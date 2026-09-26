// 도감 기기 창 — 관리 창 옆에 붙어 한 종의 도감 항목을 보이는 창. 문서는 src/renderer/dex.html
//
// 관리 창의 도감 칸을 누르면 뜬다. 관리 창 격자 아래에 상세를 끼우던 방식은 격자를 다시 그려 스크롤이 튀었다 (docs/work/play-bugs/record.md).
// 폭은 고정, 높이는 렌더러가 그린 높이다. 관리 창 내용 영역의 오른쪽 위에 붙인다. 오른쪽에 자리가 없으면 왼쪽에 붙인다.
// 관리 창을 옮기면 따라간다. 관리 창이 닫히면 같이 닫힌다(parent). 창은 하나만 둔다
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { DexDetail, DexDeviceChannel, DexDeviceView } from "../shared/manage";
import { windowIcon } from "./paths.js";

const CH = {
  show: "dexdev:show",
  size: "dexdev:size",
  step: "dexdev:step",
  cry: "dexdev:cry",
  close: "dexdev:close",
} satisfies Record<string, DexDeviceChannel>;

// Figma `Dex Device` 폭. 높이는 첫 그림 전 어림값이다
export const DEX_WINDOW = { width: 380, height: 508 };

export interface DexWindowOptions {
  preload: string;
  html: string;
  detail: (slug: string) => DexDetail | null;
  portrait: (slug: string) => Promise<string | null>;
  cry: (slug: string) => Promise<string | null>;
  volume: () => number; // 울음소리 음량 0~1
  onStep: (delta: -1 | 1) => void; // 이전·다음 — 순서는 관리 창 목록이 정한다
  onClosed: () => void;
}

export interface DexWindow {
  show: (parent: BrowserWindow, slug: string) => Promise<void>;
  close: () => void;
}

// 붙일 자리 — 관리 창 내용 영역 옆. 화면 오른쪽 끝을 넘으면 왼쪽에 붙인다
export function dockAt(parent: { x: number; y: number; width: number; height: number }, area: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): { x: number; y: number; side: "right" | "left" } {
  const right = parent.x + parent.width;
  const side = right + size.width <= area.x + area.width || parent.x - size.width < area.x ? "right" : "left";
  const x = side === "right" ? right : parent.x - size.width;
  const y = Math.max(area.y, Math.min(parent.y, area.y + area.height - size.height));
  return { x, y, side };
}

export function createDexWindow(opts: DexWindowOptions): DexWindow {
  let win: BrowserWindow | null = null;
  let owner: BrowserWindow | null = null;
  let slug: string | null = null;
  let height = DEX_WINDOW.height;
  let side: "right" | "left" = "right";

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null);
  const mine = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!alive() && e.sender === win?.webContents;

  function place(): void {
    const w = alive();
    if (!w || !owner || owner.isDestroyed()) return;
    const b = owner.getContentBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const at = dockAt(b, area, { width: DEX_WINDOW.width, height });
    side = at.side;
    w.setBounds({ x: at.x, y: at.y, width: DEX_WINDOW.width, height });
  }

  // 붙은 쪽이 바뀌면 경첩 면을 다시 그리도록 다시 보낸다
  const follow = (): void => {
    const was = side;
    place();
    if (side !== was) void send();
  };
  const hideWithOwner = (): void => alive()?.hide();
  const showWithOwner = (): void => {
    if (slug) alive()?.showInactive();
  };

  function detach(): void {
    if (!owner || owner.isDestroyed()) return; // 닫힌 창은 듣는 것도 함께 사라진다
    owner.removeListener("move", follow);
    owner.removeListener("resize", follow);
    owner.removeListener("minimize", hideWithOwner);
    owner.removeListener("restore", showWithOwner);
  }

  function attach(parent: BrowserWindow): void {
    if (owner === parent) return;
    detach();
    owner = parent;
    parent.on("move", follow);
    parent.on("resize", follow);
    parent.on("minimize", hideWithOwner);
    parent.on("restore", showWithOwner);
  }

  function create(parent: BrowserWindow): BrowserWindow {
    const w = new BrowserWindow({
      width: DEX_WINDOW.width,
      height,
      show: false,
      parent,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: "pokebuddy",
      icon: windowIcon(),
      webPreferences: { preload: opts.preload },
    });
    w.removeMenu();
    w.on("closed", () => {
      win = null;
      slug = null;
      detach();
      owner = null;
      opts.onClosed();
    });
    void w.loadFile(opts.html);
    return w;
  }

  async function send(): Promise<void> {
    const w = alive();
    if (!w || !slug) return;
    const detail = opts.detail(slug);
    if (!detail) return;
    const view: DexDeviceView = { detail, portrait: await opts.portrait(slug), side, volume: opts.volume() };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => alive()?.webContents.send(CH.show, view));
    else w.webContents.send(CH.show, view);
  }

  // 채널은 한 번만 건다. 창이 다시 만들어져도 처리기는 하나다
  ipcMain.on(CH.size, (e, h: unknown) => {
    if (!mine(e) || typeof h !== "number" || !Number.isFinite(h)) return;
    height = Math.max(200, Math.min(1200, Math.ceil(h)));
    place();
    if (!alive()?.isVisible()) alive()?.showInactive();
  });
  ipcMain.on(CH.step, (e, delta: unknown) => {
    if (mine(e) && (delta === 1 || delta === -1)) opts.onStep(delta);
  });
  ipcMain.handle(CH.cry, async (e) => (mine(e) && slug && opts.volume() > 0 ? opts.cry(slug) : null));
  ipcMain.on(CH.close, (e) => {
    if (mine(e)) alive()?.close();
  });

  return {
    async show(parent, next) {
      slug = next;
      attach(parent);
      if (!alive()) win = create(parent);
      place();
      await send();
    },
    close() {
      alive()?.close();
    },
  };
}
