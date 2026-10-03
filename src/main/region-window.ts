// 놀이공간 영역 그리기 창 — 커서가 있는 화면을 덮고 드래그로 사각형을 그린다. 문서는 src/renderer/region.html
//
// 화면 하나만 덮는다. 여러 화면에 걸친 영역은 두지 않는다 (worklog/records/game-runtime/record.md "놀이공간·설정의 설계").
// 적용하면 화면 좌표의 사각형을, 취소하거나 창을 닫으면 null 을 돌려준다. 저장은 부른 쪽이 한다 — 여기서는 그리기만 한다
import { BrowserWindow, ipcMain, screen } from "electron";
import type { RegionChannel } from "../shared/ipc/overlays";
import type { RegionInit, RegionRect } from "../shared/model/overlays";
import { regionFits } from "../state/settings.js";
import { REGION_MIN } from "../state/rules.js";
import { windowIcon } from "./paths.js";
import { webPreferencesOf } from "./window-options.js";

const CH = {
  init: "region:init",
  done: "region:done",
} satisfies Record<string, RegionChannel>;

export interface RegionOptions {
  preload: string;
  html: string;
  current: RegionRect | null; // 지금 영역 (화면 좌표)
}

let open: Promise<RegionRect | null> | null = null;

const isRect = (v: unknown): v is RegionRect => {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n));
};

export function drawRegion(opts: RegionOptions): Promise<RegionRect | null> {
  if (open) return open; // 이미 그리는 중 — 창을 하나만 둔다
  open = new Promise<RegionRect | null>((resolve) => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
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
      webPreferences: webPreferencesOf(opts.preload),
    });
    win.setAlwaysOnTop(true, "screen-saver");

    // 지금 영역을 이 화면 안 좌표로. 다른 화면에 있으면 보이지 않는다
    const cur = opts.current;
    const local = cur ? { x: cur.x - b.x, y: cur.y - b.y, w: cur.w, h: cur.h } : null;
    const onScreen = local && local.x < b.width && local.y < b.height && local.x + local.w > 0 && local.y + local.h > 0 ? local : null;
    const init: RegionInit = { current: onScreen, min: { ...REGION_MIN } };

    let settled = false;
    const finish = (rect: RegionRect | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(CH.done, onDone);
      open = null;
      resolve(rect);
      if (!win.isDestroyed()) win.close();
    };
    const onDone = (e: Electron.IpcMainEvent, rect: unknown): void => {
      if (win.isDestroyed() || e.sender !== win.webContents) return;
      if (!isRect(rect)) return finish(null);
      // 창 안 좌표 → 화면 좌표. 화면 밖으로 나간 몫은 자른다
      const x = Math.max(0, Math.min(rect.x, b.width));
      const y = Math.max(0, Math.min(rect.y, b.height));
      const w = Math.min(rect.x + rect.w, b.width) - x;
      const h = Math.min(rect.y + rect.h, b.height) - y;
      if (!regionFits(w, h)) return finish(null);
      finish({ x: Math.round(b.x + x), y: Math.round(b.y + y), w: Math.round(w), h: Math.round(h) });
    };
    ipcMain.on(CH.done, onDone);
    win.on("closed", () => finish(null));
    win.webContents.once("did-finish-load", () => {
      if (win.isDestroyed()) return;
      win.webContents.send(CH.init, init);
      win.show();
      win.focus(); // Esc·Enter 를 받는다
    });
    void win.loadFile(opts.html).catch(() => finish(null));
  });
  return open;
}
