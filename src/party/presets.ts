// 파티 프리셋 — 규칙은 worklog/records/party-preset/record.md "확정 설계". 순수 함수이며 저장을 쓰지 않는다.
//
// 세 가지 규칙만 지킨다
//   1. 적용한 프리셋의 칸은 party.slots 다. 나머지 프리셋의 칸은 party.presets 에 번호 순으로 둔다
//   2. 개체의 자리는 프리셋 칸 하나 또는 박스 칸 하나다. 프리셋에 든 개체는 박스에 없다
//   3. 적용은 칸을 잠금·숨김째 맞바꾼다. 박스는 건드리지 않는다
import { SAVE_V3_RULES } from "../save/rules.js";
import type { PartySlotV3, PartyV3, SaveV3 } from "../shared/save-v3";

export type PresetFailure =
  | "no-preset" // 그런 프리셋이 없다
  | "already-active"; // 이미 적용한 프리셋이다

// 개체의 자리 — 적용한 프리셋도 preset 이다. active 로 구분한다
export type PetPlace =
  | { kind: "preset"; preset: number; slot: number; active: boolean }
  | { kind: "box"; box: number; slot: number };

type Party = { party: PartyV3 };

export const presetCount = (save: Party): number => save.party.presetCount ?? SAVE_V3_RULES.party.presets.start;
export const activePreset = (save: Party): number => save.party.active ?? 0;

// 번호로 프리셋의 칸을 얻는다. 적용한 번호면 party.slots 다. 없는 번호면 null
export function slotsOfPreset(save: Party, index: number): PartySlotV3[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= presetCount(save)) return null;
  if (index === activePreset(save)) return save.party.slots;
  return save.party.presets?.[index] ?? null;
}

// 모든 프리셋의 칸 — 번호 순
export function allPresets(save: Party): { preset: number; slots: PartySlotV3[] }[] {
  const out: { preset: number; slots: PartySlotV3[] }[] = [];
  for (let i = 0; i < presetCount(save); i += 1) {
    const slots = slotsOfPreset(save, i);
    if (slots) out.push({ preset: i, slots });
  }
  return out;
}

// 어느 프리셋에든 든 개체의 식별자
export function presetPetIds(save: Party): Set<string> {
  const ids = new Set<string>();
  for (const { slots } of allPresets(save)) {
    for (const s of slots) if (s.state === "pokemon" && s.petId) ids.add(s.petId);
  }
  return ids;
}

// 개체의 자리를 찾는다. 프리셋을 먼저 보고 박스를 본다. 어디에도 없으면 null
export function locatePet(save: Pick<SaveV3, "party" | "boxes">, petId: string): PetPlace | null {
  const active = activePreset(save);
  for (const { preset, slots } of allPresets(save)) {
    const slot = slots.findIndex((s) => s.state === "pokemon" && s.petId === petId);
    if (slot >= 0) return { kind: "preset", preset, slot, active: preset === active };
  }
  for (let box = 0; box < save.boxes.length; box += 1) {
    const slot = save.boxes[box]!.slots.indexOf(petId);
    if (slot >= 0) return { kind: "box", box, slot };
  }
  return null;
}

// 가진 프리셋 수와 열린 칸 수를 다시 적는다. 칸을 열거나 프리셋을 더한 뒤, 그리고 읽을 때 부른다
export function countParty(save: Party): void {
  const presets = allPresets(save);
  save.party.presetCount = presetCount(save);
  save.party.slotCount = presets.reduce((n, p) => n + p.slots.filter((s) => s.state !== "locked").length, 0);
}

// 프리셋을 적용한다 — party.slots 와 그 프리셋의 칸을 통째로 맞바꾼다
export function applyPreset(save: Party, index: number): { ok: boolean; reason?: PresetFailure } {
  const target = slotsOfPreset(save, index);
  if (!target) return { ok: false, reason: "no-preset" };
  const from = activePreset(save);
  if (index === from) return { ok: false, reason: "already-active" };

  const presets = save.party.presets ?? [];
  presets[from] = save.party.slots;
  presets[index] = null;
  save.party.presets = presets;
  save.party.slots = target;
  save.party.active = index;
  return { ok: true };
}
