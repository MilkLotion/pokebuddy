// 앱이 그리는 메뉴 창 — Figma `Context Menu` `338:738`. 문서는 src/renderer/menu.html
//
// OS 기본 메뉴는 Windows 에서 체크 표시 자리로 왼쪽을 크게 비운다. 그래서 메뉴를 직접 그린다 (docs/specs/ui-components.md C-21).
// 메뉴 모델은 Electron 메뉴와 같은 모양(MenuItemConstructorOptions)을 받는다 — src/main/menus.ts 가 그대로 쓸 수 있다.
// 커서 자리에 띄우고 화면 끝에서는 방향을 뒤집는다. 항목을 고르거나 Esc 를 누르거나 포커스를 잃으면(바깥 클릭) 닫는다.
// 메뉴는 한 번에 하나다. 새로 띄우면 앞의 메뉴를 닫는다
import { BrowserWindow, ipcMain, screen, type MenuItemConstructorOptions } from "electron";
import type { MenuChannel } from "../shared/manage";
import { menuView } from "./menus.js";
import { windowIcon } from "./paths.js";

const CH = {
  show: "menu:show",
  size: "menu:size",
  pick: "menu:pick",
} satisfies Record<string, MenuChannel>;

// 그림자 자리 — menu.html 의 body 여백과 같다
const SHADOW = 8;

export interface MenuWindowOptions {
  preload: string;
  html: string;
  onPlaced?: (rect: { x: number; y: number; w: number; h: number }) => void; // 메뉴를 띄운 자리(화면 좌표, 그림자 제외)
  onClosed?: () => void;
}

let current: BrowserWindow | null = null;

export function popupMenu(opts: MenuWindowOptions, template: MenuItemConstructorOptions[], on: string): void {
  if (current && !current.isDestroyed()) current.close();
  const at = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(at).workArea;
  const win = new BrowserWindow({
    x: at.x,
    y: at.y,
    width: 216,
    height: 100,
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
    icon: windowIcon(),
    webPreferences: { preload: opts.preload },
  });
  win.setAlwaysOnTop(true, "pop-up-menu");
  current = win;

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    ipcMain.removeListener(CH.size, onSize);
    ipcMain.removeListener(CH.pick, onPick);
    if (current === win) current = null;
    if (!win.isDestroyed()) win.close();
    opts.onClosed?.();
  };
  const mine = (e: Electron.IpcMainEvent): boolean => !win.isDestroyed() && e.sender === win.webContents;

  // 그린 크기를 받으면 자리를 정한다 — 오른쪽·아래가 모자라면 커서의 왼쪽·위로 뒤집는다
  const onSize = (e: Electron.IpcMainEvent, w: unknown, h: unknown): void => {
    if (!mine(e) || typeof w !== "number" || typeof h !== "number") return;
    const width = Math.ceil(w) + SHADOW * 2;
    const height = Math.ceil(h) + SHADOW * 2;
    let x = at.x - SHADOW;
    let y = at.y - SHADOW;
    if (x + width > area.x + area.width) x = at.x - width + SHADOW;
    if (y + height > area.y + area.height) y = at.y - height + SHADOW;
    x = Math.max(area.x, x);
    y = Math.max(area.y, y);
    win.setBounds({ x, y, width, height });
    opts.onPlaced?.({ x: x + SHADOW, y: y + SHADOW, w: width - SHADOW * 2, h: height - SHADOW * 2 });
    win.show();
    win.focus(); // 방향키·Enter·Esc 를 받고, 바깥을 누르면 blur 로 닫는다
  };
  const onPick = (e: Electron.IpcMainEvent, id: unknown): void => {
    if (!mine(e)) return;
    close();
    const item = typeof id === "number" ? template[id] : undefined;
    if (item?.click && item.enabled !== false) (item.click as () => void)();
  };
  ipcMain.on(CH.size, onSize);
  ipcMain.on(CH.pick, onPick);
  win.on("blur", close);
  win.on("closed", close);
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) win.webContents.send(CH.show, menuView(template, on));
  });
  void win.loadFile(opts.html).catch(close);
}
