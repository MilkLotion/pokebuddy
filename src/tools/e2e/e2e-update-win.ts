// 앱 업데이트 E2E — 시험용 설치본 N 을 조용히 설치해 켜고, 로컬 HTTP 서버가 내놓는 N+1 로 업데이트되는지 본다.
// 설계: worklog/records/app-update/record.md "검사 계획" U-03
//   준비: `npm run build`. 설치 파일 두 개를 만드느라 몇 분 걸린다
//   실행: node dist/tools/e2e/e2e-update-win.js
//   시험 빌드는 다른 appId·이름(pokebuddy-update-test)이라 사용자의 설치본과 섞이지 않는다. 바로 가기를 만들지 않고
//   링크(pokebuddy://)·로그인 시 시작을 등록하지 않는다(scripts/build-exe.cjs PB_UPDATE_TEST). 저장은 임시 HOME 에 둔다.
//   끝나면 조용히 제거하고 임시 폴더를 지운다. 관리 창 조작은 --inspect 디버거로 manage-observer 를 실어 한다(launch)
//   확인: 설정 바닥이 받는 중 → 준비됨, `다시 시작` → 조용히 설치 → N+1 로 다시 켜짐, 저장 유지, 업데이트 뒤 첫 패치노트 한 번
// (예전 scripts/e2e-update.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다. 본문은 줄 그대로다 — 작은따옴표도 그대로 두었다.
//  Mac 판은 ./e2e-update-mac.ts 다. 두 판의 공통 뼈대(until·uiClient·feedServer·관측기 싣기)는 아직 따로 있다 — 50번 설계 G28-06)
import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { newPet } from "../../party/create";
import { emptySave as empty } from "../../save/normalize";
import { homeEnv } from "../harness/home-env";
import { makeTmp } from "../harness/tmp-dir";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any — 디버거·관측기의 JSON 을 그대로 읽는다
interface Home {
  home: string;
  data: string;
  env: NodeJS.ProcessEnv;
}

const root = path.join(__dirname, "..", "..", "..");
// 임시 폴더는 <임시 폴더>/pokebuddy/ 아래에 만들고 끝나면 지운다 (src/tools/harness/tmp-dir.ts)
const PORT = 48321; // 빌드에 박히는 공급 주소 — 바꾸면 두 빌드를 다시 만든다
const FEED = `http://127.0.0.1:${PORT}/`;
const OLD = '0.6.9';
const NEW = '0.7.0'; // data/patch-notes.json 에 노트가 있는 버전 — 업데이트 뒤 첫 패치노트를 본다
const NAME = 'pokebuddy-update-test';
const INSTALL = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', NAME);
const work = makeTmp('update-e2e');
// 시험 앱의 홈 — 빌드에 박는다(scripts/build-exe.cjs PB_UPDATE_HOME). 업데이트 설치 파일이 다시 켠 앱은 환경 변수를 물려받지 않는다
// PB_E2E_UPDATE_BUILDS 를 주면 그 폴더의 설치 파일을 다시 쓴다(없으면 만든다) — 시험을 되풀이할 때 빌드 몇 분을 줄인다.
// 홈 경로가 빌드에 박히므로 그때는 홈도 그 폴더 안의 고정 경로다
const KEEP = process.env.PB_E2E_UPDATE_BUILDS ? path.resolve(process.env.PB_E2E_UPDATE_BUILDS) : null;
const HOME = path.join(KEEP ?? work, 'home');
// 사용자의 동반자 lock — 시험 동안 바뀌면 시험 앱이 사용자의 홈을 쓴 것이다
const USER_LOCK = path.join(os.homedir(), '.claude', 'pokebuddy', 'companion.lock');
const userLockMark = () => (fs.existsSync(USER_LOCK) ? `${fs.statSync(USER_LOCK).mtimeMs}:${fs.readFileSync(USER_LOCK, 'utf8')}` : 'none');
const UPDATER_CACHE = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), `${NAME}-updater`);
const shots = path.join(work, 'shots');
const checks: string[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(test: () => unknown, label: string, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(500);
  }
  throw new Error(`대기 실패: ${label}`);
}

