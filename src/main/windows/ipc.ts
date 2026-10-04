// 창이 받는 IPC — 보낸 창 검사와 채널 묶음 (worklog/records/code-structure/design/10-main.md 3.2절)
//
// 모든 창이 같은 preload 를 쓴다. 그래서 처리기는 보낸 문서가 자기 창인지 먼저 본다(지금까지 창마다 따로 적던 mine).
// 묶음은 건 채널을 기억했다가 dispose 로 한 번에 거둔다 — 걸기와 거두기 목록이 어긋나지 않는다
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { Contract, HandlersOf } from "../../shared/ipc/kinds";

// 창이 살아 있고 그 창의 문서가 보낸 것인가
export function isFromWindow(win: BrowserWindow | null | undefined, e: { sender: unknown }): boolean {
  return !!win && !win.isDestroyed() && e.sender === win.webContents;
}

export interface IpcScope {
  // 내 창이 보낸 것만 fn 에 넘긴다. 아니면 버린다
  on(channel: string, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void;
  // 내 창이 보낸 것이 아니면 denied 를 답한다
  handle<R>(channel: string, denied: R, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => R | Promise<R>): void;
  dispose(): void; // 이 묶음이 건 것을 모두 거둔다
}

// owns — 보낸 문서가 이 묶음의 창인가. 창이 여러 개면(화면 덮개) 그 가운데 하나인가
export function createIpcScope(owns: (sender: WebContents) => boolean): IpcScope {
  const listeners: [string, (e: IpcMainEvent, ...args: unknown[]) => void][] = [];
  const handlers: string[] = [];
  return {
    on(channel, fn) {
      const listener = (e: IpcMainEvent, ...args: unknown[]): void => {
        if (owns(e.sender)) fn(e, ...args);
      };
      ipcMain.on(channel, listener);
      listeners.push([channel, listener]);
    },
    handle(channel, denied, fn) {
      ipcMain.handle(channel, (e, ...args: unknown[]) => (owns(e.sender) ? fn(e, ...args) : denied));
      handlers.push(channel);
    },
    dispose() {
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
      for (const channel of handlers) ipcMain.removeHandler(channel);
      listeners.length = 0;
      handlers.length = 0;
    },
  };
}

// 처리기가 받는 IPC 사건 — invoke(handle)와 send(on) 둘 다. 처리기는 보낸 창 검사를 묶음(scope)에 맡기므로 대개 이 값을 보지 않는다
export type IpcEvent = IpcMainInvokeEvent | IpcMainEvent;

// 계약 한 장의 처리기 표를 묶음에 건다 — invoke 항목({ denied, run })은 handle, send 항목(함수)은 on.
// 빠진 채널과 인자 모양은 HandlersOf<C> 가 컴파일에서 잡는다. 인자는 렌더러가 보낸 값이라 unknown 이다(Untrusted)
// 묶음의 on·handle 은 채널을 글자로 받는다 — 기본 계약(Contract)에서 채널 키를 좁히면 never 가 되어 지금 다섯 창이 깨진다(계약 레인 검토, D16 ⑦)
export function wireIpc<C extends Contract>(scope: IpcScope, table: HandlersOf<C, IpcEvent>): void {
  for (const [channel, entry] of Object.entries(table) as [string, unknown][]) {
    if (typeof entry === "function") {
      scope.on(channel, entry as (e: IpcMainEvent, ...args: unknown[]) => void);
    } else {
      const { denied, run } = entry as { denied: unknown; run: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown };
      scope.handle(channel, denied, run);
    }
  }
}

// 막 만든 창이 문서를 다 읽은 뒤 한 번 — 그사이 창이 부서졌으면 부르지 않는다
export function afterLoad(win: BrowserWindow, fn: () => void): void {
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) fn();
  });
}
