// 익명 저장 이관 — 익명 계정으로 쓰던 저장을 로그인·가입한 계정으로 옮긴다. 설계는 worklog-mac/records/cloud-authority/design-p2.md 2절·13절
//
// Electron 을 모른다. 공유 클라이언트를 받는다.
//   begin_handoff: 익명 세션으로 부른다(세션 교체 직전). 10분짜리 티켓을 받는다 — 익명 계정 소유 증명
//   adopt_anonymous: 로그인 세션으로 부른다(세션 교체 직후). 티켓의 익명 저장을 옮기거나(moved) 버리고(discarded) 익명 계정을 지운다
//   GitHub 교환(exchangeCodeForSession)은 공유 클라이언트의 익명 세션을 덮어쓴다 — 티켓은 반드시 교환 전에 받는다
//   세션 교체 훅(SwitchHooks)은 account.ts·github.ts 가 gate.exclusive 안에서 부른다. 훅 안에서 gate.ensure·사용자 변경 알림 금지
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AccountCode, HandoffCode } from "../shared/names/online-codes.js";
import { authCodeOf, handoffCodeOf } from "./codes.js";
import { callRpc, messageOf } from "./server-call.js";
import { ONLINE_TIMING } from "./timing.js";

export type { HandoffCode }; // 목록은 src/shared/names/online-codes.ts

// 아직 쓰지 못한 이관 티켓 — cloud.json 에 남겨 다시 시도한다
export interface PendingHandoff {
  ticket: string;
  anon: string; // 티켓을 받은 익명 계정 ID
  expiresAt: number; // ms. 지나면 서버가 CLOUD_HANDOFF_INVALID
}

//   moved      익명 저장을 로그인 계정으로 옮겼다 — 로그인 계정 서버 저장이 이 PC 저장과 같다
//   discarded  로그인 계정에 저장이 있어(D7) 또는 교환으로 내보낸 개체가 있어 익명 저장을 버렸다
//   empty      익명 계정에 서버 저장이 없었다
export type HandoffOutcome = "moved" | "discarded" | "empty";

export type BeginResult = { ok: true; handoff: PendingHandoff } | { ok: false; code: HandoffCode; detail?: string };
export type AdoptResult = { ok: true; outcome: HandoffOutcome; rev: number } | { ok: false; code: HandoffCode; detail?: string };

// 세션 교체가 끝난 뒤 호출자에 돌려주는 이관 결과
//   none     바꾸기 전 세션이 익명이 아니었다(또는 세션이 없었다) — 옮길 것 없음
//   adopted  이관을 끝냈다
//   pending  티켓은 받았지만 이관에 실패했다 — 호출자가 cloud.applyHandoff 로 cloud.json 에 남기면 cloud.start 가 다시 시도한다
export type HandoffReport =
  | { kind: "none" }
  | { kind: "adopted"; anon: string; outcome: HandoffOutcome; rev: number }
  | { kind: "pending"; handoff: PendingHandoff; code: HandoffCode };

// 세션 교체 앞뒤 훅 — gate.exclusive 안에서 부른다
//   before: 바꾸기 전 세션 사용자를 받는다. 실패하면 세션을 바꾸지 않는다(로그인 중단)
//   after: 바꾼 뒤 부른다. before 가 넘긴 티켓(없으면 null)과 새 사용자를 받는다
export interface SwitchHooks {
  before: (current: User | null) => Promise<{ ok: true; handoff: PendingHandoff | null } | { ok: false; code: "NETWORK" | "UNKNOWN" }>;
  after: (handoff: PendingHandoff | null, next: User | null) => Promise<HandoffReport>;
}

// 세션 교체 앞 — 훅을 던지지 않게 부른다. 훅이 없으면 아무것도 하지 않는다. 실패하면 부르는 쪽이 세션 교체를 멈춘다
//   훅이 던지면 실패로 돌려준다 — 앱이 멈춘 클라우드를 원래 세션으로 다시 시작한다(검수 L5)
export type SwitchPrep = { ok: true; handoff: PendingHandoff | null } | { ok: false; code: AccountCode; detail?: string };
export async function prepareSwitch(hooks: SwitchHooks | undefined, current: () => Promise<User | null>): Promise<SwitchPrep> {
  if (!hooks) return { ok: true, handoff: null };
  try {
    return await hooks.before(await current());
  } catch (e) {
    return { ok: false, ...authCodeOf({ message: messageOf(e) }) };
  }
}

