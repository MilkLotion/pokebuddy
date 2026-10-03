// 시험의 기다리기 — 자체 검사·화면 검사·E2E 가 같이 쓴다
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 조건이 참이 될 때까지 기다린다. 못 채우면 던진다: "대기 실패: <label>"
export async function until(test: () => boolean | Promise<boolean>, label: string, opts: { ms?: number; stepMs?: number } = {}): Promise<void> {
  const end = Date.now() + (opts.ms ?? 10_000);
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(opts.stepMs ?? 50);
  }
  throw new Error(`대기 실패: ${label}`);
}

// 조건이 참이 될 때까지 기다린다. 던지지 않고 마지막 판정을 돌려준다
export async function waitFor(test: () => boolean, opts: { ms?: number; stepMs?: number } = {}): Promise<boolean> {
  const end = Date.now() + (opts.ms ?? 3000);
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(opts.stepMs ?? 20);
  }
  return test();
}

// 약속이 ms 안에 끝나지 않으면 던진다 — 교착을 잡는다
export const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, sleep(ms).then((): never => { throw new Error(`${what} — ${ms}ms 안에 끝나지 않았다(교착)`); })]);