// 시험 설치 파일 하나 — 버전과 출력 폴더만 다르다
function buildInstaller(version: string): { out: string; exe: string } {
  const out = path.join(KEEP ?? work, `build-${version}`);
  const ready = path.join(out, `${NAME}-Setup-${version}.exe`);
  if (KEEP && fs.existsSync(ready)) return { out, exe: ready };
  process.stdout.write(`설치 파일 만들기 ${version} …\n`);
  // 설치 파일을 쓰는 순간 잠겨 "Can't open output file" 로 가끔 실패한다(백신 검사로 보임) — 세 번까지 다시 한다
  let r: SpawnSyncReturns<string> | null = null;
  for (let i = 0; i < 3 && (r == null || r.status !== 0); i += 1) r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-exe.cjs')], {
    cwd: root,
    env: { ...process.env, PB_UPDATE_TEST: '1', PB_UPDATE_VERSION: version, PB_UPDATE_OUT: out, PB_UPDATE_FEED: FEED, PB_UPDATE_HOME: HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  assert.equal(r!.status, 0, `빌드 실패 ${version}: ${r!.stderr}`);
  const exe = path.join(out, `${NAME}-Setup-${version}.exe`);
  assert.ok(fs.existsSync(exe), `설치 파일 없음: ${exe}`);
  return { out, exe };
}

// 공급 서버 — N+1 의 latest.yml·설치 파일·블록맵, N 의 블록맵(차분 받기의 기준)
function feedServer(dirs: string[]): Promise<{ server: http.Server; log: { name: string; range: string | null }[] }> {
  const log: { name: string; range: string | null }[] = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', FEED).pathname.slice(1));
    log.push({ name, range: req.headers.range ?? null });
    const file = dirs.map((d) => path.join(d, name)).find((f) => !name.includes('..') && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve({ server, log })));
}

// 임시 HOME 과 저장 — 튜토리얼은 건너뛴 파티 한 마리
function makeHome(): Home {
  const home = HOME;
  fs.rmSync(home, { recursive: true, force: true });
  const data = path.join(home, '.claude', 'pokebuddy');
  fs.mkdirSync(data, { recursive: true });
  const save = empty(Date.now());
  save.pets.push(newPet({ id: 'u1', species: 'pichu', shiny: false, nature: 'hardy', now: Date.now() } as Parameters<typeof newPet>[0]));
  save.party.slots[0] = { state: 'pokemon', petId: 'u1', hidden: false };
  save.starterPetId = 'u1';
  save.points.balance = 1234;
  save.tutorials = Object.fromEntries(['first-care', 'playground', 'shop', 'hatch', 'party', 'achievement'].map((k) => [k, { state: 'skipped', steps: 0 }])) as typeof save.tutorials;
  fs.writeFileSync(path.join(data, 'save.json'), JSON.stringify(save));
  // TEMP 는 짧은 경로로 둔다 — 업데이트 설치 파일이 앱의 TEMP 를 물려받아 옛 파일을 TEMP\ns….tmp\old-install 아래로 옮긴다.
  // 길면 260자를 넘어 "Failed to uninstall old application files: 2" 로 멈춘다(2026-09-28 확인. 사용자 PC 의 TEMP 는 짧다)
  const temp = makeTmp('pbu');
  const env = homeEnv(home, temp, { PB_E2E_DIR: home });
  // 옛 판(암호화 전, 0.13.0 까지)처럼 평문으로 돈다 — 첫 실행만. 업데이트 설치 파일이 다시 켠 앱은 환경 변수를 물려받지 않으므로
  // 그때 새 판처럼 저장 키를 만들고 평문 저장을 암호화한다(P3 업데이트 첫 실행 이전). 시험 빌드만 이 값을 받는다(src/main/app.ts). 지우는 반복문 뒤에 둔다
  env.POKEBUDDY_SAVE_CRYPT = 'off';
  return { home, data, env };
}

// 설치본을 켜고 관리 창 관측을 싣는다. 설치본(패키지된 Electron)은 NODE_OPTIONS 를 읽지 않는다 —
// --inspect 로 켜고 메인 프로세스 디버거로 scripts/e2e/manage-observer.cjs 를 불러온다. 이미 뜬 창(무대)도 숨긴다
const INSPECT_PORT = 9339;
async function launch(home: Home): Promise<void> {
  const lock = path.join(home.data, 'companion.lock');
  const child = spawn(path.join(INSTALL, `${NAME}.exe`), [`--inspect=${INSPECT_PORT}`], { env: home.env, detached: true, stdio: 'ignore' });
  child.unref();
  await until(() => fs.existsSync(lock), '동반자 켜짐', 90_000);
  let target: string | null = null;
  await until(async () => {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json()) as Json[];
      target = list[0]?.webSocketDebuggerUrl ?? null;
    } catch {
      target = null;
    }
    return target != null;
  }, '디버거 주소');
  const observer = path.join(root, 'scripts', 'e2e', 'manage-observer.cjs');
  const expression = `(() => {
    const { BrowserWindow } = process.mainModule.require('electron');
    for (const w of BrowserWindow.getAllWindows()) { w.hide(); w.on('show', () => { if (!global.__pbE2eShooting) w.hide(); }); }
    process.mainModule.require(${JSON.stringify(observer)});
    return 'ok';
  })()`;
  const ws = new WebSocket(target!);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = await new Promise<Json>((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(String(m.data)));
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  ws.close();
  assert.equal(reply.result?.result?.value, 'ok', `관측 싣기: ${JSON.stringify(reply)}`);
}

