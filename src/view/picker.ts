// 첫 실행 선택 창의 화면 값 — 제목·단추 글자와 스타터 줄(이름·진화 줄). 창은 메인이 띄운다 (src/main/windows/picker-window.ts)
// (예전 picker-window.ts 안에 있었다. 메인 레인 M8-4 에서 화면 값으로 옮겼다)
import { nextOf } from "../dex/evo.js";
import type { PickerPayload } from "../shared/model/stage";
import { petName, t } from "./text.js";

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
