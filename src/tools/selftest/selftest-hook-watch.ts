// 훅 기록 되풀이 읽기 — 결과는 한 번 읽기(readHookRecords)와 같고, 바뀐 파일만 다시 읽는다 (worklog/records/perf-refactor 2-6)
//
//   node dist/tools/selftest/selftest-hook-watch.js
//
// 동반자가 400ms 마다 부르는 읽기다(src/main/stage/host-watch.ts). 임시 폴더에서 파일을 더하고·고치고·지우고·깨뜨리며 매번 견준다
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { hookRecordReader, readHookRecords } from "../../agents/hook-records";
import { makeTmp } from "../harness/tmp-dir";
import { perfCounter } from "../harness/perf-count";
import { okCounter, printLine } from "../harness/report";

const dir = makeTmp("hook-watch");
const t = okCounter();
const read = hookRecordReader(dir);
let tick = 1_800_000_000; // 수정 시각(초) — 파일마다 다르게 둬 최신순이 정해지게
const put = (name: string, body: unknown): void => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  tick += 10;
  fs.utimesSync(file, tick, tick);
};
const same = (label: string): void => assert.deepStrictEqual(read(), readHookRecords(dir), label);

t.ok("폴더가 비었거나 없으면 빈 목록", () => {
  assert.deepStrictEqual(hookRecordReader(path.join(dir, "없음"))(), []);
  same("빈 폴더");
});

t.ok("더하기·고치기·지우기 — 매번 한 번 읽기와 같다(최신순)", () => {
  put("a.json", { state: "running", at: 1 });
  put("b.json", { state: "idle", at: 2 });
  same("둘");
  put("a.json", { state: "idle", at: 3 });
  same("a 를 고쳐 가장 새것");
  fs.unlinkSync(path.join(dir, "b.json"));
  same("b 를 지움");
  put("c.txt", "json 이 아니다");
  same("json 이 아닌 파일은 보지 않는다");
});

t.ok("깨진 파일은 건너뛰고, 고쳐지면 다시 읽는다", () => {
  put("d.json", "{ 쓰는 중");
  same("깨진 파일 건너뜀");
  put("d.json", { state: "running", at: 9 });
  same("고친 파일을 읽는다");
});

t.ok("바뀐 파일이 없으면 다시 읽지 않는다", () => {
  read();
  const counter = perfCounter(dir);
  try {
    read();
    read();
    assert.equal(counter.counts()["fs.readFileSync"], 0);
  } finally {
    counter.stop();
  }
});

printLine(`selftest-hook-watch: 통과 (${t.count()}건)`);
