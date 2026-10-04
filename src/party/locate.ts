// 개체의 자리 — 어느 프리셋의 몇째 칸인지, 박스의 몇째 칸인지 찾는다. 순수 함수이며 저장을 쓰지 않는다
// 프리셋의 칸 구조(적용한 프리셋은 party.slots, 나머지는 party.presets)는 ./presets.ts 가 가진다 (96 대조 ⑤, 설계 30번 party/locate.ts)
import { activePreset, allPresets } from "./presets.js";
import { petSlotIndex } from "./visibility.js";
import type { SaveV3 } from "../shared/save-v3";

// 개체의 자리 — 적용한 프리셋도 preset 이다. active 로 구분한다
export type PetPlace =
  | { kind: "preset"; preset: number; slot: number; active: boolean }
  | { kind: "box"; box: number; slot: number };

// 어느 프리셋에든 든 개체의 식별자
export function presetPetIds(save: Pick<SaveV3, "party">): Set<string> {
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
    const slot = petSlotIndex(slots, petId);
    if (slot >= 0) return { kind: "preset", preset, slot, active: preset === active };
  }
  for (let box = 0; box < save.boxes.length; box += 1) {
    const slot = save.boxes[box]!.slots.indexOf(petId);
    if (slot >= 0) return { kind: "box", box, slot };
  }
  return null;
}

// 적용한 프리셋의 칸에 있는가 — 숨겨도 참이다. 박스 개체·다른 프리셋의 개체는 거짓
export const isInParty = (save: Pick<SaveV3, "party">, petId: string): boolean =>
  petSlotIndex(save.party.slots, petId) >= 0;
