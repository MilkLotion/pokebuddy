// 도감 상세 — 한 종의 입수 방법·진화를 화면 문구로 만든다 (Figma `Dex / Base` 의 상세 패널)
//
// 1000종이 넘는 목록에 상세를 모두 싣지 않는다. 칸을 누를 때 한 종만 만든다.
// 입수 경로는 코드가 실제로 쓰는 규칙을 따른다
//   첫 선택 후보   data/unlocks.json 의 starter
//   랜덤알         해금한 종 가운데 랜덤알에서 나올 수 있는 종이 후보다 (src/shop/catalog.ts inRandomEgg)
//   종 목록 알     data/eggs.json 의 종 목록 — 태고의돌(화석)과 단일 포켓몬 알(전설·준전설·환상·울트라비스트)
//   진화           data/evo.json 을 거꾸로 — 앞 단계 종에서 진화한다
//   상점 구매      알에서 얻을 수 있는 종 — 수집 난이도별 가격 (src/shop/catalog.ts speciesPrice). 해금한 종만 산다
//   업적 보상      data/achievements.json 의 reward.pokemon — 메타몽·라프라스 (2026-09-29 사용자 결정)
// 미해금 종은 이름·타입과 진화 줄을 숨긴다. 진화 줄은 다음 종 이름을 드러내기 때문이다.
// 입수 방법은 보인다 (docs/specs/game.md "도감에서 구매·알·진화의 입수 조건은 명확히 표시한다")
import { profile } from "../dex/species.js";
import { unlockRules } from "../dex/unlocks.js";
import { nextOf, prevOf, type EvoStep } from "../dex/evo.js";
import type { DexOptions } from "../dex/data";
import { getLang, petName, typeName } from "../main/text.js";
import { loadJson } from "../dex/data.js";
import { eggName, fixedEggs, inRandomEgg, speciesPrice } from "../shop/catalog.js";
import type { DexDetail } from "../shared/manage";
import type { SaveV3 } from "../shared/save-v3";
import { nameOfItem } from "./lists.js";
import { josa } from "../shared/josa.js";
import { defs as achievementDefs, rewardPokemon } from "../achievement/core.js";
import { needIsMap, regionalOf } from "../dex/regional.js";

// 도감 상세의 상점 구매 줄 — 상점 포켓몬 탭을 숨긴 동안 끈다 (docs/specs/game.md "상점 포켓몬")
const SHOP_SPECIES_LINE = false;

// 진화 한 단계의 문구 — "Lv.16에서 리자드", "불꽃의돌로 부스터", "밤에 친밀도 65로 블래키"
// 조사는 앞 낱말 받침에 맞춘다 (src/shared/josa.ts). 레벨·친밀도 지도 간선은 결과 뒤에 " (지도)" 를 붙인다 — "Lv.36에서 히스이 블레이범 (지도)"
// 돌 대신 지도인 간선은 조건이 지도라 표시를 붙이지 않는다 — "천둥의돌로 라이츄 · 지도로 알로라 라이츄" (2026-09-30 사용자 결정)
// 얻는 방법 줄("피카츄에서 진화 (지도)")·상점 트리 화살표("지도", "Lv.36 · 지도")와 같은 낱말을 쓴다
export const MAP_MARK = " (지도)";
export function stepText(step: EvoStep, opts?: DexOptions): string {
  const to = `${petName(step.to)}${step.map && !needIsMap(step.need) ? MAP_MARK : ""}`;
  const time = step.when === "night" ? "밤에 " : step.when === "day" ? "낮에 " : "";
  const need = step.need;
  if (!need) return `${time}친밀도 100${josa("100", "으로/로")} ${to}`;
  if (need.kind === "level") return `${time}Lv.${need.level}에서 ${to}`;
  if (need.kind === "affinity") return `${time}친밀도 ${need.value}${josa(String(need.value), "으로/로")} ${to}`;
  const item = nameOfItem(need.item, opts);
  return `${time}${item}${josa(item, "으로/로")} ${to}`;
}

// 한 단계뿐인 진화 — "Lv.16에서 리자드로 진화", "천둥의돌을 쓰면 라이츄로 진화"
// 조건 뒤에 '로'가 두 번 겹치지 않게 도구·친밀도는 다른 꼴로 쓴다
function onlyStepText(step: EvoStep, opts?: DexOptions): string {
  if (step.map) return stepText(step, opts); // 지도 간선은 기본형 간선과 늘 함께라 여기 올 일이 드물다 — 조건 문구를 겹치지 않게 짧은 꼴로
  const to = petName(step.to);
  const time = step.when === "night" ? "밤에 " : step.when === "day" ? "낮에 " : "";
  const need = step.need;
  const cond = !need
    ? `${time}친밀도 100이 되면`
    : need.kind === "level"
      ? `${time}Lv.${need.level}에서`
      : need.kind === "affinity"
        ? `${time}친밀도 ${need.value}${josa(String(need.value), "이/가")} 되면`
        : `${time}${nameOfItem(need.item, opts)}${josa(nameOfItem(need.item, opts), "을/를")} 쓰면`;
  return `${cond} ${to}${josa(to, "으로/로")} 진화`;
}

