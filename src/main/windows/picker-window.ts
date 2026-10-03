// 첫 실행 선택 창 — 스타터 29종을 세대별로. 고르면 슬러그, 닫으면 null. 문서는 src/renderer/picker.html (C 단위), 문구·목록은 여기서 준다
import { BrowserWindow } from "electron";
import { nextOf } from "../../dex/evo";
import type { PickerPayload } from "../../shared/model/stage";
import type { StageChannel } from "../../shared/ipc/stage";
import { windowIcon } from "../paths";
import type { Portraits } from "../portraits";
import { petName, t } from "../text";
import { createIpcScope } from "./ipc";
import { webPreferencesOf } from "./options";

const CH = {
  list: "picker:list",
  start: "picker:start",
  portraits: "picker:portraits",
} satisfies Record<string, StageChannel>;

export interface PickerOptions {
  preload: string;
  html: string;
  starters: string[]; // data/unlocks.json 의 starter 표시 순서 — 세대별 3종 × 9 + 피카츄·이브이
  onPicking(on: boolean): void; // 선택 창이 열려 있는 동안 window-all-closed 로 끝나지 않게
  portraits: Portraits; // 미리 받기와 같은 것을 쓴다 — 같은 그림을 두 번 받지 않고, 받는 중인 그림을 함께 기다린다
}

// 진화 줄 — 한 갈래면 끝까지 "리자드 → 리자몽", 갈래가 여럿이면 그 단계의 이름을 모두 적고 멈춘다 ("샤미드 · 쥬피썬더 · …")
// 지도 간선(기본형 → 리전폼)은 적지 않는다 — 첫 선택에서는 기본 사슬만 보인다 ("피카츄 → 라이츄", "나로테 → 모크나이퍼")
export function evolutionLine(slug: string): string {
  const names: string[] = [];
  let at = slug;
  for (let guard = 0; guard < 5; guard++) {
    const next = [...new Set(nextOf(at).filter((s) => !s.map).map((s) => s.to))];
    if (!next.length) break;
    if (next.length > 1) {
      names.push(next.map((to) => petName(to)).join(" · "));
      break;
    }
    at = next[0] as string;
    names.push(petName(at));
  }
  return names.length ? t("starter.evolution", { chain: names.join(" → ") }) : "";
}

// 선택 창에 줄 목록 — data/unlocks.json 의 starter 순서 그대로. 이름은 지금 언어로
export function pickerPayload(starters: string[]): PickerPayload {
  return {
    title: t("starter.title"),
    start: t("starter.start"),
    empty: t("starter.empty"),
    items: starters.map((slug) => ({ slug, name: petName(slug), evolution: evolutionLine(slug) })),
  };
}

export function pickStarter(opts: PickerOptions): Promise<string | null> {
  return new Promise((resolve) => {
    opts.onPicking(true);
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
    // 선택 창이 보낸 요청만 받는다. 무대 창·관리 창도 같은 preload 를 쓴다
    const scope = createIpcScope((sender) => !picker.isDestroyed() && sender === picker.webContents);
    let done = false;
    const finish = (slug: string | null): void => {
      if (done) return;
      done = true;
      opts.onPicking(false);
      scope.dispose();
      resolve(slug);
      if (!picker.isDestroyed()) picker.close();
    };
    // 다른 창이 물으면 빈 목록을 준다
    scope.handle(CH.list, pickerPayload([]), () => pickerPayload(opts.starters));
    // 카드의 초상 — 후보 종만 받는다
    scope.handle(CH.portraits, {}, (_e, slugs) =>
      opts.portraits.get((Array.isArray(slugs) ? slugs : []).filter((s): s is string => typeof s === "string" && opts.starters.includes(s)).map((slug) => ({ slug, shiny: false }))),
    );
    scope.on(CH.start, (_e, slug) => finish(typeof slug === "string" && opts.starters.includes(slug) ? slug : null));
    picker.removeMenu(); // 기본 File·Edit·View·Window 메뉴를 없앤다
    picker.on("closed", () => finish(null));
    void picker.loadFile(opts.html);
  });
}
