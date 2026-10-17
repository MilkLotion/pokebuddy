// 기기 창 연결 — 설정창이 기기 창에 언제 다시 보내는지 (실행 규칙 R2·R4, worklog/records/perf-refactor 0-4)
//
//   node dist/tools/selftest/selftest-device-link.js
//
// 렌더러의 createDeviceLink(src/renderer/manage/device-link.ts)를 그대로 부른다. 메인 쪽 열기는 가짜로 세기만 한다.
// 보는 것: 고른 값과 비교 기준이 같으면 다시 보내지 않는다 · 명령 중(holding)에는 보내지 않는다 · 늦은 답은 버린다 · 닫으면 다시 연다.
// 연결마다 비교 기준(stamp)으로 무엇을 쓰는지는 정적 검사 check-runtime 이 본다 — 지금은 매초 새 객체(ui.view)라 매초 보낸다
import assert from "node:assert";
import { webModule } from "../harness/web-module";
import { okCounter, printLine } from "../harness/report";

interface DeviceLink {
  sync(force?: boolean): void;
  onClosed(gen: number): void;
  isOpen(): boolean;
}
interface LinkOptions<I> {
  build: () => I | null;
  stamp: () => unknown;
  open: (input: I | null, gen?: number) => Promise<I | null>;
  apply?: (input: I) => void;
  afterClosed: () => boolean;
  redraw: () => void;
  holding?: () => boolean;
  layer?: string; // 열림 스택의 겹 이름 — 시험 몇 개만 쓴다
}
const { createDeviceLink } = webModule<{ createDeviceLink: <I>(o: LinkOptions<I>) => DeviceLink }>("renderer/manage/device-link.js");

type Input = { id: string; qty: number };

// 가짜 메인 — 보낸 것을 모으고, 답은 부르는 쪽이 정한 때 준다
function fakeMain() {
  const sent: (Input | null)[] = [];
  const answers: ((v: Input | null) => void)[] = [];
  return {
    sent,
    open: (input: Input | null): Promise<Input | null> => {
      sent.push(input);
      return new Promise((res) => answers.push(res));
    },
    answer: (i: number, v: Input | null) => answers[i]!(v),
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

async function main(): Promise<void> {
  const t = okCounter();

  await t.okAsync("고른 값과 비교 기준이 같으면 다시 보내지 않는다", async () => {
    const m = fakeMain();
    const stamp = {};
    const link = createDeviceLink<Input>({ build: () => ({ id: "p1", qty: 1 }), stamp: () => stamp, open: m.open, afterClosed: () => false, redraw: () => {} });
    for (let i = 0; i < 10; i += 1) link.sync();
    assert.equal(m.sent.length, 1, "열 때 한 번만");
  });

  await t.okAsync("비교 기준이 바뀌면 다시 보낸다 — 매초 새 객체면 매초 보낸다", async () => {
    const m = fakeMain();
    const link = createDeviceLink<Input>({ build: () => ({ id: "p1", qty: 1 }), stamp: () => ({}), open: m.open, afterClosed: () => false, redraw: () => {} });
    for (let i = 0; i < 10; i += 1) link.sync();
    assert.equal(m.sent.length, 10, "ui.view 처럼 매번 새 객체면 매번 보낸다 — 3-5 에서 판 번호로 바꾼다");
  });

  await t.okAsync("명령 중(holding)에는 보내지 않고, 처리 중 표시(force)는 보낸다", async () => {
    const m = fakeMain();
    let hold = false;
    let n = 0;
    const link = createDeviceLink<Input>({ build: () => ({ id: "p1", qty: 1 }), stamp: () => n, open: m.open, afterClosed: () => false, redraw: () => {}, holding: () => hold });
    link.sync();
    hold = true;
    n += 1;
    link.sync();
    assert.equal(m.sent.length, 1, "명령 중에는 보내지 않는다");
    link.sync(true);
    assert.equal(m.sent.length, 2, "force 는 보낸다");
  });

  await t.okAsync("늦게 온 앞 답은 뒤 값을 덮지 않는다", async () => {
    const m = fakeMain();
    let qty = 1;
    const applied: Input[] = [];
    const link = createDeviceLink<Input>({ build: () => ({ id: "p1", qty }), stamp: () => 0, open: m.open, apply: (v) => applied.push(v), afterClosed: () => false, redraw: () => {} });
    link.sync();
    qty = 2;
    link.sync();
    m.answer(1, { id: "p1", qty: 2 });
    m.answer(0, { id: "p1", qty: 9 }); // 앞 요청의 답이 늦게 왔다
    await flush();
    assert.deepEqual(applied, [], "늦은 답은 버리고, 뒤 답은 보낸 값과 같아 되돌릴 것이 없다");
  });

  await t.okAsync("닫힘을 받았는데 고른 값이 남아 있으면 새 번호로 곧바로 다시 연다", async () => {
    // 머리의 종류 탭으로 바꿨다가 닫힘 알림 전에 돌아왔다 — 닫히기 전에 보낸 여는 요청은 낡은 번호라 메인이 버렸다 (device-kind.ts)
    const m = fakeMain();
    const link = createDeviceLink<Input>({ build: () => ({ id: "p1", qty: 1 }), stamp: () => 0, open: m.open, afterClosed: () => false, redraw: () => {}, layer: "device:t" });
    link.sync();
    link.onClosed(5);
    assert.equal(m.sent.length, 2, "닫힘 알림을 받자마자 다시 연다");
    assert.equal(link.isOpen(), true);
  });

  await t.okAsync("닫힘에서 고른 것을 비우면 다시 열지 않는다", async () => {
    // ✕·Esc 로 닫았다 — afterClosed 가 고른 것을 비우고 다시 그린다
    const m = fakeMain();
    let picked: Input | null = { id: "p1", qty: 1 };
    const link = createDeviceLink<Input>({
      build: () => picked,
      stamp: () => 0,
      open: m.open,
      afterClosed: () => {
        picked = null;
        return true;
      },
      redraw: () => link.sync(),
      layer: "device:t",
    });
    link.sync();
    link.onClosed(5);
    assert.equal(link.isOpen(), false);
    assert.equal(m.sent.filter((x) => x !== null).length, 1, "다시 열지 않는다");
  });

  printLine(`selftest-device-link: 통과 (${t.count()}건)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
