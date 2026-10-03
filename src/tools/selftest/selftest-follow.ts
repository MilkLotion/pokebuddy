// src/follow 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-follow.js (npm run selftest 가 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. 파일은 임시 폴더에서만 —
// 사용자의 ~/.claude/pokebuddy/ 는 건드리지 않는다. 헬퍼는 node 스크립트로 흉내 낸다 (빈 줄마다 한 줄 답).
// 끝에 "통과 (N건)" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as front from "../../follow/front";
import { createLineHelper } from "../../follow/line-helper";
import * as state from "../../follow/state";
import { readHookRecords } from "../../agents/hook-records";
import { isPidAlive } from "../../platform/pid";
import type { HelperWindow, StateRecord } from "../../follow/types";
import * as winbounds from "../../follow/winbounds";
import { makeTmp } from "../harness/tmp-dir";
import { sleep } from "../harness/wait";
import { okCounter, printLine as say } from "../harness/report";

const checks = okCounter();
const ok = checks.okAsync;


// 있어야 하는 값 — 없으면 여기서 실패한다 (없는 값에 점을 찍어 TypeError 로 죽는 대신)
function some<T>(v: T | null | undefined, what = "값"): T {
  assert.ok(v != null, `${what} 이(가) 없다`);
  return v;
}

const tmpRoot = makeTmp("selftest-follow");
const tmpDir = (name: string): string => {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const writeJson = (dir: string, name: string, v: unknown): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(v));
  return file;
};
const nowSec = (): number => Date.now() / 1000;

const win = (pid: number, app: string, id = pid * 10): HelperWindow => ({ app, pid, id, x: 0, y: 0, w: 800, h: 600 });

// 이미 끝난 pid — 잠깐 떠서 바로 끝나는 프로세스의 pid
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore", windowsHide: true });
  await new Promise((r) => child.on("exit", r));
  return some(child.pid, "자식 pid");
}

// 콜백 한 번을 Promise 로
const once = <T>(run: (cb: (err: Error | null, v?: T) => void) => void): Promise<{ err: Error | null; v?: T }> =>
  new Promise((resolve) => run((err, v) => resolve({ err, v })));

// ── state.ts ────────────────────────────────────────────────────────────────

async function testPids(): Promise<void> {
  await ok("pidAlive: 나 자신은 살아 있고 끝난 pid 는 아니다", async () => {
    assert.strictEqual(isPidAlive(process.pid), true);
    assert.strictEqual(isPidAlive(await deadPid()), false);
  });
}

async function testStateRecords(): Promise<void> {
  await ok("agentStateOf: hold/then · STALE 은 running·waiting 만 · 없으면 idle", () => {
    const now = nowSec();
    assert.strictEqual(state.agentStateOf({ state: "running", at: now }), "running");
    assert.strictEqual(state.agentStateOf({}), "idle");
    assert.strictEqual(state.agentStateOf({ state: "waving", hold: 5, then: "idle", at: now - 10 }), "idle");
    assert.strictEqual(state.agentStateOf({ state: "waving", hold: 60, then: "idle", at: now - 10 }), "waving");
    assert.strictEqual(state.agentStateOf({ state: "waving", hold: 5, at: now - 10 }), "idle"); // then 없음 → idle
    assert.strictEqual(state.agentStateOf({ state: "running", at: now - state.STALE_SEC - 1 }), "idle");
    assert.strictEqual(state.agentStateOf({ state: "waiting", at: now - state.STALE_SEC - 1 }), "idle");
    assert.strictEqual(state.agentStateOf({ state: "failed", at: now - state.STALE_SEC - 1 }), "failed");
    assert.strictEqual(state.agentStateOf({ state: "running", at: now - state.STALE_SEC + 1 }), "running");
  });

  await ok("stateFor: pids 중 하나를 조상으로 가진 최신 기록 · 조상 없는 기록은 거름 · pids 비면 대기", () => {
    const now = nowSec();
    const recs: StateRecord[] = [
      { state: "waiting", at: now, cwd: "/x" }, // 조상 없음 — 거른다
      { state: "running", at: now, ancestors: [30, 31], promptAt: 1234 },
      { state: "failed", at: now, ancestors: [30] },
    ];
    assert.deepStrictEqual(state.stateFor(recs, []), { state: "idle", promptAt: null });
    assert.deepStrictEqual(state.stateFor(recs, null), { state: "idle", promptAt: null });
    assert.deepStrictEqual(state.stateFor(recs, new Set([30])), { state: "running", promptAt: 1234 });
    assert.deepStrictEqual(state.stateFor(recs, [31]), { state: "running", promptAt: 1234 });
    assert.deepStrictEqual(state.stateFor(recs, [99]), { state: "idle", promptAt: null });
    assert.deepStrictEqual(state.stateFor([{ state: "waving", at: now, ancestors: [5] }], [5]), { state: "waving", promptAt: null });
  });

  await ok("readHookRecords: 폴더 없음 → [] · 깨진 파일은 건너뜀 · mtime 최신순", () => {
    assert.deepStrictEqual(readHookRecords(path.join(tmpRoot, "없음")), []);
    const dir = tmpDir("state");
    const now = nowSec();
    const older = writeJson(dir, "old.json", { state: "waiting", at: now, ancestors: [300], tag: "old" });
    const newer = writeJson(dir, "new.json", { state: "running", at: now, ancestors: [300], promptAt: 77, tag: "new" });
    const loose = writeJson(dir, "loose.json", { state: "failed", at: now, cwd: "/work", tag: "loose" });
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    const t = Date.now() / 1000;
    fs.utimesSync(older, t - 300, t - 300);
    fs.utimesSync(loose, t - 200, t - 200);
    fs.utimesSync(newer, t - 100, t - 100);
    const recs = readHookRecords(dir) as (StateRecord & { tag: string })[];
    assert.deepStrictEqual(recs.map((r) => r.tag), ["new", "loose", "old"]);

  });
}

