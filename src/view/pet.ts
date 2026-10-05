// 개체 하나의 화면 값 — 파티 칸·박스 칸·파티 상세가 보는 PetView(진화 후보·메가·모습·디버프·돌봄 보너스·버프). 저장을 읽기만 한다
// 스냅샷 조립은 ./snapshot.ts 가 한다 (96 대조 ④ — snapshot.ts 337줄을 나눴다, 설계 30번 view/pet.ts)
import { profileOf } from "../dex/species.js";
import { itemName, petName, typeName, boredText, natureName, t } from "./text.js";
import type { SaveV3, PetV3 } from "../shared/save-v3";
import { megaOf, megaChoices, megaFormsOf, shownSpecies } from "../dex/mega.js";
import { MEGA_RULES } from "../dex/rules.js";
import { locatePet } from "../party/locate.js";
import { sizeLevelOf } from "../party/size.js";
import { growthOf, progressTo } from "../dex/growth.js";
import { activeBuffs, boredStepOf, pointParts, pointPercent, zoneOf, type BoredStep } from "../state/time.js";
import { BOREDOM_RULES, TIME_RULES } from "../state/rules.js";
import { buffText, waitText } from "../shared/count-text.js";
import type { FullnessZone } from "../shared/save-v3.js";
import type { CareView, EvolutionView, FormView, MegaGoalView, MegaView, PetView } from "../shared/model/snapshot";
import { formsOf, isFormLocked, isShared, shiftRuleOf } from "../dex/forms.js";
import { genderLookOf, REGION_MAP } from "../dex/regional.js";
import { megaRivals } from "../party/mega-form.js";
import { checkPetFree } from "../party/pet-actions.js";
import { failTextOf } from "../shared/fail-text.js";
import { evolveCandidates, type EvoMissing } from "../dex/evolve.js";
import type { DayPart } from "../shared/species";
import { isKnownSpecies } from "../dex/record.js";
import { ceilMin, ceilSec } from "../shared/count-text.js";
import { feedBlock, playBlock } from "../state/care-block.js";

// 버프를 보이는 순서 — 든든함 · 신남. 이름은 data/i18n 의 buff.<식별자> (2026-10-05 돌봄 개편)
const BUFF_ORDER = ["premium-food", "long-play"] as const;

// 모자란 조건 → 화면 문구. 판정은 src/dex/evolve.ts 의 candidates 다
// 둘 이상이면(레벨·친밀도 지도 간선) 이름을 `·` 로 잇는다 — "Lv.36·지도 필요". 돌 대신 지도인 간선은 "지도 필요"
function missingText(m: EvoMissing): string {
  if (m.kind === "level") return `Lv.${m.level} 필요`;
  if (m.kind === "affinity") return `친밀도 ${m.value} 필요`;
  if (m.kind === "item") return `${itemName(m.item)} 필요`;
  if (m.kind === "time") return m.when === "night" ? "밤에만" : "낮에만";
  return m.gender === "female" ? "암컷만" : "수컷만";
}
function needText(lacks: readonly EvoMissing[]): string | undefined {
  if (!lacks.length) return undefined;
  if (lacks.length > 1) return `${lacks.map((m) => missingText(m).replace(/ 필요$/, "")).join("·")} 필요`;
  return missingText(lacks[0]!);
}

// 다음 한 단계의 후보 — 상세의 진화 확인 창과 가방의 진화용 도구가 같은 판정을 본다.
// 도감에서 해금 안 된 결과 종은 이름을 "???" 로 준다 — 도감 기기 창과 같이 가리고 조건만 보인다. 진화가 처음 보는 순간이다
// (2026-10-01 사용자 결정 "추천대로하자", Figma 05 `1126:23890`)
// 교환에 걸린 개체는 조건을 채워도 준비되지 않은 것으로 보이고, 까닭은 실패 문구표의 trade-locked 제목이다 (94 항목 9-5-1)
function evolutionsOf(save: SaveV3, pet: PetV3, dayPart: DayPart): EvolutionView[] {
  const known = (slug: string): boolean => isKnownSpecies(save, slug);
  const locked = !checkPetFree(save, pet.id, "evolve").ok;
  return evolveCandidates(save, pet.id, dayPart).map((c) => ({
    to: c.to,
    name: known(c.to) ? petName(c.to) : "???",
    known: known(c.to),
    // 쓰는 도구 — 돌 진화의 돌, 지도 간선의 지도. 같은 도구는 한 번만
    uses: [...new Set([...(c.need.kind === "item" ? [c.need.item] : []), ...(c.map ? [REGION_MAP] : [])])].map((id) => itemName(id)),
    types: known(c.to) ? profileOf(c.to).types.map((x) => typeName(x)) : [],
    typeIds: known(c.to) ? [...profileOf(c.to).types] : [],
    ready: c.ready && !locked,
    ...(c.ready && !locked ? {} : { need: locked && c.ready ? failTextOf("trade-locked", "trade").text : needText(c.lacks) }),
    ...(c.need.kind === "item" ? { item: c.need.item } : {}),
    ...(c.map ? { map: true as const } : {}),
  }));
}

