// 랜덤 배틀 — 설정창(상대 고르기 모달)과 메인 사이의 값. 서버 호출은 src/online/battle-net.ts, 규칙은 docs/specs/adventure.md "상대 고르기", "서버"
import type { BattleCode } from "../names/online-codes.js";

// 칸의 그림 값 — 이로치·성별. 배틀 창과 상대 고르기 칸이 실제 개체 그림을 고른다(서버 battle-start looks, src/battle/fighter-core.ts lookOfSource)
export interface BattleLook {
  shiny: boolean;
  gender?: string; // male · female · unknown — 성별 그림이 따로 있는 종만 다르게 보인다
}

// 상대 파티의 칸 하나 — 종·모습·타입. 상대 이름은 없다
export interface BattlePickSlotView {
  species: string; // 보이는 모습(메가면 메가 모습)
  name: string;
  portrait: string | null; // 그림 열쇠
  types: string[];
}

// 보인 3개 — 줄은 늘 3개다. 후보가 모자란 줄은 party 가 null(실패 줄)
export interface BattleOfferView {
  offerId: string;
  rows: { slot: number; party: (BattlePickSlotView | null)[] | null }[];
  cooldownMs: number; // 남은 쿨타임. 0 이면 시작할 수 있다
  rerollLeft: number; // 남은 새로고침 — 판마다 1번. 0 이면 `새로고침` 을 흐린다
}

// 배틀 기록 — 서버 battle_record_view (supabase/migrations/20261010110000_battle_record_view.sql). 규칙 docs/specs/adventure.md "배틀 기록" 의 "앱에서 보이기"
export interface BattleTally {
  wins: number;
  losses: number;
  draws: number;
}
export interface BattleRecordRow {
  id?: string; // 판 식별자 — 배틀 상세를 연다. 옛 서버면 없다
  name?: string | null; // 상대 표시 이름(건 판은 고른 상대, 받은 판은 나를 고른 사람). null 은 익명 계정, 없으면 옛 서버
  detail?: boolean; // 판 요약이 있는가 — 2026-10-12 전의 판은 없다
  at: string; // 판 시각(ISO)
  mine: boolean; // 건 판이면 true, 받은 판(남이 내 배틀 파티를 고른 판)이면 false
  result: "win" | "lose" | "draw"; // 내 쪽에서 본 결과
  reward: number | null; // 받은 포인트 — 받은 판은 null
  endMs: number; // 판 길이
}
export interface BattleRecordData {
  mine: BattleTally; // 건 판
  def: BattleTally; // 받은 판
  recent: BattleRecordRow[]; // 최근 8판, 새 판이 앞
  unseen: BattleTally & { until: string | null }; // 지난 알림 뒤 받은 판 — until 은 그 가운데 마지막 판 시각
}

// 배틀 상세 — 서버 battle_detail (supabase/migrations/20261012100000_battle_history.sql). 양쪽은 내 쪽이 앞이다
export interface BattleDetailSlot {
  species: string; // 기본 종
  form: string | null; // 켠 메가 모습
  shiny: boolean;
  dealt: number; // 준 피해(실제로 깎인 HP)
  taken: number; // 받은 피해
  activeMs: number; // 싸운 시간 — 판 시작부터 기절 또는 판 끝까지
}
export interface BattleDetailData {
  id: string;
  at: string;
  mine: boolean;
  result: "win" | "lose" | "draw";
  reward: number | null;
  endMs: number;
  name: string | null;
  sides: [(BattleDetailSlot | null)[], (BattleDetailSlot | null)[]] | null; // 요약이 없는 판은 null
}

// DPS 표 한 줄 — 배틀 창 아래 표와 배틀 상세가 같이 쓴다 (docs/specs/adventure.md "DPS 표")
export interface BattleDpsRow {
  species: string; // 보이는 모습(메가면 메가 모습) — 초상을 고른다
  shiny: boolean;
  name: string;
  dealt: number;
  taken: number;
  dps: number;
}
// 배틀 상세 화면 값 — 기록 줄 하나와 양쪽 DPS 표(DPS 높은 순)
export interface BattleDetailView {
  row: BattleRecordRow;
  sides: [BattleDpsRow[], BattleDpsRow[]] | null;
}

export type BattleAction = { action: "offer"; reroll?: boolean } | { action: "start"; offerId: string; pick: number } | { action: "record" } | { action: "detail"; id: string };

export interface BattleReply {
  ok: boolean;
  code: BattleCode | null;
  detail?: string; // 목록 밖 코드의 원래 글자
  remainMs?: number; // BATTLE_COOLDOWN 이면 남은 쿨타임
  offer?: BattleOfferView; // offer 의 답
  reward?: number; // start 의 답 — 받은 포인트
  record?: BattleRecordData; // record 의 답
  battle?: BattleDetailView | null; // detail 의 답 — 없는 판이면 null
}
