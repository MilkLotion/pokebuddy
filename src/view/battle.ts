// 배틀 파티 화면 값 — 모험 탭의 배틀 칸 카드와 배틀 파티 상세 기기 창이 쓴다 (docs/specs/adventure.md)
// 저장을 읽기만 한다
import { fixedMoveOf, moveOptions, petMoves, speciesMoves, type MoveInfo } from "../battle/moves.js";
import { battleGate, battleMegaOf, battleSlots, battleSpeciesOf, blockedSlots, canStartBattle } from "../battle/party.js";
import { AURA_ABILITY, ENGINE_RULES, FIELD_ABILITY, WEATHER_ABILITY } from "../battle/engine.js";
import { rouletteTickets } from "../battle/fighter-core.js";
import { BATTLE_RULES, type BattleTier } from "../battle/rules.js";
import { baseStatsOf } from "../battle/stats.js";
import { tierOf } from "../battle/tier.js";
import { abilityTable, genderBattleTable, megaBattleTable, speciesAbilityTable } from "../dex/tables.js";
import { megaChoices } from "../dex/mega.js";
import { profileOf } from "../dex/species.js";
import { STATUS_NAME } from "../shared/battle-timeline.js";
import type { BattleDeviceSlot } from "../shared/model/devices.js";
import type { DayPart } from "../shared/species";
import type { BattleView, MoveDetail, MoveView, PetView } from "../shared/model/snapshot";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { petView } from "./pet.js";
import { petName, petNameParts, typeName } from "./text.js";

const CLASS_TEXT: Readonly<Record<MoveInfo["class"], string>> = { physical: "물리", special: "특수", status: "변화" };
// legend 는 초전설·준전설 합 — `전설급 3마리까지` (2026-10-22 사용자 결정, worklog/records/update-1022/update-1022-range-party.md)
const TIER_TEXT: Readonly<Record<BattleTier, string>> = { legendary: "초전설", legend: "전설급", mega: "메가진화" };
// 방사형 그래프의 꼭짓점 순서 — 위에서 시계 방향. 값은 저장 순서 [HP, 공격, 방어, 특수공격, 특수방어, 스피드] 의 번호다
const STAT_ORDER: readonly [string, number][] = [["HP", 0], ["공격", 1], ["방어", 2], ["스피드", 5], ["특수방어", 4], ["특수공격", 3]];

// 분류·위력·명중·쿨타임 한 줄 — 변화기는 위력을 두지 않는다. 명중이 없으면 반드시 맞는다
export function moveMeta(m: MoveInfo): string {
  const parts = [CLASS_TEXT[m.class]];
  if (m.power != null) parts.push(`위력 ${m.power}`);
  parts.push(m.accuracy == null ? "반드시 맞음" : `명중 ${m.accuracy}`);
  if (m.cooldown != null) parts.push(`쿨타임 ${m.cooldown}초`);
  return parts.join(" · ");
}

export const moveView = (m: MoveInfo): MoveView => ({ id: m.id, name: m.name, typeId: m.type, typeName: typeName(m.type), meta: moveMeta(m), text: m.text });

const STAT_NAME: Readonly<Record<string, string>> = { atk: "공격", def: "방어", spa: "특수공격", spd: "특수방어", spe: "스피드" };

// 날씨로 충전이 없어지는 기술 — 엔진 doMove 의 `instant` 와 같다(쾌청·끝의대지에서 솔라빔·솔라블레이드, 비·시작의바다에서 일렉트로빔). 값을 바꾸면 엔진도 같이 고친다
const NO_CHARGE_WEATHER: Readonly<Record<string, string>> = { "solar-beam": "쾌청이면", "solar-blade": "쾌청이면", "electro-shot": "비가 오면" };

