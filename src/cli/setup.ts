// pokebuddy setup / uninstall — 남의 컴퓨터에 설치하는 부분이라 가장 조심스럽게 다룬다.
//
//   1. 펫 데이터 폴더   ~/.claude/pokebuddy — 훅은 이 폴더가 없으면 아무것도 안 한다
//   2. 상태 훅         dist/hooks/pokebuddy-state.js(TS 빌드 산출물)를 ~/.claude/scripts/hooks/pokebuddy-state.cjs 로 복사.
//                      CLI 마다 이벤트 등록은 하지 않는다 — 설정창 → 사용자 → 연결 탭의 버튼(connectCli)으로만 한다 (2026-09-28 사용자 결정).
//                      setup 은 옛 이름(termimon·pkmon) 등록 걷기만 계속한다
//                      dist/ 가 없으면(git clone 직후) bin/pokebuddy 가 setup 앞에서 npm run build 를 먼저 돌린다(이 파일도 dist/platform 을 읽는다).
//                      훅 원본만 없으면 여기서 다시 빌드해 보고, 못 하면 훅 단계를 건너뛰고 알린다
//   3. 옛 에디터 확장   예전 버전이 설치한 VS Code 계열 확장과 그 기록(cli.json · windows/)을 걷는다 (2026-09-27 창 모드 삭제)
//   4. 옛 이름          termimon·pkmon 데이터 폴더를 가져오고, 옛 훅 등록·훅 파일·데이터 폴더를 걷는다
//
// 원칙
//   - 설정 파일은 백업을 남기고, 이미 있는 항목은 건드리지 않고, 몇 번을 돌려도 결과가 같다
//   - 파싱할 수 없는 설정 파일은 고치려 들지 않고 멈춘다
//   - --dry-run 이면 무엇을 바꿀지만 보여 준다
// (예전 cli/setup.js. 도구 레인 T7b-3 에서 TypeScript 로 옮겼다. 훅 등록 부분은 src/agents/hooks.ts)
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanLegacyTarget,
  ensureHookSource,
  hookTarget,
  HOOK_SOURCE,
  isLegacy,
  isOurs,
  legacyHookTargets,
  readSettings,
  removeHooks,
  settingsFile,
  TARGETS,
  writeSettings,
} from "../agents/hooks";
import { PATHS } from "../platform/paths";
import { LEGACY_HOME_ITEMS, migrateLegacyHome } from "../platform/user-config";
import { electronPath } from "./electron-path";

// 예전 버전이 설치한 에디터 확장 — 지금 이름과 옛 이름. setup·uninstall 이 깔려 있으면 지운다
const RETIRED_EXTENSION_IDS = ["local.pokebuddy-active-terminal", "local.termimon-active-terminal", "local.pkmon-active-terminal"];

