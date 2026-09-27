// 박스와 파티 사이의 배치·교체·보관 — 규칙은 docs/specs/game.md "개체 획득과 파티 교체".
//
// 세 가지 규칙만 지킨다
//   1. 박스에서 파티로 들어온 개체는 꺼낸 상태로 시작한다. 교체로 들어와도 같다
//   2. 교체는 한 번에 맞바꾼다. 먼저 빈 칸을 만드는 조작을 요구하지 않는다
//   3. 개체의 값은 그대로 둔다. 칸의 이전 개체 값을 새 개체에 복사하지 않는다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { findPet, putPet, takePet } from "../box/slots.js";
import type { SaveV3 } from "../shared/save-v3";

export type PlacementFailure =
  | "no-pet" // 그런 개체가 없다
  | "not-in-box" // 박스에 없다 (이미 파티에 있거나 사라졌다)
  | "no-slot" // 그런 칸이 없다
  | "slot-not-empty" // 빈 칸이 아니다
  | "slot-locked" // 잠긴 칸이다
  | "no-empty-slot" // 빈 칸이 하나도 없다
  | "not-in-party"; // 파티에 없다

export interface PlacementResult {
  ok: boolean;
  reason?: PlacementFailure;
  slotIndex?: number;
  movedOut?: string; // 교체로 박스에 들어간 개체
}

const hasPet = (save: SaveV3, petId: string): boolean => save.pets.some((p) => p.id === petId);

// 빈 파티 칸의 번호. 없으면 -1
export const firstEmptySlot = (save: SaveV3): number => save.party.slots.findIndex((s) => s.state === "empty");

// 박스 개체를 빈 파티 칸에 배치한다. 칸을 지정하지 않으면 앞의 빈 칸에 넣는다
export function place(save: SaveV3, petId: string, slotIndex?: number): PlacementResult {
  if (!hasPet(save, petId)) return { ok: false, reason: "no-pet" };
  if (!findPet(save.boxes, petId)) return { ok: false, reason: "not-in-box" };

  const i = slotIndex ?? firstEmptySlot(save);
  if (i < 0) return { ok: false, reason: "no-empty-slot" };
  const slot = save.party.slots[i];
  if (!slot) return { ok: false, reason: "no-slot" };
  if (slot.state === "locked") return { ok: false, reason: "slot-locked" };
  if (slot.state !== "empty") return { ok: false, reason: "slot-not-empty" };

  takePet(save.boxes, petId);
  save.party.slots[i] = { state: "pokemon", petId, hidden: false }; // 꺼낸 상태로 들어온다
  return { ok: true, slotIndex: i };
}

// 파티 칸의 개체와 박스 개체를 한 번에 맞바꾼다. 들어온 개체는 꺼낸 상태로 시작한다
export function swap(save: SaveV3, slotIndex: number, petId: string): PlacementResult {
  if (!hasPet(save, petId)) return { ok: false, reason: "no-pet" };
  if (!findPet(save.boxes, petId)) return { ok: false, reason: "not-in-box" };

  const slot = save.party.slots[slotIndex];
  if (!slot) return { ok: false, reason: "no-slot" };
  if (slot.state === "locked") return { ok: false, reason: "slot-locked" };
  if (slot.state !== "pokemon" || !slot.petId) return { ok: false, reason: "not-in-party" };

  const out = slot.petId;
  takePet(save.boxes, petId);
  putPet(save.boxes, out);
  save.party.slots[slotIndex] = { state: "pokemon", petId, hidden: false };
  return { ok: true, slotIndex, movedOut: out };
}

// 파티 개체를 박스에 보관한다. 칸은 빈 칸이 된다
export function keep(save: SaveV3, petId: string): PlacementResult {
  if (!hasPet(save, petId)) return { ok: false, reason: "no-pet" };
  const i = save.party.slots.findIndex((s) => s.state === "pokemon" && s.petId === petId);
  if (i < 0) return { ok: false, reason: "not-in-party" };

  putPet(save.boxes, petId);
  save.party.slots[i] = { state: "empty" };
  return { ok: true, slotIndex: i };
}
