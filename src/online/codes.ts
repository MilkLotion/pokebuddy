// 서버 오류 → 코드. 호출 길마다 받아들이는 서버 코드와 예외가 다르다 — 그 차이만 여기 둔다.
// 공통 순서: 그 길의 서버 코드인가 → 서버에 닿지 못했는가(NETWORK, isUnreachableError) → 그 밖(UNKNOWN). 코드의 목록은 src/shared/names/online-codes.ts
import { SERVER_CLOUD_CODES, type AccountCode, type CloudCode, type HandoffCode, type MailCode, type SessionCode, type TradeCode } from "../shared/names/online-codes.js";
import { isNetworkMessage, type ServerError } from "./server-call.js";

const messageOfError = (error: ServerError): string => (error?.message ?? "").trim();

// 서버에 닿지 못한 오류인가 — 망 오류의 글이거나, 코드가 빈 글자다.
// postgrest-js 는 fetch 가 실패하면 { message: "TypeError: fetch failed", code: "" } 를 준다. 글이 정규식에 걸리지 않아도 빈 코드로 알아본다.
// 처음에는 교환 길에만 있었다(c5c4a41). 모든 길이 같은 판정을 쓴다 (worklog/records/code-structure/design/94-same-feature-diffs.md 5-4)
const isUnreachableError = (error: ServerError): boolean => isNetworkMessage(messageOfError(error)) || error?.code === "";

// 목록 밖 서버 코드 — 코드는 UNKNOWN, 원래 글자는 detail 로 남긴다. 화면은 failTextOf 가 detail 을 괄호에 보인다(사용자가 알릴 때 쓸 정보).
// 모든 길이 같은 규칙이다 (worklog/records/code-structure/design/94-same-feature-diffs.md 5-4)
const outOfList = (code: string): { code: "UNKNOWN"; detail: string } => ({ code: "UNKNOWN", detail: code });

const CLOUD_KNOWN = new Set<string>(SERVER_CLOUD_CODES);

// 클라우드 저장 — 메시지 안의 CLOUD_* 가운데 목록에 있는 것만 받는다
export function cloudCodeOf(error: ServerError): { code: CloudCode; detail?: string } {
  const message = messageOfError(error);
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1]) return CLOUD_KNOWN.has(m[1]) ? { code: m[1] as CloudCode } : outOfList(m[1]);
  return { code: isUnreachableError(error) ? "NETWORK" : "UNKNOWN" };
}

const HANDOFF_KNOWN = new Set<HandoffCode>(["CLOUD_HANDOFF_INVALID", "CLOUD_TRADE_ACTIVE", "CLOUD_LOGIN_REQUIRED", "CLOUD_ACCOUNT_HELD"]);

// 익명 저장 이관 — 아는 네 코드만 받는다. 그 밖의 CLOUD_* 는 목록 밖이다
export function handoffCodeOf(error: ServerError): { code: HandoffCode; detail?: string } {
  const message = messageOfError(error);
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1]) return HANDOFF_KNOWN.has(m[1] as HandoffCode) ? { code: m[1] as HandoffCode } : outOfList(m[1]);
  return { code: isUnreachableError(error) ? "NETWORK" : "UNKNOWN" };
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
  if (isUnreachableError(error)) return { code: "NETWORK" };
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

// 친구 교환 — 메시지 전체가 서버 코드일 때만 받는다. 닫힌 이유는 details 로 온다
export function tradeCodeOf(error: ServerError): { code: TradeCode; detail?: string } {
  const message = messageOfError(error);
  const m = TRADE_CODE.exec(message);
  if (m) return { code: m[1] as TradeCode, ...(error?.details ? { detail: error.details } : {}) };
  if (isUnreachableError(error)) return { code: "NETWORK" };
  return { code: "UNKNOWN", ...(message ? { detail: message } : {}) };
}

// 우편함 — 서버 함수의 MAIL_* 는 그대로, 그 밖은 교환과 같은 규칙(NETWORK · UNKNOWN 과 detail)
export function mailCodeOf(error: ServerError): { code: MailCode | TradeCode; detail?: string } {
  const mail = /^MAIL_[A-Z_]+$/.exec(messageOfError(error))?.[0] as MailCode | undefined;
  return mail ? { code: mail } : tradeCodeOf(error);
}
