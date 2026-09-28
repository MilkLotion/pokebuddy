// 저장 v3 의 모양 — 계약은 docs/specs/modules.md "저장 구조". v2 는 열 때 한 번 변환한다 (src/save/migrate-v3.ts)
//
// v2 와 다른 점
//   - 개체를 파티 배열에 직접 두지 않는다. `pets` 에 모으고 `party.slots` 가 식별자로 가리킨다.
//     빈 칸과 잠긴 칸을 표현할 수 있어야 파티 칸 규칙이 성립한다.
//   - 배고픔(hunger) 대신 만복도(fullness) 를 쓴다. 용어사전의 사용자 용어와 맞춘다. fullness = 100 − hunger
//   - 멈추는 값은 시각이 아니라 남은 시간으로 저장한다. PC 잠금·절전 중에는 시간이 흐르지 않기 때문이다.
//   - 시간 값은 전부 ms 정수다. 화면 표기만 초·분으로 반올림한다.
import type { AgentStats, LogEntry, NatureId, PetDaily, Totals } from "./types";

// ── 개체 ───────────────────────────────────────────────────────────────────────
// 장난감은 오래 놀아주기와 같은 버프를 준다. 그래서 종류를 따로 두지 않는다 (docs/specs/game.md "장난감")
export type BuffKind = "premium-food" | "long-play";

export interface BuffV3 {
  kind: BuffKind;
  remainMs: number; // 남은 시간. 0 이면 끝
}

export interface PetV3 {
  id: string; // 진화해도 그대로
  species: string;
  shiny: boolean;
  nature: NatureId;
  size: number; // 도트 배율
  level: number; // 1~100
  exp: number; // 누적 경험치. 레벨은 종의 성장 곡선으로 읽는다
  affinity: number; // 친밀도 0~100, 누적이며 줄지 않는다
  affinityProgressMs: number; // 다음 친밀도 1 까지의 부분 진행. 버프와 디버프를 반영한 가중 시간
  fullness: number; // 만복도 0~100. 높을수록 배부르다
  fullnessProgressMs: number; // 다음 만복도 1 감소까지의 부분 진행
  mood: number; // 0~100
  moodProgressMs: number; // 다음 기분 1 감소까지의 부분 진행 (배율을 반영한 가중 시간)
  feedCooldownMs: number; // 밥 주기 남은 쿨타임
  playCooldownMs: number; // 놀아주기 남은 쿨타임
  playWindowMs: number; // 놀아주기 상태의 남은 시간. 이 안에 또 놀아주면 중첩이 오른다
  playStreak: number; // 이어서 놀아준 횟수. 정해진 수에 닿으면 오래 놀아주기 버프가 붙는다
  buffs: BuffV3[];
  home: { dx: number; dy: number };
  screen?: ScreenRefV3; // 모든 화면 놀이공간에서 사는 화면 — 끌어다 놓을 때 정한다. 없으면 개체가 가장 적은 화면 (2026-09-28 여러 화면)
  since: number;
  stage: number; // 이 개체가 진화한 횟수
  evolved: string[]; // 거쳐 온 종
  forms?: string[]; // 공유 sid 계열의 고를 수 있는 종 (src/dex/forms.ts). 그 밖의 개체에는 없다
  daily: PetDaily;
}

// ── 파티 ───────────────────────────────────────────────────────────────────────
export type SlotState = "pokemon" | "empty" | "locked";
export type SlotUnlockBy = "shop" | "achievement";

export interface PartySlotV3 {
  state: SlotState;
  petId?: string; // state 가 pokemon 일 때만
  hidden?: boolean; // 숨김 여부. 숨겨도 포인트와 친밀도는 쌓인다
  unlockBy?: SlotUnlockBy; // state 가 locked 일 때 어떻게 여는가
}

// ── 박스 ───────────────────────────────────────────────────────────────────────
export interface BoxV3 {
  id: string;
  name: string;
  slots: (string | null)[]; // 길이 30. 개체 식별자 또는 빈 칸
}