// 효과 줄 — 문구는 docs/specs/moves.md "부담과 효과"·"능력 변화"(10초)·"급소"·"연속기" 를 따른다
//   자기 타입 위력 줄은 두지 않는다(2026-10-10 사용자 "\"· 자기 타입 기술이라 위력 1.5배\" 제거")
export function moveEffects(m: MoveInfo): string[] {
  const out: string[] = [];
  const e = m.effects ?? {};
  if (m.hits) out.push(m.hits[0] === m.hits[1] ? `${m.hits[0]}번 맞음` : `${m.hits[0]}~${m.hits[1]}번 맞음`);
  if (m.priority) out.push("선공 기술 — 쿨타임이 짧고, 같이 차면 먼저 나감");
  if (e.charge) {
    const sky = NO_CHARGE_WEATHER[m.id];
    out.push(sky ? `처음 쿨타임이 차면 충전하고, 다시 차면 공격 (${sky} 충전 없이 바로 공격)` : "처음 쿨타임이 차면 충전하고, 다시 차면 공격");
  }
  if (e.status) {
    const kinds = ([] as string[]).concat(e.status.kind).map((k) => STATUS_NAME[k as keyof typeof STATUS_NAME] ?? k);
    const what = kinds.length > 1 ? `${kinds.join("·")} 중 하나로` : kinds[0]!;
    out.push(e.status.chance >= 100 ? `맞히면 상대를 ${what}` : `${e.status.chance}% 확률로 상대를 ${what}`);
  }
  if (e.flinch) out.push(`${e.flinch}% 확률로 상대 풀죽음`);
  // 능력 변화 — 대상·확률·단계가 같은 것끼리 한 줄
  const groups = new Map<string, string[]>();
  for (const x of e.stats ?? []) {
    const key = `${x.who}|${x.chance}|${x.change}`;
    groups.set(key, [...(groups.get(key) ?? []), STAT_NAME[x.stat] ?? x.stat]);
  }
  for (const [key, names] of groups) {
    const [who, chance, change] = key.split("|") as [string, string, string];
    const n = Number(change);
    const when = Number(chance) >= 100 ? (who === "self" ? "쓴 뒤 " : "맞히면 ") : `${chance}% 확률로 `;
    out.push(`${when}${who === "self" ? "자기" : "상대"} ${names.join("·")} ${Math.abs(n)}단계 ${n > 0 ? "상승" : "하락"} (10초)`);
  }
  if (e.recoil) out.push(`준 피해의 ${e.recoil}% 를 자신도 받음`);
  if (e.drain) out.push(`준 피해의 ${e.drain}% 만큼 회복`);
  if (e.halfHp) out.push("쓰면 자기 최대 HP 의 절반을 잃음");
  if (e.crit === "high") out.push("급소에 잘 맞음");
  if (e.crit === "always") out.push("반드시 급소에 맞음");
  if (e.recharge) out.push("쓴 뒤 다음 기술 쿨타임 2배");
  if (e.rampage) out.push("쓴 뒤 2초 동안 행동하지 못함");
  if (e.hpScale) out.push("HP 가 줄수록 위력이 약해짐");
  // 킹실드 — 엔진의 막기(src/battle/engine.ts shieldMs). 효과 값이 아니라 기술 id 로 건다 (2026-10-14 사용자 "효과막는다 문구 추가")
  if (m.id === "kings-shield") {
    out.push(`쓴 뒤 ${ENGINE_RULES.shieldMs / 1000}초 동안 상대 기술을 막음 (평타는 못 막음)`);
    out.push(`막은 기술이 접촉이면 상대 공격 1단계 하락 (${ENGINE_RULES.stageMs / 1000}초)`);
  }
  return out;
}

// 기술 상세 — 기술 바꾸기 모달 오른쪽 아래 칸
export function moveDetail(m: MoveInfo): MoveDetail {
  // 사거리는 칸으로 정해 기술 상세에 적지 않는다 (2026-10-22 사용자 "시안대로 진행", 그 전에는 물리 근접·특수 원거리)
  const kind = [CLASS_TEXT[m.class], m.traits?.includes("contact") ? "접촉" : null].filter((x): x is string => !!x).join(" · ");
  const stats: MoveDetail["stats"] = [];
  if (m.power != null) stats.push({ label: "위력", value: String(m.power) });
  stats.push({ label: "명중", value: m.accuracy == null ? "반드시" : String(m.accuracy) });
  if (m.cooldown != null) stats.push({ label: "쿨타임", value: `${m.cooldown}초` });
  return { kind, stats, effects: moveEffects(m) };
}

