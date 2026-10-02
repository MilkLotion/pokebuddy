// 화면 모델 — 친구 교환. 타입만 둔다

import type { SpeciesLine } from "./snapshot.js";

// ── 친구 교환 ───────────────────────────────────────────────────────────────────
// 교환 모달이 그리는 값 — 메인이 교환 흐름(src/trade/session.ts)의 보기와 저장을 합쳐 만든다 (src/main/trade-screen.ts).
// Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 6화면. 명령은 `command` 의 trade.* 로 보낸다. 결과에도 이 값(`screen`)이 온다
export interface TradeCardView extends SpeciesLine {
  species: string;
  shiny: boolean;
  level: number;
  nature: string;
}

export interface TradeScreen {
  available: boolean; // 교환을 쓸 수 없다(동반자 아님·reader·서버 설정 없음) — 모달은 안내만 보인다
  phase: "idle" | "hosting" | "trading" | "done" | "closed";
  link: string | null; // 내가 만든 링크 (hosting)
  expiresAt: number | null; // 참가 전 만료 시각 ms (hosting)
  busy: boolean;
  error: { code: string; detail?: string } | null; // 오류 배너 — 코드는 서버 TRADE_* · NETWORK · LOCAL
  closedReason: string | null; // closed 일 때 — guest_left · host_left · expired 등
  friendJoined: boolean;
  friendName: string | null; // 친구가 로그인했으면 가입 때 받은 이름
  mine: TradeCardView | null; // 내가 올린 포켓몬
  myPetId: string | null;
  myReady: boolean;
  friend: TradeCardView | null; // 친구가 올린 포켓몬 — 받을 수 없어도 보인다
  friendReady: boolean;
  friendBlocked: string | null; // 받을 수 없는 이유 — single 등
  singles: string[]; // 올릴 수 없는 개체 ID (단일 포켓몬)
  received: { petId: string; card: TradeCardView; party: number | null; box: string | null; hidden: boolean; sent: TradeCardView | null } | null; // 완료
}
