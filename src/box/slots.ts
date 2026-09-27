// 박스 칸 다루기 — 규칙은 docs/specs/game.md "박스". 순수 함수이며 저장을 쓰지 않는다.
//
// 한 박스는 30칸이다. 모두 차면 새 박스를 자동으로 추가한다.
// 개체의 값은 건드리지 않는다. 박스는 어느 칸에 누가 있는지만 안다.
import { profile } from "../dex/species.js";
import { newBox } from "../save/v3.js";
import type { BoxV3, PetV3 } from "../shared/save-v3";

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

// 개체를 앞 박스의 첫 빈 칸에 넣는다. 자리가 없으면 박스를 새로 만든다
export function putPet(boxes: BoxV3[], petId: string): BoxSpot {
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    if (!box) continue;
    const i = box.slots.indexOf(null);
    if (i < 0) continue;
    box.slots[i] = petId;
    return { boxIndex: b, slotIndex: i };
  }
  const box = newBox(`b${boxes.length + 1}`, `박스 ${boxes.length + 1}`);
  box.slots[0] = petId;
  boxes.push(box);
  return { boxIndex: boxes.length - 1, slotIndex: 0 };
}

export const usedCount = (box: BoxV3): number => box.slots.filter((s) => s !== null).length;

// ── 정렬·이동·이름 (worklog/records/game-runtime/record.md "박스 정렬·이동·이름 변경의 설계", Figma 05 `Box / Sort Open` 등) ──

export const BOX_RULES = {
  nameMax: 10, // 박스 이름 최대 글자 수
};

export type BoxSortKey = "dex" | "level" | "affinity" | "recent" | "name";
export const BOX_SORT_KEYS: readonly BoxSortKey[] = ["dex", "level", "affinity", "recent", "name"];
export const isBoxSortKey = (v: unknown): v is BoxSortKey => typeof v === "string" && (BOX_SORT_KEYS as readonly string[]).includes(v);

export type BoxFailure = "no-box" | "bad-slot" | "empty-slot" | "box-full" | "same-slot";

// 한 박스만 정렬한다 — 개체를 기준 순서로 앞 칸부터 다시 놓고 빈 칸은 뒤로. 한 번만 정렬한다(뒤에 오는 개체는 빈 칸으로)
// 같은 값이면 도감 번호, 그다음 얻은 시각 순이다. nameOf 는 화면 이름(이름순에 쓴다)
export function sortBox(box: BoxV3, pets: ReadonlyMap<string, PetV3>, key: BoxSortKey, nameOf: (slug: string) => string): void {
  const dex = (p: PetV3): number => profile(p.species).dex || Number.MAX_SAFE_INTEGER;
  const tie = (a: PetV3, b: PetV3): number => dex(a) - dex(b) || a.since - b.since;
  const by: Record<BoxSortKey, (a: PetV3, b: PetV3) => number> = {
    dex: tie,
    level: (a, b) => b.level - a.level || tie(a, b),
    affinity: (a, b) => b.affinity - a.affinity || tie(a, b),
    recent: (a, b) => b.since - a.since || tie(a, b),
    name: (a, b) => nameOf(a.species).localeCompare(nameOf(b.species), "ko") || tie(a, b),
  };
  const list = box.slots.flatMap((id) => {
    const pet = id ? pets.get(id) : undefined;
    return pet ? [pet] : [];
  });
  // 저장에 개체가 없는 식별자는 그대로 뒤에 둔다 — 지우지 않는다
  const orphans = box.slots.filter((id): id is string => id != null && !pets.has(id));
  list.sort(by[key]);
  const ids = [...list.map((p) => p.id), ...orphans];
  box.slots = box.slots.map((_, i) => ids[i] ?? null);
}

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

// 박스 이름 — 앞뒤 공백을 지우고 nameMax 글자로 자른다. 비면 기본 이름(박스 N)으로 돌아간다
export function renameBox(box: BoxV3, name: string, boxIndex: number): string {
  const next = [...name.trim()].slice(0, BOX_RULES.nameMax).join("");
  box.name = next || `박스 ${boxIndex + 1}`;
  return box.name;
}

const validSlot = (box: BoxV3, i: number): boolean => Number.isInteger(i) && i >= 0 && i < box.slots.length;

