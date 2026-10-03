// 진화 조건 글자 한 벌 — 도감 상세·상점 상세가 같이 쓴다
import { type EvoStep } from "../dex/evo.js";
import type { DexOptions } from "../dex/data.js";
import { itemName, petName } from "./text.js";
import { needIsMap } from "../dex/regional.js";
import { josa } from "../shared/josa.js";

// 진화 한 단계의 문구 — "Lv.16에서 리자드", "불꽃의돌로 부스터", "밤에 친밀도 65로 블래키"
// 조사는 앞 낱말 받침에 맞춘다 (src/shared/josa.ts). 레벨·친밀도 지도 간선은 결과 뒤에 " (지도)" 를 붙인다 — "Lv.36에서 히스이 블레이범 (지도)"
// 돌 대신 지도인 간선은 조건이 지도라 표시를 붙이지 않는다 — "천둥의돌로 라이츄 · 지도로 알로라 라이츄" (2026-09-30 사용자 결정)
// 얻는 방법 줄("피카츄에서 진화 (지도)")·상점 트리 화살표("지도", "Lv.36 · 지도")와 같은 낱말을 쓴다
export const MAP_MARK = " (지도)";
export function stepText(step: EvoStep, opts?: DexOptions): string {
  // 조건에 더해 친밀도도 보는 간선은 결과 뒤에 적는다 — "Lv.25에서 루가루암(황혼의 모습) (친밀도 100)"
  const to = `${petName(step.to)}${step.map && !needIsMap(step.need) ? MAP_MARK : ""}${step.affinity ? ` (친밀도 ${step.affinity})` : ""}`;
  const time = step.when === "night" ? "밤에 " : step.when === "day" ? "낮에 " : "";
  const need = step.need;
  if (!need) return `${time}친밀도 100${josa("100", "으로/로")} ${to}`;
  if (need.kind === "level") return `${time}Lv.${need.level}에서 ${to}`;
  if (need.kind === "affinity") return `${time}친밀도 ${need.value}${josa(String(need.value), "으로/로")} ${to}`;
  const item = itemName(need.item, opts);
  return `${time}${item}${josa(item, "으로/로")} ${to}`;
}

// 한 단계뿐인 진화 — "Lv.16에서 리자드로 진화", "천둥의돌을 쓰면 라이츄로 진화"
// 조건 뒤에 '로'가 두 번 겹치지 않게 도구·친밀도는 다른 꼴로 쓴다
export function onlyStepText(step: EvoStep, opts?: DexOptions): string {
  if (step.map || step.affinity) return stepText(step, opts); // 지도 간선은 기본형 간선과 늘 함께라 여기 올 일이 드물다 — 조건 문구를 겹치지 않게 짧은 꼴로
  const to = petName(step.to);
  const time = step.when === "night" ? "밤에 " : step.when === "day" ? "낮에 " : "";
  const need = step.need;
  const cond = !need
    ? `${time}친밀도 100이 되면`
    : need.kind === "level"
      ? `${time}Lv.${need.level}에서`
      : need.kind === "affinity"
        ? `${time}친밀도 ${need.value}${josa(String(need.value), "이/가")} 되면`
        : `${time}${itemName(need.item, opts)}${josa(itemName(need.item, opts), "을/를")} 쓰면`;
  return `${cond} ${to}${josa(to, "으로/로")} 진화`;
}
