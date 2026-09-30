// pokebuddy setup / uninstall — 남의 컴퓨터에 설치하는 부분이라 가장 조심스럽게 다룬다.
//
//   1. 펫 데이터 폴더   ~/.claude/pokebuddy — 훅은 이 폴더가 없으면 아무것도 안 한다
//   2. 상태 훅         dist/hooks/pokebuddy-state.js(TS 빌드 산출물)를 ~/.claude/scripts/hooks/pokebuddy-state.cjs 로 복사.
//                      CLI 마다 이벤트 등록은 하지 않는다 — 설정창 → 사용자 → 연결 탭의 버튼(connectCli)으로만 한다 (2026-09-28 사용자 결정).
//                      setup 은 옛 이름(termimon·pkmon) 등록 걷기만 계속한다
//                      dist/ 가 없으면(git clone 직후) tsc 가 있을 때 npm run build 를 먼저 돌리고, 못 하면 훅 단계를 건너뛰고 알린다
//   3. 옛 에디터 확장   예전 버전이 설치한 VS Code 계열 확장과 그 기록(cli.json · windows/)을 걷는다 (2026-09-27 창 모드 삭제)
//   4. 옛 이름          termimon·pkmon 데이터 폴더를 가져오고, 옛 훅 등록·훅 파일·데이터 폴더를 걷는다
//
// 원칙
//   - 설정 파일은 백업을 남기고, 이미 있는 항목은 건드리지 않고, 몇 번을 돌려도 결과가 같다
//   - 파싱할 수 없는 설정 파일은 고치려 들지 않고 멈춘다
//   - --dry-run 이면 무엇을 바꿀지만 보여 준다
const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PATHS, LEGACY_HOME_ITEMS, migrateLegacyHome } = require("../config.js");

const PROJECT = path.join(__dirname, "..");
const HOOK_NAME = "pokebuddy-state.cjs";
// 훅 원본은 TS 빌드 산출물 (src/hooks/pokebuddy-state.ts → dist/). 목적지 이름은 .cjs — 내용이 CJS 라 그대로 돈다
const HOOK_SOURCE = path.join(PROJECT, "dist", "hooks", "pokebuddy-state.js");
// 옛 이름(termimon·pkmon) 시절에 설치한 훅 — setup 이 새 이름으로 바꾸고, uninstall 이 함께 지운다
const LEGACY_HOOK_NAMES = ["termimon-state.cjs", "pkmon-state.cjs"];
// 예전 버전이 설치한 에디터 확장 — 지금 이름과 옛 이름. setup·uninstall 이 깔려 있으면 지운다
const RETIRED_EXTENSION_IDS = ["local.pokebuddy-active-terminal", "local.termimon-active-terminal", "local.pkmon-active-terminal"];

// Claude Code 는 CLAUDE_CONFIG_DIR 로 설정 폴더를 옮길 수 있다
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const hookTarget = () => path.join(claudeDir(), "scripts", "hooks", HOOK_NAME);
const legacyHookTargets = () => LEGACY_HOOK_NAMES.map((name) => path.join(claudeDir(), "scripts", "hooks", name));

