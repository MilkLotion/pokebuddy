// 친선 배틀 — 설정창(친선 배틀 모달)과 메인 사이의 값. 서버 호출은 src/online/friendly-session.ts, 규칙은 docs/specs/adventure.md "친선 배틀"
// 화면은 Figma 05 `15 모험` 줄 4(시작 1879:5768·친구 기다림 1879:6474·로그인 필요 1879:7191·오류 1879:7874·만남 1879:12592·내가 준비 1879:9281·출전 불가 1879:9964)
import type { BattlePickSlotView } from "./battle-net.js";

//   idle     시작 — 링크 만들기·링크로 참가
//   hosting  링크를 만들고 친구를 기다린다
//   meet     친구와 만났다 — 양쪽 배틀 파티·준비
//   closed   닫혔다(친구가 나감·시간 초과). 시작 화면 위에 닫힘 배너
export type FriendlyPhase = "idle" | "hosting" | "meet" | "closed";

export interface FriendlyScreen {
  available: boolean; // 서버 설정이 있는가
  signedIn: boolean; // 로그인한 계정인가 — 아니면 로그인 안내 (2026-10-10 사용자 결정 "로그인한 계정만")
  phase: FriendlyPhase;
  busy: boolean;
  link: string | null; // 내가 만든 링크(hosting)
  expiresAt: number | null; // 참가 전 남은 시간을 셀 시각(이 PC 시계, ms)
  friendName: string | null; // 친구 표시 이름 — 없으면 `친구`
  myReady: boolean;
  friendReady: boolean;
  running: boolean; // 판정 중
  mine: (BattlePickSlotView | null)[] | null; // 내 배틀 파티 6칸
  friend: (BattlePickSlotView | null)[] | null;
  myBlocked: boolean; // 내 배틀 파티가 비었거나 출전 불가가 있다 — `준비` 막힘
  closedReason: string | null; // host_left · guest_left · expired
  error: { code: string; detail?: string } | null;
}

export type FriendlyAction =
  | { action: "view" }
  | { action: "create" }
  | { action: "join"; link: string }
  | { action: "ready"; ready: boolean }
  | { action: "leave" };