// 고를 수 있는 종 — 공유 sid 계열은 forms(박스 칸이 단체사진과 툴팁으로 보인다).
// 모습 바꾸기 종(로토무)은 박스 칸이 지금 종 그대로라 shiftForms 에 둔다 — 모습 바꾸기 확인 창이 읽는다. 해금 전에는 없다
// 규칙이 있는 묶음(로토무)은 업적 보상 종이라 공유 계열로도 판정된다 — 그래도 박스 칸은 단체사진이 아니라 지금 종이다. 그래서 규칙을 먼저 본다
function formsView(save: SaveV3, pet: PetV3): Pick<PetView, "forms" | "shiftForms" | "formItem"> {
  const list = formsOf(pet);
  if (list.length < 2) return {};
  const views = list.map((slug) => ({ species: slug, name: petName(slug), types: profileOf(slug).types.map((t) => typeName(t)), typeIds: [...profileOf(slug).types] }));
  const rule = shiftRuleOf(pet.species);
  if (rule) return isFormLocked(pet) ? {} : { shiftForms: views, formItem: { name: itemName(rule.item), base: rule.base } };
  if (isShared(pet)) return { forms: views };
  return isFormLocked(pet) ? {} : { shiftForms: views };
}

// 모습 하나 — 이름과 타입. 메가 모습은 data/mega.json 의 타입이다
const typesOf = (slug: string): string[] => megaOf(slug)?.types ?? profileOf(slug).types;
const formView = (slug: string): FormView => ({ species: slug, name: petName(slug), types: typesOf(slug).map((x) => typeName(x)), typeIds: [...typesOf(slug)] });

// 메가스톤을 지닌 개체의 메가진화 정보. 메가 모습이 없는 종(진화해 버린 개체)이면 없다
function megaView(save: SaveV3, pet: PetV3): { mega?: MegaView } {
  const choices = megaChoices(pet);
  if (!choices.length) return {};
  const base = formView(pet.species);
  return {
    mega: {
      kind: megaOf(choices[0] as string)?.kind ?? "mega",
      on: pet.mega?.on ?? null,
      baseName: base.name,
      baseTypes: base.types,
      baseTypeIds: base.typeIds,
      forms: choices.map(formView),
      canChange: (() => { const at = locatePet(save, pet.id); return at?.kind === "preset" && at.active; })(), // 적용한 프리셋의 개체만 (94 항목 9-2-1)
      rivals: megaRivals(save, pet.id).map((p) => petName(shownSpecies(p))),
    },
  };
}

// 메가스톤 조건과 진행 — 메가진화하는 종인데 메가스톤이 아직 없는 개체만 (docs/specs/game.md "조건 말풍선")
function megaGoalView(pet: PetV3): { megaGoal?: MegaGoalView } {
  const forms = megaFormsOf(pet.species);
  if (!forms.length || pet.mega?.stone === true) return {};
  const kind = megaOf(forms[0] as string)?.kind === "primal" ? "primal" : pet.species === "rayquaza" ? "rayquaza" : "mega";
  const hour = 60 * 60_000;
  return {
    megaGoal: {
      kind,
      affinity: [Math.floor(pet.affinity), MEGA_RULES.affinity],
      level: [pet.level, MEGA_RULES.level],
      hours: [Math.floor((pet.mega?.bondMs ?? 0) / hour), MEGA_RULES.bondMs / hour],
      care: [pet.mega?.care ?? 0, MEGA_RULES.care],
    },
  };
}

// 만복도 구간 낱말 — 파티 칸·파티 상세 기기 창·포켓몬 메뉴가 같이 쓴다. 글자는 언어 파일의 zone.* 다
const zoneText = (zone: FullnessZone): string => t(`zone.${zone}`);

