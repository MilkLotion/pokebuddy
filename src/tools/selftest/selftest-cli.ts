// CLI 계약 검사 — 순수 파서와 실제 Node·PowerShell·cmd 입구를 임시 HOME에서 확인.
// (예전 scripts/selftest-cli.cjs. 타입 검사를 받게 src/tools 로 옮겼다)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs as parseCliArgs } from "../../cli/args";
import { makeTmp } from "../harness/tmp-dir";
import { claimLock, isLockReady } from "../../platform/pid-lock";

interface Parsed {
  kind: string;
  opts?: Record<string, string>;
  error?: string;
  stop?: boolean;
}
const root = path.resolve(__dirname, "..", "..", "..");
// 인자 해석 — src/cli/args.ts (예전 cli/args.js, 도구 레인 T7b-3). 결과 모양은 이 검사가 보는 칸만 적은 Parsed 로 읽는다
const parseArgs = (argv: string[]): Parsed => parseCliArgs(argv) as Parsed;

// 임시 폴더는 <임시 폴더>/pokebuddy/ 아래에 만들고 끝나면 지운다 (src/tools/harness/tmp-dir.ts)
const home = makeTmp("cli");
const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home };
for (const key of Object.keys(env)) {
  if (key.startsWith("POKEBUDDY_") || key === "NODE_OPTIONS" || key === "ELECTRON_RUN_AS_NODE") delete env[key];
}
let checks = 0;
assert.deepEqual(parseArgs(["companion"]), { kind: "companion", opts: {} }); checks++;
assert.deepEqual(parseArgs(["companion", "buddy=calm", "--click", "on"]).opts, { buddy: "calm", click: "on" }); checks++;
// 세션 펫 명령(pokebuddy <종> · stop)은 없어졌다 — 알 수 없는 명령으로 멈춘다. 인자가 없으면 도움말
for (const args of [["eevee"], ["eevee", "dot=3"], ["stop"], ["stop", "all"]]) {
  assert.equal(parseArgs(args).kind, "unknown", args.join(" ")); checks++;
}
assert.equal(parseArgs([]).kind, "help"); checks++;
for (const name of ["pet", "pokemon", "pokebuddy", "PET"]) {
  for (const args of [[`${name}=eevee`], [`--${name}`, "eevee"]]) {
    assert.match(parseArgs(["companion", ...args]).error ?? "", /포켓몬 이름을 받지 않는다/); checks++;
  }
}
for (const args of [["eevee"], ["dot=3"], ["--dot", "3"], ["keep=on"], ["--keep", "on"], ["--buddy", "--help"], ["stop", "eevee"], ["stop", "--typo"]]) {
  assert.ok(parseArgs(["companion", ...args]).error, args.join(" ")); checks++;
}
assert.equal(parseArgs(["companion", "stop"]).stop, true); checks++;
assert.equal(parseArgs(["companion", "stop", "--help"]).kind, "help"); checks++;

// 실제 동반자 대신 이 검사 프로세스의 PID를 임시 잠금에 기록. 잘못된 종료의 부작용 확인.
const lock = path.join(home, ".claude", "pokebuddy", "companion.lock");
fs.mkdirSync(path.dirname(lock), { recursive: true });
const content = `${process.pid}\nready\n`;
fs.writeFileSync(lock, content);
const launchers: [string, string[]][] = [[process.execPath, [path.join(root, "bin/pokebuddy")]]];
if (process.platform === "win32") {
  launchers.push(["powershell", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "bin/pokebuddy.ps1")]]);
  launchers.push([process.env.ComSpec || "cmd.exe", ["/d", "/c", "bin\\pokebuddy.cmd"]]);
}
for (const [exe, prefix] of launchers) {
  for (const [args, status] of [[["companion", "stop", "--help"], 0], [["companion", "stop", "typo"], 2], [["companion", "pet=eevee"], 2], [["companion"], 0]] as [string[], number][]) {
    const result = spawnSync(exe, [...prefix, ...args], { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 10000 });
    assert.equal(result.status, status, `${exe}: ${args.join(" ")}\n${result.stderr}`);
    assert.equal(fs.readFileSync(lock, "utf8"), content, "도움말·오타·중복 실행은 잠금을 변경하지 않음");
    checks++;
  }
}
// CLI 도 앱과 같은 잠금 함수를 쓴다 — 준비 표시는 적힌 pid 의 것만, 살아 있는 다른 동반자의 잠금은 잡지 못한다 (94 항목 5-7)
assert.equal(isLockReady(lock, process.pid), true, "적힌 pid 의 ready"); checks++;
assert.equal(isLockReady(lock, process.pid + 1), false, "다른 pid 의 ready 는 보지 않는다"); checks++;
assert.equal(claimLock(lock, process.pid + 1).reason, "busy", "살아 있는 다른 동반자가 잡고 있다"); checks++;
assert.equal(fs.readFileSync(lock, "utf8"), content, "잡지 못하면 잠금을 바꾸지 않는다"); checks++;
fs.rmSync(lock);
process.stdout.write(`CLI PASS: ${checks}개 검사, 입구 ${launchers.length}종. 임시 데이터: ${home}\n`);
