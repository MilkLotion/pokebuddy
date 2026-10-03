// 창 도우미 자체 확인 — 입력 검사(src/main/windows/input.ts), 창 자리 계산(src/main/windows/placement.ts),
// 한 번만 띄우기(src/main/windows/answer-window.ts singleFlight). Electron 없이 돈다
//   npm run build 뒤 node dist/tools/selftest/selftest-window-helpers.js
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { singleFlight } from "../../main/windows/answer-window";
import { INPUT_LIMITS, deviceHeightOf, isIndexBelow, isQty, isRecord, isShortId, isStep } from "../../main/windows/input";
import { centerSpotOf, cornerSpotOf, dockAt } from "../../main/windows/placement";

// (1) 입력 검사 — 지금 창 파일들이 쓰던 값과 같다
{
  assert.equal(isRecord({}), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("x"), false);
  assert.equal(isShortId("p1"), true);
  assert.equal(isShortId(""), false, "빈 글자는 아니다");
  assert.equal(isShortId("a".repeat(INPUT_LIMITS.idChars)), true);
  assert.equal(isShortId("a".repeat(INPUT_LIMITS.idChars + 1)), false, "상한을 넘으면 아니다");
  assert.equal(isShortId(3), false);
  assert.equal(isQty(1), true);
  assert.equal(isQty(999), true);
  assert.equal(isQty(0), false);
  assert.equal(isQty(1000), false);
  assert.equal(isQty(1.5), false);
  assert.equal(isStep(1), true);
  assert.equal(isStep(-1), true);
  assert.equal(isStep(0), false);
  assert.equal(isIndexBelow(0, 6), true);
  assert.equal(isIndexBelow(5, 6), true);
  assert.equal(isIndexBelow(6, 6), false);
  assert.equal(isIndexBelow(-1, 6), false);
  assert.equal(deviceHeightOf(512.2), 513, "올림");
  assert.equal(deviceHeightOf(10), 200, "아래 상한");
  assert.equal(deviceHeightOf(5000), 1200, "위 상한");
  assert.equal(deviceHeightOf(Number.NaN), null);
  assert.equal(deviceHeightOf("300"), null);
  process.stdout.write("(1) 입력 검사  ok\n");
}

// (2) 창 자리 — 기기 창 옆에 붙이기, 알림 창 가운데 위쪽, 배너 오른쪽 아래
{
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 380, height: 500 };
  assert.deepEqual(dockAt({ x: 100, y: 100, width: 640, height: 700 }, area, size), { x: 740, y: 100, side: "right" }, "오른쪽에 자리가 있으면 오른쪽");
  assert.deepEqual(dockAt({ x: 1400, y: 100, width: 640, height: 700 }, area, size), { x: 1020, y: 100, side: "left" }, "오른쪽에 없으면 왼쪽");
  assert.deepEqual(dockAt({ x: 0, y: 100, width: 1800, height: 700 }, area, size), { x: 1800, y: 100, side: "right" }, "양쪽 다 없으면 오른쪽");
  assert.deepEqual(dockAt({ x: 100, y: 900, width: 640, height: 700 }, area, size).y, 540, "아래로 넘치면 화면 안으로 올린다");
  assert.deepEqual(centerSpotOf(area, { width: 472, height: 240 }), { x: 724, y: 267 });
  assert.deepEqual(centerSpotOf({ x: 0, y: 0, width: 400, height: 100 }, { width: 472, height: 240 }), { x: -36, y: 0 }, "남는 높이가 없으면 맨 위");
  assert.deepEqual(cornerSpotOf(area, { width: 296, height: 98 }, 8), { x: 1616, y: 934 });
  process.stdout.write("(2) 창 자리  ok\n");
}

// (3) 한 번만 띄우기 — 답이 오기 전에는 같은 약속, 답을 받은 쪽이 바로 다시 부르면 새로 띄운다
async function singleFlightCases(): Promise<void> {
  let runs = 0;
  let answer: (v: string) => void = () => undefined;
  const ask = singleFlight((label: string) => {
    runs++;
    return new Promise<string>((resolve) => {
      answer = (v) => resolve(`${label}:${v}`);
    });
  });
  assert.equal(ask.inFlight(), false);
  const first = ask("a");
  const second = ask("b");
  assert.equal(first, second, "답이 오기 전에는 같은 약속");
  assert.equal(runs, 1, "창은 한 벌");
  assert.equal(ask.inFlight(), true);
  let again: Promise<string> | null = null;
  const got = first.then((v) => {
    again = ask("c"); // 답을 받은 자리에서 바로 다시 부른다
    return v;
  });
  answer("ok");
  assert.equal(await got, "a:ok", "두 번째 부름의 인자는 버린다");
  assert.equal(runs, 2, "답을 받은 뒤 부르면 새로 띄운다");
  assert.notEqual(again, first);
  answer("ok");
  await again;
  assert.equal(ask.inFlight(), false);
  const failing = singleFlight(() => Promise.reject(new Error("못 띄움")));
  await assert.rejects(failing());
  assert.equal(failing.inFlight(), false, "거절돼도 비운다");
  process.stdout.write("(3) 한 번만 띄우기  ok\n");
}

singleFlightCases().then(
  () => process.stdout.write("selftest-window-helpers: 통과 (입력 검사·창 자리·한 번만 띄우기)\n"),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
