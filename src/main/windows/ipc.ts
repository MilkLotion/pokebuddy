// 창이 받는 IPC — 보낸 창 검사와 채널 묶음 (worklog/records/code-structure/design/10-main.md 3.2절)
//
// 모든 창이 같은 preload 를 쓴다. 그래서 처리기는 보낸 문서가 자기 창인지 먼저 본다(지금까지 창마다 따로 적던 mine).
// 묶음은 건 채널을 기억했다가 dispose 로 한 번에 거둔다 — 걸기와 거두기 목록이 어긋나지 않는다
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";

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

// 막 만든 창이 문서를 다 읽은 뒤 한 번 — 그사이 창이 부서졌으면 부르지 않는다
export function afterLoad(win: BrowserWindow, fn: () => void): void {
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) fn();
  });
}

// 이미 문서를 읽고 있는 창에 보낸다 — 읽는 중이면 다 읽은 뒤에, 아니면 바로. 창이 부서졌으면 버린다
export function sendWhenLoaded(win: BrowserWindow, channel: string, payload: unknown): void {
  if (win.isDestroyed()) return;
  if (win.webContents.isLoading()) afterLoad(win, () => win.webContents.send(channel, payload));
  else win.webContents.send(channel, payload);
}
