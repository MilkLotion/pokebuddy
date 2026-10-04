// 박스 칸 다루기 — 규칙은 docs/specs/game.md "박스". 순수 함수이며 저장을 쓰지 않는다.
//
// 한 박스는 30칸이다. 박스는 8개로 시작하고 상점에서 하나씩 사서 64개까지 늘린다(src/box/rules.ts BOX_RULES). 저절로 늘지 않는다.
// 개체의 값은 건드리지 않는다. 박스는 어느 칸에 누가 있는지만 안다.
import { BOX_RULES } from "./rules.js";
import { pushBox } from "./boxes.js";
import type { BoxV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export interface BoxSpot {
  boxIndex: number;
  slotIndex: number;
}

// 개체가 든 칸. 없으면 null
export function findPet(boxes: BoxV3[], petId: string): BoxSpot | null {
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    if (!box) continue;
    const i = box.slots.indexOf(petId);
    if (i >= 0) return { boxIndex: b, slotIndex: i };
  }
  return null;
}

// 개체를 박스에서 뺀다. 없었으면 false
export function takePet(boxes: BoxV3[], petId: string): boolean {
  const spot = findPet(boxes, petId);
  if (!spot) return false;
  const box = boxes[spot.boxIndex];
  if (!box) return false;
  box.slots[spot.slotIndex] = null;
  return true;
}

// 개체를 앞 박스의 첫 빈 칸에 넣는다. 모든 박스가 가득 찼으면 넣지 않고 null 을 돌려준다 — 박스는 저절로 늘지 않는다
export function addToBox(boxes: BoxV3[], petId: string): BoxSpot | null {
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    if (!box) continue;
    const i = box.slots.indexOf(null);
    if (i < 0) continue;
    box.slots[i] = petId;
    return { boxIndex: b, slotIndex: i };
  }
  return null;
}

export const usedCount = (box: BoxV3): number => box.slots.filter((s) => s !== null).length;

// 모든 박스의 빈 칸 수
export const boxRoom = (boxes: BoxV3[]): number => boxes.reduce((n, b) => n + b.slots.filter((s) => s === null).length, 0);

// 박스를 더 살 수 있는가 — 상한은 BOX_RULES.max. bought 는 기본 개수를 넘는 박스 수다(옛 규칙으로 늘어난 박스도 센다)
export function boxBuyable(boxes: BoxV3[]): { ok: boolean; bought: number; total: number } {
  const { start, max } = BOX_RULES;
  return { ok: boxes.length < max, bought: Math.max(0, boxes.length - start), total: max - start };
}

// 빈 박스 하나를 맨 뒤에 더한다. 상한이면 더하지 않고 null
export function addBox(boxes: BoxV3[]): BoxV3 | null {
  return boxBuyable(boxes).ok ? pushBox(boxes) : null;
}

export type BoxFailure = ReasonOf<"no-box" | "bad-slot" | "empty-slot" | "box-full" | "same-slot">;

// 칸에서 칸으로 옮긴다 — 빈 칸이면 옮기고, 개체 칸이면 맞바꾼다. 박스가 달라도 된다
export function moveSlot(boxes: BoxV3[], from: BoxSpot, to: BoxSpot): { ok: true } | { ok: false; reason: BoxFailure } {
  const a = boxes[from.boxIndex];
  const b = boxes[to.boxIndex];
  if (!a || !b) return { ok: false, reason: "no-box" };
  if (!validSlot(a, from.slotIndex) || !validSlot(b, to.slotIndex)) return { ok: false, reason: "bad-slot" };
  if (from.boxIndex === to.boxIndex && from.slotIndex === to.slotIndex) return { ok: false, reason: "same-slot" };
  const moving = a.slots[from.slotIndex] ?? null;
  if (!moving) return { ok: false, reason: "empty-slot" };
  a.slots[from.slotIndex] = b.slots[to.slotIndex] ?? null;
  b.slots[to.slotIndex] = moving;
  return { ok: true };
}

// 다른 박스의 첫 빈 칸으로 보낸다 — 가득 차 있으면 옮기지 않는다
export function moveToBox(boxes: BoxV3[], from: BoxSpot, boxIndex: number): { ok: true; spot: BoxSpot } | { ok: false; reason: BoxFailure } {
  const target = boxes[boxIndex];
  if (!target) return { ok: false, reason: "no-box" };
  const slotIndex = target.slots.indexOf(null);
  if (slotIndex < 0) return { ok: false, reason: "box-full" };
  const res = moveSlot(boxes, from, { boxIndex, slotIndex });
  return res.ok ? { ok: true, spot: { boxIndex, slotIndex } } : res;
}

const validSlot = (box: BoxV3, i: number): boolean => Number.isInteger(i) && i >= 0 && i < box.slots.length;
