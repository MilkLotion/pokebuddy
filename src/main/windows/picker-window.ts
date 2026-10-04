// 첫 실행 선택 창 — 스타터 29종을 세대별로. 고르면 슬러그, 닫으면 null. 문서는 src/renderer/picker.html (C 단위), 문구·목록은 화면 값이 만든다 (src/view/picker.ts)
// 한 번 답하는 창의 공통 동작은 틀(./answer-window.ts)이 한다
import { BrowserWindow } from "electron";
import type { PickerChannel } from "../../shared/ipc/picker";
import { windowIcon } from "./files";
import type { Portraits } from "../art/portraits";
import { pickerPayload } from "../../view/picker";
import { askWindow } from "./answer-window";
import { webPreferencesOf } from "./options";

const CH = {
  list: "picker:list",
  start: "picker:start",
  portraits: "picker:portraits",
} satisfies Record<string, PickerChannel>;

export interface PickerOptions {
  preload: string;
  html: string;
  starters: string[]; // data/unlocks.json 의 starter 표시 순서 — 세대별 3종 × 9 + 피카츄·이브이
  onPicking(on: boolean): void; // 선택 창이 열려 있는 동안 window-all-closed 로 끝나지 않게
  portraits: Portraits; // 미리 받기와 같은 것을 쓴다 — 같은 그림을 두 번 받지 않고, 받는 중인 그림을 함께 기다린다
}

export function askStarter(opts: PickerOptions): Promise<string | null> {
  opts.onPicking(true);
  return askWindow<string | null>({
    create() {
      // 폭은 Figma 640, 높이는 창 끝 780 — 카드 목록만 스크롤한다
      const picker = new BrowserWindow({
        width: 640,
        height: 780,
        useContentSize: true,
        title: "pokebuddy",
        resizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        minimizable: false,
        fullscreenable: false,
        icon: windowIcon(),
        webPreferences: webPreferencesOf(opts.preload),
      });
      picker.removeMenu(); // 기본 File·Edit·View·Window 메뉴를 없앤다
      return [picker];
    },
    html: opts.html,
    closed: () => null,
    // 문서를 못 읽으면 빈 창을 남기지 않고 닫은 것과 같이 끝낸다 — 부른 쪽이 첫 실행 취소로 알리고 끝낸다
    loadFailed(e, ctx) {
      console.error("선택 창 문서를 읽지 못했다 — 닫은 것으로 본다", e);
      ctx.finish(null);
    },
    // 선택 창이 보낸 요청만 받는다(틀의 scope). 무대 창·관리 창도 같은 preload 를 쓴다
    wire(ctx) {
      ctx.onCleanup(() => opts.onPicking(false));
      // 다른 창이 물으면 빈 목록을 준다
      ctx.scope.handle(CH.list, pickerPayload([]), () => pickerPayload(opts.starters));
      // 카드의 초상 — 후보 종만 받는다
      ctx.scope.handle(CH.portraits, {}, (_e, slugs) =>
        opts.portraits.get((Array.isArray(slugs) ? slugs : []).filter((s): s is string => typeof s === "string" && opts.starters.includes(s)).map((slug) => ({ slug, shiny: false }))),
      );
      ctx.scope.on(CH.start, (_e, slug) => ctx.finish(typeof slug === "string" && opts.starters.includes(slug) ? slug : null));
    },
  });
}
