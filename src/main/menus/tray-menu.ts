// 트레이 메뉴와 트레이 입력 (worklog/records/code-structure/design/10-main.md 3.9절 menus/tray-menu.ts)
//
// Windows 는 포커스를 쥐지 않게 띄운다(숨겨진 아이콘 창이 닫히지 않게). 바깥 클릭·Esc 는 헬퍼의 입력 감시로 닫는다.
// 떠 있는 동안만 헬퍼를 자주(50ms) 묻는다. 기준 수는 띄운 뒤 첫 답이다 — 메뉴를 연 그 클릭은 세지 않는다
// 항목은 화면 값이 만든다(src/view/menus.ts trayMenuOf). 여기서는 누르면 할 일만 잇는다
import { screen } from "electron";
import { trayMenuOf } from "../../view/menus";
import type { DisplayState } from "../app/display-state";
import { closeMenu, menuRectNow, isMenuOpen, openMenu } from "./menu-window";
import { t } from "../text";
import { preloadFile, rendererFile } from "../windows/files";

// 아이콘을 다시 눌러 메뉴를 닫은 때 — 메뉴가 떠 있는 동안에는 아이콘 클릭 신호가 오지 않아 Windows 가 더블클릭을 만들지 못한다.
// 그 뒤 doubleClickMs 안에 아이콘을 한 번 더 누르면 더블클릭으로 보고 설정창을 연다
export const TRAY_MENU_RULES = {
  inputMs: 50,
  doubleClickMs: 200, // 2026-09-28 사용자 "0.2초로 해도 될듯"
} as const;

export interface TrayInput {
  click: number;
  x: number;
  y: number;
  esc: number;
}

export interface TrayMenuDeps {
  display: DisplayState;
  openManage(): void;
  quit(): void;
  pollInput(): void; // 헬퍼에 입력을 한 번 묻는다 — 답은 onInput 으로 온다
  trayRect(): Electron.Rectangle | null; // 아이콘 자리(화면 DIP)
  holdClick(ms: number): void; // 이만큼 동안 아이콘 클릭 신호를 무시한다
}

export interface TrayMenu {
  open(): void;
  onInput(input: TrayInput): void;
}

export function createTrayMenu(deps: TrayMenuDeps): TrayMenu {
  let inputBase: { click: number; esc: number } | null = null;
  let inputTimer: NodeJS.Timeout | null = null;
  let iconClosed: { at: number; click: number } | null = null;

  const stopInput = (): void => {
    if (inputTimer) clearInterval(inputTimer);
    inputTimer = null;
    iconClosed = null;
  };

  const template = () =>
    trayMenuOf(
      { hidden: deps.display.hidden(), ghost: deps.display.ghost() },
      {
        openManage: deps.openManage,
        toggleHidden: deps.display.toggleHidden,
        quit: deps.quit,
        toggleGhost: () => deps.display.setGhost(!deps.display.ghost()),
      },
    );

  return {
    open() {
      const inactive = process.platform === "win32";
      inputBase = null;
      openMenu(
        {
          preload: preloadFile(),
          html: rendererFile("menu.html"),
          inactive,
          onClosed: () => {
            if (!iconClosed) stopInput(); // 아이콘으로 닫았으면 더블클릭을 볼 동안 더 묻는다
          },
        },
        template(),
        t("menu.on"),
      );
      if (inactive && !inputTimer) inputTimer = setInterval(deps.pollInput, TRAY_MENU_RULES.inputMs);
    },

    onInput(input) {
      if (!inputTimer) return;
      const at = screen.screenToDipPoint({ x: input.x, y: input.y });
      const icon = deps.trayRect();
      const onIcon = !!icon && icon.width > 0 && at.x >= icon.x && at.x < icon.x + icon.width && at.y >= icon.y && at.y < icon.y + icon.height;
      if (iconClosed) {
        const late = Date.now() - iconClosed.at > TRAY_MENU_RULES.doubleClickMs;
        const again = input.click > iconClosed.click && onIcon;
        if (again && !late) {
          stopInput();
          deps.holdClick(TRAY_MENU_RULES.doubleClickMs); // 뒤따라 오는 아이콘 클릭 신호로 메뉴가 다시 뜨지 않게
          deps.openManage();
        } else if (late) stopInput();
        return;
      }
      if (!isMenuOpen()) return;
      if (!inputBase) {
        inputBase = { click: input.click, esc: input.esc };
        return;
      }
      if (input.esc !== inputBase.esc) return closeMenu();
      if (input.click === inputBase.click) return;
      inputBase.click = input.click;
      // 트레이 아이콘을 다시 누른 것 — 메뉴가 아이콘 위에 걸쳐 떠도 닫는다(메뉴가 떠 있는 동안 아이콘 클릭 신호는 오지 않는다)
      if (onIcon) {
        iconClosed = { at: Date.now(), click: input.click };
        return closeMenu();
      }
      // 메뉴 안을 누른 것은 메뉴가 처리한다(항목 고르기). 바깥이면 닫는다 — 테두리에 걸친 점(메뉴가 붙은 아이콘 자리)은 바깥이다
      const b = menuRectNow();
      if (b && at.x > b.x && at.x < b.x + b.w - 1 && at.y > b.y && at.y < b.y + b.h - 1) return;
      closeMenu();
    },
  };
}