// 시험 앱·설치 파일 프로세스 — 진단용 "pid 명령 줄" 줄들
function processes(filter = `Name LIKE '${NAME}%'`): string {
  return spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter \"${filter}\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }`], { encoding: 'utf8' }).stdout.trim();
}

// 동반자를 내린다 — lock 을 지우면 스스로 끝난다(pokebuddy companion stop 과 같다)
async function stopApp(home: Home): Promise<void> {
  spawnSync(process.execPath, [path.join(root, 'bin', 'pokebuddy'), 'companion', 'stop'], { cwd: root, env: home.env, stdio: 'ignore', timeout: 60_000 });
  await until(() => !fs.existsSync(path.join(home.data, 'companion.lock')), '동반자 내림', 60_000);
  const alive = () => processes(`Name='${NAME}.exe'`);
  try {
    await until(() => alive() === '', '프로세스 끝남', 60_000);
  } catch (e) {
    const main = alive().split('\n').find((l) => !l.includes('--type='))?.split(' ')[0];
    const text = main ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'e2e', 'window-text.ps1'), '-ProcessId', main], { encoding: 'utf8' }).stdout.trim() : '';
    process.stderr.write(`남은 프로세스:\n${alive()}\n메인 창:\n${text}\n`);
    throw e;
  }
}

function uiClient(home: string) {
  let seq = 0;
  const ui = async (kind: string, extra: Record<string, unknown> = {}, ms = 30_000): Promise<Json> => {
    const id = `u-${++seq}`;
    fs.writeFileSync(path.join(home, 'ui.json'), JSON.stringify({ id, kind, ...extra }));
    let got: Json = null;
    await until(() => {
      const file = path.join(home, 'ui-events.jsonl');
      if (!fs.existsSync(file)) return false;
      got = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e: Json) => e.id === id) ?? null;
      return got != null;
    }, `관리 창 ${kind}`, ms);
    if (!got.ok) throw new Error(`관리 창 ${kind} 실패: ${got.message}`);
    return got.value;
  };
  const dom = (js: string) => ui('eval', { js });
  return { ui, dom, shot: (name: string) => ui('shot', { file: path.join(shots, name) }) };
}

