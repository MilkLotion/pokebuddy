// 배틀 파티 처리기 — 칸 넣기·비우기, 프리셋 가져오기, 기술 순서 (src/battle/party.ts)
import { clearBattleSlot, importPreset, setBattleSlot, swapMoves } from "../../battle/party.js";
import type { TxHandler } from "../executor";
import { intOf, petIdOf, reasonOf, slotIndexOf } from "./args.js";

// 칸에 개체를 넣는다 — args.slotIndex, args.petId
export const battleSetHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  const slotIndex = slotIndexOf(args);
  if (!petId || slotIndex == null) return { ok: false, reason: "bad-args" };
  const res = setBattleSlot(draft, slotIndex, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, slotIndex } };
};

// 칸을 비운다 — args.slotIndex
export const battleClearHandler: TxHandler = (draft, args) => {
  const slotIndex = slotIndexOf(args);
  if (slotIndex == null) return { ok: false, reason: "bad-args" };
  const res = clearBattleSlot(draft, slotIndex);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { slotIndex } };
};

// 파티 프리셋을 가져온다 — args.preset
export const battleImportHandler: TxHandler = (draft, args) => {
  const preset = intOf(args, "preset");
  if (preset == null || preset < 0) return { ok: false, reason: "bad-args" };
  const res = importPreset(draft, preset);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { preset } };
};

// 개체의 기술 위아래 순서를 바꾼다 — args.petId
export const battleMovesHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = swapMoves(draft, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, swapped: res.swapped === true } };
};
