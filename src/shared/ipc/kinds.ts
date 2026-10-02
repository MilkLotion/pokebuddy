// IPC 계약의 틀 — 채널 하나의 방향, 다리 함수 이름, 인자, 반환을 한 줄에 적는다. 타입만 둔다 (런타임 값 없음)
// 계약은 창마다 한 벌이다(./stage.ts · ./manage.ts · ./devices.ts · ./overlays.ts). 열쇠가 채널 글자다.
// preload 의 표(WireOf)와 렌더러가 보는 다리(BridgeOf), 메인의 처리기 표(HandlersOf)와 보내기(PushOf)가 같은 계약에서 나온다

// 렌더러 → 메인, 답을 기다린다 (ipcRenderer.invoke · ipcMain.handle)
export interface Invoke<M extends string, A extends unknown[], R> {
  kind: "invoke";
  method: M;
  args: A;
  ret: R;
}
// 렌더러 → 메인 (ipcRenderer.send · ipcMain.on)
export interface Send<M extends string, A extends unknown[]> {
  kind: "send";
  method: M;
  args: A;
}
// 메인 → 렌더러 (webContents.send · ipcRenderer.on). 다리는 콜백을 받는 on… 함수다
export interface Push<M extends string, A extends unknown[]> {
  kind: "push";
  method: M;
  args: A;
}

// any 는 이 제약에서만 쓴다 — 채널마다 인자가 달라 unknown[] 로는 묶이지 않는다
type Entry = Invoke<string, any[], any> | Send<string, any[]> | Push<string, any[]>;
// 계약은 type 별칭으로 적는다 — interface 는 이 제약(색인 시그니처)에 맞지 않는다
export type Contract = Record<string, Entry>;

// 렌더러가 보는 다리 — window.pokebuddy* 의 타입
export type BridgeOf<C extends Contract> = {
  [K in keyof C as C[K]["method"]]: C[K] extends Invoke<string, infer A, infer R>
    ? (...args: A) => Promise<R>
    : C[K] extends Send<string, infer A>
      ? (...args: A) => void
      : C[K] extends Push<string, infer A>
        ? (cb: (...args: A) => void) => void
        : never;
};

// preload 가 갖는 런타임 표의 타입 — 다리 함수 이름 → [방향, 채널 글자]
export type WireOf<C extends Contract> = { [K in keyof C as C[K]["method"]]: readonly [C[K]["kind"], K] };

// 메인은 렌더러가 보낸 인자를 믿지 않는다 — 처리기가 검사한다
export type Untrusted<A extends unknown[]> = { [I in keyof A]: unknown };

// 메인이 거는 처리기 표의 타입 — push 를 뺀 채널 전부.
// invoke 항목은 { denied, run } 이다. 내 창이 보낸 것이 아니면 denied 를 답한다. send 항목은 함수다
export type HandlersOf<C extends Contract, E> = {
  [K in keyof C as C[K] extends Push<string, any[]> ? never : K]: C[K] extends Invoke<string, infer A, infer R>
    ? { denied: R; run: (e: E, ...args: Untrusted<A>) => R | Promise<R> }
    : C[K] extends Send<string, infer A>
      ? (e: E, ...args: Untrusted<A>) => void
      : never;
};

// 메인이 보내는 쪽 — push 채널과 그 인자
export type PushOf<C extends Contract> = { [K in keyof C as C[K] extends Push<string, any[]> ? K : never]: C[K]["args"] };

export type InvokeChannel<C extends Contract> = { [K in keyof C]: C[K] extends Invoke<string, any[], any> ? K : never }[keyof C];
export type SendChannel<C extends Contract> = { [K in keyof C]: C[K] extends Send<string, any[]> ? K : never }[keyof C];
export type PushChannel<C extends Contract> = keyof PushOf<C>;
export type ArgsOf<C extends Contract, K extends keyof C> = C[K]["args"];
export type RetOf<C extends Contract, K extends InvokeChannel<C>> = C[K] extends Invoke<string, any[], infer R> ? R : never;