// 훅을 등록할 CLI — 설정 파일 모양이 셋 다 { hooks: { 이벤트: [{ matcher?, hooks: [{ type: "command", command, … }] }] } } 다.
//   events   이벤트 → matcher (undefined 면 넣지 않는다 — 모든 경우에 맞는다)
//   handler  우리 훅 한 항목. 타임아웃 단위가 CLI 마다 다르다 (claude·codex 초, gemini ms)
//   always   설정 폴더가 없어도 등록한다 — 펫 데이터가 ~/.claude 아래라 claude 만
const TARGETS = [
  {
    cli: "claude",
    name: "Claude Code",
    dir: claudeDir,
    file: "settings.json",
    always: true,
    events: {
      SessionStart: undefined,
      UserPromptSubmit: "",
      PreToolUse: ".*",
      PermissionRequest: ".*",
      // 승인한 도구가 끝나면 작업 중으로 돌아간다 — 없으면 긴 명령이 도는 내내 기다리는 것처럼 보인다
      PostToolUse: ".*",
      PostToolUseFailure: ".*",
      Stop: undefined,
      StopFailure: undefined,
    },
    // claude 는 async 훅을 기다리지 않는다
    handler: (command) => ({ type: "command", command, async: true, timeout: 5 }),
  },
  {
    cli: "gemini",
    name: "Gemini CLI",
    dir: () => path.join(os.homedir(), ".gemini"),
    file: "settings.json",
    // gemini 는 훅을 모두 기다린다(async 없음) — 도구 전·모델 호출처럼 잦은 이벤트는 빼고 상태가 바뀌는 곳만.
    // 승인 대기는 Notification(ToolPermission), 승인 뒤 작업으로 돌아가는 건 AfterTool 이 알린다
    events: {
      SessionStart: undefined,
      BeforeAgent: undefined,
      Notification: undefined,
      AfterTool: undefined,
      AfterAgent: undefined,
      SessionEnd: undefined,
    },
    handler: (command) => ({ name: "pokebuddy-state", type: "command", command, timeout: 5000 }),
  },
  {
    cli: "codex",
    name: "Codex CLI",
    dir: () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    file: "hooks.json",
    // 훅은 codex 0.124 부터 (Interrupt 0.150 · SessionEnd 0.145). 옛 버전은 모르는 이벤트 이름을 무시한다.
    // async 는 넣지 않는다 — 0.148 전에는 async 훅을 "지원 안 함"으로 통째로 건너뛴다
    // PreToolUse 는 넣지 않는다 — codex 에서는 running 을 다시 알릴 뿐인데 도구마다 한 번 더 돈다.
    // Windows codex 데몬은 훅을 부를 때마다 콘솔 창을 띄운다(openai/codex#44768) — 도구당 실행을 반으로 줄인다 (2026-09-28 사용자 결정).
    // 옛 등록에 남은 PreToolUse 는 연결 탭 "갱신"(connectCli)이 걷는다
    events: {
      SessionStart: undefined,
      UserPromptSubmit: undefined,
      PermissionRequest: undefined,
      PostToolUse: undefined,
      Stop: undefined,
      Interrupt: undefined,
      SessionEnd: undefined,
    },
    handler: (command) => ({ type: "command", command, timeout: 5 }),
  },
];
const CODEX_HOOKS_SINCE = [0, 124, 0];

const settingsFile = (target) => path.join(target.dir(), target.file);

const isOurs = (hook) => typeof hook?.command === "string" && hook.command.includes(HOOK_NAME);
const isLegacy = (hook) => typeof hook?.command === "string" && LEGACY_HOOK_NAMES.some((name) => hook.command.includes(name));

// 경로에 공백이 있어도(Windows 사용자 이름 등) 깨지지 않게 따옴표로 감싼다.
// claude 는 인자 없이 — 예전 등록과 같은 모양이라야 이미 등록됨으로 보인다
const hookCommand = (target) => `node "${hookTarget()}"${target.cli === "claude" ? "" : ` --cli ${target.cli}`}`;

