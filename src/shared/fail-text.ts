// 실패 문구 한 벌 — 실패 값(FailCode)을 화면 문구로. 설정창이 쓴다. 메인도 쓸 수 있게 공용 자리(src/shared)에 둔다. DOM 을 쓰지 않는다
// - 자리(scope)마다 지금 표를 그대로 옮겼다(글자 그대로). 같은 코드라도 자리마다 문장이 다르다 — 하나로 맞출지는 사용자 결정 대기
// - 표에 없는 글자가 오면 자리마다 지금 모양의 대체 문구를 쓴다(UNKNOWN)
// 설계는 worklog/records/code-structure/design/20-renderer.md 3.11절
import type { FailCode } from "./names/online-codes.js";

export type FailScope = "command" | "trade" | "account" | "mail";

// 명령 실패 — 실패 값마다 하나. 빠진 값은 컴파일 오류다
// 모르는 이유는 그대로 보여 무엇이 빠졌는지 드러나게 한다
const BASE: Record<FailCode, string> = {
  cooldown: "아직 쉬는 시간이에요.",
  full: "이미 배가 불러요.",
  already: "이미 그 상태예요.",
  "max-level": "이미 최고 레벨이에요.",
  "no-slot": "그 칸이 없어요.",
  "no-pet": "그 개체가 없어요.",
  "not-in-party": "파티에 없어요.",
  "not-in-box": "박스에 없어요.",
  "no-empty-slot": "파티에 빈 칸이 없어요.",
  "slot-locked": "잠긴 칸이에요.",
  "slot-not-empty": "그 칸이 이미 차 있어요.",
  "not-pokemon": "그 칸에 개체가 없어요.",
  "not-enough-points": "포인트가 모자라요.",
  "daycare-full": "돌보미집이 가득 찼어요.",
  "egg-none": "이 알에서 나올 포켓몬을 모두 모았어요.",
  "bag-full": "한 종류는 999개까지만 살 수 있어요.",
  "sold-out": "이 알에서 나올 포켓몬을 모두 모았어요.",
  "bad-form": "고를 수 없는 모습이에요.",
  "not-shared": "모습을 바꿀 수 없는 포켓몬이에요.",
  "no-locked-slot": "더 열 수 있는 칸이 없어요.",
  "not-unlocked": "아직 해금하지 않은 종이에요.",
  "not-ready": "아직 준비되지 않았어요.",
  "no-candidate": "지금은 진화할 수 없어요.",
  "need-choice": "진화할 모습을 골라 주세요.",
  "bad-choice": "고른 모습으로는 지금 진화할 수 없어요.",
  "no-step": "더 진화하지 않아요.",
  "none-left": "가방에 남은 것이 없어요.",
  "no-item": "가방에 없어요.",
  "no-map": "지도가 있어야 이 모습으로 진화해요.",
  "not-sellable": "팔 수 없는 도구예요.",
  "not-enough-items": "가진 개수보다 많이 팔 수 없어요.",
  "bad-count": "고를 수 없는 수량이에요.",
  "bad-nature": "쓸 수 없는 성격이에요.",
  "bad-value": "고를 수 없는 값이에요.",
  "not-achieved": "아직 달성하지 않았어요.",
  "already-claimed": "이미 받았어요.",
  "save-failed": "저장하지 못했어요. 잠시 뒤 다시 해 주세요.",
  "art-missing": "바뀔 모습의 그림을 받지 못했어요. 잠시 뒤 다시 해 주세요.",
  "not-writer": "다른 창이 저장을 맡고 있어요. 잠시 뒤 다시 해 주세요.",
  halted: "다른 PC 확인이 끝날 때까지 게임이 멈춰 있어요.",
  "box-full": "박스에 빈 칸이 없어요.",
  "box-max": "더 살 수 있는 박스가 없어요.",
  "pet-not-sellable": "팔 수 없는 포켓몬이에요.",
  "last-pet": "마지막 한 마리는 팔 수 없어요.",
  "in-preset": "파티에 든 포켓몬은 팔 수 없어요. 박스로 옮긴 뒤 팔아 주세요.",
  "preset-max": "더 살 수 있는 프리셋이 없어요.",
  "slots-not-full": "가진 프리셋의 파티 칸을 모두 열어야 해요.",
  "no-preset": "그 프리셋이 없어요.",
  "no-box": "그 박스를 찾지 못했어요.",
  // 교환에 올려 둔 개체 — 도구 사용·진화·모습 바꾸기를 막는다 (src/tx/command-table.ts 의 action, src/party/pet-actions.ts isTradeLocked)
  "trade-locked": "교환에 올린 포켓몬이에요. 교환을 끝내거나 나간 뒤 다시 해 주세요.",
  timeout: "응답이 없어요. 처리됐는지 확인해 주세요. 다시 눌러도 두 번 반영되지 않아요.",
  // [스펙 미확정] 명령 실패 문구가 아직 없는 값 — 코드 글자를 그대로 보인다(옛 화면과 같다). 새 문구는 사용자 확인 뒤에 쓴다
  ok: "ok", error: "error", "bad-args": "bad-args", "bad-cmd": "bad-cmd", "bad-result": "bad-result", "send-failed": "send-failed",
  "unknown-cmd": "unknown-cmd", "no-result": "no-result", "no-save": "no-save", cancelled: "cancelled", denied: "denied",
  "bad-request": "bad-request", "not-yet": "not-yet", expired: "expired", "already-active": "already-active", "bad-slot": "bad-slot",
  "empty-slot": "empty-slot", "same-slot": "same-slot", "no-egg": "no-egg", "no-product": "no-product", "no-stone": "no-stone",
  "no-achievement": "no-achievement", "bad-id": "bad-id", busy: "busy", "no-channel": "no-channel", "in-trade": "in-trade", stopped: "stopped",
  "cloud-wait": "cloud-wait", "login-required": "login-required", "save-wait": "save-wait", single: "single", locked: "locked",
  "bad-received": "bad-received", "trade-off": "trade-off", "bad-gift": "bad-gift",
  CLOUD_ACCOUNT_HELD: "CLOUD_ACCOUNT_HELD", CLOUD_BAD_ARGS: "CLOUD_BAD_ARGS", CLOUD_EMPTY_SAVE: "CLOUD_EMPTY_SAVE",
  CLOUD_HANDOFF_INVALID: "CLOUD_HANDOFF_INVALID", CLOUD_LOGIN_REQUIRED: "CLOUD_LOGIN_REQUIRED", CLOUD_NOT_ACTIVE: "CLOUD_NOT_ACTIVE",
  CLOUD_PET_TRADED_OUT: "CLOUD_PET_TRADED_OUT", CLOUD_REV_CONFLICT: "CLOUD_REV_CONFLICT", CLOUD_SAVE_REJECTED: "CLOUD_SAVE_REJECTED",
  CLOUD_TOO_LARGE: "CLOUD_TOO_LARGE", CLOUD_TRADE_ACTIVE: "CLOUD_TRADE_ACTIVE", CLOUD_TRADE_UNSYNCED: "CLOUD_TRADE_UNSYNCED",
  CLOUD_UPDATE_REQUIRED: "CLOUD_UPDATE_REQUIRED", TRADE_AUTH_REQUIRED: "TRADE_AUTH_REQUIRED", TRADE_BAD_ARGS: "TRADE_BAD_ARGS",
  TRADE_VERSION_MISMATCH: "TRADE_VERSION_MISMATCH", TRADE_RATE_LIMITED: "TRADE_RATE_LIMITED", TRADE_ALREADY_ACTIVE: "TRADE_ALREADY_ACTIVE",
  TRADE_LINK_INVALID: "TRADE_LINK_INVALID", TRADE_LINK_EXPIRED: "TRADE_LINK_EXPIRED", TRADE_LINK_USED: "TRADE_LINK_USED",
  TRADE_OWN_LINK: "TRADE_OWN_LINK", TRADE_NOT_FOUND: "TRADE_NOT_FOUND", TRADE_CLOSED: "TRADE_CLOSED", TRADE_OFFER_INVALID: "TRADE_OFFER_INVALID",
  TRADE_OFFER_MISSING: "TRADE_OFFER_MISSING", TRADE_OFFER_CHANGED: "TRADE_OFFER_CHANGED", TRADE_ALREADY_DONE: "TRADE_ALREADY_DONE",
  TRADE_NOT_DONE: "TRADE_NOT_DONE", TRADE_LOGIN_REQUIRED: "TRADE_LOGIN_REQUIRED", TRADE_PET_TRADED: "TRADE_PET_TRADED",
  TRADE_PET_NOT_SYNCED: "TRADE_PET_NOT_SYNCED", TRADE_PET_BUSY: "TRADE_PET_BUSY", TRADE_SAVE_UNVERIFIED: "TRADE_SAVE_UNVERIFIED",
  MAIL_EXPIRED: "MAIL_EXPIRED", MAIL_LOGIN_REQUIRED: "MAIL_LOGIN_REQUIRED", MAIL_NO_GIFTS: "MAIL_NO_GIFTS", MAIL_NOT_FOUND: "MAIL_NOT_FOUND",
  AUTH_NAME_INVALID: "AUTH_NAME_INVALID", AUTH_USERNAME_INVALID: "AUTH_USERNAME_INVALID", AUTH_USERNAME_RESERVED: "AUTH_USERNAME_RESERVED",
  AUTH_ANONYMOUS: "AUTH_ANONYMOUS", AUTH_REQUIRED: "AUTH_REQUIRED", AUTH_TOKEN: "AUTH_TOKEN", AUTH_TRADE_ACTIVE: "AUTH_TRADE_ACTIVE",
  NETWORK: "NETWORK", UNKNOWN: "UNKNOWN", LOCAL: "LOCAL", CLOUD_OWNER_OTHER: "CLOUD_OWNER_OTHER", CLOUD_BAD_SAVE: "CLOUD_BAD_SAVE",
  AUTH_INVALID_LOGIN: "AUTH_INVALID_LOGIN", AUTH_USERNAME_TAKEN: "AUTH_USERNAME_TAKEN", AUTH_PASSWORD_WEAK: "AUTH_PASSWORD_WEAK",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED", AUTH_CANCELLED: "AUTH_CANCELLED", AUTH_PORT_BUSY: "AUTH_PORT_BUSY",
  SAVE_BACKUP_FAILED: "SAVE_BACKUP_FAILED",
};

