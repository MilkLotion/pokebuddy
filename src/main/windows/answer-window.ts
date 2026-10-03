// 한 번 답하는 창 틀 — 창을 띄워 답 하나를 받고 닫는다 (worklog/records/code-structure/design/10-main.md 3.6절)
//
// 알림·첫 포켓몬 선택·영역 그리기·화면 고르기가 쓴다. 틀이 하는 일은 다섯이다:
//   두 번째 답 버리기 · 처리기 거두기 · 끝날 때 거둘 것 거두기 · 답 돌려주기 · 창 닫기
// 창마다 다른 것(만들기·채널·문서를 읽은 뒤·닫혔을 때의 답)은 명세가 준다
import type { BrowserWindow, WebContents } from "electron";
import { afterLoad, createIpcScope, type IpcScope } from "./ipc";

export interface AnswerContext<T> {
  scope: IpcScope; // 이 창들이 보낸 것만 받는다
  wins: readonly BrowserWindow[];
  indexOf(sender: WebContents): number; // 보낸 창의 번호. 이 창들이 아니면 -1
  finish(answer: T): void; // 처음 한 번만 듣는다
  onCleanup(fn: () => void): void; // 끝날 때 거둘 것(타이머·밖의 듣기)
}

export interface AnswerSpec<T> {
  create(): BrowserWindow[]; // 창을 만든다(하나, 또는 화면마다 하나). 던지면 약속이 거절된다
  html: string;
  wire(ctx: AnswerContext<T>): void; // 채널을 건다
  loaded?(win: BrowserWindow, index: number, ctx: AnswerContext<T>): void; // 문서를 읽은 뒤 — 값 보내기, 보이기
  closed(ctx: AnswerContext<T>): T; // 창 하나라도 닫혔을 때의 답
  loadFailed?(error: unknown, ctx: AnswerContext<T>): void; // 문서를 못 읽었다 — 없으면 거절을 다루지 않는다
  end?: "close" | "destroy"; // 끝난 뒤 창을 어떻게 없앨지. 기본 close
}

// finish 순서: 끝남 표시 → 처리기 거두기 → onCleanup → 답 → 창 닫기
export function askWindow<T>(spec: AnswerSpec<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const wins = spec.create();
    const indexOf = (sender: WebContents): number => wins.findIndex((w) => !w.isDestroyed() && w.webContents === sender);
    const scope = createIpcScope((sender) => indexOf(sender) >= 0);
    const cleanups: (() => void)[] = [];
    let done = false;
    const ctx: AnswerContext<T> = {
      scope,
      wins,
      indexOf,
      finish(answer) {
        if (done) return;
        done = true;
        scope.dispose();
        for (const fn of cleanups) fn();
        resolve(answer);
        for (const w of wins) {
          if (w.isDestroyed()) continue;
          if (spec.end === "destroy") w.destroy();
          else w.close();
        }
      },
      onCleanup: (fn) => cleanups.push(fn),
    };
    for (const w of wins) w.on("closed", () => ctx.finish(spec.closed(ctx)));
    spec.wire(ctx);
    wins.forEach((w, i) => {
      const loaded = spec.loaded;
      if (loaded) afterLoad(w, () => loaded(w, i, ctx));
      const loading = w.loadFile(spec.html);
      const failed = spec.loadFailed;
      if (failed) loading.catch((e: unknown) => failed(e, ctx));
      else void loading;
    });
  });
}

export type SingleFlight<A extends unknown[], T> = ((...args: A) => Promise<T>) & { inFlight(): boolean };

// 답이 올 때까지 같은 약속을 돌려준다 — 창을 한 벌만 둔다(영역 그리기, 화면 고르기). 두 번째 부름의 인자는 버린다
export function singleFlight<A extends unknown[], T>(run: (...args: A) => Promise<T>): SingleFlight<A, T> {
  let open: Promise<T> | null = null;
  const clear = (): void => {
    open = null;
  };
  const ask = (...args: A): Promise<T> => {
    if (open) return open;
    const p = run(...args);
    open = p;
    // 부른 쪽의 then 보다 먼저 걸어 두어, 답을 받은 쪽이 바로 다시 불러도 새 창이 뜬다
    p.then(clear, clear);
    return p;
  };
  return Object.assign(ask, { inFlight: () => open !== null });
}
