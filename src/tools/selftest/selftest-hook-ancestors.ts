// 훅의 조상 조회 — 세션 시작 때 한 번 구하고, 도구 호출마다 이어 쓴다. 못 구한 것도 이어 쓴다 (worklog/records/perf-refactor 8-3, G12-1·2)
//
//   node dist/tools/selftest/selftest-hook-ancestors.js   (npm run build 뒤 — 빌드한 훅 dist/hooks/pokebuddy-state.js 를 실제로 띄운다)
//
// 다시 구했는지는 기록의 조상 목록으로 가른다 — 이 시험을 띄운 프로세스에는 조상이 있으므로 다시 구하면 목록이 찬다
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTmp } from "../harness/tmp-dir";
import { okCounter, printLine } from "../harness/report";

const HOOK = path.join(__dirname, "..", "..", "hooks", "pokebuddy-state.js");
const t = okCounter();

const home = makeTmp("hook-ancestors");
const dataDir = process.platform === "win32" ? path.join(home, "AppData", "Roaming", "pokebuddy") : process.platform === "darwin" ? path.join(home, "Library", "Application Support", "pokebuddy") : path.join(home, ".config", "pokebuddy");
fs.mkdirSync(path.join(dataDir, "state"), { recursive: true });
fs.writeFileSync(path.join(dataDir, "config.json"), "{}"); // 데이터 폴더가 비어 있으면 훅이 옛 자리를 찾는다
const stateFile = path.join(dataDir, "state", "s1.json");

const run = (event: string): void => {
  const r = spawnSync(process.execPath, [HOOK, "--cli", "claude"], {
    input: JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: home }),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `훅 ${event}: ${r.stderr}`);
};
const record = (): { ancestors?: number[]; ancestorsTried?: boolean } => JSON.parse(fs.readFileSync(stateFile, "utf8")) as { ancestors?: number[]; ancestorsTried?: boolean };
const seed = (extra: Record<string, unknown>): void => fs.writeFileSync(stateFile, JSON.stringify({ state: "running", cli: "claude", event: "PreToolUse", at: Date.now() / 1000, cwd: home, ...extra }));

t.ok("세션 시작 때 구하고 구해 봤다고 적는다", () => {
  run("SessionStart");
  const r = record();
  assert.equal(r.ancestorsTried, true);
  assert.ok((r.ancestors ?? []).length > 0, "이 시험을 띄운 프로세스가 조상이다");
});

t.ok("도구 호출은 적힌 조상을 이어 쓴다", () => {
  seed({ ancestors: [111, 222], ancestorsTried: true });
  run("PreToolUse");
  assert.deepEqual(record().ancestors, [111, 222]);
});

t.ok("못 구한 것(빈 목록)도 이어 쓴다 — 도구마다 다시 띄우지 않는다", () => {
  seed({ ancestors: [], ancestorsTried: true });
  run("PreToolUse");
  assert.deepEqual(record().ancestors, []);
});

t.ok("옛 훅의 빈 기록(구해 봤다는 표시 없음)은 다시 구한다", () => {
  seed({ ancestors: [] });
  run("PreToolUse");
  assert.ok((record().ancestors ?? []).length > 0);
  assert.equal(record().ancestorsTried, true);
});

printLine(`selftest-hook-ancestors: 통과 (${t.count()}건)`);
