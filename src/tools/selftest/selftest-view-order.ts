// 늦게 온 스냅샷 가리기 — 이미 받은 것보다 낮은 순번은 버린다 (실행 규칙 R2, worklog/records/perf-refactor 1-4)
//
//   node dist/tools/selftest/selftest-view-order.js
//
// 렌더러의 createViewGate(src/renderer/manage/view-gate.ts)를 그대로 부른다.
// 메인은 요청을 받은 차례대로 스냅샷에 순번을 매긴다(src/main/manage/game-reads.ts). 설정창에 닿는 차례는 다를 수 있다
import assert from "node:assert";
import { webModule } from "../harness/web-module";
import { okCounter, printLine } from "../harness/report";

const { createViewGate } = webModule<{ createViewGate: () => { fresh(view: { seq?: number } | null): boolean } }>("renderer/manage/view-gate.js");
const t = okCounter();

t.ok("1초 시계 스냅샷(5)이 명령 답(6)보다 늦게 오면 버린다 — G47-3", () => {
  const gate = createViewGate();
  assert.equal(gate.fresh({ seq: 6 }), true, "명령 답");
  assert.equal(gate.fresh({ seq: 5 }), false, "늦게 온 시계 스냅샷");
  assert.equal(gate.fresh({ seq: 7 }), true, "다음 시계");
});

t.ok("차례대로 오면 모두 받는다", () => {
  const gate = createViewGate();
  for (const seq of [1, 2, 3, 10]) assert.equal(gate.fresh({ seq }), true);
});

t.ok("같은 순번은 한 번만 받는다", () => {
  const gate = createViewGate();
  assert.equal(gate.fresh({ seq: 3 }), true);
  assert.equal(gate.fresh({ seq: 3 }), false);
});

t.ok("순번이 없는 값(저장 없음 null, 순번 없는 스냅샷)은 받고 기억을 바꾸지 않는다", () => {
  const gate = createViewGate();
  assert.equal(gate.fresh({ seq: 4 }), true);
  assert.equal(gate.fresh(null), true);
  assert.equal(gate.fresh({}), true);
  assert.equal(gate.fresh({ seq: 4 }), false);
});

t.ok("엇갈린 순서를 모두 돌려도 화면 값은 가장 큰 순번이다", () => {
  const orders = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
  for (const order of orders) {
    const gate = createViewGate();
    let shown = 0;
    for (const seq of order) if (gate.fresh({ seq })) shown = seq;
    assert.equal(shown, 3, `순서 ${order.join(",")}`);
  }
});

printLine(`selftest-view-order: 통과 (${t.count()}건)`);
