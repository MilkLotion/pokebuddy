// 훅의 토큰 집계 — 한 응답(message.id)이 여러 줄로 기록돼도 한 번만 센다 (worklog/records/perf-refactor 5-6, G12-3)
//
//   node dist/tools/selftest/selftest-hook-usage.js   (npm run build 뒤 — 빌드한 훅 dist/hooks/pokebuddy-state.js 를 실제로 띄운다)
//
// 임시 HOME 에 데이터 폴더와 대화 기록을 두고, SessionStart 로 기준점을 잡은 뒤 Stop 에서 늘어난 몫을 본다
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTmp } from "../harness/tmp-dir";
import { okCounter, printLine } from "../harness/report";

const HOOK = path.join(__dirname, "..", "..", "hooks", "pokebuddy-state.js");
const t = okCounter();

const home = makeTmp("hook-usage");
const dataDir = process.platform === "win32" ? path.join(home, "AppData", "Roaming", "pokebuddy") : process.platform === "darwin" ? path.join(home, "Library", "Application Support", "pokebuddy") : path.join(home, ".config", "pokebuddy");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "config.json"), "{}"); // 데이터 폴더가 비어 있으면 훅이 옛 자리를 찾는다
const transcript = path.join(home, "session.jsonl");
fs.writeFileSync(transcript, "");

const run = (event: string): void => {
  const r = spawnSync(process.execPath, [HOOK, "--cli", "claude"], {
    input: JSON.stringify({ hook_event_name: event, session_id: "s1", transcript_path: transcript, cwd: home }),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `훅 ${event}: ${r.stderr}`);
};
const line = (id: string | null, out: number): string => `${JSON.stringify({ type: "assistant", message: { ...(id ? { id } : {}), usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n`;
const record = (): { usage?: { out: number; in: number } } => JSON.parse(fs.readFileSync(path.join(dataDir, "state", "s1.json"), "utf8")) as { usage?: { out: number; in: number } };

t.ok("한 응답이 여러 줄이어도 한 번만 센다", () => {
  run("SessionStart");
  // 응답 m1 — 콘텐츠 블록 셋(같은 usage 를 되풀이), 응답 m2 — 한 줄
  fs.appendFileSync(transcript, line("m1", 100) + line("m1", 100) + line("m1", 100) + line("m2", 50));
  run("Stop");
  assert.equal(record().usage?.out, 150, "100(m1 한 번) + 50(m2)");
  assert.equal(record().usage?.in, 2);
});

t.ok("다음 턴은 늘어난 몫만 더한다 — id 없는 줄은 줄마다 센다", () => {
  fs.appendFileSync(transcript, line("m3", 10) + line("m3", 10) + line(null, 7) + line(null, 7));
  run("Stop");
  assert.equal(record().usage?.out, 150 + 10 + 7 + 7);
});

printLine(`selftest-hook-usage: 통과 (${t.count()}건)`);