// 디버프 배지 — 배고픔(구간 낱말, 포인트·친밀도 증가량 감소율), 그다음 심심함(단계 말, 포인트 감소율). 색은 1단계 warning, 2단계 danger
// (docs/specs/balance.md "만복도와 돌봄"·"심심함", 2026-10-05 사용자 결정 — 심심해·지루해 배지 "그 2개도")
const DEBUFF_TONE: Partial<Record<FullnessZone | BoredStep, "warning" | "danger">> = { hungry: "warning", starving: "danger", bored: "warning", tired: "danger" };
function debuffsOf(pet: PetV3): PetView["debuffs"] {
  const out: PetView["debuffs"] = [];
  const zone = zoneOf(pet.fullness);
  const zoneTone = DEBUFF_TONE[zone];
  if (zoneTone) out.push({ label: zoneText(zone), tone: zoneTone, note: t("debuff.note", { point: TIME_RULES.zonePointPenalty[zone], percent: 100 - TIME_RULES.zonePercent[zone] }) });
  const step = BOREDOM_RULES.steps.find((s) => pet.boredom >= s.min);
  if (step) out.push({ label: boredText(step.id), tone: DEBUFF_TONE[step.id] ?? "warning", note: t("debuff.noteBored", { point: step.penalty }) });
  return out;
}

export function petView(save: SaveV3, pet: PetV3, hidden: boolean, dayPart: DayPart): PetView {
  const rate = growthOf(pet.species);
  const { percent } = progressTo(rate, pet.exp);
  const shown = formView(shownSpecies(pet)); // 메가 모습이면 그 이름·타입·그림이다. species 는 그대로다
  return {
    id: pet.id,
    species: pet.species,
    look: pet.mega?.on ? shown.species : (genderLookOf(pet.species, pet.gender) ?? shown.species), // 초상 그림 — 성별 그림이 있으면 그것 (data/regional.json 의 gender)
    name: shown.name,
    shiny: pet.shiny,
    level: pet.level,
    percentToNext: percent,
    exp: pet.exp,
    growth: rate,
    types: shown.types,
    typeIds: shown.typeIds,
    nature: natureName(pet.nature),
    natureId: pet.nature,
    gender: pet.gender,
    size: sizeLevelOf(pet.size), // 단계 번호 — 저장은 배율이다
    affinity: pet.affinity,
    fullness: pet.fullness,
    zone: zoneOf(pet.fullness),
    zoneText: zoneText(zoneOf(pet.fullness)),
    debuffs: debuffsOf(pet),
    boredom: pet.boredom,
    boredWord: boredText(boredStepOf(pet.boredom)),
    hidden,
    feedBlock: feedBlock(pet),
    feedInSec: ceilSec(pet.feedCooldownMs),
    playBlock: playBlock(pet),
    // 단추 글자 — 막는 까닭을 그대로 쓴다 (src/state/care-block.ts)
    feedText: feedBlock(pet) === "full" ? "밥 주기 · 배부름" : feedBlock(pet) === "cooldown" ? `밥 주기 · ${waitText(ceilSec(pet.feedCooldownMs))}` : "밥 주기",
    playText: playBlock(pet) ? `놀아주기 · ${waitText(ceilSec(pet.playCooldownMs))}` : "놀아주기",
    longPlay: pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0),
    // 켜진 버프 — 보이는 순서대로 이름과 남은 분. 배지가 `신남 12분` 처럼 쓴다 (2026-09-30 사용자 결정 "추천대로 진행해")
    buffs: BUFF_ORDER.filter((kind) => activeBuffs(pet.buffs).includes(kind)).flatMap((kind) => {
      const hit = pet.buffs.find((b) => b.kind === kind && b.remainMs > 0);
      return hit ? [{ kind, name: t(`buff.${kind}`), remainMin: ceilMin(hit.remainMs), text: buffText({ name: t(`buff.${kind}`), remainMin: ceilMin(hit.remainMs) }) }] : [];
    }),
    buffNames: BUFF_ORDER.filter((kind) => activeBuffs(pet.buffs).includes(kind)).map((kind) => t(`buff.${kind}`)),
    evolutions: evolutionsOf(save, pet, dayPart),
    ...formsView(save, pet),
    ...megaView(save, pet),
    ...megaGoalView(pet),
    care: careView(pet),
  };
}

// 포인트 적립 배율의 내역 — 버프(배지와 같은 순서), 그다음 배고픔·심심함 손해. 합은 바닥에서 멈춘다 (src/state/time.ts pointPercent)
// 친밀도와 상관없이 늘 있다 (2026-10-05 사용자 결정 — 돌봄 개편, 그 전의 "친밀도 100 일 때만 돌봄 보너스" 를 대신한다)
function careView(pet: PetV3): CareView {
  const nameOf = (kind: string): string =>
    kind === "hungry" || kind === "starving" ? t(`zone.${kind}`) : kind === "bored" || kind === "tired" ? boredText(kind) : t(`buff.${kind}`);
  const order: string[] = [...BUFF_ORDER, "hungry", "starving", "bored", "tired"];
  const parts = pointParts(pet)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((p) => ({ kind: p.kind, name: nameOf(p.kind), bonus: p.percent }));
  return { bonus: pointPercent(pet) - 100, parts };
}
