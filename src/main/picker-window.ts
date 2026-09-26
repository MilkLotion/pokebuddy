// 첫 실행 선택 창 — 스타터 29종을 세대별로. 고르면 슬러그, 닫으면 null. 문서는 src/renderer/picker.html (C 단위), 문구·목록은 여기서 준다
import { BrowserWindow, ipcMain } from "electron";
import { nextOf } from "../dex/evo";
import type { PickerPayload, StageChannel } from "../shared/stage";
import { windowIcon } from "./paths";
import type { Portraits } from "./portraits";
import { petName, t } from "./text";

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
export function evolutionLine(slug: string): string {
  const names: string[] = [];
  let at = slug;
  for (let guard = 0; guard < 5; guard++) {
    const next = [...new Set(nextOf(at).map((s) => s.to))];
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
    subtitle: t("starter.subtitle"),
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
      webPreferences: { preload: opts.preload },
    });
    let done = false;
    const finish = (slug: string | null): void => {
      if (done) return;
      done = true;
      opts.onPicking(false);
      ipcMain.removeHandler(CH.list);
      ipcMain.removeHandler(CH.portraits);
      ipcMain.removeListener(CH.start, onStart);
      resolve(slug);
      if (!picker.isDestroyed()) picker.close();
    };
    const onStart = (_e: unknown, slug: unknown): void => finish(typeof slug === "string" && opts.starters.includes(slug) ? slug : null);
    ipcMain.handle(CH.list, () => pickerPayload(opts.starters));
    // 카드의 초상 — 후보 종만 받는다
    ipcMain.handle(CH.portraits, (_e, slugs: unknown) =>
      opts.portraits.get((Array.isArray(slugs) ? slugs : []).filter((s): s is string => typeof s === "string" && opts.starters.includes(s)).map((slug) => ({ slug, shiny: false }))),
    );
    ipcMain.on(CH.start, onStart);
    picker.removeMenu(); // 기본 File·Edit·View·Window 메뉴를 없앤다
    picker.on("closed", () => finish(null));
    void picker.loadFile(opts.html);
  });
}
