// 온라인 코드의 원본 — 서버 호출 길에서 생기는 실패 코드다. 대문자로 적는다.
// 서버가 내는 코드의 정본은 supabase/migrations/*.sql 의 raise exception 과 supabase/functions/** 의 { error } 다.
// 아래 SERVER_* 배열은 그 목록의 사본이다 — 서버에 코드를 더하면 여기도 더한다.
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. ./reasons.ts 의 타입만 가져다 쓴다
import type { Reason } from "./reasons.js";

// ── 서버가 내는 코드 ───────────────────────────────────────────────────────────
export const SERVER_CLOUD_CODES = [
  "CLOUD_ACCOUNT_HELD",
  "CLOUD_BAD_ARGS",
  "CLOUD_EMPTY_SAVE",
  "CLOUD_HANDOFF_INVALID",
  "CLOUD_LOGIN_REQUIRED",
  "CLOUD_NOT_ACTIVE",
  "CLOUD_PET_TRADED_OUT",
  "CLOUD_REV_CONFLICT",
  "CLOUD_SAVE_REJECTED",
  "CLOUD_TOO_LARGE",
  "CLOUD_TRADE_ACTIVE",
  "CLOUD_TRADE_UNSYNCED",
  "CLOUD_UPDATE_REQUIRED",
] as const;

export const SERVER_TRADE_CODES = [
  "TRADE_AUTH_REQUIRED",
  "TRADE_BAD_ARGS",
  "TRADE_VERSION_MISMATCH",
  "TRADE_RATE_LIMITED",
  "TRADE_ALREADY_ACTIVE",
  "TRADE_LINK_INVALID",
  "TRADE_LINK_EXPIRED",
  "TRADE_LINK_USED",
  "TRADE_OWN_LINK",
  "TRADE_NOT_FOUND",
  "TRADE_CLOSED",
  "TRADE_OFFER_INVALID",
  "TRADE_OFFER_MISSING",
  "TRADE_OFFER_CHANGED",
  "TRADE_ALREADY_DONE",
  "TRADE_NOT_DONE",
  "TRADE_LOGIN_REQUIRED",
  "TRADE_PET_TRADED",
  "TRADE_PET_NOT_SYNCED",
  "TRADE_PET_BUSY",
  "TRADE_SAVE_UNVERIFIED",
] as const;

export const SERVER_MAIL_CODES = ["MAIL_EXPIRED", "MAIL_LOGIN_REQUIRED", "MAIL_NO_GIFTS", "MAIL_NOT_FOUND"] as const;

// AUTH_USERNAME_RESERVED 는 앱이 AUTH_USERNAME_TAKEN 으로 바꿔 보인다 (src/online/account.ts authCodeOf)
export const SERVER_AUTH_CODES = [
  "AUTH_NAME_INVALID",
  "AUTH_USERNAME_INVALID",
  "AUTH_USERNAME_RESERVED",
  "AUTH_ANONYMOUS",
  "AUTH_REQUIRED",
  "AUTH_TOKEN",
  "AUTH_TRADE_ACTIVE",
] as const;

// ── 앱이 만드는 코드 ───────────────────────────────────────────────────────────
//   NETWORK              서버에 닿지 못했다
//   UNKNOWN              서버 코드도 망 오류도 아니다
//   LOCAL                교환의 로컬 거래(trade.lock·apply)가 실패했다
//   CLOUD_OWNER_OTHER    이 PC 저장이 다른 계정 것이고 이 계정 저장이 없다
//   CLOUD_BAD_SAVE       계정 저장을 읽지 못했다
//   SAVE_BACKUP_FAILED   로그아웃·삭제 뒤 이 PC 저장을 백업하지 못했다
export const APP_ONLINE_CODES = [
  "NETWORK",
  "UNKNOWN",
  "LOCAL",
  "CLOUD_OWNER_OTHER",
  "CLOUD_BAD_SAVE",
  "AUTH_INVALID_LOGIN",
  "AUTH_USERNAME_TAKEN",
  "AUTH_PASSWORD_WEAK",
  "AUTH_RATE_LIMITED",
  "AUTH_CANCELLED",
  "AUTH_PORT_BUSY",
  "SAVE_BACKUP_FAILED",
] as const;

// ── 호출 길마다의 코드 ─────────────────────────────────────────────────────────
type Net = "NETWORK" | "UNKNOWN";

// 클라우드 저장
export type CloudCode = (typeof SERVER_CLOUD_CODES)[number] | "CLOUD_OWNER_OTHER" | "CLOUD_BAD_SAVE" | Net;

// 친구 교환 — CLOUD_ACCOUNT_HELD 는 이용 정지. 교환 호출에서도 온다
export type TradeCode = (typeof SERVER_TRADE_CODES)[number] | "CLOUD_ACCOUNT_HELD" | Net;

// 우편함
export type MailCode = (typeof SERVER_MAIL_CODES)[number] | Net;

// 계정 — 가입·로그인·로그아웃·이름 바꾸기·삭제
export type AccountCode =
  | "AUTH_USERNAME_INVALID"
  | "AUTH_USERNAME_TAKEN"
  | "AUTH_NAME_INVALID"
  | "AUTH_PASSWORD_WEAK"
  | "AUTH_INVALID_LOGIN"
  | "AUTH_TRADE_ACTIVE"
  | "AUTH_RATE_LIMITED"
  | Net;

// GitHub 로그인이 더하는 코드 — 취소·시간 초과, 돌아올 포트가 없다
export type GithubCode = AccountCode | "AUTH_CANCELLED" | "AUTH_PORT_BUSY";

// 세션 확보
export type SessionCode = "AUTH_RATE_LIMITED" | Net;

// 익명 저장 이관
export type HandoffCode = "CLOUD_HANDOFF_INVALID" | "CLOUD_TRADE_ACTIVE" | "CLOUD_LOGIN_REQUIRED" | "CLOUD_ACCOUNT_HELD" | Net;

export type OnlineCode =
  | (typeof SERVER_CLOUD_CODES)[number]
  | (typeof SERVER_TRADE_CODES)[number]
  | (typeof SERVER_MAIL_CODES)[number]
  | (typeof SERVER_AUTH_CODES)[number]
  | (typeof APP_ONLINE_CODES)[number];

// 화면에 닿는 실패 값 전부 — 로컬 판정의 까닭(kebab-case)과 온라인 코드(대문자). 글자의 모양이 출처를 알린다
export type FailCode = Reason | OnlineCode;
