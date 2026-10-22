// 도감 상세 — 한 종의 입수 방법·진화를 화면 문구로 만든다 (Figma `Dex / Base` 의 상세 패널)
//
// 1000종이 넘는 목록에 상세를 모두 싣지 않는다. 칸을 누를 때 한 종만 만든다.
// 입수 경로는 코드가 실제로 쓰는 규칙을 따른다
//   첫 선택 후보는 적지 않는다 — 첫 실행의 고르기는 입수처로 보이지 않는다 (2026-10-18 사용자 "스타팅포켓몬들 입수처에 첫 선택 후보 제거")
//   랜덤알         해금한 종 가운데 랜덤알에서 나올 수 있는 종이 후보다 (src/shop/catalog.ts inRandomEgg)
//   종 목록 알     data/eggs.json 의 종 목록 — 태고의돌(화석)과 단일 포켓몬 알(전설·준전설·환상·울트라비스트)
//   진화           data/evo.json 을 거꾸로 — 앞 단계 종에서 진화한다
//   상점 구매      알에서 얻을 수 있는 종 — 수집 난이도별 가격 (src/shop/catalog.ts speciesPrice). 해금한 종만 산다
//   업적 보상      data/achievements.json 의 reward.pokemon — 메타몽·라프라스 (2026-09-29 사용자 결정)
// 미해금 종은 이름·타입과 진화 줄을 숨긴다. 진화 줄은 다음 종 이름을 드러내기 때문이다.
// 입수 방법은 보인다 (docs/specs/game.md "도감에서 구매·알·진화의 입수 조건은 명확히 표시한다")
import { profileOf } from "../dex/species.js";
import { nextOf, prevOf } from "../dex/evo.js";
import type { DexOptions } from "../dex/data.js";
import { hasObtained, hasShiny, hasUnlocked } from "../dex/record.js";
import { achievementName, itemName, petName, typeName, t } from "./text.js";
import { fixedEggs, inRandomEgg, rewardSpecies } from "../dex/obtain.js";
import { eggName, speciesPrice } from "../shop/catalog.js";
import type { DexDetail, DexFormView } from "../shared/model/detail";
import type { SaveV3 } from "../shared/save-v3";
import { achievementDefs, rewardPokemon } from "../achievement/defs.js";
import { dexSlugOf, evolveLookVariants, formLabelOf, hatchBaseOf, lookFormOf, otherFormsOf, partnerOf, regionalOf, riderOwnerOf, shiftGroupOf } from "../dex/regional.js";
import { shiftRuleOf } from "../dex/forms.js";
import { megaFormsOf, megaOf, megaTagOf } from "../dex/mega.js";
import { bodySize, officialText, textOf } from "./dex-text.js";
import { MAP_MARK, onlyStepText, stepText } from "./evo-text.js";
import { pointText } from "../shared/count-text.js";
import { josa } from "../shared/josa.js";
import { RIDER_ITEM } from "../dex/rules.js";

// 도감 상세의 상점 구매 줄 — 상점 포켓몬 탭을 숨긴 동안 끈다 (docs/specs/game.md "상점 포켓몬")
const SHOP_SPECIES_LINE = false;

// 메가진화 줄 — 얻은 종에만 보인다 (2026-10-02 사용자 결정). 메가스톤이 있는지는 보지 않는다. 조건은 적지 않는다
function megaLine(slug: string, obtained: boolean, opts?: DexOptions): Pick<DexDetail, "mega"> {
  const forms = obtained ? megaFormsOf(slug, opts) : [];
  if (!forms.length) return {};
  const label = megaOf(forms[0] as string, opts)?.kind === "primal" ? "원시회귀" : "메가진화";
  return { mega: { label, names: forms.map((f) => petName(f)).join(" · ") } };
}