// 교환 — 오류 배너의 제목·문구 (Figma `Trade / Error` 와 주석 `633:18930`)
const TRADE: Partial<Record<FailCode, readonly [string, string]>> = {
  TRADE_LINK_EXPIRED: ["링크가 만료됐어요", "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요"],
  TRADE_LINK_USED: ["이미 사용된 링크예요", "다른 사람이 먼저 참가했어요"],
  TRADE_OWN_LINK: ["내가 만든 링크예요", "친구에게 보내 주세요"],
  TRADE_VERSION_MISMATCH: ["앱 버전이 달라요", "두 사람 모두 앱을 업데이트해 주세요"],
  NETWORK: ["서버에 연결할 수 없어요", "교환 밖의 게임은 그대로 할 수 있어요"],
  TRADE_LINK_INVALID: ["링크가 올바르지 않아요", "친구가 보낸 링크를 그대로 붙여 넣어 주세요"],
  TRADE_RATE_LIMITED: ["잠시 뒤에 다시 해 주세요", "짧은 시간에 링크를 너무 많이 만들었어요"],
  TRADE_CLOSED: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  "in-trade": ["진행 중인 교환이 있어요", "지금 교환에서 나간 뒤 다시 해 주세요"],
  busy: ["잠시 뒤에 다시 해 주세요", "앞의 조작을 처리하는 중이에요"],
  "not-ready": ["아직 확정할 수 없어요", "두 사람 모두 포켓몬을 올려야 확정할 수 있어요"],
  timeout: ["응답이 늦어요", "잠시 뒤에 다시 해 주세요"],
  "cloud-wait": ["클라우드 저장이 연결되지 않았어요", "연결되면 다시 해 주세요. 계정 탭에서 저장 상태를 볼 수 있어요"],
  // 교환 규약 2 — 익명 계정 거절·원장 (design-p2.md 14절)
  "login-required": ["로그인해야 교환할 수 있어요", "계정 탭에서 로그인해 주세요"],
  TRADE_LOGIN_REQUIRED: ["로그인해야 교환할 수 있어요", "계정 탭에서 로그인해 주세요"],
  "save-wait": ["아직 저장되지 않은 포켓몬이에요", "저장이 끝나면 다시 올려 주세요"],
  TRADE_PET_NOT_SYNCED: ["아직 저장되지 않은 포켓몬이에요", "저장이 끝나면 다시 올려 주세요"],
  TRADE_PET_TRADED: ["이미 교환으로 보낸 포켓몬이에요", "다른 포켓몬을 골라 주세요"],
  // 서버 교환 중 예약 — 같은 개체가 다른 교환에 올라가 있다 (design-p2.md 17절 D31)
  TRADE_PET_BUSY: ["다른 교환에 올라가 있는 포켓몬이에요", "그 교환이 닫힌 뒤 다시 올리거나 다른 포켓몬을 골라 주세요"],
  TRADE_OFFER_INVALID: ["올릴 수 없는 포켓몬이에요", "다른 포켓몬을 골라 주세요"],
  // 서버 검증을 받지 못한 저장(P5) — 계정 저장을 확인하는 동안 교환을 막는다
  TRADE_SAVE_UNVERIFIED: ["지금은 교환할 수 없어요", "계정 저장을 확인하는 중이에요"],
};

