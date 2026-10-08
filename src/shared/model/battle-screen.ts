// 배틀 창의 화면 모델 — 메인이 엔진 결과(src/battle/engine.ts BattleResult)로 만들고(src/view/battle-screen.ts) 렌더러가 재생한다
// 렌더러 빌드는 src/battle 을 보지 못한다. 그래서 이벤트 모양을 여기 다시 적는다 — 엔진과 어긋나면 view 의 변환이 컴파일 오류가 난다
// 화면 규칙은 docs/specs/ui-components.md "배틀 창으로 더한 것", Figma 05 `16 배틀`

import type { MoveView } from "./snapshot.js";
import type { LookSheets } from "./stage.js";

export type BattleSide = 0 | 1;
export type BattleStatusKind = "burn" | "paralysis" | "poison" | "toxic" | "freeze" | "sleep" | "confusion" | "flinch" | "trap"; // 엔진 StatusKind 와 같다

export interface BattlePos {
  x: number; // 계산 칸 — 몸(2×2)의 왼쪽 위
  y: number;
}

export interface BattleObstacleView extends BattlePos {
  size: 1 | 2; // 계산 칸
}

// 날씨·필드·오라 룰렛 한 칸 — 엔진이 판을 시작할 때 뽑는다 (docs/specs/moves.md "날씨, 필드, 오라")
// kind — 날씨 sun·rain·sand·snow·none·harsh-sun·heavy-rain·strong-winds, 필드 electric·grassy·psychic·misty, 오라 fairy·dark·break
export interface BattleRoulette {
  kind: string | null;
  candidates: { side: BattleSide; slot: number }[];
  picked: { side: BattleSide; slot: number } | null;
  fixed?: true; // 원시회귀·델타스트림처럼 룰렛 없이 정해졌다
}

// 엔진 BattleEvent 와 같은 모양 (src/battle/engine.ts). nextAt(다음 기술이 준비되는 시각)은 엔진이 줄 때만 있다 — 없으면 다음 기술을 쓴 시각까지로 어림한다
export type BattleScreenEvent =
  | { t: number; kind: "start"; obstacles: BattleObstacleView[]; pos: [(BattlePos | null)[], (BattlePos | null)[]]; roulette?: { weather?: BattleRoulette; field?: BattleRoulette; aura?: BattleRoulette } }
  | { t: number; kind: "step"; side: BattleSide; slot: number; x: number; y: number }
  | { t: number; kind: "move"; side: BattleSide; slot: number; move: string; nextAt?: number }
  | { t: number; kind: "attack"; side: BattleSide; slot: number }
  | { t: number; kind: "charge"; side: BattleSide; slot: number; move: string; nextAt?: number }
  | { t: number; kind: "miss"; side: BattleSide; slot: number; move: string; target: number }
  | { t: number; kind: "damage"; side: BattleSide; slot: number; target: number; amount: number; mult: number; hp: number; source: string; hit: number; crit?: true }
  | { t: number; kind: "self"; side: BattleSide; slot: number; amount: number; hp: number; cause: "recoil" | "half-hp" | "drain" }
  | { t: number; kind: "blocked"; side: BattleSide; slot: number; target: number; move: string }
  | { t: number; kind: "reflect"; side: BattleSide; slot: number; target: number; amount: number; hp: number }
  | { t: number; kind: "stat"; side: BattleSide; slot: number; stat: number; stage: number }
  | { t: number; kind: "form"; side: BattleSide; slot: number; species: string }
  | { t: number; kind: "copy"; side: BattleSide; slot: number; from: number; moves: string[] }
  | { t: number; kind: "weather"; side: BattleSide; slot: number; amount: number; hp: number; cause: "sand" | "grassy" | "rain-dish" | "ice-body" } // 5초마다 — 피해는 양수, 회복은 음수
  | { t: number; kind: "status"; side: BattleSide; slot: number; status: BattleStatusKind; on: boolean; until?: number } // 상태 이상 걸림(on, until = 풀리는 시각)·풀림 — 화면 표시는 아직 없다
  | { t: number; kind: "status-hp"; side: BattleSide; slot: number; amount: number; hp: number; cause: "burn" | "poison" | "toxic" | "trap" | "nightmare" | "poison-heal" | "confusion" } // 상태 이상 피해(양수)·회복(음수)
  | { t: number; kind: "faint"; side: BattleSide; slot: number }
  | { t: number; kind: "end"; winner: BattleSide | null; timeout: boolean };

// 칸 하나 — 카드와 전장의 포켓몬
export interface BattleUnitView {
  side: BattleSide;
  slot: number;
  species: string; // 보이는 모습(메가 포함)
  name: string;
  types: string[];
  portrait: string | null; // data URI
  moves: MoveView[]; // 쓰는 순서. meta 는 배틀 수치 한 줄(분류 · 위력 · 명중 · 쿨타임)
  ability: string | null; // 특성 이름 — 룰렛 칸에 보인다
  maxHp: number; // 전투 최대 HP
}

// 룰렛 릴 하나 — 판 표시 줄 칩과 룰렛 패널이 같이 쓴다. 후보가 없으면 candidates 가 비고 name 은 null
export interface BattleRouletteView {
  key: "weather" | "field" | "aura";
  kind: string | null; // 엔진 kind(sun·psychic·fairy …) — 전장 연출을 고른다. 후보가 없으면 null
  label: string; // 날씨 · 필드 · 오라
  name: string | null; // 걸린 효과 — 비 · 사이코필드 · 시작의바다 …
  type: string | null; // 관련 타입 아이콘 (docs/specs/ui-components.md "배틀 창으로 더한 것")
  fixed: boolean; // 룰렛 없이 정해졌다
  candidates: { side: BattleSide; slot: number }[];
  picked: { side: BattleSide; slot: number } | null;
}

// 판이 끝난 뒤 대화상자
export interface BattleResultView {
  title: string; // 이겼어요 · 졌어요 · 비겼어요
  lead: string; // 보상 줄
  detail: string;
  confirm: string; // 확인
}

export interface BattleScreenView {
  title: string; // 머리 줄 제목 — 랜덤 배틀
  sideNames: [string, string]; // 나 · 상대 · 2번 파티
  units: [(BattleUnitView | null)[], (BattleUnitView | null)[]];
  typeIcons: Record<string, string | null>; // 타입 → 흰 타입 아이콘 data URI. 기술 알약과 카드의 타입 칸이 같이 쓴다(바탕은 type-badge.css 의 --type)
  field: { w: number; h: number; body: number; stepMs: number; stageMs: number }; // 계산 칸 16×10, 몸 2, 한 칸 걷는 시간, 능력 변화 지속
  sprites: Record<string, LookSheets | null>; // 종 → 무대와 같은 PMD 그림 묶음. 없으면 초상으로 그린다
  zoom: number; // 도트 배율 — 크기 2단계(1.5)
  moveKinds: Record<string, "physical" | "special" | "status">; // 기술 → 분류. 공격 동작(Attack·Shoot)을 고른다
  maxMs: number; // 판 길이 상한
  endMs: number;
  events: BattleScreenEvent[]; // 시각 순서
  roulette: BattleRouletteView[] | null; // 릴 세 개(날씨·필드·오라). 엔진이 룰렛을 주지 않은 판은 null — 룰렛 없이 시작한다
  result: BattleResultView;
}