// VS Code 계열 에디터 CLI — PATH 와 앱 설치 폴더 양쪽에서 찾는다.
// 에디터 하나에 CLI 하나만 남긴다. 기준은 명령 이름이 아니라 심링크를 따라간 실제 폴더다 —
//   Cursor·Windsurf 는 자기 bin 폴더에 code 명령도 둬서, 이름으로 거르면 PATH 앞의 Cursor 가 진짜 VS Code 를 가린다
//   mac 은 여러 에디터가 /usr/local/bin 에 링크를 나란히 둬서, 링크 폴더로 거르면 한쪽이 빠진다
// 반환: [{ name, file }] — name 은 안내용 (실제 경로에서 알아본 에디터 이름)
function editorClis(): Array<{ name: string; file: string }> {
  const isWin = process.platform === "win32";
  const candidates: string[] = [];
  const names = ["code", "code-insiders", "cursor", "windsurf", "antigravity-ide", "antigravity", "codium"];
  const exts = isWin ? [".cmd", ".exe"] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) for (const ext of exts) candidates.push(path.join(dir, name + ext));
  }
  if (process.platform === "darwin") {
    for (const root of ["/Applications", path.join(os.homedir(), "Applications")]) {
      candidates.push(
        path.join(root, "Visual Studio Code.app/Contents/Resources/app/bin/code"),
        path.join(root, "Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"),
        path.join(root, "Cursor.app/Contents/Resources/app/bin/cursor"),
        path.join(root, "Windsurf.app/Contents/Resources/app/bin/windsurf"),
        path.join(root, "Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"),
        path.join(root, "Antigravity.app/Contents/Resources/app/bin/antigravity"),
        path.join(root, "VSCodium.app/Contents/Resources/app/bin/codium"),
      );
    }
  } else if (isWin) {
    const local = process.env.LOCALAPPDATA || "";
    const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
    candidates.push(
      path.join(local, "Programs", "Microsoft VS Code", "bin", "code.cmd"),
      ...programs.map((p) => path.join(p, "Microsoft VS Code", "bin", "code.cmd")),
      path.join(local, "Programs", "Microsoft VS Code Insiders", "bin", "code-insiders.cmd"),
      path.join(local, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
      path.join(local, "Programs", "Windsurf", "bin", "windsurf.cmd"),
      path.join(local, "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
      path.join(local, "Programs", "Antigravity", "bin", "antigravity.cmd"),
      path.join(local, "Programs", "VSCodium", "bin", "codium.cmd"),
      ...programs.map((p) => path.join(p, "VSCodium", "bin", "codium.cmd")),
    );
  }

  const found: Array<{ name: string; file: string }> = [];
  const seen = new Set<string>();
  for (const file of candidates) {
    let real: string;
    try {
      if (!fs.statSync(file).isFile()) continue;
      real = fs.realpathSync(file);
    } catch {
      continue; // 없는 후보
    }
    const dir = path.dirname(real).toLowerCase();
    if (seen.has(dir)) continue;
    seen.add(dir);
    found.push({ name: editorName(real), file });
  }
  return found;
}

// 실제 경로로 어느 에디터인지 알아본다 — "code" 명령이 사실은 Cursor 일 수 있다
function editorName(real: string): string {
  const p = real.toLowerCase();
  if (p.includes("insiders")) return "VS Code Insiders";
  if (p.includes("cursor")) return "Cursor";
  if (p.includes("windsurf")) return "Windsurf";
  if (p.includes("antigravity")) return "Antigravity";
  if (p.includes("codium")) return "VSCodium";
  if (p.includes("code")) return "VS Code";
  return path.basename(real);
}

// 에디터 CLI 실행 — Windows 의 .cmd 는 셸을 거쳐야 한다
function runEditor(cli: string, args: string[]): string {
  const opts: ExecFileSyncOptionsWithStringEncoding = { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
  if (process.platform === "win32" && /\.cmd$/i.test(cli)) {
    // windowsVerbatimArguments — Node 의 execFileSync 는 받아서 spawnSync 로 넘기지만 @types/node 의 ExecFileSyncOptions 에는 없다
    return execFileSync(process.env.comspec || "cmd.exe", ["/d", "/s", "/c", `""${cli}" ${args.map((a) => `"${a}"`).join(" ")}"`], {
      ...opts,
      windowsVerbatimArguments: true,
    } as ExecFileSyncOptionsWithStringEncoding);
  }
  return execFileSync(cli, args, opts);
}

const say = (line = ""): boolean => process.stdout.write(`${line}\n`);

// sudo 로 돌리면 ~/.claude 아래에 root 소유 파일이 생겨, 이후 Claude·펫이 그 파일을 못 고친다
function refuseRoot(what: string): boolean {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return false;
  say(`pokebuddy ${what} 은 sudo 없이 실행한다 — 관리자 권한으로 만든 파일은 이후 일반 사용자가 고칠 수 없다`);
  process.exitCode = 1;
  return true;
}

// Electron 실행 파일을 받아 둔다. 설치 때(postinstall) 못 받았으면(오프라인·--ignore-scripts) 여기서 받는다.
// 펫을 띄울 때는 받지 않으므로(!pokebuddy 가 그만큼 멈춘다) setup 이 유일한 두 번째 기회다
function ensureElectron(dryRun: boolean): boolean | undefined {
  try {
    require.resolve("electron/package.json");
  } catch {
    say("Electron       패키지가 없음 — npm install 을 다시 한다");
    process.exitCode = 1;
    return;
  }
  // 받아 두었는가 — 실행 파일 경로 풀이는 src/cli/electron-path.ts 한 곳(옛 lib/electron.js 와 이 함수가 같은 일을 두 벌로 했다)
  if (electronPath()) return say("Electron       준비됨");
  if (dryRun) return say("Electron       받을 예정 (약 100MB)");
  say("Electron       받는 중 (약 100MB)…");
  try {
    require("electron"); // Electron 44: 실행 파일이 없으면 이 순간 받는다
    say("Electron       준비됨");
  } catch (e) {
    say(`Electron       받지 못함 (${String((e as Error).message).split("\n")[0]}) — 네트워크를 확인하고 다시 pokebuddy setup`);
    process.exitCode = 1;
  }
}

export function runSetup({ dryRun = false, editor = true }: { dryRun?: boolean; editor?: boolean } = {}): void {
  if (refuseRoot("setup")) return;
  say(dryRun ? "pokebuddy setup — 미리 보기 (아무것도 바꾸지 않는다)\n" : "pokebuddy setup\n");
  ensureElectron(dryRun);

  // 0. 옛 이름(termimon·pkmon) 데이터 폴더에서 설정·위치·그림 캐시를 가져온다 — 새 폴더를 만드는 1 보다 먼저.
  // 명령을 한 번이라도 실행했으면 config.load 가 이미 가져왔다. 옛 폴더 지우기는 옛 훅·확장을 걷은 뒤 맨 끝에
  if (!dryRun) migrateLegacyHome();

  // 1. 펫 데이터 폴더
  const homeExists = fs.existsSync(PATHS.home);
  say(`펫 데이터 폴더  ${PATHS.home}  ${homeExists ? "있음" : dryRun ? "만들 예정" : "만듦"}`);
  if (!homeExists && !dryRun) fs.mkdirSync(PATHS.home, { recursive: true });

  // 2. 훅 파일 — 원본은 dist/hooks/pokebuddy-state.js. 없으면 빌드해 보고(tsc 가 있을 때), 못 만들면 훅 단계(파일·등록)를 건너뛴다.
  //    같으면 건너뛴다. 다르면 새 버전으로 바꾼다 (훅은 이 도구의 일부라 사용자가 고칠 파일이 아니다)
  let legacyKept = false; // 옛 이름 훅 등록이 남았을 수 있다 — 그러면 옛 훅 파일을 지우지 않는다
  const source = ensureHookSource({ dryRun });
  const skipHooks = !source.ready && !source.willBuild;
  const target = hookTarget();
  if (skipHooks) {
    say(`훅 파일        ${source.note} — 훅 단계(파일·등록) 건너뜀`);
    process.exitCode = 1;
    legacyKept = true; // 등록을 손대지 않았으니 옛 등록도 그대로다
  } else if (source.willBuild) {
    say(`훅 파일        ${target}  dist/ 없음 — npm run build 뒤 복사할 예정`);
  } else {
    if (source.built) say(`훅 빌드        npm run build  dist/ 가 없어 만듦`);
    const same = fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(HOOK_SOURCE));
    say(`훅 파일        ${target}  ${same ? "최신" : fs.existsSync(target) ? (dryRun ? "새 버전으로 바꿀 예정" : "새 버전으로 바꿈") : dryRun ? "복사할 예정" : "복사함"}`);
    if (!same && !dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(HOOK_SOURCE, target);
    }
  }

  // 3. CLI 마다 옛 이름(termimon·pkmon) 훅 등록만 걷는다 — 새 등록은 하지 않는다.
  //    CLI 연결은 설정창 → 사용자 → 연결 탭의 버튼으로만 한다 (2026-09-28 사용자 결정). 이미 등록된 우리 훅은 그대로 둔다
  for (const t of skipHooks ? [] : TARGETS) {
    const label = `옛 훅 등록     ${t.name.padEnd(12)}`;
    const r = cleanLegacyTarget(t, { dryRun });
    if (r.skipped || (!r.error && !r.removed.length)) continue;
    if (!r.removed.length) {
      // 설정 파일을 못 읽었다 — 옛 등록이 남았을 수 있어 옛 훅 파일을 지우지 않는다
      say(`${label}${r.error}`);
      legacyKept = true;
      continue;
    }
    say(`${label}${settingsFile(t)}  ${r.removed.length}개 ${dryRun ? "걷을 예정" : "걷음"}`);
    if (r.error) {
      say(`               ${r.error}`);
      process.exitCode = 1;
      legacyKept = true;
    } else if (r.backup) say(`               백업: ${r.backup}`);
  }
  say("CLI 연결       설정창 → 사용자 → 연결 탭에서 CLI 마다 연결한다");

  // 옛 훅 파일 — 옛 등록을 다 걷었을 때만 지운다. 등록만 남고 파일이 없으면 CLI 이벤트마다 없는 파일을 실행한다
  for (const legacyHook of legacyHookTargets()) {
    if (!fs.existsSync(legacyHook)) continue;
    if (legacyKept) say(`옛 훅 파일     ${legacyHook}  설정에서 옛 등록을 다 걷지 못해 남김`);
    else {
      say(`옛 훅 파일     ${legacyHook}  ${dryRun ? "지울 예정" : "지움"}`);
      if (!dryRun) fs.rmSync(legacyHook, { force: true });
    }
  }

  // 4. 옛 에디터 확장 — 예전 버전이 창마다 펫을 띄우던 확장과 그 기록을 걷는다. 남겨 두면 확장이 창 펫을 계속 띄우려 든다
  removeRetiredEditorFiles(dryRun);
  if (!editor) say("옛 에디터 확장 --no-editor — 건너뜀");
  else for (const { name, file: cli } of editorClis()) removeRetiredExtensions(name, cli, dryRun);

  removeLegacyHomes(dryRun);

  say();
  if (dryRun) say("실제로 적용하려면: pokebuddy setup");
  else if (process.exitCode) say("설치가 덜 끝났다 — 위 메시지를 확인한 뒤 다시 pokebuddy setup");
  else {
    say("끝. pokebuddy companion 으로 동반자를 띄우세요. CLI(claude·codex·gemini) 연결은 설정창 → 사용자 → 연결 탭에서 한다");
  }
}

// 예전 버전이 설치한 에디터 확장이 깔려 있으면 지운다 — 두면 창 기록을 계속 쓰고 창 펫을 띄우려 든다.
// 목록으로 먼저 본다 — 없는 확장을 지우면 실패로 끝나 "없음"과 "못 지움"을 가를 수 없다
function removeRetiredExtensions(name: string, cli: string, dryRun: boolean): void {
  let installed: string[];
  try {
    const ids = runEditor(cli, ["--list-extensions"])
      .split(/\r?\n/)
      .map((id) => id.trim().toLowerCase());
    installed = RETIRED_EXTENSION_IDS.filter((id) => ids.includes(id));
  } catch {
    return;
  }
  for (const id of installed) {
    if (dryRun) {
      say(`옛 에디터 확장 ${name}: ${id} 제거할 예정`);
      continue;
    }
    try {
      runEditor(cli, ["--uninstall-extension", id]);
      say(`옛 에디터 확장 ${name}: ${id} 제거함 — 열려 있는 창은 다시 불러와야 적용된다`);
    } catch (e) {
      say(`옛 에디터 확장 ${name}: ${id} 제거 실패 (${String((e as Error).message).split("\n")[0]})`);
    }
  }
}

// 예전 확장이 쓰던 실행 경로 기록(cli.json)과 창 기록 폴더(windows/) — 남아 있으면 지운다
function removeRetiredEditorFiles(dryRun: boolean): void {
  for (const file of [PATHS.legacyCli, PATHS.legacyWindows]) {
    if (!fs.existsSync(file)) continue;
    say(`옛 확장 기록   ${file}  ${dryRun ? "지울 예정" : "지움"}`);
    if (!dryRun) fs.rmSync(file, { recursive: true, force: true });
  }
}

// 옛 이름(termimon·pkmon) 데이터 폴더를 지운다 — 가져올 것(LEGACY_HOME_ITEMS)이 새 폴더에 다 있을 때만.
// 가져오기 전에 새 폴더가 먼저 생겨 못 가져왔으면 남기고 알린다
function removeLegacyHomes(dryRun: boolean): void {
  for (const old of PATHS.legacyHomes) {
    if (!fs.existsSync(old)) continue;
    if (dryRun && !fs.existsSync(PATHS.home)) {
      say(`옛 데이터      ${old}  설정·위치·그림 캐시를 ${PATHS.home} 로 가져오고 지울 예정`);
      continue;
    }
    const missing = LEGACY_HOME_ITEMS.filter((item) => fs.existsSync(path.join(old, item)) && !fs.existsSync(path.join(PATHS.home, item)));
    if (missing.length) {
      say(`옛 데이터      ${old}  남김 — 새 폴더에 없는 것: ${missing.join(", ")} (필요하면 ${PATHS.home} 로 옮긴 뒤 다시 setup)`);
      continue;
    }
    say(`옛 데이터      ${old}  ${dryRun ? "지울 예정" : "지움"} (가져올 것은 ${PATHS.home} 에 있음)`);
    if (dryRun) continue;
    try {
      fs.rmSync(old, { recursive: true, force: true });
    } catch (e) {
      // Windows — 떠 있는 옛 펫이 electron 폴더를 잡고 있다
      const err = e as NodeJS.ErrnoException;
      say(`               다 지우지 못함 (${err.code || err.message}) — 떠 있는 옛 펫을 내린 뒤 다시 pokebuddy setup`);
    }
  }
}

export function runUninstall({ dryRun = false, purge = false, editor = true }: { dryRun?: boolean; purge?: boolean; editor?: boolean } = {}): void {
  if (refuseRoot("uninstall")) return;
  say(dryRun ? "pokebuddy uninstall — 미리 보기 (아무것도 바꾸지 않는다)\n" : "pokebuddy uninstall\n");

  // 설치할 때 폴더가 없어 건너뛴 CLI 도 본다 — 그 뒤에 설정 파일이 생겼을 수 있다
  for (const t of TARGETS) {
    const label = `훅 등록        ${t.name.padEnd(12)}`;
    if (!fs.existsSync(settingsFile(t))) {
      say(`${label}설정 파일 없음`);
      continue;
    }
    const read = readSettings(t);
    if (read.error) {
      say(`${label}${read.error}`);
      process.exitCode = 1;
      continue;
    }
    const removed = removeHooks(read.data, (h) => isOurs(h) || isLegacy(h)); // 옛 이름(termimon·pkmon) 등록도 함께
    if (!removed.length) say(`${label}${settingsFile(t)}  등록된 훅 없음`);
    else if (dryRun) say(`${label}이벤트 ${removed.length}개에서 뺄 예정: ${removed.join(", ")}`);
    else {
      const wrote = writeSettings(t, read.data, read.existed);
      if (wrote.error) {
        say(`${label}${wrote.error}`);
        process.exitCode = 1;
      } else {
        say(`${label}이벤트 ${removed.length}개에서 뺌: ${removed.join(", ")}`);
        if (wrote.backup) say(`               백업: ${wrote.backup}`);
      }
    }
  }

  const target = hookTarget();
  // 등록을 못 뺐으면 훅 파일은 남긴다 — 등록만 남고 파일이 없으면 CLI 이벤트마다 없는 파일을 실행한다
  if (process.exitCode) say("훅 파일        설정에서 등록을 빼지 못해 남김");
  else {
    if (fs.existsSync(target)) {
      say(`훅 파일        ${target}  ${dryRun ? "지울 예정" : "지움"}`);
      if (!dryRun) fs.rmSync(target, { force: true });
    } else say("훅 파일        없음");
    for (const legacyHook of legacyHookTargets()) {
      if (!fs.existsSync(legacyHook)) continue;
      say(`옛 훅 파일     ${legacyHook}  ${dryRun ? "지울 예정" : "지움"}`);
      if (!dryRun) fs.rmSync(legacyHook, { force: true });
    }
  }

  // 예전 버전의 에디터 확장과 그 기록
  removeRetiredEditorFiles(dryRun);
  for (const { name, file: cli } of editor ? editorClis() : []) removeRetiredExtensions(name, cli, dryRun);

  if (purge) {
    say(`펫 데이터      ${PATHS.home}  ${dryRun ? "지울 예정" : "지움"} (설정·위치·그림 캐시)`);
    if (!dryRun) fs.rmSync(PATHS.home, { recursive: true, force: true });
    for (const old of PATHS.legacyHomes.filter((dir) => fs.existsSync(dir))) {
      say(`옛 데이터      ${old}  ${dryRun ? "지울 예정" : "지움"}`);
      if (!dryRun) fs.rmSync(old, { recursive: true, force: true });
    }
  } else {
    say(`펫 데이터      ${PATHS.home}  남김 (설정·위치·그림 캐시까지 지우려면 --purge)`);
    for (const old of PATHS.legacyHomes.filter((dir) => fs.existsSync(dir))) say(`옛 데이터      ${old}  남김 (--purge 면 함께 지운다)`);
  }
}