// 계정 — 계정 탭의 오류 줄
const ACCOUNT: Partial<Record<FailCode, string>> = {
  AUTH_INVALID_LOGIN: "아이디 또는 비밀번호가 맞지 않아요",
  AUTH_USERNAME_TAKEN: "이미 쓰는 아이디",
  AUTH_USERNAME_INVALID: "영문 소문자로 시작, 소문자·숫자·_ 4~16자",
  AUTH_NAME_INVALID: "이름은 1~12자로 적어 주세요",
  AUTH_PASSWORD_WEAK: "비밀번호는 8자 이상이에요",
  AUTH_TRADE_ACTIVE: "교환 중에는 계정을 바꿀 수 없어요",
  AUTH_RATE_LIMITED: "잠시 뒤에 다시 해 주세요",
  AUTH_PORT_BUSY: "로그인 창을 열 수 없어요. 잠시 뒤에 다시 해 주세요",
  NETWORK: "서버에 연결할 수 없어요",
  CLOUD_LOGIN_REQUIRED: "다시 로그인해 주세요",
  CLOUD_UPDATE_REQUIRED: "업데이트해야 계정에 저장돼요",
  CLOUD_TRADE_ACTIVE: "다른 PC 에서 교환 중이라 넘겨받을 수 없어요",
  CLOUD_TRADE_UNSYNCED: "다른 PC 에서 끝낸 교환이 아직 저장되지 않았어요",
  CLOUD_OWNER_OTHER: "이 PC 진행은 다른 계정 것이라 올리지 않아요",
  CLOUD_BAD_SAVE: "계정 저장을 읽지 못해 올리지 않아요",
  CLOUD_TOO_LARGE: "저장이 너무 커서 올리지 못했어요",
  CLOUD_PET_TRADED_OUT: "교환으로 보낸 포켓몬이 남아 있어 올리지 않아요",
  CLOUD_ACCOUNT_HELD: "이 계정은 이용이 정지됐어요",
  CLOUD_HANDOFF_INVALID: "이 PC 진행을 계정으로 옮기지 못했어요",
  SAVE_BACKUP_FAILED: "이 PC 저장을 백업하지 못해 새로 시작하지 않았어요",
};

