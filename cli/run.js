// pokebuddy companion — 동반자 하나를 띄우고 곧바로 돌아온다. 항상 위에 떠서 맨 앞 터미널 창의 에이전트 상태를 따른다.
//
// 펫은 따로 떠서 스스로 lock 파일이 사라졌는지 본다 (src/main/lifetime.ts). 세션 펫(pokebuddy <종>)은 2026-09-27 에 지웠다
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const settings = require("../config.js");
const state = require("../dist/follow/state.js");
const { electronPath } = require("../lib/electron.js");
const i18n = require("../lib/i18n.js");
const { petName } = require("../lib/names.js");
const { optionEnv } = require("./args.js");

const PROJECT = path.join(__dirname, "..");
const { PATHS } = settings;
// 동반자가 창을 만들 때까지 기다리는 시간 — 처음 띄우면 그림(PMD ZIP)을 받느라 몇 초 걸린다.
// 넘기면 더 기다리지 않고 돌아온다 (동반자는 계속 뜨는 중이다)
const READY_TIMEOUT_MS = 15000;
// 첫 실행 선택 창에서 포켓몬을 고르는 동안 기다리는 시간 — 고르지 않고 닫으면 동반자가 끝나 그 전에 돌아온다
const PICK_TIMEOUT_MS = 120000;
// 내릴 때 끝나길 기다리는 시간
const GONE_TIMEOUT_MS = 5000;
const POLL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line = "") => process.stdout.write(`${line}\n`);

// 동반자가 스스로 끝났을 때 남긴 이유 (src/main/lifetime.ts reportFailure) — since 이후 것만
function lastError(since) {
  try {
    const e = JSON.parse(fs.readFileSync(PATHS.lastError, "utf8"));
    return e && e.at >= since ? e : null;
  } catch {
    return null;
  }
}

// 동반자의 pid — lock 파일의 pid 가 살아 있을 때만. 죽은 pid 가 남은 lock(크래시)은 지운다
function companionPid() {
  let text;
  try {
    text = fs.readFileSync(PATHS.companionLock, "utf8");
  } catch {
    return null;
  }
  const pid = Number(String(text).split("\n")[0]);
  if (pid > 0 && state.pidAlive(pid)) return pid;
  fs.rmSync(PATHS.companionLock, { force: true });
  return null;
}

// 동반자 프로세스를 따로 띄우고 번호를 돌려준다 (못 띄우면 null). 출력은 물려주지 않는다.
// 따로 띄우는 이유: 이 명령은 곧바로 끝나는데, Windows 는 따로 띄우지 않은 자식을 부모(node)가
// 끝날 때 함께 끝내고, mac 은 같은 프로세스 그룹이면 셸 쪽 신호에 같이 죽는다.
//
// Windows 는 node 가 직접 띄우지 않고 PowerShell Start-Process 로 띄운다. node 의 spawn(CreateProcess)은 상속 가능한 핸들을
// 전부 넘겨서, 이 명령이 받은 출력 파이프까지 동반자가 쥔다. 출력을 파이프로 받는 쪽(CLI LLM 의 ! 명령 등)은
// 그 파이프가 닫힐 때까지 — 동반자가 끝날 때까지 — 명령이 안 끝난다. Start-Process 는 ShellExecute 라 핸들을 넘기지 않는다
function launchPet(electron, env) {
  if (process.platform !== "win32") {
    return new Promise((resolve) => {
      const child = spawn(electron, [PROJECT], { stdio: "ignore", detached: true, env });
      child.once("spawn", () => resolve(child.pid));
      child.once("error", () => resolve(null));
      child.unref();
    });
  }
  // 경로는 환경변수로 넘긴다 — 명령줄에 끼워 넣으면 사용자 이름의 공백·따옴표가 PowerShell 문법이 된다
  const script =
    "(Start-Process -WindowStyle Hidden -PassThru -FilePath $env:POKEBUDDY_LAUNCH_EXE -WorkingDirectory $env:POKEBUDDY_LAUNCH_APP" +
    " -ArgumentList ('\"' + $env:POKEBUDDY_LAUNCH_APP + '\"')).Id";
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: { ...env, POKEBUDDY_LAUNCH_EXE: electron, POKEBUDDY_LAUNCH_APP: PROJECT },
        encoding: "utf8",
        timeout: 20_000,
        windowsHide: true,
        // 부른 쪽이 명령을 작업 개체(job)에 넣어 두었다가 한꺼번에 끝내도 동반자는 남게
        detached: true,
      },
      (err, stdout) => {
        const pid = Number(String(stdout).trim());
        resolve(!err && pid > 0 ? pid : null);
      },
    );
  });
}

async function waitGone(pids) {
  const until = Date.now() + GONE_TIMEOUT_MS;
  while (pids.some((pid) => state.pidAlive(pid)) && Date.now() < until) await sleep(POLL_MS);
}

// 동반자가 창을 만들었다고 적거나(ready) 끝날 때까지 기다린다 — 이 명령의 자식이 아니라서(Windows) 번호로 살아 있는지 본다.
// pet: { pid, file, ready, exited } — ready·exited 를 채운다. 시간을 넘기면 그대로 돌아온다 (동반자는 계속 뜨는 중이다)
async function waitReady(pet, { timeoutMs = READY_TIMEOUT_MS } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      pet.ready = /\bready\b/.test(fs.readFileSync(pet.file, "utf8"));
    } catch {
      // 쓰는 중 — 다음에 다시 본다
    }
    if (!pet.ready && !state.pidAlive(pet.pid)) pet.exited = true;
    if (pet.ready || pet.exited || Date.now() >= until) break;
    await sleep(POLL_MS);
  }
}