// 모습 바꾸기의 조건 — "(파티에서 작업 2시간 · 로토무카탈로그)". 규칙이 없는 묶음(오리진폼)은 빈 글자. 쌓인 시간은 적지 않는다 (2026-10-05)
// 작업 시간 조건이 없는 묶음(플라엣테·다투곰)은 도구만 — "(영원의 꽃)" (2026-10-08 사용자 확인)
function shiftNeedText(slug: string, opts?: DexOptions): string {
  const rule = shiftRuleOf(slug, opts);
  if (rule == null) return "";
  return rule.workMs > 0 ? `(파티에서 작업 ${rule.workMs / 3_600_000}시간 · ${itemName(rule.item)})` : `(${itemName(rule.item)})`;
}

// 입수처에 적는 다른 종의 이름 — 그 종을 아직 발견(해금·획득)하지 못했으면 `???` 다 (2026-10-13 사용자 "입수처에도 기존포켓몬 발견못했으면 ???에서 진화로")
const knownName = (save: SaveV3, slug: string): string => (hasObtained(save, slug) || hasUnlocked(save, slug) ? petName(slug) : "???");

// 짝이 있어야 하는 모습(블랙큐레무 — 제크로무) — "(제크로무가 있어야)". 짝이 없으면 빈 글자 (data/regional.json partners)
function partnerText(save: SaveV3, slug: string, opts?: DexOptions): string {
  const mate = partnerOf(slug, opts);
  if (!mate) return "";
  const name = knownName(save, mate);
  return `(${name}${josa(name, "이/가")} 있어야)`;
}

// 모습 바꾸기 줄 — 규칙이 있고 오가는 묶음의 기본 종(로토무)에만, 메가진화 줄과 같은 자리·같은 보임(얻은 종에만).
// 값은 모습 수와 조건 — "다섯 모습(로토무카탈로그)" (docs/specs/game.md "로토무의 모습 바꾸기")
const COUNT_WORDS = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
function shiftLine(slug: string, obtained: boolean, opts?: DexOptions): Pick<DexDetail, "mega"> {
  const group = shiftGroupOf(slug, opts);
  const rule = shiftRuleOf(slug, opts);
  // 한 방향 묶음(플라엣테·다투곰)에는 이 줄이 없다
  if (!obtained || group[0] !== slug || !rule || rule.oneWay) return {};
  const n = group.length - 1;
  return { mega: { label: "모습 바꾸기", names: `${COUNT_WORDS[n] ?? n} 모습${shiftNeedText(slug, opts)}` } };
}

// 메가·원시회귀 칸의 상세 — 기본 종에 메가스톤이 생긴 적이 있으면 획득, 아니면 미해금 (2026-10-09 시안 99 `도감 메가 칸 시안` 상세 기기)
// 분류·설명·키·몸무게는 기본 종 것이다. 진화 칸은 기본 종 → 메가 모습 한 단계다
function megaDetail(save: SaveV3, slug: string, opts?: DexOptions): DexDetail | null {
  const form = megaOf(slug, opts);
  const dex = form ? profileOf(form.base, opts).dex : undefined;
  if (!form || !dex) return null;
  const obtained = (save.dex.megaOpened ?? []).includes(form.base);
  const base = petName(form.base);
  const way = form.kind === "primal" ? "원시회귀" : "메가진화";
  const types = obtained ? (form.types ?? profileOf(form.base, opts).types) : [];
  const baseKnown = hasObtained(save, form.base) || hasUnlocked(save, form.base);
  return {
    slug,
    dex,
    tag: megaTagOf(slug, opts) ?? "M",
    name: obtained ? petName(slug) : "???",
    state: obtained ? "obtained" : "locked",
    types: types.map((t) => typeName(t)),
    typeIds: [...types],
    shiny: false,
    owned: save.pets.filter((p) => p.species === form.base && p.mega?.stone === true).length,
    methods: `${baseKnown ? base : "???"}의 ${way}(메가스톤)`,
    evolution: obtained ? "더 진화하지 않아요" : "???",
    gimmick: "없음",
    megaTree: {
      slug: form.base,
      name: baseKnown ? base : "???",
      locked: !baseKnown,
      current: false,
      children: [{ slug, name: obtained ? petName(slug) : "???", locked: !obtained, current: true, need: "메가스톤", children: [] }],
    },
    ...officialText(obtained ? textOf(form.base, dex, opts) : undefined),
    ...bodySize(obtained ? textOf(form.base, dex, opts) : undefined),
  };
}

