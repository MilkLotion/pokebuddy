// 클라우드 올리기 종류 — 시간 진행만 바뀐 저장은 10분, 명령은 2분, 사건은 바로. 배틀 전에는 명령·사건 쓰기가 남았을 때만 올린다
// (2026-10-14 사용자 결정 "추천대로", worklog/records/perf-refactor 2-9)
//
//   node dist/tools/selftest/selftest-cloud-kind.js
//
// 서버 없이 도는 부분만 — 쓰기 이름 → 종류(src/online/save-kind.ts), 마지막 올리기 뒤 바뀐 것 세기(src/online/change-mark.ts).
// 올리기 예약 자체는 로컬 Supabase 가 있어야 도는 selftest-cloud 가 본다
import assert from "node:assert";
import { saveKindOf } from "../../online/save-kind";
import { createChangeMark } from "../../online/change-mark";
import { ONLINE_TIMING } from "../../online/timing";
import { okCounter, printLine } from "../harness/report";

const t = okCounter();

t.ok("쓰기 이름 → 종류 — 이름 없음은 tick, 사건은 event, 그 밖의 명령은 change", () => {
  assert.equal(saveKindOf(undefined), "tick");
  assert.equal(saveKindOf(""), "tick");
  assert.equal(saveKindOf("egg.open"), "event");
  assert.equal(saveKindOf("trade.apply"), "event");
  for (const name of ["shop.buy", "bag.use", "feed", "battle.place", "settings.set"]) assert.equal(saveKindOf(name), "change", name);
});

t.ok("간격 — 시간 진행 10분, 명령 2분", () => {
  assert.equal(ONLINE_TIMING.tickThrottleMs, 600_000);
  assert.equal(ONLINE_TIMING.uploadThrottleMs, 120_000);
});

t.ok("시간 진행만 쓰면 배틀 전에 올릴 것이 없다", () => {
  const m = createChangeMark(false);
  m.note("tick");
  m.note("tick");
  assert.equal(m.pending(), false);
});

t.ok("명령·사건을 쓰면 올릴 것이 있고, 그 뒤 올리기가 성공하면 없다", () => {
  const m = createChangeMark(false);
  m.note("change");
  assert.equal(m.pending(), true);
  const mark = m.start();
  m.done(mark);
  assert.equal(m.pending(), false);
  m.note("event");
  assert.equal(m.pending(), true);
});

t.ok("올리는 동안 또 바뀌면 그 올리기가 끝나도 남는다", () => {
  const m = createChangeMark(false);
  m.note("change");
  const mark = m.start();
  m.note("change"); // 보내는 사이
  m.done(mark);
  assert.equal(m.pending(), true);
});

t.ok("지난 실행에서 못 올린 저장이 있으면 바뀐 것으로 본다", () => {
  assert.equal(createChangeMark(true).pending(), true);
  assert.equal(createChangeMark(false).pending(), false);
});

printLine(`selftest-cloud-kind: 통과 (${t.count()}건)`);
