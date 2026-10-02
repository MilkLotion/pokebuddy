// 익명 저장 이관 — 익명 계정으로 쓰던 저장을 로그인·가입한 계정으로 옮긴다. 설계는 worklog-mac/records/cloud-authority/design-p2.md 2절·13절
//
// Electron 을 모른다. 공유 클라이언트를 받는다.
//   begin_handoff: 익명 세션으로 부른다(세션 교체 직전). 10분짜리 티켓을 받는다 — 익명 계정 소유 증명
//   adopt_anonymous: 로그인 세션으로 부른다(세션 교체 직후). 티켓의 익명 저장을 옮기거나(moved) 버리고(discarded) 익명 계정을 지운다
//   GitHub 교환(exchangeCodeForSession)은 공유 클라이언트의 익명 세션을 덮어쓴다 — 티켓은 반드시 교환 전에 받는다
//   세션 교체 훅(SwitchHooks)은 account.ts·github.ts 가 gate.exclusive 안에서 부른다. 훅 안에서 gate.ensure·사용자 변경 알림 금지
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { HandoffCode } from "../shared/names/online-codes.js";

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

export type BeginResult = { ok: true; handoff: PendingHandoff } | { ok: false; code: HandoffCode };
export type AdoptResult = { ok: true; outcome: HandoffOutcome; rev: number } | { ok: false; code: HandoffCode };

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

const TICKET_MS = 10 * 60_000; // 서버 만료와 같다(begin_handoff)
const NETWORK = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i;
const KNOWN = new Set<HandoffCode>(["CLOUD_HANDOFF_INVALID", "CLOUD_TRADE_ACTIVE", "CLOUD_LOGIN_REQUIRED", "CLOUD_ACCOUNT_HELD"]);

// RPC 오류 → 이관 코드. 서버 코드 밖은 망 오류면 NETWORK, 나머지는 UNKNOWN
export function handoffCodeOf(error: { message?: string } | null | undefined): HandoffCode {
  const message = (error?.message ?? "").trim();
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1] && KNOWN.has(m[1] as HandoffCode)) return m[1] as HandoffCode;
  return NETWORK.test(message) ? "NETWORK" : "UNKNOWN";
}

const thrown = (e: unknown): HandoffCode => handoffCodeOf({ message: e instanceof Error ? e.message : String(e) });

// 익명 세션으로 티켓을 받는다. anon 은 지금 익명 계정 ID
export async function beginHandoff(client: SupabaseClient, anon: string, now: () => number = Date.now): Promise<BeginResult> {
  try {
    const started = now();
    const { data, error } = await client.rpc("begin_handoff");
    if (error) return { ok: false, code: handoffCodeOf(error) };
    if (typeof data !== "string" || !data) return { ok: false, code: "UNKNOWN" };
    return { ok: true, handoff: { ticket: data, anon, expiresAt: started + TICKET_MS } };
  } catch (e) {
    return { ok: false, code: thrown(e) };
  }
}

// 로그인 세션으로 티켓의 익명 저장을 옮긴다
export async function adoptAnonymous(client: SupabaseClient, ticket: string): Promise<AdoptResult> {
  try {
    const { data, error } = await client.rpc("adopt_anonymous", { p_ticket: ticket });
    if (error) return { ok: false, code: handoffCodeOf(error) };
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; rev?: unknown } | null | undefined;
    const outcome = row?.outcome;
    if (outcome !== "moved" && outcome !== "discarded" && outcome !== "empty") return { ok: false, code: "UNKNOWN" };
    return { ok: true, outcome, rev: Number(row?.rev ?? 0) };
  } catch (e) {
    return { ok: false, code: thrown(e) };
  }
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
