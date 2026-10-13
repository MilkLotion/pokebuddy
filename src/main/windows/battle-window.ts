// 배틀 창 — 판 하나를 재생하는 창. 기기 창처럼 새 창으로 뜨고 머리 줄(제목·✕)을 렌더러가 그린다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// 기기 창과 다른 점: 폭(1116)이 커서 설정창 옆에 붙이지 않는다(dockAt). 설정창 위 가운데에 띄우고, 머리 줄을 끌어 옮길 수 있다.
// 설정창을 부모로 둔다 — 설정창이 최소화되면 같이 숨고 닫히면 같이 닫힌다. 창은 하나만 둔다. 다시 열면 앞으로 오고 새 판을 보낸다
// 배틀 로그 창(battle-log-window.ts)은 이 창을 부모로 둔다. 렌더러가 알린 줄 수만큼 판의 로그 줄을 보낸다 (docs/specs/adventure.md "배틀 로그")
import { BrowserWindow, type Rectangle } from "electron";
import type { BattleScreenChannel, BattleScreenIpc } from "../../shared/ipc/battle";
import type { BattleScreenView } from "../../shared/model/battle-screen";
import { createBattleLogWindow } from "./battle-log-window.js";
import { primaryWorkArea, workAreaAt } from "./display.js";
import { windowIcon } from "./files.js";
import { createIpcScope, wireIpc } from "./ipc.js";
import { webPreferencesOf } from "./options.js";

const CH = {
  ready: "battlescreen:ready",
  show: "battlescreen:show",
  loading: "battlescreen:loading",
  close: "battlescreen:close",
  logOpen: "battlescreen:log-open",
  logAt: "battlescreen:log-at",
} satisfies Record<string, BattleScreenChannel>;

// Figma 04 `Battle Window` — 머리 줄 44 + 판 표시 줄 + 카드·전장 1116×484 (2026-10-09 전장 10×6)
// 아래에 나·상대 DPS 표를 붙여 615 (2026-10-12 사용자 "배틀에서의dps표를 화면밑에 확장하자", Figma 04 `Battle Window` 1787:9967)
const BATTLE_WINDOW_SIZE = { width: 1116, height: 615 } as const;

export interface BattleWindow {
  show(parent: BrowserWindow | null, view: BattleScreenView): void; // parent 가 없으면 주 화면 가운데
  loading(parent: BrowserWindow | null, title: string): void; // 판을 받기 전 준비 중 모습으로 띄운다 — 같은 크기라 판이 와도 창이 움직이지 않는다
  isOpen(): boolean;
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

export function createBattleWindow(files: { preload: string; html: string; logHtml: string; onClosed?: () => void }): BattleWindow {
  let win: BrowserWindow | null = null;
  let pending: BattleScreenView | null = null; // 문서가 준비되면 보낼 판 — 보낸 뒤에도 지금 판으로 남는다(로그 줄을 꺼낸다)
  let logCount = 0; // 재생 시각까지 보일 로그 줄 수 — 렌더러가 알린다. 새 판·준비 중이면 0
  const logWin = createBattleLogWindow({ preload: files.preload, html: files.logHtml });
  const logView = () => ({ maxMs: pending?.maxMs ?? 0, lines: pending?.log.slice(0, logCount) ?? [] });
  let pendingLoading: string | null = null; // 문서가 준비되면 보낼 준비 중 제목 — 판이 오면 지운다
  let ready = false;

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null);
  // 채널은 한 번만 건다. 창이 다시 만들어져도 처리기는 하나다
  const scope = createIpcScope((sender) => !!alive() && sender === win?.webContents);

  function send(): void {
    const w = alive();
    if (!w || !ready || (!pending && pendingLoading == null)) return;
    if (pending) w.webContents.send(CH.show, pending);
    else w.webContents.send(CH.loading, pendingLoading);
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
    "battlescreen:log-open": () => {
      const w = alive();
      if (w) logWin.open(w, logView());
    },
    "battlescreen:log-at": (_e, count) => {
      // 렌더러가 보낸 값 — 0 이상 정수만 받는다
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count === logCount) return;
      logCount = Math.min(count, pending?.log.length ?? 0);
      logWin.update(logView());
    },
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
      pendingLoading = null;
      logCount = 0;
      logWin.close(); // 자식 창이라 같이 닫히지만, 닫힘을 기다리지 않고 바로 거둔다
      files.onClosed?.(); // 배틀 동안 숨긴 무대를 되돌린다 (src/main/manage/battle-screen.ts)
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
      pendingLoading = null;
      logCount = 0;
      logWin.update(logView());
      if (!alive()) win = create(parent);
      send();
    },
    loading(parent, title) {
      pending = null;
      pendingLoading = title;
      logCount = 0;
      logWin.update(logView());
      if (!alive()) win = create(parent);
      send();
    },
    isOpen: () => !!alive(),
    close() {
      alive()?.close();
    },
  };
}