// 출전 불가 글자
export const blockedText = (tier: BattleTier): string => `출전 불가 · ${TIER_TEXT[tier]} ${BATTLE_RULES.limits[tier]}마리까지`;

// 특성 id — 메가 모습이면 data/mega-battle.json. 표에 없으면 null
const abilityIdOf = (species: string): string | null => megaBattleTable()[species]?.ability ?? speciesAbilityTable()[species] ?? null;

// 날씨·필드·오라 룰렛에 드는 특성이면 그 룰렛 이름. 엔진의 룰렛 표로 판정한다(abilities.json 의 group 은 위협·재앙 특성도 `전장` 이라 쓰지 않는다)
// 설명 끝에 그 개체의 룰렛 칸 수를 붙인다 (docs/specs/moves.md "날씨, 필드, 오라")
const rouletteOf = (ability: string): string | null => (ability in WEATHER_ABILITY ? "날씨" : ability in FIELD_ABILITY ? "필드" : ability in AURA_ABILITY ? "오라" : null);

// 특성 이름과 화면 설명. 표에 없으면 null. shown 은 싸우는 모습(메가 포함), base 는 그 기본 종
// femaleAbility — 성별 능력치가 있는 종의 암컷 특성(data/gender-battle.json). 있으면 종의 특성 대신 쓴다
function abilityOf(shown: string, base: string, femaleAbility?: string): { name: string; text: string } | null {
  const id = femaleAbility ?? abilityIdOf(shown);
  const row = id ? abilityTable()[id] : undefined;
  if (!row) return null;
  const reel = rouletteOf(id!);
  const tickets = rouletteTickets(shown !== base, !!tierOf(base));
  return { name: row.ko, text: reel ? `${row.text} (${reel}우선도+${tickets})` : row.text };
}

// shown — 배틀에서 싸우는 모습. 메가를 켰으면 그 메가 모습, 아니면 기본 종
// 방사형 그래프는 종족값을 보인다. 배틀 계산은 이 값이 아니라 50레벨 실제 능력치다 (2026-10-12 사용자 "저 방사형에 보이는건 종족값으로 보이고, 실제 내부 배틀계산은 50기준으로하자")
// femaleStats — 성별 능력치가 있는 종의 암컷 종족값. 있으면 종의 종족값 대신 쓴다
function statRows(shown: string, femaleStats?: readonly number[]): { label: string; value: number }[] {
  const base = femaleStats ?? baseStatsOf(shown);
  return base ? STAT_ORDER.map(([label, i]) => ({ label, value: base[i]! })) : [];
}

// 배틀에서 보이는 개체 — 배틀 파티의 메가 상태로 이름·타입·초상을 바꾼다. 프리셋의 메가 모습은 쓰지 않는다.
// 메가진화 창(renderer/manage/pet-forms.ts drawMega)이 읽는 mega 도 배틀 기준이다 — 늘 바꿀 수 있다
function battlePetView(save: SaveV3, pet: PetV3, form: string | null, dayPart: DayPart): PetView {
  const asShown: PetV3 = pet.mega ? { ...pet, mega: { ...pet.mega, ...(form ? { on: form } : {}) } } : { ...pet };
  if (asShown.mega && !form) delete asShown.mega.on;
  delete asShown.battleLook; // 전투 중 모습 보이기는 일상 파티에만 — 모험은 기본 모습이다 (src/dex/battle-look.ts)
  const view = petView(save, asShown, false, dayPart);
  return view.mega ? { ...view, mega: { ...view.mega, on: form, canChange: true } } : view;
}