// 세션 교체 뒤 — 훅이 없으면 undefined. 훅이 던지면 티켓을 남겨 다음에 다시 시도하게 한다
export async function finishSwitch(hooks: SwitchHooks | undefined, handoff: PendingHandoff | null, next: User | null): Promise<HandoffReport | undefined> {
  if (!hooks) return undefined;
  try {
    return await hooks.after(handoff, next);
  } catch (e) {
    console.error("익명 저장 이관 훅이 실패했다", e);
    return handoff ? { kind: "pending", handoff, code: "UNKNOWN" } : { kind: "none" };
  }
}

// RPC 오류 → 이관 코드는 ./codes.ts handoffCodeOf 다
const classify = (error: Parameters<typeof handoffCodeOf>[0]): { code: HandoffCode; detail?: string } => handoffCodeOf(error);

// 익명 세션으로 티켓을 받는다. anon 은 지금 익명 계정 ID
export async function beginHandoff(client: SupabaseClient, anon: string, now: () => number = Date.now): Promise<BeginResult> {
  const started = now();
  const res = await callRpc<unknown, HandoffCode>(client, "begin_handoff", undefined, classify);
  if (!res.ok) return { ok: false, code: res.code };
  const data = res.data;
  if (typeof data !== "string" || !data) return { ok: false, code: "UNKNOWN" };
  return { ok: true, handoff: { ticket: data, anon, expiresAt: started + ONLINE_TIMING.handoffTicketMs } };
}

// 로그인 세션으로 티켓의 익명 저장을 옮긴다
export async function adoptAnonymous(client: SupabaseClient, ticket: string): Promise<AdoptResult> {
  const res = await callRpc<unknown, HandoffCode>(client, "adopt_anonymous", { p_ticket: ticket }, classify);
  if (!res.ok) return { ok: false, code: res.code };
  const data = res.data;
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; rev?: unknown } | null | undefined;
  const outcome = row?.outcome;
  if (outcome !== "moved" && outcome !== "discarded" && outcome !== "empty") return { ok: false, code: "UNKNOWN" };
  return { ok: true, outcome, rev: Number(row?.rev ?? 0) };
}

// 이관 훅 — 익명 세션이면 교체 전에 티켓을 받고, 교체 뒤에 옮긴다
//   before 실패: 망 오류는 NETWORK 로 로그인을 멈춘다(티켓 없이 바꾸면 익명 저장을 옮길 길이 없다)
//   익명 계정이 이미 지워졌으면(CLOUD_LOGIN_REQUIRED) 옮길 것이 없다 — 티켓 없이 바꾼다
//   after 실패: 티켓을 pending 으로 돌려준다. 새 세션이 익명이면(이론상 없음) 옮기지 않는다
export function handoffHooks(client: SupabaseClient, now: () => number = Date.now): SwitchHooks {
  return {
    before: async (current) => {
      if (!current?.is_anonymous) return { ok: true, handoff: null };
      const r = await beginHandoff(client, current.id, now);
      if (r.ok) return r;
      if (r.code === "CLOUD_LOGIN_REQUIRED" || r.code === "CLOUD_HANDOFF_INVALID") return { ok: true, handoff: null };
      return { ok: false, code: r.code === "NETWORK" ? "NETWORK" : "UNKNOWN" };
    },
    after: async (handoff, next) => {
      if (!handoff) return { kind: "none" };
      if (!next || next.is_anonymous || next.id === handoff.anon) return { kind: "pending", handoff, code: "CLOUD_HANDOFF_INVALID" };
      const r = await adoptAnonymous(client, handoff.ticket);
      if (r.ok) return { kind: "adopted", anon: handoff.anon, outcome: r.outcome, rev: r.rev };
      return { kind: "pending", handoff, code: r.code };
    },
  };
}
