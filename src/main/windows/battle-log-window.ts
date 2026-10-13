// 배틀 로그 창 — 배틀 창 옆에 뜨는 440×615 창. 재생 시각까지의 기술 사용·기절 줄을 보인다 (docs/specs/adventure.md "배틀 로그")
// - 판 표시 줄의 노트 단추로 연다. 열려 있으면 앞으로 가져온다
// - 배틀 창을 부모로 둔다 — 배틀 창이 닫히면 같이 닫힌다. 머리 줄(제목·✕)은 렌더러가 기기 창 틀로 그린다
// - 줄은 배틀 창(src/main/windows/battle-window.ts)이 보낸다. 이 창은 받은 줄을 그대로 그린다
import { BrowserWindow, type Rectangle } from "electron";
import type { BattleLogChannel, BattleLogIpc, BattleLogView } from "../../shared/ipc/battle";
import { workAreaAt } from "./display.js";
import { windowIcon } from "./files.js";
import { createIpcScope, wireIpc } from "./ipc.js";
import { webPreferencesOf } from "./options.js";

const CH = {
  ready: "battlelog:ready",
  show: "battlelog:show",
  close: "battlelog:close",
} satisfies Record<string, BattleLogChannel>;

// Figma 04 `Battle Log Window` 1993:572 — 배틀 창과 같은 높이
const LOG_WINDOW_SIZE = { width: 440, height: 615 } as const;
const GAP = 16; // 배틀 창과의 간격

export interface BattleLogWindow {
  open(parent: BrowserWindow, view: BattleLogView): void; // 없으면 만들고, 있으면 앞으로
  update(view: BattleLogView): void; // 떠 있을 때만 보낸다
  isOpen(): boolean;
  close(): void;
}

// 배틀 창 오른쪽 16. 오른쪽에 자리가 없으면 왼쪽, 둘 다 없으면 작업 영역 안으로 자른다
function spotBeside(owner: Rectangle): { x: number; y: number } {
  const { width, height } = LOG_WINDOW_SIZE;
  const area = workAreaAt(owner);
  const right = owner.x + owner.width + GAP;
  const left = owner.x - GAP - width;
  const x = right + width <= area.x + area.width ? right : left >= area.x ? left : area.x + area.width - width;
  const y = Math.max(area.y, Math.min(owner.y, area.y + area.height - height));
  return { x: Math.round(Math.max(area.x, x)), y: Math.round(y) };
}

export function createBattleLogWindow(files: { preload: string; html: string }): BattleLogWindow {
  let win: BrowserWindow | null = null;
  let ready = false;
  let latest: BattleLogView = { maxMs: 0, lines: [] };

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null);
  const scope = createIpcScope((sender) => !!alive() && sender === win?.webContents);

  function send(): void {
    const w = alive();
    if (!w || !ready) return;
    w.webContents.send(CH.show, latest);
    if (!w.isVisible()) w.show();
  }

  wireIpc<BattleLogIpc>(scope, {
    "battlelog:ready": () => {
      ready = true;
      send();
    },
    "battlelog:close": () => alive()?.close(),
  });

  function create(parent: BrowserWindow): BrowserWindow {
    const { width, height } = LOG_WINDOW_SIZE;
    const w = new BrowserWindow({
      ...spotBeside(parent.getBounds()),
      width,
      height,
      useContentSize: true,
      parent,
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
    });
    void w.loadFile(files.html).catch((e: unknown) => {
      console.error("배틀 로그 창 문서를 읽지 못했다", e);
      if (!w.isDestroyed()) w.destroy();
    });
    return w;
  }

  return {
    open(parent, view) {
      latest = view;
      const w = alive();
      if (w) {
        send();
        w.focus();
        return;
      }
      win = create(parent);
    },
    update(view) {
      latest = view;
      send();
    },
    isOpen: () => !!alive(),
    close() {
      alive()?.close();
    },
  };
}