// ── front.ts ────────────────────────────────────────────────────────────────

async function testFront(): Promise<void> {
  const windows = [win(10, "Safari", 101), win(20, "Code", 201), win(20, "Code", 202), win(30, "Electron", 301)];
  const self = { pid: 30, appNames: new Set(["electron"]) };

  await ok("frontWindow: frontPid 로 고른다 · frontId 가 있으면 그 창 · 없으면 같은 pid 의 첫 창", () => {
    assert.strictEqual(some(front.frontWindow({ frontPid: 20, windows }, windows, self)).id, 201);
    assert.strictEqual(some(front.frontWindow({ frontPid: 20, frontId: 202, windows }, windows, self)).id, 202);
    assert.strictEqual(some(front.frontWindow({ frontPid: 20, frontId: 999, windows }, windows, self)).id, 201); // 대화상자 — 목록에 없음
    assert.strictEqual(front.frontWindow({ frontPid: 40, windows }, windows, self), null); // 다른 Space — 창이 목록에 없음
  });

  await ok("frontWindow: 펫 자신(pid·이름)은 null · 옛 헬퍼는 frontmost 이름으로 · 입력이 없으면 null", () => {
    assert.strictEqual(front.frontWindow({ frontPid: 30, windows }, windows, self), null);
    assert.strictEqual(front.frontWindow({ frontmost: "Electron", windows }, windows, self), null);
    assert.strictEqual(front.frontWindow({ frontmost: "Electron", windows }, windows, { pid: 1, appNames: new Set(["electron"]) }), null);
    assert.strictEqual(some(front.frontWindow({ frontmost: "Code", windows }, windows, self)).pid, 20);
    assert.strictEqual(some(front.frontWindow({ frontmost: "Code", windows }, windows)).pid, 20); // self 없음
    assert.strictEqual(front.frontWindow({ windows }, windows, self), null);
    assert.strictEqual(front.frontWindow(null, windows, self), null);
    assert.strictEqual(front.frontWindow({ frontPid: 20, windows }, null, self), null);
  });

  await ok("hostOf: (a) 훅 기록의 조상에 창 주인 → hook · (b) 알려진 터미널 이름 → known · (c) 아니면 null", () => {
    const hooked: StateRecord[] = [{ state: "running", at: nowSec(), ancestors: [40, 41] }];
    assert.deepStrictEqual(front.hostOf(win(41, "mystery"), hooked), { kind: "hook", pids: [41] });
    assert.deepStrictEqual(front.hostOf(win(20, "Code"), [{ state: "running", at: nowSec(), ancestors: [20] }]), { kind: "hook", pids: [20] });
    assert.deepStrictEqual(front.hostOf(win(50, "iterm2"), hooked), { kind: "known", pids: [] });
    assert.deepStrictEqual(front.hostOf(win(50, "WindowsTerminal"), []), { kind: "known", pids: [] });
    assert.strictEqual(front.hostOf(win(60, "Safari"), hooked), null);
    assert.strictEqual(front.hostOf(null, hooked), null);
    assert.strictEqual(front.hostOf(win(60, "Safari"), null), null);
  });

  await ok("KNOWN_TERMINAL_APPS · isKnownTerminal: 대소문자 무관", () => {
    assert.strictEqual(front.isKnownTerminal("code"), true);
    assert.strictEqual(front.isKnownTerminal("Code - Insiders"), true);
    assert.strictEqual(front.isKnownTerminal("Finder"), false);
    assert.strictEqual(front.isKnownTerminal(null), false);
    assert.strictEqual(front.KNOWN_TERMINAL_APPS.has("windowsterminal"), true);
  });
}

