// 파티 처리기 — 꺼내기·숨기기·배치·맞바꾸기·옮기기·박스로 보내기·프리셋
import { keepInBox, movePartySlot, placeInParty, swapWithBox } from "../../party/placement.js";
import { setHidden, shownCount } from "../../party/visibility.js";
import { applyPreset, presetName, renamePreset } from "../../party/presets.js";
import type { TxHandler } from "../executor";
import { isArgsRecord, petIdOf, reasonOf, slotIndexOf } from "./args.js";

// 표시·숨김 — 칸의 hidden 하나만 바꾼다
export const visibilityHandler = (hidden: boolean): TxHandler => (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = setHidden(draft.party.slots, petId, hidden);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, hidden, shown: shownCount(draft.party.slots) } };
};

// 박스 개체를 빈 파티 칸에 — 칸을 지정하지 않으면 앞의 빈 칸에 넣는다
export const placeHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = placeInParty(draft, petId, slotIndexOf(args) ?? undefined);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, slotIndex: res.slotIndex, hidden: false } };
};

// 파티 칸의 개체와 박스 개체를 한 번에 맞바꾼다
export const swapHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  const slotIndex = slotIndexOf(args);
  if (!petId || slotIndex == null) return { ok: false, reason: "bad-args" };
  const res = swapWithBox(draft, slotIndex, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, slotIndex: res.slotIndex, movedOut: res.movedOut, hidden: false } };
};

// 파티 개체의 칸을 옮긴다 — 빈 칸이면 옮기고 개체 칸이면 맞바꾼다
export const moveHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  const toSlot = isArgsRecord(args) && typeof args.toSlot === "number" && Number.isInteger(args.toSlot) ? args.toSlot : null;
  if (!petId || toSlot == null) return { ok: false, reason: "bad-args" };
  const res = movePartySlot(draft, petId, toSlot);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, slotIndex: res.slotIndex } };
};

// 파티 개체를 박스에 보관한다 — toBoxId·toSlot 을 주면 그 박스 빈 칸에
export const keepHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  let to: { boxId: string; slot: number } | undefined;
  if (isArgsRecord(args) && (args.toBoxId !== undefined || args.toSlot !== undefined)) {
    if (typeof args.toBoxId !== "string" || typeof args.toSlot !== "number" || !Number.isInteger(args.toSlot)) return { ok: false, reason: "bad-args" };
    to = { boxId: args.toBoxId, slot: args.toSlot };
  }
  const res = keepInBox(draft, petId, to);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, slotIndex: res.slotIndex } };
};

// 파티 프리셋 — 번호로 적용하거나 이름을 바꾼다 (src/party/presets.ts)
const presetOf = (args: unknown): number | null => {
  const i = isArgsRecord(args) ? args.preset : undefined;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 ? i : null;
};

// 적용 — party.slots 와 그 프리셋의 칸을 통째로 맞바꾼다. 박스는 건드리지 않는다
export const presetApplyHandler: TxHandler = (draft, args) => {
  const preset = presetOf(args);
  if (preset == null) return { ok: false, reason: "bad-args" };
  const res = applyPreset(draft, preset);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { preset, name: presetName(draft, preset), shown: shownCount(draft.party.slots) } };
};

// 이름 바꾸기 — 비우면 기본 이름으로 돌아간다
export const presetRenameHandler: TxHandler = (draft, args) => {
  const preset = presetOf(args);
  const name = isArgsRecord(args) ? args.name : undefined;
  if (preset == null || typeof name !== "string") return { ok: false, reason: "bad-args" };
  const res = renamePreset(draft, preset, name);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { preset, name: res.name } };
};
