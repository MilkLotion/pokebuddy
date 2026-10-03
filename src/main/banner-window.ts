// 알림 배너 창 — 주 화면 작업 영역 오른쪽 아래에 배너 하나를 띄운다. 문서는 src/renderer/banner.html
//
// 테두리 없음 · 배경 투명 · 항상 위 · 포커스를 뺏지 않음 · 작업 표시줄에 없음. 배너가 없을 때는 숨긴다.
// 배너는 뜬 뒤 BANNER_RULES.showMs 가 지나면 사라진다. 커서 위치와 무관하다.
// 제목 줄 오른쪽 `✕` 로 바로 닫는다. 누르지 않아도 시간이 지나면 사라진다 (docs/specs/ui-components.md C-19)
import { BrowserWindow, ipcMain, screen } from "electron";
import type { BannerChannel } from "../shared/ipc/overlays";
import type { BannerView } from "../shared/model/overlays";
import type { ManageRoute } from "../shared/model/route";
import { windowIcon } from "./paths.js";
import { webPreferencesOf } from "./windows/options.js";

const CH = {
  show: "banner:show",
  go: "banner:go",
  close: "banner:close",
} satisfies Record<string, BannerChannel>;

// 표시 시간 3초 — 2026-09-30 사용자 결정 "시간은 3초로 늘리고, 모든 알림은 생성되고 3초뒤에 사라지게 해" (worklog/records/features-0930/record.md)
// 옛 2초·커서 멈춤은 뺐다 — 멈춤 신호가 풀리지 않아 배너가 남던 문제
// 창 크기는 배너 280 × 82 에 그림자 자리 8 을 둘렀다. margin 은 작업 영역 가장자리와의 거리다
export const BANNER_RULES = { showMs: 3000, width: 296, height: 98, margin: 8 } as const;

export interface BannerWindowOptions {
  preload: string;
  html: string;
  chime: () => number; // 알림음 음량 0~1 — 설정의 소리·소리 크기 (src/state/settings.ts gainOf)
  onGo: (route: ManageRoute) => void; // `바로가기` — 관리 창을 열고 옮긴다
  onDone: () => void; // 배너가 사라졌다. 다음 배너를 내보낼 차례다
}

export interface BannerWindow {
  show(banner: BannerView): void;
  close(): void;
}

export function createBannerWindow(opts: BannerWindowOptions): BannerWindow {
  let win: BrowserWindow | null = null;
  let loaded: Promise<void> | null = null;
  let current: BannerView | null = null;
  let timer: NodeJS.Timeout | null = null;

  const mine = (sender: unknown): boolean => !!win && !win.isDestroyed() && sender === win.webContents;

  const stopTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const startTimer = (ms: number): void => {
    stopTimer();
    timer = setTimeout(finish, ms);
  };

  // 배너를 내린다. 다음 배너는 부른 쪽이 onDone 에서 내보낸다
  function finish(): void {
    stopTimer();
    if (!current) return;
    current = null;
    if (win && !win.isDestroyed()) win.hide();
    opts.onDone();
  }

  const onGo = (e: Electron.IpcMainEvent, key: unknown): void => {
    if (!mine(e.sender) || !current || key !== current.key) return;
    const route = current.route;
    finish();
    opts.onGo(route);
  };
  // `✕` — 그 배너만 닫는다. 다음 배너는 onDone 에서 나온다
  const onClose = (e: Electron.IpcMainEvent, key: unknown): void => {
    if (!mine(e.sender) || !current || key !== current.key) return;
    finish();
  };
  ipcMain.on(CH.go, onGo);
  ipcMain.on(CH.close, onClose);

  function ensure(): Promise<void> {
    if (win && !win.isDestroyed() && loaded) return loaded;
    win = new BrowserWindow({
      width: BANNER_RULES.width,
      height: BANNER_RULES.height,
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
      focusable: false, // 누르기는 받지만 쓰던 창의 포커스는 뺏지 않는다
      acceptFirstMouse: true, // mac 에서 첫 클릭을 삼키지 않는다
      icon: windowIcon(),
      webPreferences: webPreferencesOf(opts.preload),
    });
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.on("closed", () => {
      win = null;
      loaded = null;
      stopTimer();
      current = null;
    });
    loaded = win.loadFile(opts.html).catch(() => undefined);
    return loaded;
  }

  // 주 화면 작업 영역 오른쪽 아래. 작업 표시줄을 피한다
  const place = (w: BrowserWindow): void => {
    const area = screen.getPrimaryDisplay().workArea;
    const x = area.x + area.width - BANNER_RULES.width - BANNER_RULES.margin;
    const y = area.y + area.height - BANNER_RULES.height - BANNER_RULES.margin;
    w.setBounds({ x, y, width: BANNER_RULES.width, height: BANNER_RULES.height });
  };

  return {
    show(banner) {
      current = banner;
      void ensure().then(() => {
        if (!win || win.isDestroyed() || current !== banner) return;
        place(win);
        // 알림음은 배너 창이 낸다 — OS 기본음(shell.beep)은 크기를 바꿀 수 없어 너무 컸다 (2026-09-27 사용자 요청)
        win.webContents.send(CH.show, { ...banner, chime: opts.chime() });
        win.showInactive();
        startTimer(BANNER_RULES.showMs);
      });
    },
    close() {
      stopTimer();
      current = null;
      ipcMain.removeListener(CH.go, onGo);
      ipcMain.removeListener(CH.close, onClose);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
