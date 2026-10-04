// 놀이공간 화면 번호 덮개 — 화면마다 창 하나로 번호를 크게 보인다. 문서는 src/renderer/screens.html (2026-09-28 여러 화면)
//
//   보기(identify)  설정의 한 화면 목록이 열린 동안. 클릭을 통과시키고 포커스를 받지 않는다 — 목록을 계속 쓸 수 있다
//   고르기(ask)     `화면에서 고르기`. 누른 화면을 돌려주고 Esc·창 닫기는 null. 영역 그리기 창(region-window.ts)과 같은 규칙이다
//                   한 번 답하는 창의 공통 동작은 틀(./answer-window.ts)이 한다
//
// 번호는 설정 목록과 같다 — 주 화면이 1 (layout.ts screenOrder). 지금 화면 목록은 ./display.ts screensNow. 저장은 부른 쪽이 한다
import type { BrowserWindow } from "electron";
import type { ScreenOverlayInit, ScreenView } from "../../shared/model/overlays";
import type { ScreensChannel } from "../../shared/ipc/overlays";
import { findScreen, screenRefOfInfo, type ScreenInfo, type ScreenRef } from "./screens";
import { askWindow, singleFlight } from "./answer-window";
import { afterLoad } from "./ipc";
import { createOverlayWindow } from "./options";

const CH = {
  init: "screens:init",
  pick: "screens:pick",
  cancel: "screens:cancel",
} satisfies Record<string, ScreensChannel>;

// 설정의 한 화면 목록 — chosen 은 저장된 고른 화면(없으면 주 화면)
export function screenViews(screens: readonly ScreenInfo[], chosen: ScreenRef | null): ScreenView[] {
  const now = findScreen(chosen, screens);
  return screens.map((s, i) => ({ number: i + 1, primary: s.primary, w: s.bounds.w, h: s.bounds.h, current: s.id === now?.id, ref: screenRefOfInfo(s) }));
}

export interface ScreenPickerOptions {
  preload: string;
  html: string;
  screens: () => ScreenInfo[]; // 번호 순
}

// 화면 하나를 덮는 창 — 보기면 클릭 통과·포커스 없음, 고르기면 누를 수 있다
function overlay(opts: ScreenPickerOptions, s: ScreenInfo, pick: boolean): BrowserWindow {
  const b = s.bounds;
  const win = createOverlayWindow({ preload: opts.preload, layer: "screen-saver", bounds: { x: b.x, y: b.y, width: b.w, height: b.h }, focusable: pick, firstMouse: true, allWorkspaces: true }); // mac 첫 클릭 — 알림 창과 같다 (94 문서 4-4)
  if (!pick) win.setIgnoreMouseEvents(true);
  return win;
}

// 문서를 읽은 뒤 번호를 보내고 보인다
function reveal(win: BrowserWindow, s: ScreenInfo, number: number, pick: boolean): void {
  const init: ScreenOverlayInit = { number, primary: s.primary, w: s.bounds.w, h: s.bounds.h, pick };
  win.webContents.send(CH.init, init);
  if (pick) {
    win.show();
    win.focus(); // Esc 를 받는다 — 영역 그리기 창과 같다
  } else win.showInactive(); // 설정 창의 포커스를 빼앗지 않는다
}

const closeAll = (wins: BrowserWindow[]): void => {
  for (const w of wins) if (!w.isDestroyed()) w.close();
};

export interface ScreenPicker {
  identify(on: boolean): void;
  ask(): Promise<ScreenRef | null>;
  close(): void;
}

export function createScreenPicker(opts: ScreenPickerOptions): ScreenPicker {
  let shown: BrowserWindow[] = []; // 보기 덮개

  // 이미 고르는 중이면 같은 약속 — 덮개를 한 벌만 둔다
  const ask = singleFlight((): Promise<ScreenRef | null> => {
    closeAll(shown);
    shown = [];
    const screens = opts.screens();
    // 덮개 가운데 하나가 보낸 것만 받는다(틀의 scope)
    return askWindow<ScreenRef | null>({
      create: () => screens.map((s) => overlay(opts, s, true)),
      html: opts.html,
      // 한 화면이라도 닫히면(시스템이 닫음 등) 취소로 친다 — 남은 덮개가 화면을 막지 않게
      closed: () => null,
      wire(ctx) {
        ctx.scope.on(CH.pick, (e) => {
          const s = screens[ctx.indexOf(e.sender)];
          if (s) ctx.finish(screenRefOfInfo(s));
        });
        ctx.scope.on(CH.cancel, () => ctx.finish(null));
      },
      loaded(win, i) {
        const s = screens[i];
        if (s) reveal(win, s, i + 1, true);
      },
      // 덮개 하나라도 문서를 못 읽으면 취소 — 그 덮개를 닫던 것과 답이 같다
      loadFailed: (_e, ctx) => ctx.finish(null),
    });
  });

  return {
    identify(on) {
      closeAll(shown);
      shown = [];
      if (!on || ask.inFlight()) return;
      shown = opts.screens().map((s, i) => {
        const win = overlay(opts, s, false);
        afterLoad(win, () => reveal(win, s, i + 1, false));
        void win.loadFile(opts.html).catch(() => {
          if (!win.isDestroyed()) win.close();
        });
        return win;
      });
    },

    ask,

    close() {
      closeAll(shown);
      shown = [];
    },
  };
}
