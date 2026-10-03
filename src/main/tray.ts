// 트레이 — 동반자만. 늘 떠 있는 펫이라 끝낼 길이 트레이·우클릭뿐이다 (전역 단축키는 잡지 않는다)
import { Tray, nativeImage, type NativeImage } from "electron";

export interface TrayOptions {
  icon: string | null; // 공식 앱 로고 PNG 경로
  tooltip: string;
  // 앱이 그리는 메뉴를 띄운다 (src/main/menus/menu-window.ts). OS 기본 메뉴는 쓰지 않는다 — Windows 기본 메뉴는 왼쪽을 크게 비운다
  popup: () => void;
  open?: () => void; // 아이콘 더블클릭 — 설정창
  isMenuOpen?: () => boolean; // 앱이 그리는 메뉴가 떠 있는가
  closeMenu?: () => void;
  closedWithin?: (ms: number) => boolean; // 메뉴가 방금 닫혔는가
}

// 메뉴가 방금 닫혔으면 이만큼은 아이콘 클릭으로 다시 열지 않는다 — 아이콘을 눌러 닫은 클릭·더블클릭의 두 번째 클릭 (Windows 기본 더블클릭 간격)
const REOPEN_BLOCK_MS = 500;
// 메뉴를 닫은 클릭의 아이콘 신호가 늦게 오는 시간 — 2026-09-28 로그 실측 0.09~0.17초
const SAME_CLICK_MS = 250;

export interface TrayHandle {
  bounds(): Electron.Rectangle | null; // 아이콘 자리(화면 DIP) — 트레이 메뉴의 "아이콘 다시 누르기"를 가른다
  holdClick(ms: number): void; // 이만큼 동안 아이콘 클릭 신호를 무시한다 — 앱이 더블클릭을 직접 알아챘을 때
  setIcon(file: string | null): void;
  destroy(): void;
}

// 트레이 아이콘 — 실행 중인 펫이 바뀌어도 공식 앱 로고를 유지한다
export function trayIcon(file: string | null): NativeImage {
  const size = process.platform === "darwin" ? 18 : 16;
  try {
    if (file) {
      return nativeImage.createFromPath(file).resize({ width: size, height: size });
    }
  } catch {
    // 잘라내기 실패 — 아래 대체
  }
  return nativeImage.createFromBitmap(Buffer.alloc(size * size * 4, 0xff), { width: size, height: size });
}

export function createTray(opts: TrayOptions): TrayHandle | null {
  let tray: Tray | null = null;
  let holdUntil = 0;
  try {
    tray = new Tray(trayIcon(opts.icon));
    tray.setToolTip(opts.tooltip);
    const popup = opts.popup;
    // Windows 기본 트레이 아이콘처럼 — 우클릭은 메뉴, 왼쪽 클릭(한 번·더블)은 설정창
    // (2026-09-28 사용자 "윈도우기본앱은 아이콘 좌클릭이 그냥 바로 켜기구나"). 떠 있는 메뉴는 아이콘을 다시 누르면 닫히기만 한다
    const toggledOff = (): boolean => {
      if (opts.isMenuOpen?.()) {
        opts.closeMenu?.();
        return true;
      }
      return opts.closedWithin?.(REOPEN_BLOCK_MS) ?? false;
    };
    tray.on("click", () => {
      if (opts.isMenuOpen?.()) return opts.closeMenu?.();
      // 메뉴를 닫은 그 클릭의 신호가 뒤늦게(0.1~0.2초) 온다 — 그 신호로는 설정창을 열지 않는다
      if (Date.now() < holdUntil || opts.closedWithin?.(SAME_CLICK_MS)) return;
      opts.open?.();
    });
    tray.on("right-click", () => {
      if (Date.now() < holdUntil || toggledOff()) return;
      popup();
    });
    tray.on("double-click", () => {
      opts.closeMenu?.();
      opts.open?.();
    });
  } catch (e) {
    process.stderr.write(`트레이 아이콘을 만들지 못함 — ${e instanceof Error ? e.message : String(e)}. 우클릭 메뉴나 pokebuddy companion stop 으로 내린다\n`);
    return null;
  }
  return {
    holdClick(ms) {
      holdUntil = Date.now() + ms;
    },
    bounds() {
      return tray ? tray.getBounds() : null;
    },
    setIcon(file) {
      tray?.setImage(trayIcon(file));
    },
    destroy() {
      tray?.destroy();
      tray = null;
    },
  };
}
