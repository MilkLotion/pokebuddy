// 도감 상세 — 한 종의 입수 방법·진화·알 행동 조건을 화면 문구로 만든다 (Figma `Dex / Base` 의 상세 패널)
//
// 1000종이 넘는 목록에 상세를 모두 싣지 않는다. 칸을 누를 때 한 종만 만든다.
// 입수 경로는 코드가 실제로 쓰는 규칙을 따른다
//   첫 선택 후보   data/unlocks.json 의 starter
//   랜덤알         해금한 종 가운데 랜덤알에서 나올 수 있는 종이 후보다 (src/shop/catalog.ts inRandomEgg)
//   알 행동 조건   data/egg-conditions.json — 해금과 무관하게 조건으로 나온다
//   종 목록 알     data/eggs.json 의 종 목록 — 태고의돌(화석)과 단일 포켓몬 알(전설·준전설·환상·울트라비스트)
//   진화           data/evo.json 을 거꾸로 — 앞 단계 종에서 진화한다
//   상점 구매      data/unlocks.json 의 shop (해금한 종만 산다)
// 미해금 종은 이름·타입과 진화 줄을 숨긴다. 진화 줄은 다음 종 이름을 드러내기 때문이다.
// 입수 방법과 알 조건 힌트는 보인다 (docs/specs/game.md "도감에서 구매·알·진화의 입수 조건은 명확히 표시한다")
import { profile } from "../dex/species.js";
import { unlockRules } from "../dex/unlocks.js";
import { nextOf, prevOf, type EvoStep } from "../dex/evo.js";
import type { DexOptions } from "../dex/data";
import { conditionOf, textOf } from "../egg/conditions.js";
import { getLang, petName, typeName } from "../main/text.js";
import { loadJson } from "../dex/data.js";
import { eggName, fixedEggs, inRandomEgg, speciesPrice } from "../shop/catalog.js";
import type { DexDetail } from "../shared/manage";
import type { SaveV3 } from "../shared/save-v3";
import { nameOfItem } from "./lists.js";

// 진화 한 단계의 문구 — "Lv.16에서 리자드", "불꽃의돌로 부스터", "밤에 친밀도 65로 블래키"
export function stepText(step: EvoStep, opts?: DexOptions): string {
  const to = petName(step.to);
  const time = step.when === "night" ? "밤에 " : step.when === "day" ? "낮에 " : "";
  const need = step.need;
  if (!need) return `${time}친밀도 100으로 ${to}`;
  if (need.kind === "level") return `${time}Lv.${need.level}에서 ${to}`;
  if (need.kind === "affinity") return `${time}친밀도 ${need.value}로 ${to}`;
  return `${time}${nameOfItem(need.item, opts)}로 ${to}`;
}

// 공식 분류와 설명문 — data/dex-text.json (src/tools/build-dex-text.ts 가 PokeAPI CSV 로 만든다)
interface DexText {
  genus: { ko?: string; en?: string };
  flavor: { ko?: string; en?: string };
  height?: number; // 데시미터
  weight?: number; // 헥토그램
}
const dexTexts = (opts?: DexOptions): Record<string, DexText> => loadJson<Record<string, DexText>>("dex-text.json", opts);

export function dexDetail(save: SaveV3, slug: string, opts?: DexOptions): DexDetail | null {
  const row = profile(slug, opts);
  if (!row.dex) return null;
  const obtained = save.dex.obtained.includes(slug);
  const unlocked = obtained || save.dex.unlocked.includes(slug);
  const state = obtained ? "obtained" : unlocked ? "unlocked" : "locked";

  const methods: string[] = [];
  if (unlockRules(opts)[slug]?.starter) methods.push("첫 선택 후보");
  const prev = prevOf(slug, opts);
  if (prev) methods.push(`${petName(prev)}에서 진화`);
  if (unlocked && inRandomEgg(slug, opts)) methods.push(eggName("random", opts) ?? "랜덤알");
  for (const [kind, pool] of fixedEggs(opts)) if (pool.includes(slug)) methods.push(eggName(kind, opts) ?? kind);
  const condition = conditionOf(slug, opts);
  if (condition) methods.push("알 행동 조건");
  const price = speciesPrice(slug, opts);
  if (price != null) methods.push(unlocked ? `상점 구매 ${price}P` : `상점 구매 ${price}P(해금 후)`);

  const steps = nextOf(slug, opts);
  const evolution = !unlocked
    ? "해금하면 보여요"
    : steps.length
      ? `${steps.map((s) => stepText(s, opts)).join(" · ")} · 진화는 개체 상세에서 직접`
      : "더 진화하지 않아요";

  const discovered = save.dex.discovered[slug];
  const eggCondition = !condition
    ? "없음"
    : discovered
      ? `발견 · ${textOf(discovered, opts) ?? discovered}`
      : "미발견 · 알을 돌보는 방법에 따라 나올 수 있어요";

  return {
    slug,
    dex: row.dex,
    name: unlocked ? petName(slug) : "???",
    state,
    types: unlocked ? row.types.map((t) => typeName(t)) : [],
    typeIds: unlocked ? [...row.types] : [],
    shiny: save.dex.shinyObtained.includes(slug),
    owned: save.pets.filter((p) => p.species === slug).length,
    methods: methods.length ? methods.join(" · ") : "획득 방법 준비 중",
    evolution,
    eggCondition,
    gimmick: "없음", // 특수 기믹은 아직 없다
    // 미해금 종은 분류·설명을 숨긴다 — 이름을 숨기는 것과 같다. 한국어 설명문이 없는 종(899번부터)은 영어로 대신한다
    ...officialText(unlocked ? dexTexts(opts)[String(row.dex)] : undefined),
    ...bodySize(unlocked ? dexTexts(opts)[String(row.dex)] : undefined),
  };
}

// 키·몸무게 — 공식 도감처럼 소수 한 자리. 미해금 종과 값이 없는 종은 빈 문자열
function bodySize(t: DexText | undefined): { height: string; weight: string } {
  return {
    height: t?.height ? `${(t.height / 10).toFixed(1)}m` : "",
    weight: t?.weight ? `${(t.weight / 10).toFixed(1)}kg` : "",
  };
}

function officialText(t: DexText | undefined): { genus: string; flavor: string } {
  if (!t) return { genus: "", flavor: "" };
  const lang = getLang();
  const other = lang === "ko" ? "en" : "ko";
  return { genus: t.genus[lang] ?? t.genus[other] ?? "", flavor: t.flavor[lang] ?? t.flavor[other] ?? "" };
}
