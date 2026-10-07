// 배틀 파티 화면 값 — 모험 탭의 배틀 칸 카드와 배틀 파티 상세 기기 창이 쓴다 (docs/specs/adventure.md)
// 저장을 읽기만 한다
import { petMoves, type MoveInfo } from "../battle/moves.js";
import { battleSlots, blockedSlots, canStartBattle } from "../battle/party.js";
import { BATTLE_RULES, type BattleTier } from "../battle/rules.js";
import { realStatsOf } from "../battle/stats.js";
import { abilityTable, speciesAbilityTable } from "../dex/tables.js";
import type { DayPart } from "../shared/species";
import type { BattleView, MoveView } from "../shared/model/snapshot";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { petView } from "./pet.js";
import { typeName } from "./text.js";

const CLASS_TEXT: Readonly<Record<MoveInfo["class"], string>> = { physical: "물리", special: "특수", status: "변화" };
const TIER_TEXT: Readonly<Record<BattleTier, string>> = { legendary: "초전설", sub: "준전설" };
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

// 출전 불가 글자
export const blockedText = (tier: BattleTier): string => `출전 불가 · ${TIER_TEXT[tier]} ${BATTLE_RULES.limits[tier]}마리까지`;

// 특성 이름 — 표에 없으면 null
function abilityName(species: string): string | null {
  const id = speciesAbilityTable()[species];
  return id ? (abilityTable()[id]?.ko ?? null) : null;
}

function statRows(pet: PetV3): { label: string; value: number }[] {
  const real = realStatsOf(pet.species);
  return real ? STAT_ORDER.map(([label, i]) => ({ label, value: real[i]! })) : [];
}

export function battleView(save: SaveV3, dayPart: DayPart): BattleView {
  const blocked = blockedSlots(save);
  const slots = battleSlots(save).map((id, index) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    if (!pet) return { index, moves: [], blocked: null, stats: [], ability: null };
    const tier = blocked[index];
    return {
      index,
      pet: petView(save, pet, false, dayPart),
      moves: petMoves(pet).map(moveView),
      blocked: tier ? blockedText(tier) : null,
      stats: statRows(pet),
      ability: abilityName(pet.species),
    };
  });
  return { slots, canStart: canStartBattle(save) };
}