// pokebuddy companion [buddy=값] [click=값] — 동반자 하나를 띄운다. 포켓몬은 첫 실행 선택창에서 고른다.
// 기기당 하나. 항상 위에 떠서 맨 앞 터미널 창을 따르고, 트레이나 companion stop 으로 내린다 (src/main/app.ts)
async function companion(opts = {}) {
  const startedAt = Date.now() / 1000;
  const debug = Boolean(process.env.POKEBUDDY_DEBUG);

  const electron = electronPath();
  if (!electron) {
    process.stderr.write("동반자를 띄우지 못함 — Electron 이 아직 준비되지 않음. pokebuddy setup 을 한 번 실행하면 받는다\n");
    process.exitCode = 1;
    return;
  }
  const running = companionPid();
  if (running) {
    say(`동반자가 이미 떠 있음 (pid ${running}) — 내리기: pokebuddy companion stop`);
    return;
  }

  const config = settings.load();
  fs.mkdirSync(PATHS.home, { recursive: true });
  const env = { ...process.env, ...optionEnv(opts) };
  // 셸에 남은 POKEBUDDY_SLUG 가 첫 실행 선택창을 건너뛰게 하지 않는다 — 스타터를 환경변수로 주는 것은 개발 실행(npm start)만
  delete env.POKEBUDDY_SLUG;
  // 저장은 v3 이다. 옛 v2 파일이면 읽는 값만 v3 로 옮겨 본다 — 파일을 옮기는 것은 동반자(writer)의 일 (repair:false)
  const { state: saved } = require("../dist/save/store.js").read(PATHS.save, { repair: false });
  const firstRun = !saved || saved.pets.length === 0;
  if (firstRun) say("첫 실행 — 포켓몬 선택 창에서 고르면 뜬다 (닫으면 시작하지 않는다)");
  if (debug) {
    env.POKEBUDDY_LOG = path.join(PATHS.home, "debug-companion.log");
    process.stderr.write(`동반자 로그: ${env.POKEBUDDY_LOG}\n`);
  }
  const pet = { pid: null, file: PATHS.companionLock, ready: false, exited: false };
  try {
    pet.pid = await launchPet(electron, env);
  } catch (e) {
    process.stderr.write(`동반자를 띄우지 못함 — ${e.message}\n`);
  }
  if (!pet.pid) {
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(pet.file, `${pet.pid}\n`);
  // 선택 창을 고르는 동안은 오래 기다린다 — 고르지 않고 닫으면 동반자가 끝나 exited 로 돌아온다
  await waitReady(pet, { timeoutMs: firstRun ? PICK_TIMEOUT_MS : READY_TIMEOUT_MS });

  const shown = displayName(savedSpecies() || config.slug, config);
  if (pet.ready) say(`동반자를 띄움: ${shown} — 맨 앞 터미널 창을 따른다. 내리기: 트레이 메뉴 또는 pokebuddy companion stop`);
  else if (!pet.exited) say(`아직 뜨는 중: ${shown} — 한참 안 보이면 pokebuddy status`);
  else {
    const why = lastError(startedAt);
    if (why?.reason === "starter-cancelled") {
      say(why.message);
      return;
    }
    process.stderr.write(`동반자가 뜨지 못함${why ? ` — ${why.message}` : ""} (자세히: pokebuddy status)\n`);
    fs.rmSync(pet.file, { force: true });
    process.exitCode = 1;
  }
}

// 파티에서 꺼내 놓은 첫 마리의 종 — 동반자가 저장을 쓰는 중이라 읽기 전용으로 본다 (저장 v3).
// repair:false — 파손 파일을 .bak 으로 옮기는 것은 writer 의 일. 저장이 없거나 꺼낸 마리가 없으면 null
function savedSpecies() {
  try {
    const { state: save } = require("../dist/save/store.js").read(PATHS.save, { repair: false });
    const slot = save ? save.party.slots.find((s) => s.state === "pokemon" && s.petId && !s.hidden) : null;
    const pet = slot ? save.pets.find((p) => p.id === slot.petId) : null;
    return pet ? pet.species : null;
  } catch {
    return null;
  }
}

// 화면 이름과 슬러그를 함께 — "이브이 (eevee)". 이름표에 없으면 슬러그만
function displayName(slug, config) {
  const name = petName(slug, i18n.langOf(config));
  return name === slug ? slug : `${name} (${slug})`;
}

// pokebuddy companion stop — 동반자를 내린다. lock 파일을 지우면 동반자가 스스로 끝난다
async function companionStop() {
  const pid = companionPid();
  if (!pid) {
    say("떠 있는 동반자가 없음");
    return;
  }
  fs.rmSync(PATHS.companionLock, { force: true });
  await waitGone([pid]);
  if (state.pidAlive(pid)) say(`동반자(pid ${pid})가 아직 끝나지 않음 — 잠시 뒤 pokebuddy status 로 확인`);
  else say("동반자를 내림");
}

module.exports = { companion, companionStop, companionPid };
