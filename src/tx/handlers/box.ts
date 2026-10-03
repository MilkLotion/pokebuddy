// 박스 처리기 — 정렬·이동·이름·순서
import { isBoxSortKey, moveSlot, moveToBox, orderBox, renameBox, sortBox } from "../../box/slots.js";
import type { TxHandler } from "../executor";
import { intOf, isObj } from "./args.js";

// ── 박스 정렬·이동·이름·순서 ────────────────────────────────────────────────────
// 박스의 slots 와 name, 박스 배열의 순서만 바꾼다. 파티·알·도감은 건드리지 않는다 (src/box/slots.ts)

const boxIndexOf = (draft: Parameters<TxHandler>[0], args: unknown, key: string): number => {
  const id = isObj(args) ? args[key] : undefined;
  return typeof id === "string" ? draft.boxes.findIndex((b) => b.id === id) : -1;
};

// 지금 보는 박스 하나를 기준대로 한 번 정렬한다
export const boxSortHandler: TxHandler = (draft, args, ctx) => {
  const boxIndex = boxIndexOf(draft, args, "boxId");
  const by = isObj(args) ? args.by : undefined;
  if (boxIndex < 0) return { ok: false, reason: "no-box" };
  if (!isBoxSortKey(by)) return { ok: false, reason: "bad-args" };
  const box = draft.boxes[boxIndex];
  if (!box) return { ok: false, reason: "no-box" };
  sortBox(box, new Map(draft.pets.map((p) => [p.id, p])), by, ctx.petName ?? ((slug) => slug));
  return { ok: true, result: { boxId: box.id, by } };
};

// 칸 옮기기 — toSlot 이 있으면 그 칸으로(빈 칸이면 옮기고 개체 칸이면 맞바꾼다), 없으면 toBoxId 의 첫 빈 칸으로
export const boxMoveHandler: TxHandler = (draft, args) => {
  const from = boxIndexOf(draft, args, "boxId");
  const slot = intOf(args, "slot");
  const to = isObj(args) && args.toBoxId !== undefined ? boxIndexOf(draft, args, "toBoxId") : from;
  const toSlot = intOf(args, "toSlot");
  if (from < 0 || to < 0) return { ok: false, reason: "no-box" };
  if (slot == null) return { ok: false, reason: "bad-args" };
  if (toSlot == null) {
    const res = moveToBox(draft.boxes, { boxIndex: from, slotIndex: slot }, to);
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, result: { boxId: draft.boxes[to]?.id, slot: res.spot.slotIndex } };
  }
  const res = moveSlot(draft.boxes, { boxIndex: from, slotIndex: slot }, { boxIndex: to, slotIndex: toSlot });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { boxId: draft.boxes[to]?.id, slot: toSlot } };
};

// 박스 이름 바꾸기 — 비우면 기본 이름으로 돌아간다
export const boxRenameHandler: TxHandler = (draft, args) => {
  const boxIndex = boxIndexOf(draft, args, "boxId");
  const name = isObj(args) ? args.name : undefined;
  const box = draft.boxes[boxIndex];
  if (!box) return { ok: false, reason: "no-box" };
  if (typeof name !== "string") return { ok: false, reason: "bad-args" };
  return { ok: true, result: { boxId: box.id, name: renameBox(box, name, boxIndex) } };
};

// 박스 순서 바꾸기 — 박스를 to 자리로 옮긴다. 사이의 박스는 한 칸씩 밀린다 (2026-10-02 사용자 결정 "박스끼리 순서변경")
export const boxOrderHandler: TxHandler = (draft, args) => {
  const from = boxIndexOf(draft, args, "boxId");
  const to = intOf(args, "to");
  if (from < 0) return { ok: false, reason: "no-box" };
  if (to == null) return { ok: false, reason: "bad-args" };
  const res = orderBox(draft.boxes, from, to);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { boxId: draft.boxes[to]?.id, to } };
};
