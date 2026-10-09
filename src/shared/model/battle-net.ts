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
}

export type BattleAction = { action: "offer" } | { action: "start"; offerId: string; pick: number };

export interface BattleReply {
  ok: boolean;
  code: BattleCode | null;
  detail?: string; // 목록 밖 코드의 원래 글자
  remainMs?: number; // BATTLE_COOLDOWN 이면 남은 쿨타임
  offer?: BattleOfferView; // offer 의 답
  reward?: number; // start 의 답 — 받은 포인트
}
