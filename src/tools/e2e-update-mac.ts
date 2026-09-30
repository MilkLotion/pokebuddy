// mac 앱 업데이트 실기 시험 — 시험 앱 N 을 임시 Applications 폴더에 두고 켜서, 로컬 HTTP 가 내놓는 N+1 로 바뀌는지 본다.
// Windows 판(scripts/e2e-update.cjs)과 같은 확인 목록을 mac 자체 업데이트(src/main/mac-updater.ts)에 맞게 한다
//   준비: `npm run build`. 시험 빌드 두 개(zip, 이 Mac 아키텍처만)를 만드느라 몇 분 걸린다. mac 에서만
//   실행: node dist/tools/e2e-update-mac.js
//   시험 빌드는 다른 appId·이름(pokebuddy-update-test.app)이라 사용자의 앱과 섞이지 않는다. 링크·로그인 시 시작을 등록하지 않고
//   저장은 빌드에 박힌 임시 홈에 둔다(scripts/build-exe.cjs PB_UPDATE_TEST). 키체인은 쓰지 않는다(--use-mock-keychain). 사용자의 /Applications/PokeBuddy.app 과 ~/.claude/pokebuddy 는 건드리지 않는다.
//   관리 창 조작은 --inspect 디버거로 scripts/e2e/manage-observer.cjs 를 실어 한다. 끝나면 시험 프로세스를 내리고 임시 폴더를 지운다
//   확인: 설정 바닥이 받는 중 → 준비됨, `다시 시작` → 같은 자리의 앱이 N+1 로 바뀌어 다시 켜짐, 저장 유지, 업데이트 뒤 첫 패치노트 한 번
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.join(__dirname, "..", "..");
const PORT = 48322; // 빌드에 박히는 공급 주소 — 바꾸면 두 빌드를 다시 만든다
const FEED = `http://127.0.0.1:${PORT}/`;
const OLD = "0.7.9";
const NEW = "0.8.0"; // data/patch-notes.json 에 노트가 있는 버전 — 업데이트 뒤 첫 패치노트를 본다
const NAME = "pokebuddy-update-test";
const ARCH_DIR = process.arch === "arm64" ? "mac-arm64" : "mac"; // electron-builder 의 풀린 앱 폴더
const work = fs.mkdtempSync(path.join(os.tmpdir(), "pb-update-mac-e2e-"));
const HOME = path.join(work, "home");
const APPS = path.join(work, "Applications");
const APP = path.join(APPS, `${NAME}.app`);
const shots = path.join(work, "shots");
const checks: string[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 사용자의 것 — 시험 전후가 같아야 한다
const USER_APP = "/Applications/PokeBuddy.app";
const USER_LOCK = path.join(os.homedir(), ".claude", "pokebuddy", "companion.lock");
const mark = (file: string): string => (fs.existsSync(file) ? `${fs.statSync(file).mtimeMs}` : "none");
const userMark = (): string => `${mark(USER_APP)}|${mark(path.join(USER_APP, "Contents", "Info.plist"))}|${mark(USER_LOCK)}`;
// 업데이트 캐시 — 앱의 HOME 을 바꾸지 않으므로 진짜 ~/Library/Caches 아래 시험 이름 폴더다. 끝나면 지운다
const REAL_CACHE = path.join(os.homedir(), "Library", "Caches", `${NAME}-updater`);

async function until(test: () => boolean | Promise<boolean>, label: string, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(500);
  }
  throw new Error(`대기 실패: ${label}`);
}

const plistVersion = (app: string): string | null => {
  const r = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

// 시험 빌드 하나 — 버전과 출력 폴더만 다르다
function build(version: string): string {
  const out = path.join(work, `build-${version}`);
  process.stdout.write(`시험 빌드 ${version} …\n`);
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "build-exe.cjs"), "--mac"], {
    cwd: root,
    env: { ...process.env, PB_UPDATE_TEST: "1", PB_UPDATE_VERSION: version, PB_UPDATE_OUT: out, PB_UPDATE_FEED: FEED, PB_UPDATE_HOME: HOME },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `빌드 실패 ${version}: ${r.stderr}\n${r.stdout.slice(-2000)}`);
  assert.ok(fs.existsSync(path.join(out, ARCH_DIR, `${NAME}.app`)), `풀린 앱 없음 ${version}`);
  assert.ok(fs.existsSync(path.join(out, "latest-mac.yml")), `latest-mac.yml 없음 ${version}`);
  return out;
}

// 공급 서버 — N+1 의 latest-mac.yml·zip
function feedServer(dir: string): Promise<{ server: http.Server; log: string[] }> {
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? "/", FEED).pathname.slice(1));
    log.push(name);
    const file = path.join(dir, name);
    if (name.includes("..") || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve({ server, log })));
}