// 우편 — 편지 바닥의 상태 글자
const MAIL: Partial<Record<FailCode, string>> = {
  MAIL_LOGIN_REQUIRED: "로그인하면 받을 수 있어요.",
  MAIL_EXPIRED: "기간이 지나 받을 수 없어요.",
  MAIL_NOT_FOUND: "편지를 찾지 못했어요.",
  MAIL_NO_GIFTS: "받을 선물이 없어요.",
  NETWORK: "서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.",
  "bad-gift": "앱을 업데이트하면 받을 수 있어요.",
  "box-full": "박스에 빈 칸이 없어요. 자리를 만든 뒤 받아 주세요.",
  "cloud-wait": "클라우드 저장이 연결되면 받을 수 있어요. 계정 탭에서 저장 상태를 확인해 주세요.",
};

// 표에 없는 글자가 왔을 때 — 자리마다 지금 모양
const UNKNOWN: Record<FailScope, (code: string) => { text: string; detail?: string }> = {
  command: (code) => ({ text: code }),
  trade: (code) => ({ text: "교환을 진행하지 못했어요", detail: `잠시 뒤에 다시 해 주세요 (${code})` }),
  account: (code) => ({ text: `계정 작업을 하지 못했어요 (${code})` }),
  mail: (code) => ({ text: `받지 못했어요 (${code})` }),
};

// 실패 값의 문구 — 교환만 둘째 줄(detail)이 있다
export function failTextOf(code: FailCode | string, scope: FailScope): { text: string; detail?: string } {
  const key = code as FailCode; // 실행 때는 목록 밖의 글자도 온다 — 표에 없으면 UNKNOWN
  if (scope === "trade") {
    const pair = TRADE[key];
    return pair ? { text: pair[0], detail: pair[1] } : UNKNOWN.trade(code);
  }
  const text = scope === "command" ? BASE[key] : scope === "account" ? ACCOUNT[key] : MAIL[key];
  return text !== undefined ? { text } : UNKNOWN[scope](code);
}