export function battleView(save: SaveV3, dayPart: DayPart): BattleView {
  const blocked = blockedSlots(save);
  const slots = battleSlots(save).map((id, index) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    if (!pet) return { index, moves: [], blocked: null, stats: [], ability: null };
    const tier = blocked[index];
    // 칸에 들어올 때 적은 모습 바꾸기 종으로 본다(로토무 등) — 그 뒤 파티의 모습 바꾸기와 따로다
    const asPet: PetV3 = { ...pet, species: battleSpeciesOf(save, pet) };
    const form = battleMegaOf(save, pet.id);
    const shown = form ?? asPet.species;
    const view = battlePetView(save, asPet, form, dayPart);
    // 암컷 능력치·특성 — 엔진과 같은 조건(성별이 암컷이고 메가가 아닐 때, src/battle/fighter-core.ts fighterFrom)
    const female = pet.gender === "female" && !form ? genderBattleTable()[asPet.species] : undefined;
    const withDetail = (m: MoveInfo): MoveView => ({ ...moveView(m), detail: moveDetail(m) });
    return {
      index,
      pet: view,
      // 메가 모습은 다른 포켓몬처럼 자기 기술 줄을 쓴다 — 기술 바꾸기 모달도 그 모습의 6개를 보인다 (2026-10-22 사용자 "보만다랑 메가보만다랑 다른포켓몬 취급")
      moves: petMoves(asPet, undefined, form).map(withDetail),
      options: moveOptions(asPet.species, undefined, form).map(withDetail),
      ...(fixedMoveOf(asPet.species) ? { fixedFirst: true as const } : {}),
      blocked: tier ? blockedText(tier) : null,
      stats: statRows(shown, female?.stats),
      ability: abilityOf(shown, asPet.species, female?.ability),
    };
  });
  return { slots, canStart: canStartBattle(save), gate: battleGate(save) };
}

// 배틀 종 보기 — 배틀 파티 밖의 종(도감) 또는 개체(파티·박스)를 배틀 기준으로 본다 (docs/specs/adventure.md "종 보기", 2026-10-18 사용자 시안 확정)
// - 개체면 그 개체의 고른 기술 순서·암컷 능력치·이로치 초상. 종이면 종의 기본 기술 2개, 성별 없음
// - 배틀 파티 모습(battle.form)은 쓰지 않는다 — 배틀 파티에 들어올 때 정하는 값이다. 개체의 지금 종으로 본다
// - 개체가 일상 파티에서 메가 모습을 켰으면(mega.on) 그 메가 모습의 능력치·특성·기술·이름·초상이다 — 파티 탭과 같은 모습
//   (2026-10-22 사용자 "파티에선 메가몬인데, 도감/배틀은 메가몬이 아니야". 그 전에는 메가를 쓰지 않았다)
// - 표에 없는 종이거나 개체가 없으면 null
export function battleSpeciesSlot(save: SaveV3, species: string, petId: string | null, dayPart: DayPart): { slot: BattleDeviceSlot; look: string } | null {
  const pet = petId ? save.pets.find((p) => p.id === petId) : undefined;
  if (petId && !pet) return null;
  const slug = pet ? pet.species : species;
  if (!baseStatsOf(slug)) return null;
  const withDetail = (m: MoveInfo): MoveView => ({ ...moveView(m), detail: moveDetail(m) });
  const on = pet?.mega?.on;
  const form = pet && on && megaChoices(pet).includes(on) ? on : null;
  const shown = form ?? slug;
  // 암컷 능력치는 메가가 아닐 때만 — 배틀 파티 칸(battleView)과 같다
  const female = pet?.gender === "female" && !form ? genderBattleTable()[slug] : undefined;
  const base = { index: -1, moves: (pet ? petMoves(pet, undefined, form) : speciesMoves(slug)).map(withDetail), blocked: null, stats: statRows(shown, female?.stats), ability: abilityOf(shown, slug, female?.ability), ...(fixedMoveOf(slug) ? { fixedFirst: true as const } : {}) };
  if (pet) {
    const v = battlePetView(save, pet, form, dayPart);
    const { id, name, nameParts, gender, shiny, types, typeIds } = v;
    return { slot: { ...base, pet: { id, species: slug, name, nameParts, gender, shiny, types, typeIds } }, look: shown };
  }
  const typeIds = [...profileOf(slug).types];
  return { slot: { ...base, pet: { id: "", species: slug, name: petName(slug), nameParts: petNameParts(slug), gender: "none", shiny: false, types: typeIds.map((t) => typeName(t)), typeIds } }, look: slug };
}