// ── 알 ─────────────────────────────────────────────────────────────────────────
export interface EggV3 {
  id: string;
  kind: string; // data/eggs.json 의 키. random · ancient-stone
  boughtAt: number;
  remainMs: number; // 준비까지 남은 시간
  ready: boolean;
  candidates: string[]; // 구매 당시 후보 종
  careCooldownMs: number; // 돌봄 남은 쿨타임
  actions: { pat: number; song: number }; // 인정한 돌봄 횟수. 행동 조건의 입력
}

// ── 그 밖의 영역 ───────────────────────────────────────────────────────────────
export interface PointsV3 {
  balance: number;
  progressMs: number; // 다음 1포인트까지의 부분 진행
}

export interface DexV3 {
  unlocked: string[];
  obtained: string[];
  shinyObtained: string[];
  discovered: Record<string, string>; // 종 → 발견한 알 행동 조건 식별자
  rulesRev: number; // 해금 정리를 마친 판 — SAVE_V3_RULES.unlockRev. 옛 저장은 0
}

export interface AchievementV3 {
  achievedAt: number | null;
  claimedAt: number | null;
}

export type TutorialState = "none" | "active" | "skipped" | "done";

export interface TutorialV3 {
  state: TutorialState;
  steps: number; // 끝낸 단계 수
  queuedAt?: number; // 시작 조건을 채운 시각 — 먼저 생긴 것부터 보여 준다 (src/tutorial/core.ts)
}

// 놀이공간 방식 — 모든 화면 · 한 화면 · 영역 지정 (2026-09-28 여러 화면). 옛 "full"(주 화면)은 읽을 때 "screen" + 주 화면이 된다
export type PlayAreaMode = "all" | "screen" | "region";

// 화면 하나를 가리키는 값 — Electron Display.id 와 그 화면의 사각형(DIP). id 가 없어지면 사각형이 가장 많이 겹치는 화면을 쓴다
export interface ScreenRefV3 {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SettingsV3 {
  language: string;
  startOnLogin: boolean;
  sound: boolean;
  volume: number; // 소리 크기 0~100 (src/state/settings.ts SOUND_RULES). 2026-09-27 에 더했다
  sleepAfterMin: number;
  playArea: { mode: PlayAreaMode; rect: { x: number; y: number; w: number; h: number } | null; screen: ScreenRefV3 | null }; // screen 은 한 화면 방식의 고른 화면. null 이면 주 화면
  display: Record<string, unknown>;
}

// 친구 교환에 걸린 개체 — 확정할 때 남기고, 반영·취소·만료 때 지운다 (src/trade/core.ts)
// 저장 형식 번호는 올리지 않는다. 없으면 빈 값으로 읽는다
export interface TradePendingV3 {
  channelId: string; // 서버의 공유 채널
  petId: string; // 내가 올린 개체
  offerRev: number; // 내가 확정한 제안 판
  received: unknown; // 완료 뒤 받은 개체 값. 반영 전에 앱이 꺼져도 다시 받아 오므로 비어 있을 수 있다
}

export interface TxRecordV3 {
  id: string; // 요청 식별자
  at: number;
  result: unknown; // 같은 요청을 다시 받으면 그대로 돌려준다
}

export interface SaveV3 {
  v: 3;
  savedAt: number;
  lastTickAt: number;
  pets: PetV3[];
  starterPetId: string | null; // 첫 선택으로 만난 개체. 업적 판정에 쓴다
  party: { slots: PartySlotV3[] };
  boxes: BoxV3[];
  eggs: EggV3[];
  eggSeq: number; // 지금까지 만든 알 수 — 알 식별자를 다시 쓰지 않게 한다. 연 알의 식별자가 새 알에 붙으면 배너 기록이 겹친다
  bag: Record<string, number>;
  points: PointsV3;
  dex: DexV3;
  achievements: Record<string, AchievementV3>;
  tutorials: Record<string, TutorialV3>;
  settings: SettingsV3;
  daily: { date: string; streak: number; interacted: boolean };
  totals: Totals;
  agents: Partial<Record<string, AgentStats>>;
  tx: TxRecordV3[];
  legacy: Record<string, unknown>; // 새 화면에서 쓰지 않는 옛 값. 지우지 않고 보존한다
  log: LogEntry[];
  trade?: { pending: TradePendingV3 | null };
}
