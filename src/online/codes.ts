// 서버 오류 → 코드. 호출 길마다 받아들이는 서버 코드와 예외가 다르다 — 그 차이만 여기 둔다.
// 공통 순서: 그 길의 서버 코드인가 → 망 오류의 글인가(NETWORK) → 그 밖(UNKNOWN). 코드의 목록은 src/shared/names/online-codes.ts
import type { AccountCode, HandoffCode, MailCode, SessionCode, TradeCode } from "../shared/names/online-codes.js";
import { isNetworkMessage, type ServerError } from "./server-call.js";

const messageOfError = (error: ServerError): string => (error?.message ?? "").trim();

// 클라우드 저장 — 메시지 안의 CLOUD_* 를 그대로 돌려준다(목록 검사 없음). 서버가 새 코드를 내도 그 글자가 온다
export const cloudCodeOf = (error: ServerError): string => {
  const message = messageOfError(error);
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1]) return m[1];
  return isNetworkMessage(message) ? "NETWORK" : "UNKNOWN";
};

const HANDOFF_KNOWN = new Set<HandoffCode>(["CLOUD_HANDOFF_INVALID", "CLOUD_TRADE_ACTIVE", "CLOUD_LOGIN_REQUIRED", "CLOUD_ACCOUNT_HELD"]);

// 익명 저장 이관 — 아는 네 코드만 받는다. 서버 코드 밖은 망 오류면 NETWORK, 나머지는 UNKNOWN
export function handoffCodeOf(error: ServerError): HandoffCode {
  const message = messageOfError(error);
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1] && HANDOFF_KNOWN.has(m[1] as HandoffCode)) return m[1] as HandoffCode;
  return isNetworkMessage(message) ? "NETWORK" : "UNKNOWN";
}

// 계정 — supabase-js 인증 오류의 코드를 먼저 본다. 그다음 메시지 안의 AUTH_*
export function authCodeOf(error: ServerError): { code: AccountCode; detail?: string } {
  const message = messageOfError(error);
  const code = error?.code ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return { code: "AUTH_INVALID_LOGIN" };
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(message)) return { code: "AUTH_USERNAME_TAKEN" };
  if (code === "weak_password" || /password should be/i.test(message)) return { code: "AUTH_PASSWORD_WEAK" };
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) return { code: "AUTH_RATE_LIMITED" };
  const own = /(AUTH_[A-Z_]+)/.exec(message);
  if (own) return { code: own[1] === "AUTH_USERNAME_RESERVED" ? "AUTH_USERNAME_TAKEN" : (own[1] as AccountCode) };
  if (isNetworkMessage(message)) return { code: "NETWORK" };
  return { code: "UNKNOWN", ...(message ? { detail: message } : {}) };
}

// 세션 확보 — 계정 쪽 분류(authCodeOf)를 쓰고, NETWORK·AUTH_RATE_LIMITED 밖은 UNKNOWN 으로 모은다
export function sessionCodeOf(error: ServerError): { code: SessionCode; detail?: string } {
  const c = authCodeOf(error);
  if (c.code === "NETWORK" || c.code === "AUTH_RATE_LIMITED") return { code: c.code };
  const detail = c.detail ?? (c.code === "UNKNOWN" ? undefined : c.code);
  return { code: "UNKNOWN", ...(detail ? { detail } : {}) };
}

const TRADE_CODE = /^(TRADE_[A-Z_]+|CLOUD_ACCOUNT_HELD)$/;

// 친구 교환 — 메시지 전체가 서버 코드일 때만 받는다. 닫힌 이유는 details 로 온다. 코드가 빈 글자인 오류도 연결 문제로 본다
export function tradeCodeOf(error: ServerError): { code: TradeCode; detail?: string } {
  const message = messageOfError(error);
  const m = TRADE_CODE.exec(message);
  if (m) return { code: m[1] as TradeCode, ...(error?.details ? { detail: error.details } : {}) };
  if (isNetworkMessage(message) || error?.code === "") return { code: "NETWORK" };
  return { code: "UNKNOWN", ...(message ? { detail: message } : {}) };
}

// 우편함 — 서버 함수의 MAIL_* 는 그대로, 그 밖은 교환과 같은 규칙(NETWORK · UNKNOWN). detail 은 주지 않는다
export function mailCodeOf(error: ServerError): { code: MailCode | TradeCode } {
  return { code: (/^MAIL_[A-Z_]+$/.exec(messageOfError(error))?.[0] as MailCode | undefined) ?? tradeCodeOf(error).code };
}