export function dexDetail(save: SaveV3, slug: string, opts?: DexOptions): DexDetail | null {
  if (megaOf(slug, opts)) return megaDetail(save, slug, opts);
  const row = profileOf(slug, opts);
  if (!row.dex) return null;
  const obtained = hasObtained(save, slug);
  const unlocked = obtained || hasUnlocked(save, slug);
  const state = obtained ? "obtained" : unlocked ? "unlocked" : "locked";

  const methods: string[] = [];
  const shopLinks: { label: string; productId: string }[] = []; // 알 이름 → 알 상품(상품 id 가 알 종류다). 해금 전 "(해금 후)" 는 잇지 않는다
  const prev = prevOf(slug, opts);
  if (prev) methods.push(`${knownName(save, prev)}에서 진화${nextOf(prev, opts).some((s) => s.to === slug && s.map) ? MAP_MARK : ""}`);
  const random = eggName("random", opts) ?? "랜덤알";
  if (inRandomEgg(slug, opts)) methods.push(unlocked ? random : `${random}(해금 후)`);
  // 모습 바꾸기로만 얻는 모습(기라티나(오리진폼)·로토무의 다섯 모습). 작업 시간 조건이 있으면 괄호로 붙인다
  const shiftForm = regionalOf(slug, opts);
  // 한 방향 모습(플라엣테(영원의 꽃)·다투곰(붉은 달), get tool)도 같다 — "플라엣테의 모습 바꾸기(영원의 꽃)"
  if (shiftForm?.get === "shift" || shiftForm?.get === "tool") methods.push(`${knownName(save, shiftForm.base)}의 모습 바꾸기${shiftNeedText(slug, opts)}${partnerText(save, slug, opts)}`);
  // 전투 중에만 바뀌는 모습(메로엣타(스텝폼)) — 기본 종을 얻으면 함께 기록된다 (2026-10-09 사용자 결정 "메로엣타를 얻으면 같이")
  if (shiftForm?.get === "battle") {
    const base = knownName(save, shiftForm.base);
    methods.push(`${base}${josa(base, "을/를")} 얻으면 함께`);
  }
  // 겉모습의 입수처 — 모습 바꾸기로 오가는 모습(아르세우스 타입)과 진화할 때 정하는 모습(비비용 무늬) (2026-10-17)
  const look = lookFormOf(slug, opts);
  if (look && shiftGroupOf(look.base, opts).includes(slug)) methods.push(`${knownName(save, look.base)}의 모습 바꾸기`);
  const lookPrev = look && evolveLookVariants(look.base, opts).some(([s]) => s === slug) ? prevOf(look.base, opts) : null;
  if (lookPrev) methods.push(`${knownName(save, lookPrev)}에서 진화`);
  // 알에서 기본형 대신 나오는 모습(배쓰나이(백색근의 모습)) — 기본 종이 나오는 알을 적는다
  const hatchBase = hatchBaseOf(slug, opts);
  if (hatchBase && inRandomEgg(hatchBase, opts)) methods.push(random);
  // 랜덤알이 "(해금 후)" 없이 적혔으면 상품으로 잇는다
  if ((unlocked && inRandomEgg(slug, opts)) || (hatchBase && inRandomEgg(hatchBase, opts))) shopLinks.push({ label: random, productId: "random" });
  for (const [kind, pool] of fixedEggs(opts)) {
    if (!pool.includes(slug)) continue;
    const name = eggName(kind, opts) ?? kind;
    methods.push(name);
    shopLinks.push({ label: name, productId: kind });
  }
  // 버드렉스의 말(블리자포스·레이스포스) — "유대의고삐로 부르기" (data/regional.json riders, 2026-10-07)
  if (riderOwnerOf(slug, opts)) {
    const reins = itemName(RIDER_ITEM, opts);
    methods.push(`${reins}${josa(reins, "으로/로")} 부르기`);
  }
  // 상점 구매 줄은 잠시 숨긴다 — 상점의 포켓몬 탭을 숨긴 동안 (2026-09-30 사용자 결정 "그 줄도 숨기자"). 탭을 다시 열면 SHOP_SPECIES_LINE 을 true 로
  const price = SHOP_SPECIES_LINE ? speciesPrice(slug, opts) : null;
  if (price != null) methods.push(unlocked ? `상점 구매 ${pointText(price)}` : `상점 구매 ${pointText(price)}(해금 후)`);
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
    shiny: hasShiny(save, slug),
    owned: save.pets.filter((p) => p.species === slug).length,
    methods: methods.length ? [...new Set(methods)].join(" · ") : NO_METHOD, // 같은 길이 둘이면 하나만(겉모습의 진화 줄)
    ...(shopLinks.length ? { shopLinks } : {}),
    evolution,
    gimmick: "없음", // 특수 기믹은 아직 없다
    ...(unlocked ? formsOfDetail(save, slug, opts) : {}),
    ...megaLine(slug, obtained, opts),
    ...shiftLine(slug, obtained, opts),
    // 미해금 종은 분류·설명을 숨긴다 — 이름을 숨기는 것과 같다. 한국어 설명문이 없는 종은 영어로 대신한다(899번부터는 data/dex-text.ko.json 으로 채워 지금은 없다)
    ...officialText(unlocked ? textOf(slug, row.dex, opts) : undefined),
    ...bodySize(unlocked ? textOf(slug, row.dex, opts) : undefined),
  };
}

