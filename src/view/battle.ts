// 배틀 파티 화면 값 — 모험 탭의 배틀 칸 카드와 배틀 파티 상세 기기 창이 쓴다 (docs/specs/adventure.md)
// 저장을 읽기만 한다
import { moveOptions, petMoves, type MoveInfo } from "../battle/moves.js";
import { battleMegaOf, battleSlots, battleSpeciesOf, blockedSlots, canStartBattle } from "../battle/party.js";
import { BATTLE_RULES, type BattleTier } from "../battle/rules.js";
import { realStatsOf } from "../battle/stats.js";
import { abilityTable, megaBattleTable, speciesAbilityTable } from "../dex/tables.js";
import type { DayPart } from "../shared/species";
import type { BattleView, MoveView, PetView } from "../shared/model/snapshot";
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

// 출전 불가 글자
export const blockedText = (tier: BattleTier): string => `출전 불가 · ${TIER_TEXT[tier]} ${BATTLE_RULES.limits[tier]}마리까지`;

// 특성 이름과 화면 설명 — 메가 모습이면 data/mega-battle.json. 표에 없으면 null
function abilityOf(species: string): { name: string; text: string } | null {
  const id = megaBattleTable()[species]?.ability ?? speciesAbilityTable()[species];
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
    return {
      index,
      pet: battlePetView(save, asPet, form, dayPart),
      moves: petMoves(asPet).map(moveView),
      options: moveOptions(asPet.species).map(moveView),
      blocked: tier ? blockedText(tier) : null,
      stats: statRows(shown),
      ability: abilityOf(shown),
    };
  });
  return { slots, canStart: canStartBattle(save) };
}