// 공식 분류와 설명문 — data/dex-text.json (src/tools/build-dex-text.ts 가 PokeAPI CSV 로 만든다)
export interface DexText {
  genus: { ko?: string; en?: string };
  flavor: { ko?: string; en?: string };
  height?: number; // 데시미터
  weight?: number; // 헥토그램
}
export const dexTexts = (opts?: DexOptions): Record<string, DexText> => loadJson<Record<string, DexText>>("dex-text.json", opts);

// 한 종의 도감 글 — 도감 번호 항목(분류·설명문) 위에 슬러그 항목(리전폼의 키·몸무게)을 얹는다. 리전폼 설명문은 기본형 것이다
export function textOf(slug: string, dex: number, opts?: DexOptions): DexText | undefined {
  const all = dexTexts(opts);
  const base = all[String(dex)];
  const own = all[slug];
  if (!own) return base;
  return {
    genus: { ...base?.genus, ...own.genus },
    flavor: { ...base?.flavor, ...own.flavor },
    height: own.height ?? base?.height,
    weight: own.weight ?? base?.weight,
  };
}

export function dexDetail(save: SaveV3, slug: string, opts?: DexOptions): DexDetail | null {
  const row = profile(slug, opts);
  if (!row.dex) return null;
  const obtained = save.dex.obtained.includes(slug);
  const unlocked = obtained || save.dex.unlocked.includes(slug);
  const state = obtained ? "obtained" : unlocked ? "unlocked" : "locked";

  const methods: string[] = [];
  if (unlockRules(opts)[slug]?.starter) methods.push("첫 선택 후보");
  const prev = prevOf(slug, opts);
  if (prev) methods.push(`${petName(prev)}에서 진화${nextOf(prev, opts).some((s) => s.to === slug && s.map) ? MAP_MARK : ""}`);
  const random = eggName("random", opts) ?? "랜덤알";
  if (inRandomEgg(slug, opts)) methods.push(unlocked ? random : `${random}(해금 후)`);
  for (const [kind, pool] of fixedEggs(opts)) if (pool.includes(slug)) methods.push(eggName(kind, opts) ?? kind);
  // 상점 구매 줄은 잠시 숨긴다 — 상점의 포켓몬 탭을 숨긴 동안 (2026-09-30 사용자 결정 "그 줄도 숨기자"). 탭을 다시 열면 SHOP_SPECIES_LINE 을 true 로
  const price = SHOP_SPECIES_LINE ? speciesPrice(slug, opts) : null;
  if (price != null) methods.push(unlocked ? `상점 구매 ${price}P` : `상점 구매 ${price}P(해금 후)`);
  for (const [, def] of achievementDefs(opts)) if (rewardPokemon(def) === slug) methods.push(`업적 보상(${def.ko})`);

  const steps = nextOf(slug, opts);
  // 한 단계면 "Lv.16에서 리자드로 진화", 여러 갈래면 단계 문구만 잇는다
  const onlyStep = steps.length === 1 ? steps[0] : undefined;
  const evolution = !unlocked
    ? "???"
    : onlyStep
      ? onlyStepText(onlyStep, opts)
      : steps.length
        ? steps.map((s) => stepText(s, opts)).join(" · ")
        : "더 진화하지 않아요";

  const form = regionalOf(slug, opts);
  return {
    slug,
    dex: row.dex,
    ...(form ? { form: form.no } : {}),
    name: unlocked ? petName(slug) : "???",
    state,
    types: unlocked ? row.types.map((t) => typeName(t)) : [],
    typeIds: unlocked ? [...row.types] : [],
    shiny: save.dex.shinyObtained.includes(slug),
    owned: save.pets.filter((p) => p.species === slug).length,
    methods: methods.length ? methods.join(" · ") : NO_METHOD,
    evolution,
    gimmick: "없음", // 특수 기믹은 아직 없다
    // 미해금 종은 분류·설명을 숨긴다 — 이름을 숨기는 것과 같다. 한국어 설명문이 없는 종은 영어로 대신한다(899번부터는 data/dex-text.ko.json 으로 채워 지금은 없다)
    ...officialText(unlocked ? textOf(slug, row.dex, opts) : undefined),
    ...bodySize(unlocked ? textOf(slug, row.dex, opts) : undefined),
  };
}

// 입수 경로가 하나도 없을 때 — 첫 선택·진화·알·상점 어디에도 없는 종
const NO_METHOD = "획득 방법 준비 중";

// 키·몸무게 — 공식 도감처럼 소수 한 자리. 미해금 종과 값이 없는 종은 빈 문자열
function bodySize(t: DexText | undefined): { height: string; weight: string } {
  return {
    height: t?.height ? `${(t.height / 10).toFixed(1)}m` : "",
    weight: t?.weight ? `${(t.weight / 10).toFixed(1)}kg` : "",
  };
}

export function officialText(t: DexText | undefined): { genus: string; flavor: string } {
  if (!t) return { genus: "", flavor: "" };
  const lang = getLang();
  const other = lang === "ko" ? "en" : "ko";
  return { genus: t.genus[lang] ?? t.genus[other] ?? "", flavor: t.flavor[lang] ?? t.flavor[other] ?? "" };
}
