// 배틀 파티 처리기 — 칸 넣기·비우기, 프리셋 가져오기, 기술 순서 (src/battle/party.ts)
import { applyBattleReward, clearBattleSlot, importPreset, setBattleMega, setBattleSlot, swapMoves } from "../../battle/party.js";
import type { TxHandler } from "../executor";
import { intOf, isArgsRecord, petIdOf, reasonOf, slotIndexOf } from "./args.js";

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

// 배틀 파티에서 메가 모습을 켜고 끈다 — args.petId, args.form(메가 모습 슬러그, null 이면 원래 모습)
export const battleMegaHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  const raw = isArgsRecord(args) ? args.form : undefined;
  if (!petId || (raw != null && typeof raw !== "string")) return { ok: false, reason: "bad-args" };
  const form = typeof raw === "string" && raw ? raw : null;
  const res = setBattleMega(draft, petId, form);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, form } };
};

// 랜덤 배틀 보상 — 서버 호출은 온라인 층(src/online/battle-net.ts)이 한다. 표면 명령이 아니다(internal) — 설정창·CLI 가 보상을 만들어 넣지 못하게
export const battleRewardHandler: TxHandler = (draft, args) => {
  const battleId = isArgsRecord(args) && typeof args.battleId === "string" ? args.battleId : "";
  const reward = isArgsRecord(args) && typeof args.reward === "number" ? args.reward : -1;
  const res = applyBattleReward(draft, battleId, reward);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { battleId, applied: res.applied === true } };
};
