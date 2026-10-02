// 놀이공간 화면 번호 덮개 — 화면마다 창 하나로 번호를 크게 보인다. 문서는 src/renderer/screens.html (2026-09-28 여러 화면)
//
//   보기(identify)  설정의 한 화면 목록이 열린 동안. 클릭을 통과시키고 포커스를 받지 않는다 — 목록을 계속 쓸 수 있다
//   고르기(pick)    `화면에서 고르기`. 누른 화면을 돌려주고 Esc·창 닫기는 null. 영역 그리기 창(region-window.ts)과 같은 규칙이다
//
// 번호는 설정 목록과 같다 — 주 화면이 1 (layout.ts screenOrder). 저장은 부른 쪽이 한다
import { BrowserWindow, ipcMain, screen } from "electron";
import type { ScreenOverlayInit, ScreensChannel, ScreenView } from "../shared/manage";
import { resolveScreen, screenOrder, screenRefOfInfo, type ScreenInfo, type ScreenRef } from "./layout";
import { windowIcon } from "./paths.js";
import { webPreferencesOf } from "./window-options.js";

const CH = {
  init: "screens:init",
  pick: "screens:pick",
  cancel: "screens:cancel",
} satisfies Record<string, ScreensChannel>;

// 지금 화면들 — 번호 순 (주 화면이 1). 좌표는 DIP
export function currentScreens(): ScreenInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  const rect = (r: Electron.Rectangle) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  return screenOrder(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: rect(d.bounds), work: rect(d.workArea), primary: d.id === primary })));
}

// 설정의 한 화면 목록 — chosen 은 저장된 고른 화면(없으면 주 화면)
export function screenViews(screens: readonly ScreenInfo[], chosen: ScreenRef | null): ScreenView[] {
  const now = resolveScreen(chosen, screens);
  return screens.map((s, i) => ({ number: i + 1, primary: s.primary, w: s.bounds.w, h: s.bounds.h, current: s.id === now?.id, ref: screenRefOfInfo(s) }));
}

export interface ScreenPickerOptions {
  preload: string;
  html: string;
  screens: () => ScreenInfo[]; // 번호 순
}

// 화면 하나를 덮는 창 — 보기면 클릭 통과·포커스 없음, 고르기면 누를 수 있다
function overlay(opts: ScreenPickerOptions, s: ScreenInfo, number: number, pick: boolean): BrowserWindow {
  const b = s.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.w,
    height: b.h,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: pick,
    icon: windowIcon(),
    webPreferences: webPreferencesOf(opts.preload),
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (!pick) win.setIgnoreMouseEvents(true);
  const init: ScreenOverlayInit = { number, primary: s.primary, w: b.w, h: b.h, pick };
  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send(CH.init, init);
    if (pick) {
      win.show();
      win.focus(); // Esc 를 받는다 — 영역 그리기 창과 같다
    } else win.showInactive(); // 설정 창의 포커스를 빼앗지 않는다
  });
  void win.loadFile(opts.html).catch(() => {
    if (!win.isDestroyed()) win.close();
  });
  return win;
}

const closeAll = (wins: BrowserWindow[]): void => {
  for (const w of wins) if (!w.isDestroyed()) w.close();
};

export interface ScreenPicker {
  identify(on: boolean): void;
  pick(): Promise<ScreenRef | null>;
  close(): void;
}

export function createScreenPicker(opts: ScreenPickerOptions): ScreenPicker {
  let shown: BrowserWindow[] = []; // 보기 덮개
  let picking: Promise<ScreenRef | null> | null = null;

  return {
    identify(on) {
      closeAll(shown);
      shown = [];
      if (!on || picking) return;
      shown = opts.screens().map((s, i) => overlay(opts, s, i + 1, false));
    },

    pick() {
      if (picking) return picking; // 이미 고르는 중 — 덮개를 한 벌만 둔다
      closeAll(shown);
      shown = [];
      picking = new Promise<ScreenRef | null>((resolve) => {
        const screens = opts.screens();
        const wins = screens.map((s, i) => overlay(opts, s, i + 1, true));
        let settled = false;
        const finish = (ref: ScreenRef | null): void => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener(CH.pick, onPick);
          ipcMain.removeListener(CH.cancel, onCancel);
          picking = null;
          resolve(ref);
          closeAll(wins);
        };
        const indexOf = (sender: Electron.WebContents): number => wins.findIndex((w) => !w.isDestroyed() && w.webContents === sender);
        const onPick = (e: Electron.IpcMainEvent): void => {
          const i = indexOf(e.sender);
          const s = i >= 0 ? screens[i] : undefined;
          if (s) finish(screenRefOfInfo(s));
        };
        const onCancel = (e: Electron.IpcMainEvent): void => {
          if (indexOf(e.sender) >= 0) finish(null);
        };
        ipcMain.on(CH.pick, onPick);
        ipcMain.on(CH.cancel, onCancel);
        // 한 화면이라도 닫히면(시스템이 닫음 등) 취소로 친다 — 남은 덮개가 화면을 막지 않게
        for (const w of wins) w.on("closed", () => finish(null));
      });
      return picking;
    },

    close() {
      closeAll(shown);
      shown = [];
    },
  };
}
