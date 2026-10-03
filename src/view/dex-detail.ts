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
import { profileOf } from "../dex/species.js";
import { unlockRules } from "../dex/unlocks.js";
import { nextOf, prevOf } from "../dex/evo.js";
import type { DexOptions } from "../dex/data.js";
import { achievementName, petName, typeName, t } from "./text.js";
import { fixedEggs, inRandomEgg, rewardSpecies } from "../dex/obtain.js";
import { eggName, speciesPrice } from "../shop/catalog.js";
import type { DexDetail } from "../shared/model/detail";
import type { SaveV3 } from "../shared/save-v3";
import { achievementDefs, rewardPokemon } from "../achievement/defs.js";
import { hatchBaseOf, regionalOf } from "../dex/regional.js";
import { megaFormsOf, megaOf } from "../dex/mega.js";
import { bodySize, officialText, textOf } from "./dex-text.js";
import { MAP_MARK, onlyStepText, stepText } from "./evo-text.js";

// 도감 상세의 상점 구매 줄 — 상점 포켓몬 탭을 숨긴 동안 끈다 (docs/specs/game.md "상점 포켓몬")
const SHOP_SPECIES_LINE = false;

// 메가진화 줄 — 얻은 종에만 보인다 (2026-10-02 사용자 결정). 메가스톤이 있는지는 보지 않는다. 조건은 적지 않는다
function megaLine(slug: string, obtained: boolean, opts?: DexOptions): Pick<DexDetail, "mega"> {
  const forms = obtained ? megaFormsOf(slug, opts) : [];
  if (!forms.length) return {};
  const label = megaOf(forms[0] as string, opts)?.kind === "primal" ? "원시회귀" : "메가진화";
  return { mega: { label, names: forms.map((f) => petName(f)).join(" · ") } };
}

export function dexDetail(save: SaveV3, slug: string, opts?: DexOptions): DexDetail | null {
  const row = profileOf(slug, opts);
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
  // 모습 바꾸기로만 얻는 모습(기라티나(오리진폼))
  const shiftForm = regionalOf(slug, opts);
  if (shiftForm?.get === "shift") methods.push(`${petName(shiftForm.base)}의 모습 바꾸기`);
  // 알에서 기본형 대신 나오는 모습(배쓰나이(백색근의 모습)) — 기본 종이 나오는 알을 적는다
  const hatchBase = hatchBaseOf(slug, opts);
  if (hatchBase && inRandomEgg(hatchBase, opts)) methods.push(random);
  for (const [kind, pool] of fixedEggs(opts)) if (pool.includes(slug)) methods.push(eggName(kind, opts) ?? kind);
  // 상점 구매 줄은 잠시 숨긴다 — 상점의 포켓몬 탭을 숨긴 동안 (2026-09-30 사용자 결정 "그 줄도 숨기자"). 탭을 다시 열면 SHOP_SPECIES_LINE 을 true 로
  const price = SHOP_SPECIES_LINE ? speciesPrice(slug, opts) : null;
  if (price != null) methods.push(unlocked ? `상점 구매 ${price}P` : `상점 구매 ${price}P(해금 후)`);
  for (const [, def] of achievementDefs(opts)) if (rewardPokemon(def) === slug) methods.push(`업적 보상(${achievementName(def)})`);
  // 우편으로만 받는 특수 폼 (data/regional.json 의 get "gift", 2026-10-03 사용자 결정)
  // 업적 보상으로 주는 종(마기아나(500년 전의 색) · 피츄(삐쭉귀), 2026-10-03 사용자 결정 "업적으로 바꿔")은 아래의 `업적 보상` 줄만 적는다
  if (regionalOf(slug, opts)?.get === "gift" && !rewardSpecies(opts).includes(slug)) methods.push(GIFT_METHOD);

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
    ...megaLine(slug, obtained, opts),
    // 미해금 종은 분류·설명을 숨긴다 — 이름을 숨기는 것과 같다. 한국어 설명문이 없는 종은 영어로 대신한다(899번부터는 data/dex-text.ko.json 으로 채워 지금은 없다)
    ...officialText(unlocked ? textOf(slug, row.dex, opts) : undefined),
    ...bodySize(unlocked ? textOf(slug, row.dex, opts) : undefined),
  };
}

// 입수 경로가 하나도 없을 때 — 첫 선택·진화·알·상점 어디에도 없는 종
const NO_METHOD = "획득 방법 준비 중";
const GIFT_METHOD = "이벤트 우편";