interface Home { home: string; data: string; env: NodeJS.ProcessEnv; cliEnv: NodeJS.ProcessEnv }

// 임시 HOME 과 저장 — 튜토리얼은 건너뛴 파티 한 마리
function makeHome(): Home {
  fs.rmSync(HOME, { recursive: true, force: true });
  const data = path.join(HOME, ".claude", "pokebuddy");
  fs.mkdirSync(data, { recursive: true });
  const { empty } = require(path.join(root, "dist/save/v3.js")) as { empty: (now: number) => Record<string, unknown> & { pets: unknown[]; party: { slots: unknown[] }; points: { balance: number } } };
  const { newPet } = require(path.join(root, "dist/party/create.js")) as { newPet: (o: Record<string, unknown>) => unknown };
  const save = empty(Date.now());
  save.pets.push(newPet({ id: "u1", species: "pichu", shiny: false, nature: "hardy", gender: "male", now: Date.now() }));
  save.party.slots[0] = { state: "pokemon", petId: "u1", hidden: false };
  save.starterPetId = "u1";
  save.points.balance = 1234;
  save.tutorials = Object.fromEntries(["first-care", "playground", "shop", "hatch", "party", "achievement"].map((k) => [k, { state: "skipped", steps: 0 }]));
  fs.writeFileSync(path.join(data, "save.json"), JSON.stringify(save));
  // 앱에는 HOME 을 바꾸지 않는다 — 바꾸면 macOS 가 로그인 키체인을 찾지 못해 사용자 화면에 대화상자를 띄운다(2026-09-28).
  // 앱의 임시 홈은 빌드에 박힌 update-test.json 이 준다(config.js updateTestHome). CLI(companion stop)만 HOME 으로 임시 홈을 가리킨다
  const appEnv: NodeJS.ProcessEnv = { ...process.env, PB_E2E_DIR: HOME };
  for (const key of Object.keys(appEnv)) if (key.startsWith("POKEBUDDY_") || key === "ELECTRON_RUN_AS_NODE" || key === "NODE_OPTIONS") delete appEnv[key];
  appEnv.POKEBUDDY_SAVE_CRYPT = "off"; // 업데이트 뒤 저장을 직접 읽는다 — 평문(시험 빌드만 받는다, src/main/app.ts)
  return { home: HOME, data, env: appEnv, cliEnv: { ...appEnv, HOME } };
}

// 시험 앱 프로세스 — 옛 앱·다시 켜진 앱 모두 이 경로 아래에서 돈다
const appPids = (): number[] => {
  const r = spawnSync("/usr/bin/pgrep", ["-f", APP], { encoding: "utf8" });
  return r.stdout.split("\n").map(Number).filter((n) => n > 0 && n !== process.pid);
};

interface InspectorSocket {
  onopen: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((m: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}
const WS = (globalThis as unknown as { WebSocket: new (url: string) => InspectorSocket }).WebSocket;

// 앱을 켜고 관리 창 관측을 싣는다 — 패키지된 앱은 NODE_OPTIONS 를 읽지 않아 --inspect 디버거로 싣는다. 이미 뜬 창(무대)도 숨긴다
const INSPECT_PORT = 9340;
async function launch(home: Home): Promise<void> {
  const lock = path.join(home.data, "companion.lock");
  // --use-mock-keychain — 키체인에 닿지 않는다(시험 빌드는 앱도 스스로 켠다. src/main/app.ts)
  const child = spawn(path.join(APP, "Contents", "MacOS", NAME), [`--inspect=${INSPECT_PORT}`, "--use-mock-keychain"], { env: home.env, detached: true, stdio: "ignore" });
  child.unref();
  await until(() => fs.existsSync(lock), "동반자 켜짐", 90_000);
  let target: string | null = null;
  await until(async () => {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json()) as { webSocketDebuggerUrl?: string }[];
      target = list[0]?.webSocketDebuggerUrl ?? null;
    } catch {
      target = null;
    }
    return target != null;
  }, "디버거 주소");
  const observer = path.join(root, "scripts", "e2e", "manage-observer.cjs");
  const expression = `(() => {
    const { BrowserWindow } = process.mainModule.require('electron');
    for (const w of BrowserWindow.getAllWindows()) { w.hide(); w.on('show', () => { if (!global.__pbE2eShooting) w.hide(); }); }
    process.mainModule.require(${JSON.stringify(observer)});
    return 'ok';
  })()`;
  const ws = new WS(target!);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = await new Promise<{ result?: { result?: { value?: unknown } } }>((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(m.data));
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  ws.close();
  assert.equal(reply.result?.result?.value, "ok", `관측 싣기: ${JSON.stringify(reply)}`);
}

// 동반자를 내린다 — lock 을 지우면 스스로 끝난다(pokebuddy companion stop 과 같다)
async function stopApp(home: Home): Promise<void> {
  spawnSync(process.execPath, [path.join(root, "bin", "pokebuddy"), "companion", "stop"], { cwd: root, env: home.cliEnv, stdio: "ignore", timeout: 60_000 });
  await until(() => !fs.existsSync(path.join(home.data, "companion.lock")), "동반자 내림", 60_000);
  await until(() => appPids().length === 0, "프로세스 끝남", 60_000);
}

function uiClient(home: string) {
  let seq = 0;
  const ui = async (kind: string, extra: Record<string, unknown> = {}, ms = 30_000): Promise<unknown> => {
    const id = `u-${++seq}`;
    fs.writeFileSync(path.join(home, "ui.json"), JSON.stringify({ id, kind, ...extra }));
    let got: { id: string; ok: boolean; value?: unknown; message?: string } | null = null;
    await until(() => {
      const file = path.join(home, "ui-events.jsonl");
      if (!fs.existsSync(file)) return false;
      got = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; ok: boolean }).find((e) => e.id === id) ?? null;
      return got != null;
    }, `관리 창 ${kind}`, ms);
    const res = got as unknown as { ok: boolean; value?: unknown; message?: string };
    if (!res.ok) throw new Error(`관리 창 ${kind} 실패: ${res.message}`);
    return res.value;
  };
  const dom = (js: string): Promise<unknown> => ui("eval", { js });
  return { ui, dom, shot: (name: string) => ui("shot", { file: path.join(shots, name) }) };
}