// 도감 기기 창 2쪽(모습) — 기본 종과 그 다른 모습. 다른 모습이 없는 종은 없다 (2026-10-17 사용자 결정 "리전폼 빼고 다 합치기", 2026-10-18 "1페이지 2페이지 느낌")
// 기본 종은 겉모습이면 looks 의 base, 특수 폼이면 forms 의 base 다. 얻음은 도감 기록이나 지금 가진 개체의 종으로 본다(옛 저장은 겉모습을 기본 종으로만 적었다)
// 얻음·해금은 그 종의 모습 Set 으로 목록을 한 번씩만 훑어 찾는다 — 모습이 많은 종(마휘핑 63)도 칸마다 목록을 훑지 않는다 (worklog/records/update-1017/perf-review-agent1.md A4)
// 2쪽 머리 줄의 종 이름(formsTitle)은 기본 종 화면 이름의 괄호 앞이다 — 괄호를 떼는 곳은 여기 한 곳이다 (A6)
function formsOfDetail(save: SaveV3, slug: string, opts?: DexOptions): { forms?: DexFormView[]; formsTitle?: string } {
  const special = regionalOf(slug, opts);
  const base = special?.special ? special.base : dexSlugOf(slug, opts);
  const others = otherFormsOf(base, opts);
  if (!others.length) return {};
  const slugs = [base, ...others];
  const mine = new Set(slugs);
  const got = new Set<string>();
  const seen = new Set<string>();
  for (const s of save.dex.obtained) if (mine.has(s)) got.add(s);
  for (const p of save.pets) if (mine.has(p.species)) got.add(p.species);
  for (const s of save.dex.unlocked) if (mine.has(s)) seen.add(s);
  const forms = slugs.map((s) => {
    const has = got.has(s);
    // 이름 표에 없으면 화면 이름의 괄호 안(도롱충이(초목도롱) → 초목도롱), 그것도 없으면 화면 이름
    const name = petName(s);
    const label = formLabelOf(s, opts) ?? FORM_PAREN.exec(name)?.[2] ?? name;
    return { slug: s, name: has || seen.has(s) ? name : "???", label: has ? label : "???", obtained: has, current: s === slug };
  });
  const head = forms[0]?.name ?? "???";
  return { forms, formsTitle: FORM_PAREN.exec(head)?.[1] ?? head };
}
// 화면 이름의 `<종>(<모습>)` — 1 종 이름, 2 모습
const FORM_PAREN = /^(.*)\(([^)]+)\)$/;

// 입수 경로가 하나도 없을 때 — 첫 선택·진화·알·상점 어디에도 없는 종
const NO_METHOD = "획득 방법 준비 중";
const GIFT_METHOD = "이벤트 우편";
