// 친구 교환·우편 처리기 — 메인의 서비스만 낸다(internal). 명령 통로에 등록하지 않는다
import { applyTrade, clearUnacked, lockTrade, markUnacked, unlockTrade } from "../../trade/exchange.js";
import { applyGifts } from "../../mail/gifts.js";
import { markRead } from "../../mail/letters.js";
import type { TxHandler } from "../executor";
import { intOf, isArgsRecord, petIdOf } from "./args.js";

// ── 친구 교환 ───────────────────────────────────────────────────────────────────
// 서버 호출은 메인 프로세스가 한다. 여기서는 로컬 저장만 바꾼다 (src/trade/exchange.ts, worklog/records/trade/trade.md)

const strOf = (args: unknown, key: string): string | null => {
  const v = isArgsRecord(args) ? args[key] : undefined;
  return typeof v === "string" && v ? v : null;
};

// 확정할 때 잠근다
export const tradeLockHandler: TxHandler = (draft, args) => {
  const channelId = strOf(args, "channelId");
  const petId = petIdOf(args);
  const offerRev = intOf(args, "offerRev");
  if (!channelId || !petId || offerRev == null || offerRev < 0) return { ok: false, reason: "bad-args" };
  const res = lockTrade(draft, channelId, petId, offerRev);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { channelId, petId, offerRev } };
};

// 확정 풀기·취소·만료
export const tradeUnlockHandler: TxHandler = (draft, args) => {
  const channelId = strOf(args, "channelId");
  if (!channelId) return { ok: false, reason: "bad-args" };
  return { ok: true, result: { channelId, unlocked: unlockTrade(draft, channelId) } };
};

// 완료 반영 — 한 번의 저장으로 맞바꾼다. 이미 반영했으면 아무것도 하지 않는다
export const tradeApplyHandler: TxHandler = (draft, args, ctx) => {
  const channelId = strOf(args, "channelId");
  if (!channelId) return { ok: false, reason: "bad-args" };
  const res = applyTrade(draft, channelId, isArgsRecord(args) ? args.received : undefined, ctx.now);
  if (!res.ok) return { ok: false, reason: res.reason };
  // 반영을 마쳤다 — 서버가 반영 알림을 받을 때까지 저장에 남긴다. 앱이 그 사이 꺼져도 켤 때 다시 보낸다 (worklog/records/perf-refactor 10단계)
  markUnacked(draft, channelId);
  // refused — 받은 개체를 넣지 않고 잠금만 풀었다(받은 값이 규칙 밖·빈 칸 없음). 교환 세션이 화면에 알린다 (src/online/trade-session.ts settle)
  return { ok: true, result: res.applied ? { channelId, applied: true, petId: res.newPetId, where: res.where } : { channelId, applied: false, ...(res.refused ? { refused: res.refused } : {}) } };
};

// 반영 알림이 서버에 닿았다 — 다시 보낼 목록에서 뺀다
export const tradeAckedHandler: TxHandler = (draft, args) => {
  const channelId = strOf(args, "channelId");
  if (!channelId) return { ok: false, reason: "bad-args" };
  return { ok: true, result: { channelId, cleared: clearUnacked(draft, channelId) } };
};

// ── 우편함 ─────────────────────────────────────────────────────────────────────
// 서버 호출은 온라인 층의 우편함이 한다(src/online/mail-inbox.ts). 명령 처리기(dispatcher)에는 등록하지 않는다 — 설정 창·CLI 가 선물을 만들어 넣지 못하게
export const mailApplyHandler: TxHandler = (draft, args, ctx) => {
  const letterId = strOf(args, "letterId");
  if (!letterId) return { ok: false, reason: "bad-args" };
  const res = applyGifts(draft, letterId, isArgsRecord(args) ? args.gifts : undefined, undefined, { now: ctx.now, rand: ctx.rand });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { letterId, applied: res.applied } };
};
export const mailReadHandler: TxHandler = (draft, args) => {
  const letterId = strOf(args, "letterId");
  if (!letterId || !markRead(draft, letterId)) return { ok: false, reason: "bad-args" };
  return { ok: true, result: { letterId } };
};
