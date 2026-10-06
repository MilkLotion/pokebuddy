// 파티 프리셋 — 규칙은 worklog/records/party-preset/party-preset.md "확정 설계". 순수 함수이며 저장을 쓰지 않는다.
//
// 세 가지 규칙만 지킨다
//   1. 적용한 프리셋의 칸은 party.slots 다. 나머지 프리셋의 칸은 party.presets 에 번호 순으로 둔다
//   2. 개체의 자리는 프리셋 칸 하나 또는 박스 칸 하나다. 프리셋에 든 개체는 박스에 없다
//   3. 적용은 칸을 잠금째 맞바꾼다. 새로 적용한 프리셋의 숨김은 모두 푼다 (2026-10-05 사용자 결정). 박스는 건드리지 않는다
import { BOX_RULES } from "../box/rules.js";
import { PARTY_RULES } from "./rules.js";
import type { PartySlotV3, PartyV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type PresetFailure = ReasonOf<
  | "no-preset" // 그런 프리셋이 없다
  | "already-active" // 이미 적용한 프리셋이다
  | "preset-max" // 프리셋을 더 가질 수 없다
  | "slots-not-full" // 가진 프리셋의 칸을 모두 열지 않았다
>;

type Party = { party: PartyV3 };

export const presetCount = (save: Party): number => save.party.presetCount ?? PARTY_RULES.presets.start;
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

// 가진 프리셋 수와 열린 칸 수를 다시 적는다. 칸을 열거나 프리셋을 더한 뒤, 그리고 읽을 때 부른다
export function countParty(save: Party): void {
  const presets = allPresets(save);
  save.party.presetCount = presetCount(save);
  save.party.slotCount = presets.reduce((n, p) => n + p.slots.filter((s) => s.state !== "locked").length, 0);
}

// 프리셋의 이름 — 정하지 않았으면 "프리셋 N"
export const defaultPresetName = (index: number): string => `프리셋 ${index + 1}`;
export const presetName = (save: Party, index: number): string => save.party.presetNames?.[index] || defaultPresetName(index);

// 이름 바꾸기 — 앞뒤 공백을 떼고 nameMax 자로 자른다. 비우면 기본 이름으로 돌아간다. 박스 이름과 같은 규칙이다
export function renamePreset(save: Party, index: number, name: string): Outcome<PresetFailure> & { name?: string } {
  if (!slotsOfPreset(save, index)) return { ok: false, reason: "no-preset" };
  const next = [...name.trim()].slice(0, BOX_RULES.nameMax).join("");
  const names = Array.from({ length: presetCount(save) }, (_, i) => save.party.presetNames?.[i] ?? "");
  names[index] = next === defaultPresetName(index) ? "" : next;
  save.party.presetNames = names;
  return { ok: true, name: presetName(save, index) };
}

// 적용한 프리셋에서 상점으로 여는 칸 — 남은 수와 전체 수. 첫 프리셋은 shopUnlock 칸, 나머지는 잠긴 칸 전부다
export function shopSlots(save: Party): { left: number; total: number; bought: number } {
  const { total: all, openAtStart, shopUnlock } = PARTY_RULES;
  const total = activePreset(save) === 0 ? shopUnlock : all - openAtStart;
  const left = save.party.slots.filter((s) => s.state === "locked" && s.unlockBy === "shop").length;
  return { left, total, bought: Math.max(0, total - left) };
}

// 프리셋을 하나 더 살 수 있는가 — 가진 프리셋의 칸을 모두 열어야 한다 (2개면 12칸, 3개면 18칸)
export function presetBuyable(save: Party): Outcome<PresetFailure> & { open: number; need: number } {
  const count = presetCount(save);
  const need = count * PARTY_RULES.total;
  const open = allPresets(save).reduce((n, p) => n + p.slots.filter((s) => s.state !== "locked").length, 0);
  if (count >= PARTY_RULES.presets.max) return { ok: false, reason: "preset-max", open, need };
  if (open < need) return { ok: false, reason: "slots-not-full", open, need };
  return { ok: true, open, need };
}

// 프리셋을 하나 더한다 — 새 프리셋의 칸은 부르는 쪽이 준다 (src/party/slots.ts presetSlots). 새 번호를 돌려준다
export function addPreset(save: Party, slots: PartySlotV3[]): number {
  const index = presetCount(save);
  const presets = save.party.presets ?? [];
  presets[index] = slots;
  for (let i = 0; i < index; i += 1) if (presets[i] === undefined) presets[i] = null;
  save.party.presets = presets;
  save.party.presetCount = index + 1;
  countParty(save);
  return index;
}

// 프리셋을 적용한다 — party.slots 와 그 프리셋의 칸을 통째로 맞바꾼다. 들어온 칸의 숨김은 푼다
export function applyPreset(save: Party, index: number): Outcome<PresetFailure> {
  const target = slotsOfPreset(save, index);
  if (!target) return { ok: false, reason: "no-preset" };
  const from = activePreset(save);
  if (index === from) return { ok: false, reason: "already-active" };

  const presets = save.party.presets ?? [];
  presets[from] = save.party.slots;
  presets[index] = null;
  save.party.presets = presets;
  for (const s of target) if (s.state === "pokemon") s.hidden = false;
  save.party.slots = target;
  save.party.active = index;
  return { ok: true };
}