async function main(): Promise<void> {
  assert.equal(process.platform, "darwin", "mac 에서만");
  assert.ok(fs.existsSync(path.join(root, "dist", "main", "app.js")), "npm run build 를 먼저 한다");
  fs.mkdirSync(shots, { recursive: true });
  const userBefore = userMark();
  const oldOut = build(OLD);
  const newOut = build(NEW);
  const { server, log } = await feedServer(newOut);
  const home = makeHome();
  const { ui, dom, shot } = uiClient(home.home);
  try {
    // (1) N 을 임시 Applications 에 둔다
    fs.mkdirSync(APPS, { recursive: true });
    assert.equal(spawnSync("/usr/bin/ditto", [path.join(oldOut, ARCH_DIR, `${NAME}.app`), APP]).status, 0, "앱 복사");
    assert.equal(plistVersion(APP), OLD);
    const updateYml = fs.readFileSync(path.join(APP, "Contents", "Resources", "app-update.yml"), "utf8");
    assert.match(updateYml, /provider: generic/);
    assert.ok(updateYml.includes(`url: ${FEED}`), `app-update.yml 공급처: ${updateYml}`);
    assert.ok(fs.existsSync(path.join(APP, "Contents", "Resources", "app", "update-test.json")), "시험 빌드 표시");
    checks.push(`(1) ${OLD} 을 ${APP} 에 둠 — app-update.yml 공급처 ${FEED}`);

    // (2) 켜고 설정 바닥을 본다. 1분 뒤 첫 확인 → 받기 → 준비됨
    await launch(home);
    await ui("open", {}, 60_000);
    await until(async () => (await dom("document.getElementById('open-settings') != null").catch(() => false)) === true, "관리 창 문서");
    await sleep(1500);
    await dom("document.getElementById('open-settings').click()");
    const foot = async (): Promise<string> => String(await dom("document.querySelector('.version-foot')?.innerText ?? ''"));
    await until(async () => (await foot()).includes(`pokebuddy ${OLD}`), "버전 글자");
    checks.push(`(2) 설정 바닥 "${(await foot()).split("\n")[0]}"`);
    let sawDownloading = false;
    await until(async () => {
      const t = await foot();
      if (t.includes("받는 중")) sawDownloading = true;
      if (t.includes("확인하지 못했어요")) throw new Error(`업데이트 오류: ${t}`);
      return t.includes("준비됨");
    }, "새 버전 준비됨", 240_000);
    const ready = await foot();
    assert.match(ready, new RegExp(`새 버전 ${NEW.replace(/[.]/g, "\\.")} 준비됨`));
    await shot("1-ready.png");
    assert.ok(log.includes("latest-mac.yml") && log.some((n) => n.endsWith(".zip")), `latest-mac.yml·zip 을 받았다: ${JSON.stringify(log)}`);
    checks.push(`(3) 받기 → 준비됨 "${ready.split("\n")[0]}"${sawDownloading ? " (받는 중 표시 봄)" : ""} · 요청 ${[...new Set(log)].join(", ")}`);

    // (3) 다시 시작 — 도우미가 앱을 바꾸고 다시 켠다
    const lockText = (): string => { try { return fs.readFileSync(path.join(home.data, "companion.lock"), "utf8"); } catch { return ""; } };
    const lockPid = (): number => Number(lockText().split("\n")[0]) || 0;
    const oldPid = lockPid();
    const pressed = await dom("(() => { const b = [...document.querySelectorAll('.version-foot button')].find((x) => x.textContent.trim() === '다시 시작'); if (!b) return false; b.click(); return true; })()");
    assert.equal(pressed, true, "다시 시작 단추");
    await until(() => plistVersion(APP) === NEW, `앱이 ${NEW}`, 180_000).catch((e: unknown) => {
      const logFile = path.join(REAL_CACHE, "install.log");
      process.stderr.write(`앱 ${plistVersion(APP)}, 폴더 ${fs.readdirSync(APPS).join(", ")}\n도우미 로그:\n${fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "(없음)"}\n`);
      throw e;
    });
    // 도우미는 새 앱을 놓은 뒤 옛 앱을 지운다 — 앱이 커서 몇 초 걸린다
    await until(() => fs.readdirSync(APPS).join(",") === `${NAME}.app`, `옛 앱·임시 앱이 남지 않는다 (${fs.readdirSync(APPS).join(", ")})`, 60_000);
    // 도우미가 open 으로 다시 켠다 — 새 pid 가 lock 에 적히고 ready 가 된다
    await until(() => lockPid() > 0 && lockPid() !== oldPid && lockText().includes("ready"), "새 버전이 다시 켜짐", 120_000).catch((e: unknown) => {
      process.stderr.write(`lock: 옛 pid ${oldPid}, 지금 "${lockText().replace(/\n/g, " ")}", 프로세스 ${appPids().join(",")}\n`);
      throw e;
    });
    checks.push(`(4) 다시 시작 → 같은 자리 앱 ${plistVersion(APP)}, 도우미가 다시 켬 (pid ${oldPid} → ${lockPid()})`);

    // (4) 업데이트 뒤 첫 관리 창 — 새 버전 패치노트가 한 번 뜬다. 저장은 그대로.
    // 다시 켜진 앱에는 관측을 실을 수 없어(디버거 인자 없음) 내리고 관측과 함께 다시 켠다
    assert.equal(fs.existsSync(path.join(home.data, "notes-seen.json")), false, "관리 창을 열기 전에는 본 것으로 적지 않는다");
    await stopApp(home);
    fs.rmSync(path.join(home.home, "ui-events.jsonl"), { force: true });
    await launch(home);
    await ui("open", {}, 60_000);
    await until(async () => String(await dom("document.querySelector('.dialog h2')?.textContent ?? ''").catch(() => "")).includes("업데이트했어요"), "업데이트 뒤 패치노트", 30_000);
    const title = String(await dom("document.querySelector('.dialog h2').textContent"));
    assert.equal(title, `${NEW} 으로 업데이트했어요`);
    await shot("2-notes-new.png");
    await until(() => fs.existsSync(path.join(home.data, "notes-seen.json")), "notes-seen.json");
    assert.equal(JSON.parse(fs.readFileSync(path.join(home.data, "notes-seen.json"), "utf8")).seen, NEW);
    const save = JSON.parse(fs.readFileSync(path.join(home.data, "save.json"), "utf8")) as { points: { balance: number }; pets: { id: string }[] };
    assert.equal(save.points.balance, 1234, "저장 유지");
    assert.ok(save.pets.some((p) => p.id === "u1"), "포켓몬 유지");
    await dom("document.querySelector('.dialog-close').click()");
    await dom("document.getElementById('open-settings').click()");
    await until(async () => (await foot()).includes(`pokebuddy ${NEW}`), "새 버전 글자");
    await shot("3-settings-new.png");
    checks.push(`(5) 업데이트 뒤 패치노트 "${title}" 한 번, notes-seen.json ${NEW}, 저장 유지(1234P·u1), 설정 바닥 "${(await foot()).split("\n")[0]}"`);
    assert.equal(userMark(), userBefore, "사용자의 /Applications/PokeBuddy.app·companion.lock 이 그대로다");
    checks.push("(6) 사용자의 /Applications/PokeBuddy.app 과 ~/.claude/pokebuddy/companion.lock 그대로");
  } finally {
    await stopApp(home).catch(() => undefined);
    for (const pid of appPids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 이미 끝났다
      }
    }
    server.close();
    for (const d of [work, REAL_CACHE]) {
      try {
        fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch (e) {
        process.stderr.write(`지우지 못했다: ${d} — ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
  }
}

main().then(
  () => {
    process.stdout.write(`${checks.join("\n")}\ne2e-update-mac: 통과\n`);
    process.exit(0);
  },
  (e: unknown) => {
    process.stderr.write(`${checks.join("\n")}\n실패: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  },
);
