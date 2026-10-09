// 배틀 파티 화면 값 — 모험 탭의 배틀 칸 카드와 배틀 파티 상세 기기 창이 쓴다 (docs/specs/adventure.md)
// 저장을 읽기만 한다
import { moveOptions, petMoves, type MoveInfo } from "../battle/moves.js";
import { battleMegaOf, battleSlots, battleSpeciesOf, blockedSlots, canStartBattle } from "../battle/party.js";
import { BATTLE_RULES, type BattleTier } from "../battle/rules.js";
import { realStatsOf } from "../battle/stats.js";
import { abilityTable, megaBattleTable, speciesAbilityTable } from "../dex/tables.js";
import { STATUS_NAME } from "../shared/battle-timeline.js";
import type { DayPart } from "../shared/species";
import type { BattleView, MoveDetail, MoveView, PetView } from "../shared/model/snapshot";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { petView } from "./pet.js";
import { typeName } from "./text.js";

const CLASS_TEXT: Readonly<Record<MoveInfo["class"], string>> = { physical: "물리", special: "특수", status: "변화" };
const TIER_TEXT: Readonly<Record<BattleTier, string>> = { legendary: "초전설", sub: "준전설", mega: "메가진화" };
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
const RANGE_TEXT: Readonly<Record<MoveInfo["class"], string | null>> = { physical: "근접", special: "원거리", status: null };

// 효과 줄 — 문구는 docs/specs/moves.md "부담과 효과"·"능력 변화"(10초)·"급소"·"연속기" 를 따른다
//   types·abilityId — 배틀에서 싸우는 모습의 타입과 특성. 자기 타입이면 위력 1.5배(적응력은 2배)
export function moveEffects(m: MoveInfo, types: readonly string[], abilityId: string | null): string[] {
  const out: string[] = [];
  const e = m.effects ?? {};
  if (m.class !== "status" && types.includes(m.type)) out.push(`자기 타입 기술이라 위력 ${abilityId === "adaptability" ? 2 : 1.5}배`);
  if (m.hits) out.push(m.hits[0] === m.hits[1] ? `${m.hits[0]}번 맞음` : `${m.hits[0]}~${m.hits[1]}번 맞음`);
  if (m.priority) out.push("선공 기술 — 쿨타임이 짧고, 같이 차면 먼저 나감");
  if (e.charge) out.push("처음 쿨타임이 차면 충전하고, 다시 차면 공격");
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
  return out;
}

// 기술 상세 — 기술 바꾸기 모달 오른쪽 아래 칸
export function moveDetail(m: MoveInfo, types: readonly string[], abilityId: string | null): MoveDetail {
  const kind = [CLASS_TEXT[m.class], RANGE_TEXT[m.class], m.traits?.includes("contact") ? "접촉" : null].filter((x): x is string => !!x).join(" · ");
  const stats: MoveDetail["stats"] = [];
  if (m.power != null) stats.push({ label: "위력", value: String(m.power) });
  stats.push({ label: "명중", value: m.accuracy == null ? "반드시" : String(m.accuracy) });
  if (m.cooldown != null) stats.push({ label: "쿨타임", value: `${m.cooldown}초` });
  return { kind, stats, effects: moveEffects(m, types, abilityId) };
}

// 출전 불가 글자
export const blockedText = (tier: BattleTier): string => `출전 불가 · ${TIER_TEXT[tier]} ${BATTLE_RULES.limits[tier]}마리까지`;

// 특성 id — 메가 모습이면 data/mega-battle.json. 표에 없으면 null
const abilityIdOf = (species: string): string | null => megaBattleTable()[species]?.ability ?? speciesAbilityTable()[species] ?? null;

// 특성 이름과 화면 설명. 표에 없으면 null
function abilityOf(species: string): { name: string; text: string } | null {
  const id = abilityIdOf(species);
  const row = id ? abilityTable()[id] : undefined;
  return row ? { name: row.ko, text: row.text } : null;
}

// shown — 배틀에서 싸우는 모습. 메가를 켰으면 그 메가 모습, 아니면 기본 종
function statRows(shown: string): { label: string; value: number }[] {
  const real = realStatsOf(shown);
  return real ? STAT_ORDER.map(([label, i]) => ({ label, value: real[i]! })) : [];
}

// 배틀에서 보이는 개체 — 배틀 파티의 메가 상태로 이름·타입·초상을 바꾼다. 프리셋의 메가 모습은 쓰지 않는다.
// 메가진화 창(renderer/manage/pet-forms.ts drawMega)이 읽는 mega 도 배틀 기준이다 — 늘 바꿀 수 있고, 다른 개체를 끄지 않아 rivals 는 비운다
function battlePetView(save: SaveV3, pet: PetV3, form: string | null, dayPart: DayPart): PetView {
  const asShown: PetV3 = pet.mega ? { ...pet, mega: { ...pet.mega, ...(form ? { on: form } : {}) } } : pet;
  if (asShown.mega && !form) delete asShown.mega.on;
  const view = petView(save, asShown, false, dayPart);
  return view.mega ? { ...view, mega: { ...view.mega, on: form, canChange: true, rivals: [] } } : view;
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
    const abilityId = abilityIdOf(shown);
    const withDetail = (m: MoveInfo): MoveView => ({ ...moveView(m), detail: moveDetail(m, view.typeIds, abilityId) });
    return {
      index,
      pet: view,
      moves: petMoves(asPet).map(withDetail),
      options: moveOptions(asPet.species).map(withDetail),
      blocked: tier ? blockedText(tier) : null,
      stats: statRows(shown),
      ability: abilityOf(shown),
    };
  });
  return { slots, canStart: canStartBattle(save) };
}
