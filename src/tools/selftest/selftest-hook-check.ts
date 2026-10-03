// 연결 점검 — node 찾기, 마지막 신호, 점검(훅을 한 번 실제로 돌림)과 실패 이유 (src/agents/check.ts)
//   npm run build && node dist/tools/selftest/selftest-hook-check.js
// 임시 HOME 을 쓴다 — 진짜 ~/.claude·~/.codex 설정과 훅 기록을 건드리지 않는다
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTmp } from "../harness/tmp-dir";

const home = makeTmp("selftest-hook-check");
process.env.HOME = home; // platform/paths(dist) · setup.js 가 require 될 때 os.homedir() 로 읽는다
process.env.USERPROFILE = home;
process.env.CODEX_HOME = path.join(home, ".codex");
delete process.env.CLAUDE_CONFIG_DIR;

// HOME 을 바꾼 뒤에 읽는다 — ES import 는 맨 위로 끌어올려진다
import check = require("../../agents/check");
import registry = require("../../agents/registry");

const stateDir = path.join(home, ".claude", "pokebuddy", "state");

async function main(): Promise<void> {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });

  // (1) node 찾기 — 이 시험을 돌리는 node 가 있으니 찾아야 한다
  const node = await check.findNode(true);
  assert.ok(node && fs.existsSync(node.path) && /^v\d+/.test(node.version), `node 를 찾는다 (${JSON.stringify(node)})`);
  process.stdout.write("(1) node 찾기  ok\n");

  // (2) 마지막 신호 — CLI 별 가장 늦은 at(초 → ms). 점검 기록과 깨진 파일은 세지 않는다
  fs.writeFileSync(path.join(stateDir, "a.json"), JSON.stringify({ cli: "claude", at: 100 }));
  fs.writeFileSync(path.join(stateDir, "b.json"), JSON.stringify({ cli: "claude", at: 250 }));
  fs.writeFileSync(path.join(stateDir, "c.json"), JSON.stringify({ cli: "codex", at: 50.5 }));
  fs.writeFileSync(path.join(stateDir, "pokebuddy-check-1.json"), JSON.stringify({ cli: "gemini", at: 999 }));
  fs.writeFileSync(path.join(stateDir, "broken.json"), "{");
  assert.deepStrictEqual(check.lastSignals(stateDir), { claude: 250_000, codex: 50_500 });
  for (const n of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, n));
  process.stdout.write("(2) 마지막 신호  ok\n");

  // (3) 점검 — 연결한 뒤 등록한 명령을 돌리면 기록이 생기고, 확인한 기록은 지운다
  const connected = registry.connect("codex");
  assert.ok(connected.ok, JSON.stringify(connected));
  const hook = registry.hookCommandOf("codex");
  assert.ok(hook && hook.command.includes("--cli codex") && fs.existsSync(hook.file), JSON.stringify(hook));
  const ok = await check.probe("codex", hook.command, hook.file, node, stateDir);
  assert.deepStrictEqual(ok, { ok: true, reason: "ok" });
  assert.deepStrictEqual(fs.readdirSync(stateDir).filter((n) => n.startsWith("pokebuddy-check")), [], "점검 기록은 지운다");
  process.stdout.write("(3) 점검 성공 · 기록 정리  ok\n");

  // (4) 실패 이유 — node 없음, 훅 파일 없음, 종료 코드
  assert.equal((await check.probe("codex", hook.command, hook.file, null, stateDir)).reason, "node-missing");
  assert.equal((await check.probe("codex", hook.command, path.join(home, "없는-훅.cjs"), node, stateDir)).reason, "hook-missing");
  const bad = await check.probe("codex", `node -e "process.exit(3)"`, hook.file, node, stateDir);
  assert.deepStrictEqual(bad, { ok: false, reason: "exit", detail: "3" });
  const silent = await check.probe("codex", `node -e "0"`, hook.file, node, stateDir);
  assert.equal(silent.reason, "no-record", "돌았지만 기록이 없다");
  process.stdout.write("(4) 실패 이유  ok\n");

  fs.rmSync(home, { recursive: true, force: true });
  process.stdout.write("selftest-hook-check: 통과 (node 찾기·마지막 신호·점검·실패 이유)\n");
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