// ── line-helper.ts · winbounds.ts ───────────────────────────────────────────

// 가짜 헬퍼 — 표준입력 한 줄마다 {"n":k} 한 줄. answerUpTo 를 넘긴 질문에는 답하지 않는다(멈춘 헬퍼 흉내)
function fakeServeScript(dir: string, name: string, answerUpTo = Infinity): string {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    [
      `let n = 0; const upTo = ${Number.isFinite(answerUpTo) ? answerUpTo : "Infinity"};`,
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (d) => { for (const line of d.split("\\n").slice(0, -1)) { n += 1; if (n <= upTo) process.stdout.write(JSON.stringify({ n, echo: line }) + "\\n"); } });',
      'process.stdin.on("end", () => process.exit(0));',
    ].join("\n"),
  );
  return file;
}

async function testLineHelper(): Promise<void> {
  const dir = tmpDir("helper");
  const serve = fakeServeScript(dir, "serve.js");

  await ok("createLineHelper: 빈 줄마다 한 줄 답 · 답을 기다리는 중엔 겹쳐 묻지 않는다 · stop 은 대기 중인 질문을 끝낸다", async () => {
    const h = createLineHelper(process.execPath, [serve], { timeoutMs: 3000, startTimeoutMs: 10000 });
    const a = await once<string>((cb) => h.query(cb));
    assert.strictEqual(a.err, null);
    assert.deepStrictEqual(JSON.parse(some(a.v)), { n: 1, echo: "" });
    // 겹쳐 묻기 — 두 번째 cb 는 불리지 않고 첫 답만 온다
    let second = 0;
    const b = await once<string>((cb) => {
      h.query(cb);
      h.query(() => {
        second += 1;
      });
    });
    assert.deepStrictEqual(JSON.parse(some(b.v)), { n: 2, echo: "" });
    assert.strictEqual(second, 0);
    // stop — 대기 중 질문은 "헬퍼 중단" 으로 끝난다
    const c = once<string>((cb) => h.query(cb));
    h.stop();
    assert.strictEqual(some((await c).err).message, "헬퍼 중단");
    h.stop(); // 두 번 멈춰도 조용하다
  });

  await ok("createLineHelper: 답이 늦으면 헬퍼를 버리고 다음 질문에 새로 띄운다 (한 번 답한 뒤라 재시도 간격 없음)", async () => {
    const onlyFirst = fakeServeScript(dir, "first-only.js", 1);
    const h = createLineHelper(process.execPath, [onlyFirst], { timeoutMs: 150, startTimeoutMs: 10000 });
    const a = await once<string>((cb) => h.query(cb));
    assert.deepStrictEqual(JSON.parse(some(a.v)), { n: 1, echo: "" });
    const b = await once<string>((cb) => h.query(cb));
    assert.strictEqual(some(b.err).message, "헬퍼 중단");
    const c = await once<string>((cb) => h.query(cb)); // 새 프로세스 — 번호가 1 로 돌아온다
    assert.strictEqual(c.err, null);
    assert.deepStrictEqual(JSON.parse(some(c.v)), { n: 1, echo: "" });
    h.stop();
  });

  await ok("createLineHelper: 첫 답도 못 하면 실패로 세고 다음 질문은 재시도 대기 · 바로 끝나는 헬퍼는 '헬퍼가 끝남'", async () => {
    const silent = fakeServeScript(dir, "silent.js", 0);
    const h = createLineHelper(process.execPath, [silent], { timeoutMs: 100, startTimeoutMs: 100 });
    const a = await once<string>((cb) => h.query(cb));
    assert.strictEqual(some(a.err).message, "헬퍼 중단");
    const b = await once<string>((cb) => h.query(cb));
    assert.strictEqual(some(b.err).message, "헬퍼 재시도 대기");
    h.stop();

    const quit = path.join(dir, "quit.js");
    fs.writeFileSync(quit, "process.exit(0);");
    const q = createLineHelper(process.execPath, [quit], { timeoutMs: 3000, startTimeoutMs: 3000 });
    const c = await once<string>((cb) => q.query(cb));
    assert.strictEqual(some(c.err).message, "헬퍼가 끝남");
    q.stop();
  });

  await ok("helperCommand: POKEBUDDY_WINBOUNDS 덮어쓰기 · mac 실행 파일 · Windows ps1 -Serve · 없으면 null · 인자 없음", () => {
    const proj = tmpDir("project");
    const bare: NodeJS.ProcessEnv = {};
    assert.strictEqual(winbounds.helperCommand("darwin", proj, bare), null);
    assert.strictEqual(winbounds.helperCommand("win32", proj, bare), null);
    assert.strictEqual(winbounds.helperCommand("linux", proj, bare), null);
    fs.mkdirSync(path.join(proj, "helpers"));
    const bin = path.join(proj, "helpers", "winbounds");
    fs.writeFileSync(bin, "");
    assert.deepStrictEqual(winbounds.helperCommand("darwin", proj, bare), { cmd: bin, args: [] });
    assert.strictEqual(winbounds.helperCommand("linux", proj, bare), null); // 파일이 있어도 다른 플랫폼은 없음
    const ps1 = path.join(proj, "helpers", "winbounds.ps1");
    fs.writeFileSync(ps1, "");
    assert.deepStrictEqual(winbounds.helperCommand("win32", proj, bare), {
      cmd: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Serve"],
      serve: true,
    });
    // 덮어쓰기 — 있으면 그것, 없으면 null (플랫폼 기본으로 떨어지지 않는다)
    assert.deepStrictEqual(winbounds.helperCommand("linux", proj, { POKEBUDDY_WINBOUNDS: bin }), { cmd: bin, args: [] });
    assert.strictEqual(winbounds.helperCommand("darwin", proj, { POKEBUDDY_WINBOUNDS: path.join(proj, "없음") }), null);
  });

  await ok("parseInfo: JSON 한 줄 → HelperInfo · id 가 숫자 아닌 창은 뺌 · 깨진 줄·객체 아님 → null", () => {
    const line = '{"frontmost":"Code","frontPid":2108,"windows":[{"app":"Code","pid":2108,"id":12345,"x":0,"y":30,"w":2560,"h":1324},{"app":"x","pid":1,"id":"bad"},null]}';
    const info = some(winbounds.parseInfo(line));
    assert.strictEqual(info.frontmost, "Code");
    assert.strictEqual(info.frontPid, 2108);
    assert.deepStrictEqual(info.windows.map((w) => w.id), [12345]);
    const ps = some(winbounds.parseInfo('{"frontmost":"Code","frontId":123456,"windows":[]}'));
    assert.strictEqual(ps.frontId, 123456);
    assert.deepStrictEqual(ps.windows, []);
    assert.deepStrictEqual(some(winbounds.parseInfo("{}")).windows, []);
    assert.strictEqual(winbounds.parseInfo('{"frontmost":'), null);
    assert.strictEqual(winbounds.parseInfo(""), null);
    assert.strictEqual(winbounds.parseInfo(undefined), null);
    assert.strictEqual(winbounds.parseInfo("null"), null);
    assert.strictEqual(winbounds.parseInfo("42"), null);
    // 헬퍼 답 → frontWindow 로 이어지는지
    const picked = front.frontWindow(info, info.windows, { pid: 1, appNames: new Set(["electron"]) });
    assert.strictEqual(some(picked).id, 12345);
  });

  await ok("queryHelper: 한 번 실행(execFile) · serve 는 하나를 띄워 두고 재사용 · stopHelper 로 멈춤", async () => {
    const onceScript = path.join(dir, "once.js");
    fs.writeFileSync(onceScript, 'process.stdout.write(JSON.stringify({ frontmost: "Code", frontPid: 7, windows: [{ app: "Code", pid: 7, id: 70, x: 0, y: 0, w: 1, h: 1 }] }) + "\\n");');
    const a = await once<string>((cb) => winbounds.queryHelper({ cmd: process.execPath, args: [onceScript] }, cb));
    assert.strictEqual(a.err, null);
    assert.strictEqual(some(winbounds.parseInfo(a.v)).frontPid, 7);
    const bad = await once<string>((cb) => winbounds.queryHelper({ cmd: path.join(dir, "없는-실행파일"), args: [] }, cb));
    assert.ok(bad.err instanceof Error);

    const cmd = { cmd: process.execPath, args: [serve], serve: true };
    const b = await once<string>((cb) => winbounds.queryHelper(cmd, cb, { timeoutMs: 3000, startTimeoutMs: 10000 }));
    assert.deepStrictEqual(JSON.parse(some(b.v)), { n: 1, echo: "" });
    const c = await once<string>((cb) => winbounds.queryHelper(cmd, cb));
    assert.deepStrictEqual(JSON.parse(some(c.v)), { n: 2, echo: "" }); // 같은 프로세스 — 번호가 이어진다
    winbounds.stopHelper();
    winbounds.stopHelper(); // 없을 때도 조용하다
    const d = await once<string>((cb) => winbounds.queryHelper(cmd, cb));
    assert.deepStrictEqual(JSON.parse(some(d.v)), { n: 1, echo: "" }); // 새로 띄움
    winbounds.stopHelper();
    await sleep(50); // 자식이 끝날 시간 — 임시 폴더 삭제 전에
  });
}

async function main(): Promise<void> {
  say("selftest-follow");
  await testPids();
  await testStateRecords();
  await testFront();
  await testLineHelper();
  say(`통과 (${checks.count()}건)`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => {
    winbounds.stopHelper();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 임시 폴더 — 남아도 해가 없다
    }
  });
