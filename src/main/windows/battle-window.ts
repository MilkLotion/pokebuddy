// 배틀 창 — 판 하나를 재생하는 창. 기기 창처럼 새 창으로 뜨고 머리 줄(제목·✕)을 렌더러가 그린다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// 기기 창과 다른 점: 폭(1004)이 커서 설정창 옆에 붙이지 않는다(dockAt). 설정창 위 가운데에 띄우고, 머리 줄을 끌어 옮길 수 있다.
// 설정창을 부모로 둔다 — 설정창이 최소화되면 같이 숨고 닫히면 같이 닫힌다. 창은 하나만 둔다. 다시 열면 앞으로 오고 새 판을 보낸다
import { BrowserWindow, type Rectangle } from "electron";
import type { BattleScreenChannel, BattleScreenIpc } from "../../shared/ipc/battle";
import type { BattleScreenView } from "../../shared/model/battle-screen";
import { primaryWorkArea, workAreaAt } from "./display.js";
import { windowIcon } from "./files.js";
import { createIpcScope, wireIpc } from "./ipc.js";
import { webPreferencesOf } from "./options.js";

const CH = {
  ready: "battlescreen:ready",
  show: "battlescreen:show",
  close: "battlescreen:close",
} satisfies Record<string, BattleScreenChannel>;

// Figma 04 `Battle Window` — 머리 줄 44 + 판 표시 줄 + 카드·전장 (99 `Draft / Battle Window · 머리 줄` 1004×428)
const BATTLE_WINDOW_SIZE = { width: 1004, height: 428 } as const;

export interface BattleWindow {
  show(parent: BrowserWindow | null, view: BattleScreenView): void; // parent 가 없으면 주 화면 가운데
  close(): void;
}

// 부모 창 위 가운데 — 작업 영역 안으로 자른다
function spotOver(owner: Rectangle | null): { x: number; y: number } {
  const { width, height } = BATTLE_WINDOW_SIZE;
  const area = owner ? workAreaAt(owner) : primaryWorkArea();
  const cx = owner ? owner.x + owner.width / 2 : area.x + area.width / 2;
  const cy = owner ? owner.y + owner.height / 2 : area.y + area.height / 2;
  const x = Math.round(Math.max(area.x, Math.min(cx - width / 2, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(cy - height / 2, area.y + area.height - height)));
  return { x, y };
}

export function createBattleWindow(files: { preload: string; html: string }): BattleWindow {
  let win: BrowserWindow | null = null;
  let pending: BattleScreenView | null = null; // 문서가 준비되면 보낼 판
  let ready = false;

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null);
  // 채널은 한 번만 건다. 창이 다시 만들어져도 처리기는 하나다
  const scope = createIpcScope((sender) => !!alive() && sender === win?.webContents);

  function send(): void {
    const w = alive();
    if (!w || !ready || !pending) return;
    w.webContents.send(CH.show, pending);
    if (!w.isVisible()) w.show();
    w.focus();
    w.webContents.focus();
  }

  wireIpc<BattleScreenIpc>(scope, {
    "battlescreen:ready": () => {
      ready = true;
      send();
    },
    "battlescreen:close": () => alive()?.close(),
  });

  function create(parent: BrowserWindow | null): BrowserWindow {
    const { width, height } = BATTLE_WINDOW_SIZE;
    const at = spotOver(parent && !parent.isDestroyed() ? parent.getBounds() : null);
    const w = new BrowserWindow({
      ...at,
      width,
      height,
      useContentSize: true,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: "#f1f2ee", // tokens.css --canvas
      title: "pokebuddy",
      icon: windowIcon(),
      webPreferences: webPreferencesOf(files.preload),
    });
    w.removeMenu();
    w.on("closed", () => {
      if (win !== w) return;
      win = null;
      ready = false;
      pending = null;
    });
    void w.loadFile(files.html).catch((e: unknown) => {
      console.error("배틀 창 문서를 읽지 못했다", e);
      if (!w.isDestroyed()) w.destroy();
    });
    return w;
  }

  return {
    show(parent, view) {
      pending = view;
      if (!alive()) win = create(parent);
      send();
    },
    close() {
      alive()?.close();
    },
  };
}
