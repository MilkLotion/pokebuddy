// 계약 처리기 표 걸기 자체 확인 (src/main/windows/ipc.ts wireIpc) — 가짜 묶음(IpcScope)으로 Electron 없이 돈다
//   npm run build 뒤 node dist/tools/selftest/selftest-wire-ipc.js
// 확인: invoke 항목은 handle(denied 와 함께), send 항목은 on 으로 건다. 표의 채널을 빠짐없이 한 번씩 건다
// 빠진 채널·인자 모양은 컴파일이 잡는다(HandlersOf) — 아래 표에서 채널 하나를 지우면 빌드가 깨진다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import type { Invoke, Push, Send } from "../../shared/ipc/kinds";
import { wireIpc, type IpcScope } from "../../main/windows/ipc";

// 시험용 계약 — invoke 둘, send 하나, push 하나(push 는 메인이 보내는 쪽이라 걸지 않는다)
type TestIpc = {
  "t:ask": Invoke<"ask", [q: string], number>;
  "t:list": Invoke<"list", [], string[]>;
  "t:poke": Send<"poke", [on: boolean]>;
  "t:push": Push<"onPush", [n: number]>;
};

const on: [string, (e: never, ...args: unknown[]) => void][] = [];
const handle: [string, unknown, (e: never, ...args: unknown[]) => unknown][] = [];
const scope: IpcScope = {
  on: (channel, fn) => void on.push([channel, fn as never]),
  handle: (channel, denied, fn) => void handle.push([channel, denied, fn as never]),
  dispose: () => undefined,
};

const poked: unknown[] = [];
wireIpc<TestIpc>(scope, {
  "t:ask": { denied: -1, run: (_e, q) => (typeof q === "string" ? q.length : 0) },
  "t:list": { denied: [], run: () => ["a"] },
  "t:poke": (_e, value) => void poked.push(value),
});

assert.deepEqual(on.map(([c]) => c), ["t:poke"], "send 는 on");
assert.deepEqual(handle.map(([c]) => c).sort(), ["t:ask", "t:list"], "invoke 는 handle");
assert.deepEqual(Object.fromEntries(handle.map(([c, d]) => [c, d])), { "t:ask": -1, "t:list": [] }, "denied 를 함께 넘긴다");
const ask = handle.find(([c]) => c === "t:ask")![2];
assert.equal(ask(undefined as never, "abcd"), 4, "run 이 그대로 불린다");
on[0]![1](undefined as never, true);
assert.deepEqual(poked, [true], "send 처리기가 그대로 불린다");

process.stdout.write("selftest-wire-ipc: 통과 (invoke → handle·denied, send → on, push 는 걸지 않음)\n");