const installedVersion = (): string | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(INSTALL, 'resources', 'app', 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

async function main(): Promise<void> {
  assert.ok(fs.existsSync(path.join(root, 'dist', 'main', 'app.js')), 'npm run build 를 먼저 한다');
  fs.mkdirSync(shots, { recursive: true });
  const userLockBefore = userLockMark();
  if (fs.existsSync(path.join(INSTALL, `${NAME}.exe`))) throw new Error(`이미 설치된 시험 앱이 있다 — 먼저 지운다: ${INSTALL}`);
  const oldBuild = buildInstaller(OLD);
  const newBuild = buildInstaller(NEW);
  const { server, log } = await feedServer([newBuild.out, oldBuild.out]);
  const home = makeHome();
  const { ui, dom, shot } = uiClient(home.home);
  try {
    // (1) N 을 조용히 설치한다
    const inst = spawnSync(oldBuild.exe, ['/S'], { stdio: 'ignore' });
    assert.equal(inst.status, 0, '조용한 설치');
    await until(() => installedVersion() === OLD, '설치 끝');
    assert.ok(fs.existsSync(path.join(INSTALL, 'resources', 'app-update.yml')), 'app-update.yml');
    assert.match(fs.readFileSync(path.join(INSTALL, 'resources', 'app-update.yml'), 'utf8'), new RegExp(`url: ${FEED.replace(/[.]/g, '\\.')}`));
    assert.ok(fs.existsSync(path.join(INSTALL, 'resources', 'app', 'update-test.json')), '시험 빌드 표시');
    checks.push(`(1) ${OLD} 조용히 설치 — ${INSTALL}`);

    // (2) 켜고 설정 바닥을 본다. 1분 뒤 첫 확인 → 받기 → 준비됨
    await launch(home);
    await ui('open', {}, 60_000);
    await until(async () => (await dom("document.getElementById('open-settings') != null").catch(() => false)) === true, '관리 창 문서');
    await sleep(1500);
    await dom("document.getElementById('open-settings').click()");
    const foot = () => dom("document.querySelector('.version-foot')?.innerText ?? ''");
    await until(async () => (await foot()).includes(`pokebuddy ${OLD}`), '버전 글자');
    checks.push(`(2) 설정 바닥 "${(await foot()).split('\n')[0]}"`);
    let sawDownloading = false;
    await until(async () => {
      const t = await foot();
      if (t.includes('받는 중')) sawDownloading = true;
      return t.includes('준비됨');
    }, '새 버전 준비됨', 240_000);
    const ready = await foot();
    assert.match(ready, new RegExp(`새 버전 ${NEW.replace(/[.]/g, '\\.')} 준비됨`));
    await shot('1-ready.png');
    const gotExe = log.some((l) => l.name === 'latest.yml') && log.some((l) => l.name.endsWith('.exe'));
    assert.ok(gotExe, `latest.yml·설치 파일을 받았다: ${JSON.stringify(log)}`);
    checks.push(`(3) 받기 → 준비됨 "${ready.split('\n')[0]}"${sawDownloading ? ' (받는 중 표시 봄)' : ''} · 요청 ${log.length}건 (${[...new Set(log.map((l) => l.name))].join(', ')}), 부분 요청 ${log.filter((l) => l.range).length}건`);

    // (3) 다시 시작 — 조용히 설치하고 N+1 로 다시 켠다
    const lockText = (): string => { try { return fs.readFileSync(path.join(home.data, 'companion.lock'), 'utf8'); } catch { return ''; } };
    const lockPid = () => Number(lockText().split('\n')[0]) || 0;
    const oldPid = lockPid();
    const pressed = await dom("(() => { const b = [...document.querySelectorAll('.version-foot button')].find((x) => x.textContent.trim() === '다시 시작'); if (!b) return false; b.click(); return true; })()");
    assert.equal(pressed, true, '다시 시작 단추');
    await until(() => installedVersion() === NEW, `설치본이 ${NEW}`, 180_000).catch((e) => {
      const windows = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.ProcessName -like '${NAME}*' -or $_.MainWindowTitle -like '*${NAME}*' } | ForEach-Object { \"$($_.Id) $($_.ProcessName) [$($_.MainWindowTitle)]\" }`], { encoding: 'utf8' }).stdout.trim();
      // 멈춘 창의 글자 — 조용한 설치에서도 메시지 창이 뜰 수 있다
      const texts = windows.split('\n').filter(Boolean).map((l) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'e2e', 'window-text.ps1'), '-ProcessId', l.split(' ')[0]!], { encoding: 'utf8' }).stdout.trim()).join('\n');
      // 옛 설치 폴더를 잡은 프로세스 — 이름이 달라도(도우미 PowerShell 등) 명령 줄·실행 파일에 설치 폴더가 있으면 찍는다
      const holders = processes(`CommandLine LIKE '%${NAME}%' OR ExecutablePath LIKE '%${NAME}%'`);
      process.stderr.write(`설치본 ${installedVersion()}, 남은 프로세스:\n${holders}\n창:\n${windows}\n${texts}\n`);
      throw e;
    });
    // 설치 파일이 새 버전을 다시 켠다(--force-run) — lock 이 다시 생긴다
    // 옛 앱은 설치 파일이 강제로 끝내 lock 이 남는다 — 새 pid 가 적히고 ready 가 될 때까지 본다
    await until(() => lockPid() > 0 && lockPid() !== oldPid && lockText().includes('ready'), '새 버전이 다시 켜짐', 120_000).catch((e) => {
      process.stderr.write(`lock: 옛 pid ${oldPid}, 지금 "${lockText().replace(/\n/g, ' ')}"\n${processes()}\n`);
      throw e;
    });
    checks.push(`(4) 다시 시작 → 설치본 ${installedVersion()}, 설치 파일이 다시 켬`);

    // (4) 업데이트 뒤 첫 관리 창 — 새 버전 패치노트가 한 번 뜬다. 저장은 그대로.
    // 다시 켜진 앱에는 관측을 실을 수 없어(디버거 인자 없음) 내리고 관측과 함께 다시 켠다. 관리 창을 열기 전이라 노트는 아직 안 봤다
    assert.equal(fs.existsSync(path.join(home.data, 'notes-seen.json')), false, '관리 창을 열기 전에는 본 것으로 적지 않는다');
    await stopApp(home);
    fs.rmSync(path.join(home.home, 'ui-events.jsonl'), { force: true });
    await launch(home);
    await ui('open', {}, 60_000);
    await until(async () => (await dom("document.querySelector('.dialog h2')?.textContent ?? ''").catch(() => '')).includes('업데이트했어요'), '업데이트 뒤 패치노트', 30_000);
    const title = await dom("document.querySelector('.dialog h2').textContent");
    assert.equal(title, `${NEW} 으로 업데이트했어요`);
    await shot('2-notes-new.png');
    await until(() => fs.existsSync(path.join(home.data, 'notes-seen.json')), 'notes-seen.json');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home.data, 'notes-seen.json'), 'utf8')).seen, NEW);
    // 업데이트 뒤 첫 실행이 평문 저장을 암호화했다(P3) — 백업을 남기고, 진행은 그대로
    const sealedHead = fs.readFileSync(path.join(home.data, 'save.json')).subarray(0, 4).toString('latin1');
    assert.equal(sealedHead, 'PBS1', '업데이트 뒤 저장은 암호화');
    assert.ok(fs.existsSync(path.join(home.data, 'save.key')), '저장 키');
    const plainBak = fs.readdirSync(home.data).filter((f) => f.startsWith('save.json.plain-'));
    assert.equal(plainBak.length, 1, '암호화 전 평문 백업');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home.data, plainBak[0]!), 'utf8')).points.balance, 1234, '백업은 옛 평문 저장');
    const snap = await dom('window.pokebuddyManage.snapshot().then((s) => ({ points: s.points, pets: s.party.slots.filter((x) => x.pet).map((x) => x.pet.id) }))');
    assert.equal(snap.points, 1234, '저장 유지(암호화 뒤 앱이 읽은 값)');
    assert.ok(snap.pets.includes('u1'), '포켓몬 유지');
    await dom("document.querySelector('.dialog-close').click()");
    await dom("document.getElementById('open-settings').click()");
    await until(async () => (await foot()).includes(`pokebuddy ${NEW}`), '새 버전 글자');
    await shot('3-settings-new.png');
    assert.equal(userLockMark(), userLockBefore, '사용자의 동반자 lock 이 그대로다 — 시험 앱이 사용자의 홈을 쓰지 않았다');
    checks.push(`(5) 사용자의 홈(~/.claude/pokebuddy)의 companion.lock 그대로`);
    checks.push(`(6) 업데이트 뒤 패치노트 "${title}" 한 번, notes-seen.json ${NEW}, 저장 암호화(PBS1·save.key·평문 백업) 뒤 유지(1234P·u1), 설정 바닥 "${(await foot()).split('\n')[0]}"`);
  } finally {
    // 끄고 지운다 — 시험 앱이 남으면 다음 실행이 막힌다
    await stopApp(home).catch(() => undefined);
    // 앱과 업데이트 설치 파일(pending 의 Setup)이 남아 있으면 끝낸다
    spawnSync('taskkill', ['/IM', `${NAME}.exe`, '/F'], { stdio: 'ignore' });
    spawnSync('taskkill', ['/IM', `${NAME}-Setup-${NEW}.exe`, '/F'], { stdio: 'ignore' });
    const uninstaller = path.join(INSTALL, `Uninstall ${NAME}.exe`);
    if (fs.existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { stdio: 'ignore' });
    await until(() => !fs.existsSync(path.join(INSTALL, `${NAME}.exe`)), '제거', 60_000).catch(() => process.stderr.write(`제거가 끝나지 않았다 — 손으로 지운다: ${INSTALL}\n`));
    server.close();
    // 정리 실패는 알리기만 한다 — 시험의 원래 오류를 가리지 않게
    for (const d of [UPDATER_CACHE, ...(KEEP ? [] : [oldBuild.out, newBuild.out]), home.home, home.env.TEMP!]) {
      try {
        fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch (e) {
        process.stderr.write(`지우지 못했다: ${d} — ${(e as Error).message}
`);
      }
    }
  }
}

main().then(
  () => {
    process.stdout.write(`${checks.join('\n')}\n화면: ${shots}\ne2e-update: 통과\n`);
    process.exit(0);
  },
  (e: unknown) => {
    process.stderr.write(`${checks.join('\n')}\n실패: ${e instanceof Error && e.stack ? e.stack : e}\n화면: ${shots}\n`);
    process.exit(1);
  },
);