// 설정 파일을 읽는다. 우리가 이해하지 못하는 모양이면 고치려 들지 않고 멈춘다 —
// 남의 설정 파일을 "알아서" 바로잡다가 사용자 훅을 날리는 것보다 멈추고 알리는 편이 낫다
function readSettings(target) {
  const file = settingsFile(target);
  if (!fs.existsSync(file)) return { data: {}, existed: false };
  const stop = (why) => ({ error: `${file} 을(를) 다룰 수 없음 (${why}) — 손대지 않고 멈춘다` });
  let data;
  try {
    // 윈도우 편집기가 붙이는 BOM 은 벗긴다
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    data = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    return stop(e.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return stop("최상위가 객체가 아님");
  if ("hooks" in data) {
    if (!data.hooks || typeof data.hooks !== "object" || Array.isArray(data.hooks)) return stop("hooks 가 객체가 아님");
    for (const [event, groups] of Object.entries(data.hooks)) {
      if (!Array.isArray(groups)) return stop(`hooks.${event} 가 배열이 아님`);
    }
  }
  return { data, existed: true };
}

// 등록된 훅 명령이 가리키는 파일 — `node <경로>` · `node "<경로>"` (뒤에 --cli 인자) 모양일 때만.
// 그 밖(환경변수·플래그·래퍼)은 null
function hookPathOf(command) {
  const m = command.trim().match(/^node\s+(?:"([^"]+)"|(\S+))(?:\s+--cli\s+\S+)?$/);
  if (!m) return null;
  const p = m[1] || m[2];
  return p.replace(/^~(?=[\\/])/, os.homedir()).replace(/^\$HOME(?=[\\/])/, os.homedir());
}

// 훅 등록을 더한다 — 이미 우리 훅이 있는 이벤트는 그대로 둔다.
// 단 없는 파일을 가리키는 옛 등록(다른 경로에 설치했다 지운 경우)은 지금 경로로 고친다 — 두면 훅이 조용히 죽는다.
// 반환: { added: 더한 이벤트, fixed: 경로를 고친 이벤트 }
function addHooks(data, target) {
  const added = [];
  const fixed = [];
  if (!data.hooks) data.hooks = {}; // 모양 검사는 readSettings 가 했다
  for (const [event, matcher] of Object.entries(target.events)) {
    const groups = data.hooks[event] || [];
    const ours = groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks.filter(isOurs) : []));
    if (ours.length) {
      for (const hook of ours) {
        const file = hookPathOf(hook.command);
        // 모양을 알아볼 수 있고 그 파일이 없을 때만 고친다 — 사용자가 감싼 명령은 그대로 둔다.
        // 지금 설치하는 자리는 setup 이 먼저 복사하므로 있는 것으로 본다 (미리 보기에서도 같은 판정이 나오게)
        if (file && path.resolve(file) !== path.resolve(hookTarget()) && !fs.existsSync(file)) {
          hook.command = hookCommand(target);
          if (!fixed.includes(event)) fixed.push(event);
        }
      }
      continue;
    }
    const group = { hooks: [target.handler(hookCommand(target))] };
    if (matcher !== undefined) group.matcher = matcher;
    data.hooks[event] = [...groups, group];
    added.push(event);
  }
  return { added, fixed };
}

// 우리 훅만 걷어낸다 — 같은 묶음에 남의 훅이 있으면 그건 남긴다. match 로 옛 이름 훅만 고를 수 있다.
// keepEvent 가 참인 이벤트는 건드리지 않는다 — 지금 목록에 없는 이벤트의 우리 등록만 걷을 때 쓴다
function removeHooks(data, match = isOurs, keepEvent = () => false) {
  const removed = [];
  if (!data.hooks || typeof data.hooks !== "object") return removed;
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups) || keepEvent(event)) continue;
    let touched = false;
    const kept = [];
    for (const g of groups) {
      if (!Array.isArray(g?.hooks) || !g.hooks.some(match)) {
        kept.push(g);
        continue;
      }
      touched = true;
      const rest = g.hooks.filter((h) => !match(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (!touched) continue;
    removed.push(event);
    if (kept.length) data.hooks[event] = kept;
    else delete data.hooks[event];
  }
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;
  return removed;
}

// 지금 이벤트 목록에 없는데 우리 훅이 남아 있는 이벤트 — 옛 버전이 등록한 것(예: codex PreToolUse)
function staleEvents(data, target) {
  const hooks = data.hooks && typeof data.hooks === "object" ? data.hooks : {};
  return Object.keys(hooks).filter(
    (e) => !(e in target.events) && Array.isArray(hooks[e]) && hooks[e].some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)),
  );
}

