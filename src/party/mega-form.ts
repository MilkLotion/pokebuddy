// 메가 모습 켜기·끄기와 풀기 — 적용한 프리셋에 든 개체만 켠다. 한 프리셋에 메가 모습은 한 마리다 (규칙은 src/dex/mega.ts 머리말, docs/specs/game.md "메가진화는 적용한 프리셋의 칸에 든 개체만 한다")
// 모습 표와 메가스톤 조건은 도감(src/dex/mega.ts)이 가진다. 여기는 개체가 어느 프리셋에 있는지를 본다
import type { DexOptions } from "../dex/data";
import { megaChoices, megaFormsOf, megaFree, megaOf } from "../dex/mega.js";
import { activePreset, allPresets, presetPetIds } from "./presets.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

// 개체가 든 프리셋의 칸들. 박스 개체면 null
function presetMatesOf(save: SaveV3, petId: string): { preset: number; petIds: string[] } | null {
  for (const { preset, slots } of allPresets(save)) {
    const ids = slots.filter((s) => s.state === "pokemon" && s.petId).map((s) => s.petId as string);
    if (ids.includes(petId)) return { preset, petIds: ids };
  }
  return null;
}

export type MegaFailure = ReasonOf<"no-pet" | "no-stone" | "bad-form" | "not-in-party" | "already">;

export type MegaResult = Outcome<MegaFailure> & {
  petId?: string;
  on?: string | null; // 바뀐 뒤의 모습. null 이면 기본 모습
  reverted?: string[]; // 같은 프리셋에서 기본 모습으로 돌아간 개체
};

// 메가 모습을 켜거나 끈다 — form 이 null 이면 기본 모습으로 돌아간다
export function setMega(save: SaveV3, petId: string, form: unknown, opts?: DexOptions): MegaResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (form == null) {
    if (!pet.mega?.on) return { ok: false, reason: "already" };
    delete pet.mega.on;
    return { ok: true, petId, on: null, reverted: [] };
  }
  if (pet.mega?.stone !== true) return { ok: false, reason: "no-stone" };
  if (typeof form !== "string" || !megaChoices(pet, opts).includes(form)) return { ok: false, reason: "bad-form" };
  if (pet.mega.on === form) return { ok: false, reason: "already" };
  const place = presetMatesOf(save, petId);
  // 적용하지 않은 프리셋의 개체는 켜지 못한다 — 박스 개체와 같은 거절이다 (94 항목 9-2-1)
  if (!place || place.preset !== activePreset(save)) return { ok: false, reason: "not-in-party" };
  const reverted: string[] = [];
  // 제한에서 빠지는 모습은 다른 개체를 풀지 않는다. 다른 개체의 제한 밖 모습도 풀지 않는다
  if (!megaFree(form, opts)) {
    for (const other of save.pets) {
      if (other.id === petId || !other.mega?.on || megaFree(other.mega.on, opts) || !place.petIds.includes(other.id)) continue;
      delete other.mega.on;
      reverted.push(other.id);
    }
  }
  pet.mega.on = form;
  return { ok: true, petId, on: form, reverted };
}

// 같은 프리셋에서 지금 메가 모습인 다른 개체 — 확인 창이 "원래 모습으로 돌아가요" 줄에 쓴다
export function megaRivals(save: SaveV3, petId: string, opts?: DexOptions): PetV3[] {
  const place = presetMatesOf(save, petId);
  const pet = save.pets.find((p) => p.id === petId);
  // 이 개체의 모습이 제한 밖이면 아무도 풀리지 않는다. 한 종의 모습은 모두 같은 쪽이다
  if (!place || !pet || megaFree(megaFormsOf(pet.species, opts)[0], opts)) return [];
  return save.pets.filter((p) => p.id !== petId && p.mega?.on && !megaFree(p.mega.on, opts) && place.petIds.includes(p.id));
}

// 규칙에 맞지 않는 메가 모습을 푼다 — 거래 실행기가 명령마다 한 번 부른다
//   프리셋에 들지 않은 개체(박스), 종이 바뀌어 모습의 기본 종이 지금 종과 다른 개체, 메가스톤이 없는 개체
export function settleMega(save: SaveV3, opts?: DexOptions): string[] {
  const inPreset = presetPetIds(save);
  const reverted: string[] = [];
  for (const pet of save.pets) {
    const on = pet.mega?.on;
    if (!on) continue;
    if (inPreset.has(pet.id) && pet.mega?.stone === true && megaOf(on, opts)?.base === pet.species) continue;
    delete pet.mega!.on;
    reverted.push(pet.id);
  }
  return reverted;
}
