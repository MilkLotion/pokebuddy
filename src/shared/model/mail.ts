// 화면 모델 — 우편함. 타입만 둔다
import type { MailReplyCode } from "../names/online-codes.js";

// ── 우편함 ───────────────────────────────────────────────────────────────────────
// 헤더 봉투 단추가 여는 모달 (받기 흐름 src/online/mail-inbox.ts, 화면 값 src/view/mail.ts). Figma 05 Screens 섹션 `10 우편함` `932:22859` (A안 편지 + 선물)
// manage:mail 은 렌더러 → 메인 요청(결과에 screen), manage:mail-view 는 메인 → 렌더러 밀어 보내기다
export interface MailGiftView {
  kind: "item" | "points" | "pokemon";
  id: string | null; // 도구 id — 그림(item:<id>)을 찾는다. 포켓몬은 종 slug(초상). 포인트는 null
  name: string; // "경험사탕M" · "포인트" · "미뇽"
  count: number;
}

export interface MailLetterView {
  id: string;
  title: string;
  body: string;
  sender: string;
  startsAt: number;
  endsAt: number | null; // 없으면 기한 없음
  gifts: MailGiftView[]; // 비면 공지 편지
  claimedAt: number | null; // 서버가 받은 기록을 가진 시각
  applied: boolean; // 이 저장에 선물을 넣었다
  read: boolean;
  unsupported: boolean; // 모르는 선물이 있다 — 앱을 업데이트해야 받는다
}

export interface MailScreen {
  available: boolean; // 서버 설정이 있다
  status: "idle" | "loading" | "ok" | "offline";
  signedIn: boolean; // 정식 계정 — 선물은 로그인해야 받는다
  letters: MailLetterView[]; // 최근 순
  unread: number; // 읽지 않았거나 받을 선물이 남은 편지 수 — 헤더 점
  busy: string | null; // 받는 중인 편지 id
  error: string | null; // 마지막 받기의 실패 코드 — MAIL_* · NETWORK · bad-gift
}

export type MailAction = { action: "refresh" } | { action: "read"; id: string } | { action: "claim"; id: string };

export interface MailReply {
  ok: boolean;
  code: MailReplyCode | null;
  screen: MailScreen;
}