// 백업을 남기고 원자적으로 쓴다 — 쓰다 죽어도 반쪽 파일이 남지 않는다.
//   심링크(dotfiles 저장소로 관리)면 링크가 아니라 실제 파일을 바꾼다 — rename 은 링크를 일반 파일로 덮어쓴다
//   권한을 유지한다 — API 키가 들어 있을 수 있어 0600 인 파일을 0644 로 만들면 안 된다
// 실패하면 { error } — 백신이 파일을 잡고 있는 Windows 등
function writeSettings(target, data, existed) {
  const link = settingsFile(target);
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    const file = existed ? fs.realpathSync(link) : link;
    const mode = existed ? fs.statSync(file).mode & 0o777 : 0o600;
    let backup = null;
    if (existed) {
      backup = `${link}.pokebuddy-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(file, backup);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
    fs.chmodSync(tmp, mode); // umask 가 깎은 권한을 되돌린다
    fs.renameSync(tmp, file);
    return { backup };
  } catch (e) {
    try {
      for (const f of fs.readdirSync(path.dirname(link))) {
        if (f.endsWith(`.${process.pid}.tmp`)) fs.rmSync(path.join(path.dirname(link), f), { force: true }); // 쓰다 만 임시 파일
      }
    } catch {
      // 정리 실패는 무시
    }
    return { error: `${link} 에 쓰지 못함 (${e.code || e.message}) — 에디터·백신이 파일을 잡고 있으면 닫고 다시 실행` };
  }
}

// VS Code 계열 에디터 CLI — PATH 와 앱 설치 폴더 양쪽에서 찾는다.
// 에디터 하나에 CLI 하나만 남긴다. 기준은 명령 이름이 아니라 심링크를 따라간 실제 폴더다 —
//   Cursor·Windsurf 는 자기 bin 폴더에 code 명령도 둬서, 이름으로 거르면 PATH 앞의 Cursor 가 진짜 VS Code 를 가린다
//   mac 은 여러 에디터가 /usr/local/bin 에 링크를 나란히 둬서, 링크 폴더로 거르면 한쪽이 빠진다
// 반환: [{ name, file }] — name 은 안내용 (실제 경로에서 알아본 에디터 이름)
function editorClis() {
  const isWin = process.platform === "win32";
  const candidates = [];
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
    const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
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

  const found = [];
  const seen = new Set();
  for (const file of candidates) {
    let real;
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
function editorName(real) {
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
function runEditor(cli, args) {
  const opts = { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
  if (process.platform === "win32" && /\.cmd$/i.test(cli)) {
    return execFileSync(process.env.comspec || "cmd.exe", ["/d", "/s", "/c", `""${cli}" ${args.map((a) => `"${a}"`).join(" ")}"`], {
      ...opts,
      windowsVerbatimArguments: true,
    });
  }
  return execFileSync(cli, args, opts);
}

const say = (line = "") => process.stdout.write(`${line}\n`);

// 훅 원본(dist/)이 있게 한다 — git clone 으로 받았으면 dist/ 가 없다 (빌드 산출물이라 저장소에 넣지 않는다. npm 배포본에는 prepack 이 넣는다).
// tsc 가 있으면(개발 의존성 설치됨) npm run build 를 돌린다. 미리 보기에서는 만들지 않고 예정으로만 둔다.
// 없는 원본을 등록하면 CLI 이벤트마다 없는 파일을 실행하게 되므로, 못 만들면 부르는 쪽이 훅 단계(파일·등록)를 건너뛴다
// 반환: { ready: true, built? } · { ready: false, willBuild: true } (미리 보기) · { ready: false, note } (못 만듦)
const TSC = path.join(PROJECT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
function ensureHookSource({ dryRun = false } = {}) {
  if (fs.existsSync(HOOK_SOURCE)) return { ready: true };
  if (!fs.existsSync(TSC)) return { ready: false, note: `${HOOK_SOURCE} 없음 — 빌드가 필요하다 (npm run build)` };
  if (dryRun) return { ready: false, willBuild: true };
  try {
    // npm 은 셸을 거쳐 찾는다 (Windows 의 npm.cmd). 출력은 버린다 — 실패는 파일 유무로 판정
    execSync("npm run build", { cwd: PROJECT, stdio: "ignore", timeout: 180_000, windowsHide: true });
  } catch {
    // 아래에서 파일 유무로 판정
  }
  if (fs.existsSync(HOOK_SOURCE)) return { ready: true, built: true };
  return { ready: false, note: "npm run build 가 실패 — 직접 돌려 오류를 확인한다" };
}

// CLI 하나에 훅을 등록한다 — setup 이 전부에, 설정창 "연결" 버튼이 하나에 쓴다. 출력하지 않고 결과만 돌려준다.
// 반환: { skipped } (CLI 를 안 씀) · { error, wrote:false } (설정 파일을 못 읽음) ·
//       { changed, what[], legacy[], added[], fixed[], wrote, backup?, error?, notes[] }
function registerTarget(t, { dryRun = false } = {}) {
  if (!t.always && !fs.existsSync(t.dir())) return { skipped: `설치 안 됨 (${t.dir()} 없음) — 건너뜀` };
  const read = readSettings(t);
  if (read.error) return { error: read.error, wrote: false };
  // 옛 이름 등록은 걷고 새 훅으로 다시 등록한다 — 두면 옛 훅과 새 훅이 함께 돈다
  const legacy = removeHooks(read.data, isLegacy);
  // 목록에서 빠진 이벤트의 우리 등록을 걷는다 — 우리 명령만. 남의 훅은 그대로
  const stale = removeHooks(read.data, isOurs, (e) => e in t.events);
  const { added, fixed } = addHooks(read.data, t);
  const what = [
    legacy.length ? `옛 이름(termimon·pkmon) 훅 ${legacy.length}개 걷음${dryRun ? " 예정" : ""}` : "",
    stale.length ? `목록에 없는 이벤트 ${stale.length}개 걷음${dryRun ? " 예정" : ""}: ${stale.join(", ")}` : "",
    added.length ? `이벤트 ${added.length}개 추가${dryRun ? " 예정" : ""}: ${added.join(", ")}` : "",
    fixed.length ? `없는 경로를 가리키던 ${fixed.length}개 고침${dryRun ? " 예정" : ""}: ${fixed.join(", ")}` : "",
  ].filter(Boolean);
  const out = { changed: what.length > 0, what, legacy, stale, added, fixed, wrote: false, notes: hookNotes(t, read.data, added.length > 0) };
  if (out.changed && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

// CLI 하나의 훅 등록을 걷는다 (옛 이름 등록도 함께). 반환: { skipped } · { error } · { removed[], wrote, backup? }
function unregisterTarget(t, { dryRun = false } = {}) {
  if (!fs.existsSync(settingsFile(t))) return { skipped: "설정 파일 없음", removed: [] };
  const read = readSettings(t);
  if (read.error) return { error: read.error, removed: [] };
  const removed = removeHooks(read.data, (h) => isOurs(h) || isLegacy(h));
  const out = { removed, wrote: false };
  if (removed.length && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

// CLI 하나의 옛 이름 훅 등록만 걷는다 — setup 이 쓴다. 우리 훅은 등록하지도 걷지도 않는다.
// 반환: { skipped } · { error, removed:[] } (설정 파일을 못 읽음) · { removed[], wrote, backup?, error? }
function cleanLegacyTarget(t, { dryRun = false } = {}) {
  if (!fs.existsSync(settingsFile(t))) return { skipped: true, removed: [] };
  const read = readSettings(t);
  if (read.error) return { error: read.error, removed: [] };
  const removed = removeHooks(read.data, isLegacy);
  const out = { removed, wrote: false };
  if (removed.length && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

const targetOf = (cli) => TARGETS.find((t) => t.cli === cli) || null;

// 훅 파일을 최신으로 둔다 — 등록만 있고 파일이 없으면 CLI 이벤트마다 없는 파일을 실행한다.
// 반환: "최신" | "복사함" | "바꿈" | "빌드 뒤 복사 예정"(미리 보기, dist 없음) | null (원본을 만들 수 없다 — 부르는 쪽이 등록도 멈춘다)
function ensureHookFile({ dryRun = false } = {}) {
  const source = ensureHookSource({ dryRun });
  if (!source.ready) return source.willBuild ? "빌드 뒤 복사 예정" : null;
  const target = hookTarget();
  const exists = fs.existsSync(target);
  const same = exists && fs.readFileSync(target).equals(fs.readFileSync(HOOK_SOURCE));
  if (same) return "최신";
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(HOOK_SOURCE, target);
  }
  return exists ? "바꿈" : "복사함";
}

// 에이전트 연결 — 설정창 "연결" 버튼·커맨드 agent.connect 가 부른다 (src/agents). 훅 파일을 두고 그 CLI 에 등록한다
function connectCli(cli, { dryRun = false } = {}) {
  const t = targetOf(cli);
  if (!t) return { ok: false, reason: "unknown-cli" };
  if (!fs.existsSync(PATHS.home) && !dryRun) fs.mkdirSync(PATHS.home, { recursive: true }); // 훅은 이 폴더가 없으면 아무것도 안 한다
  const hookFile = ensureHookFile({ dryRun });
  // 훅 원본이 없으면 등록하지 않는다 — 없는 파일을 등록하면 CLI 이벤트마다 죽은 명령이 돈다. reason 은 ConnectResult(src/agents/registry.ts)의 것만
  if (hookFile === null) return { ok: false, reason: "settings-error", detail: `훅 파일을 만들 수 없음 — ${ensureHookSource({ dryRun }).note}`, hookFile: "없음" };
  const r = registerTarget(t, { dryRun });
  if (r.skipped) return { ok: false, reason: "not-installed", detail: r.skipped, hookFile };
  if (r.error && !r.wrote) return { ok: false, reason: "settings-error", detail: r.error, hookFile };
  return { ok: true, reason: "ok", changed: r.changed, added: r.added, fixed: r.fixed, stale: r.stale, backup: r.backup || null, notes: r.notes, hookFile, error: r.error || null };
}

// 에이전트 연결 해제 — 그 CLI 의 훅 등록만 걷는다. 훅 파일은 다른 CLI 가 쓰고 있을 수 있어 남긴다
function disconnectCli(cli, { dryRun = false } = {}) {
  const t = targetOf(cli);
  if (!t) return { ok: false, reason: "unknown-cli" };
  const r = unregisterTarget(t, { dryRun });
  if (r.skipped) return { ok: true, reason: "ok", removed: [], detail: r.skipped };
  if (r.error) return { ok: false, reason: "settings-error", detail: r.error, removed: r.removed };
  return { ok: true, reason: "ok", removed: r.removed, backup: r.backup || null };
}

// sudo 로 돌리면 ~/.claude 아래에 root 소유 파일이 생겨, 이후 Claude·펫이 그 파일을 못 고친다
function refuseRoot(what) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return false;
  say(`pokebuddy ${what} 은 sudo 없이 실행한다 — 관리자 권한으로 만든 파일은 이후 일반 사용자가 고칠 수 없다`);
  process.exitCode = 1;
  return true;
}

// Electron 실행 파일을 받아 둔다. 설치 때(postinstall) 못 받았으면(오프라인·--ignore-scripts) 여기서 받는다.
// 펫을 띄울 때는 받지 않으므로(!pokebuddy 가 그만큼 멈춘다) setup 이 유일한 두 번째 기회다
function ensureElectron(dryRun) {
  let dir;
  try {
    dir = path.dirname(require.resolve("electron/package.json"));
  } catch {
    say("Electron       패키지가 없음 — npm install 을 다시 한다");
    process.exitCode = 1;
    return;
  }
  const ready = (() => {
    try {
      return fs.existsSync(path.join(dir, "dist", fs.readFileSync(path.join(dir, "path.txt"), "utf8").trim()));
    } catch {
      return false;
    }
  })();
  if (ready) return say("Electron       준비됨");
  if (dryRun) return say("Electron       받을 예정 (약 100MB)");
  say("Electron       받는 중 (약 100MB)…");
  try {
    require("electron"); // Electron 44: 실행 파일이 없으면 이 순간 받는다
    say("Electron       준비됨");
  } catch (e) {
    say(`Electron       받지 못함 (${String(e.message).split("\n")[0]}) — 네트워크를 확인하고 다시 pokebuddy setup`);
    process.exitCode = 1;
  }
}

function setup({ dryRun = false, editor = true } = {}) {
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
function removeRetiredExtensions(name, cli, dryRun) {
  let installed;
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
      say(`옛 에디터 확장 ${name}: ${id} 제거 실패 (${String(e.message).split("\n")[0]})`);
    }
  }
}

// 예전 확장이 쓰던 실행 경로 기록(cli.json)과 창 기록 폴더(windows/) — 남아 있으면 지운다
function removeRetiredEditorFiles(dryRun) {
  for (const file of [PATHS.legacyCli, PATHS.legacyWindows]) {
    if (!fs.existsSync(file)) continue;
    say(`옛 확장 기록   ${file}  ${dryRun ? "지울 예정" : "지움"}`);
    if (!dryRun) fs.rmSync(file, { recursive: true, force: true });
  }
}

// 옛 이름(termimon·pkmon) 데이터 폴더를 지운다 — 가져올 것(LEGACY_HOME_ITEMS)이 새 폴더에 다 있을 때만.
// 가져오기 전에 새 폴더가 먼저 생겨 못 가져왔으면 남기고 알린다
function removeLegacyHomes(dryRun) {
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
      say(`               다 지우지 못함 (${e.code || e.message}) — 떠 있는 옛 펫을 내린 뒤 다시 pokebuddy setup`);
    }
  }
}

// codex --version → [주, 부, 수]. 못 알아내면 null (설치 안 됨·PATH 밖)
function codexVersion() {
  try {
    // Windows 의 codex 는 npm 이 만든 codex.cmd 라 셸을 거쳐야 한다. 인자가 고정이라 셸에 넘겨도 안전하다
    const out = execSync("codex --version", { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? m.slice(1).map(Number) : null;
  } catch {
    return null;
  }
}
const olderThan = (a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;

// 등록은 됐지만 CLI 쪽 사정으로 안 돌 수 있는 경우를 알린다
function hookNotes(target, data, added) {
  const notes = [];
  if (target.cli === "gemini" && data.hooksConfig && data.hooksConfig.enabled === false) {
    notes.push("hooksConfig.enabled 가 false 라 gemini 훅이 꺼져 있다 — 상태에 반응하지 않는다");
  }
  if (target.cli === "codex") {
    const v = codexVersion();
    if (v && olderThan(v, CODEX_HOOKS_SINCE)) {
      notes.push(`codex ${v.join(".")} 에는 훅이 없다 — ${CODEX_HOOKS_SINCE.join(".")} 이상으로 올리면 상태에 반응한다 (npm i -g @openai/codex)`);
    } else if (v && added && !olderThan(v, [0, 129, 0])) {
      notes.push("codex 는 새 훅을 한 번 승인해야 돌린다 — codex 에서 /hooks");
    }
  }
  return notes;
}

function uninstall({ dryRun = false, purge = false, editor = true } = {}) {
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

// 진단용 — 훅 파일이 최신인가, CLI 마다 등록돼 있는가
// 반환: { file, current, clis: [{ name, used, error?, registered?, total?, stale? }] } — used 가 false 면 그 CLI 를 안 쓴다.
// stale 은 지금 목록에 없는데 우리 훅이 남은 이벤트 — 연결 탭 "갱신" 이 걷는다
function hookInstalled() {
  const file = fs.existsSync(hookTarget());
  // 업데이트 뒤 훅 파일이 옛 버전인지 — 내용이 번들(dist/)과 다르면 pokebuddy setup 으로 바꿔야 한다. dist/ 가 없으면(빌드 전) 최신으로 볼 수 없다
  const current = file && fs.existsSync(HOOK_SOURCE) && fs.readFileSync(hookTarget()).equals(fs.readFileSync(HOOK_SOURCE));
  const clis = TARGETS.map((t) => {
    if (!t.always && !fs.existsSync(t.dir())) return { name: t.name, used: false };
    const read = readSettings(t);
    if (read.error) return { name: t.name, used: true, error: read.error };
    const hooks = read.data.hooks || {};
    const events = Object.keys(t.events);
    const registered = events.filter(
      (e) => Array.isArray(hooks[e]) && hooks[e].some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)),
    ).length;
    return { name: t.name, used: true, registered, total: events.length, stale: staleEvents(read.data, t) };
  });
  // source — 비교할 원본(dist/)이 있는가. 없으면(개발 실행에서 빌드 전) 옛 버전인지 판정하지 않는다
  return { file, current, source: fs.existsSync(HOOK_SOURCE), clis };
}

// 앱이 켤 때 부르는 정리 — 새로 등록하지 않는다 (2026-09-28 사용자 결정 "기존 훅 사용자 자동 정리").
//   CLI 등록  우리 훅이 남은 설정 파일에서 지금 목록에 없는 우리 이벤트만 걷는다(예: 옛 codex PreToolUse). 남의 훅·백업 규칙 그대로. 걷을 게 없으면 쓰지 않는다
//   훅 파일   이미 있을 때만 원본과 다르면 새 버전으로 바꾼다. 없으면 만들지 않는다 — 연결은 연결 탭 버튼으로만 한다
// 반환: { clis: [{ cli, removed[], backup?, error? }] (걷은 CLI 만), hookFile: "최신" | "바꿈" | "없음" | "원본 없음" | "실패", error? }
function tidyInstalled({ dryRun = false } = {}) {
  const clis = [];
  for (const t of TARGETS) {
    if (!fs.existsSync(settingsFile(t))) continue;
    const read = readSettings(t);
    if (read.error) {
      clis.push({ cli: t.cli, removed: [], error: read.error });
      continue;
    }
    if (!staleEvents(read.data, t).length) continue;
    const removed = removeHooks(read.data, isOurs, (e) => e in t.events);
    const out = { cli: t.cli, removed };
    if (!dryRun) {
      const wrote = writeSettings(t, read.data, read.existed);
      if (wrote.error) out.error = wrote.error;
      else out.backup = wrote.backup;
    }
    clis.push(out);
  }
  const target = hookTarget();
  if (!fs.existsSync(target)) return { clis, hookFile: "없음" };
  if (!fs.existsSync(HOOK_SOURCE)) return { clis, hookFile: "원본 없음" };
  if (fs.readFileSync(target).equals(fs.readFileSync(HOOK_SOURCE))) return { clis, hookFile: "최신" };
  try {
    if (!dryRun) fs.copyFileSync(HOOK_SOURCE, target);
    return { clis, hookFile: "바꿈" };
  } catch (e) {
    return { clis, hookFile: "실패", error: `${target} 에 쓰지 못함 (${e.code || e.message})` };
  }
}

// 연결 점검(src/agents/check.ts) — 그 CLI 에 등록하는 것과 같은 명령과 훅 파일 자리
const hookCommandFor = (cli) => {
  const t = targetOf(cli);
  return t ? hookCommand(t) : null;
};

module.exports = { setup, uninstall, hookInstalled, connectCli, disconnectCli, tidyInstalled, hookCommandFor, hookFile: hookTarget, TARGET_CLIS: TARGETS.map((t) => ({ cli: t.cli, name: t.name })) };
