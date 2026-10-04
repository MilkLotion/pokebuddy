// 저장 v3 의 모양 — 계약은 docs/specs/modules.md "저장 구조". v2 는 열 때 한 번 변환한다 (src/save/migrate-v3.ts)
//
// v2 와 다른 점
//   - 개체를 파티 배열에 직접 두지 않는다. `pets` 에 모으고 `party.slots` 가 식별자로 가리킨다.
//     빈 칸과 잠긴 칸을 표현할 수 있어야 파티 칸 규칙이 성립한다.
//   - 배고픔(hunger) 대신 만복도(fullness) 를 쓴다. 용어사전의 사용자 용어와 맞춘다. fullness = 100 − hunger
//   - 멈추는 값은 시각이 아니라 남은 시간으로 저장한다. PC 잠금·절전 중에는 시간이 흐르지 않기 때문이다.
//   - 시간 값은 전부 ms 정수다. 화면 표기만 초·분으로 반올림한다.
import type { Gender, NatureId } from "./species.js";

// ── 저장이 함께 쓰는 작은 모양 ─────────────────────────────────────────────────
// 시각은 전부 ms (Date.now())
// ── 저장 v2 ────────────────────────────────────────────────────────────────────
// 시각은 전부 ms (Date.now()). 마리에 id 를 두어 종이 바뀌어도(진화) 같은 마리다
export interface PetDaily {
  date: string; // YYYY-MM-DD 로컬 — 날짜가 바뀌면 비운다
  gained: number; // 오늘 오른 친밀도 (하루 상한 대조)
  feeds: number;
  plays: number;
  pokes: number;
  presence: number; // 오늘 켜 두기로 오른 친밀도
  work: number; // 오늘 일한 양(토큰·시간)으로 오른 친밀도
  turns: number; // 오늘 턴 완료 횟수
}

export interface Totals {
  workMs: number;
  presenceMs: number;
  tokens: number;
  turns: number;
  days: number;
  fed: number;
  played: number;
}

export interface AgentStats {
  connected: boolean;
  date?: string; // tokensToday 의 날짜
  tokensToday?: number;
  tokensTotal?: number;
}

export interface LogEntry {
  at: number;
  kind: string;
  [key: string]: unknown;
}

// ── 개체 ───────────────────────────────────────────────────────────────────────
// 장난감은 놀아주기 3중첩과 같은 버프(신남)를 준다. 그래서 종류를 따로 두지 않는다 (docs/specs/game.md "장난감")
// 이름 — premium-food 든든함 · long-play 신남(옛 이름 오래 놀아주기) · short-play 들뜸 (2026-09-29 사용자 결정).
// 식별자는 바꾸지 않았다 — 옛 저장과 옛 판 앱(클라우드로 같은 저장을 읽는)이 신남 버프를 그대로 읽는다
export type BuffKind = "premium-food" | "long-play" | "short-play";

export interface BuffV3 {
  kind: BuffKind;
  remainMs: number; // 남은 시간. 0 이면 끝
}

// 메가진화 (2026-10-02) — 규칙은 src/dex/mega.ts. 저장 형식 번호는 올리지 않는다. 없으면 진행 0 으로 읽는다
export interface MegaV3 {
  bondMs: number; // 친밀도 100 이 된 뒤 파티에서 보낸 시간
  care: number; // 친밀도 100 이 된 뒤 밥 주기·놀아주기 횟수
  stone?: true; // 조건을 채워 메가스톤을 지녔다
  on?: string; // 지금 메가 모습의 슬러그 (data/mega.json). 없으면 기본 모습
}

export interface PetV3 {
  id: string; // 진화해도 그대로
  species: string;
  shiny: boolean;
  nature: NatureId;
  gender: Gender; // 2026-09-30 에 더했다. 옛 저장은 열 때 정한다 (src/dex/gender.ts legacyGender)
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
  playStreak: number; // 이어서 놀아준 횟수. 2 면 들뜸, 3 이면 신남 버프가 붙는다
  buffs: BuffV3[];
  home: { dx: number; dy: number };
  screen?: ScreenRefV3; // 모든 화면 놀이공간에서 사는 화면 — 끌어다 놓을 때 정한다. 없으면 개체가 가장 적은 화면 (2026-09-28 여러 화면)
  since: number;
  stage: number; // 이 개체가 진화한 횟수
  evolved: string[]; // 거쳐 온 종
  forms?: string[]; // 공유 sid 계열의 고를 수 있는 종 (src/dex/forms.ts). 그 밖의 개체에는 없다
  mega?: MegaV3; // 메가진화 진행과 모습 (src/dex/mega.ts). 메가 모습이 있는 종이 친밀도 100 이 된 뒤에 생긴다
  daily: PetDaily;
}

// 만복도 구간 — 경계값은 src/state/time.ts zoneOf 가 정한다
export type FullnessZone = "full" | "normal" | "hungry" | "starving";

// ── 파티 ───────────────────────────────────────────────────────────────────────
export type SlotState = "pokemon" | "empty" | "locked";
export type SlotUnlockBy = "shop" | "achievement";

export interface PartySlotV3 {
  state: SlotState;
  petId?: string; // state 가 pokemon 일 때만
  hidden?: boolean; // 숨김 여부. 숨겨도 포인트와 친밀도는 쌓인다
  unlockBy?: SlotUnlockBy; // state 가 locked 일 때 어떻게 여는가
}

// 파티 프리셋 (2026-10-02) — 규칙은 worklog/records/party-preset/record.md "확정 설계".
// 저장 형식 번호는 올리지 않는다. 새 칸은 없으면 읽을 때 채운다 (src/save/normalize.ts normalizeSave)
//   - 개체는 한 프리셋에만 든다. 프리셋에 든 개체는 박스에 없다
//   - 칸의 잠금은 프리셋마다 따로다. 적용은 칸을 잠금째 맞바꾼다 (src/party/presets.ts applyPreset)
export interface PartyV3 {
  slots: PartySlotV3[]; // 적용한 프리셋의 칸 — 바탕화면에 나오고 시간이 흐른다
  active?: number; // 적용한 프리셋 번호. 0 부터
  presets?: (PartySlotV3[] | null)[]; // 번호 순. 적용한 번호의 자리는 null — 그 칸은 slots 에 있다
  presetNames?: string[]; // 번호 순 이름. 빈 글자면 기본 이름 "프리셋 N" 이다
  presetCount?: number; // 가진 프리셋 수
  slotCount?: number; // 모든 프리셋의 열린 칸 수 — 다음 프리셋 구매 조건에 쓴다
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
  // 알 돌봄(2026-09-28 삭제)의 옛 칸. 쓰지 않는다. 옛 버전이 클라우드 저장을 읽다 멈추지 않게 기본값만 적는다
  careCooldownMs: number;
  actions: { pat: number; song: number };
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
  discovered: Record<string, string>; // 알 행동 조건(2026-09-28 삭제)의 옛 칸. 쓰지 않는다 — 옛 버전 호환으로 읽은 값을 그대로 둔다
  rulesRev: number; // 해금 정리를 마친 판 — UNLOCK_RULES.rev. 옛 저장은 0
  megaOpened?: string[]; // 메가스톤이 생긴 적이 있는 종 — 도감 카드의 메가스톤 표식. 개체를 팔거나 교환해도 남는다 (2026-10-02)
}

export interface AchievementV3 {
  achievedAt: number | null;
  claimedAt: number | null;
  quiet?: true; // 업적 목록이 늘어난 뒤 첫 판정에서 한꺼번에 달성한 업적 — 배너를 띄우지 않는다 (src/achievement/evaluate.ts evaluate)
}

// 업적이 세는 누적 값 (src/achievement/evaluate.ts). 2026-10-03 에 더했다
export interface CountsV3 {
  hatched: number; // 알에서 포켓몬이 나온 횟수. 옛 저장은 만든 알 수 − 기다리는 알 수에서 시작한다
  evolved: number; // 진화 횟수. 옛 저장은 가진 개체의 stage 합에서 시작한다
  traded: number; // 끝난 교환 횟수. 옛 저장은 0 에서 시작한다
  day: string; // 마지막으로 앱이 돈 날 (로컬 날짜)
  streak: number; // 이어서 앱이 돈 날 수
}

export type TutorialState = "none" | "active" | "skipped" | "done";

export interface TutorialV3 {
  state: TutorialState;
  steps: number; // 끝낸 단계 수
  queuedAt?: number; // 시작 조건을 채운 시각 — 먼저 생긴 것부터 보여 준다 (src/tutorial/queue.ts)
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

// 친구 교환에 걸린 개체 — 확정할 때 남기고, 반영·취소·만료 때 지운다 (src/trade/exchange.ts)
// 저장 형식 번호는 올리지 않는다. 없으면 빈 값으로 읽는다
export interface TradePendingV3 {
  channelId: string; // 서버의 공유 채널
  petId: string; // 내가 올린 개체
  offerRev: number; // 내가 확정한 제안 판
  received: unknown; // 완료 뒤 받은 개체 값. 반영 전에 앱이 꺼져도 다시 받아 오므로 비어 있을 수 있다
}

// 줍기 — 무대의 포켓몬이 주워 온 것 (src/find/pickup.ts). 저장 형식 번호는 올리지 않는다. 없으면 빈 값으로 읽는다
export type FindKind = "points" | "item" | "evo" | "pokemon";

export interface FindRecordV3 {
  id: string; // f<순번> — 알림 배너 키가 된다 (src/notify/queue.ts)
  at: number;
  petId: string; // 주운 마리
  species: string; // 주운 마리의 그때 종 — 개체가 사라져도 문구를 만든다
  kind: FindKind;
  ref: string; // 도구 식별자 · 종. 포인트면 빈 값
  amount: number; // 포인트 양. 그 밖은 1
  newPetId?: string; // 데려온 개체
}

// 쌓인 활동 시간은 저장하지 않는다 — 판정이 무기억이다. 옛 판의 activeMs 는 읽을 때 버린다 (2026-09-29 마리별 1초 판정)
export interface FindV3 {
  seq: number; // 지금까지 만든 줍기 기록 수 — 기록 식별자를 다시 쓰지 않는다
  log: FindRecordV3[]; // 최근 기록 (FIND_RULES.keep)
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
  party: PartyV3;
  boxes: BoxV3[];
  eggs: EggV3[];
  petSeq: number; // 지금까지 쓴 개체 번호의 최댓값 — 판 개체의 식별자를 새 개체에 다시 쓰지 않게 한다 (src/shop/sell-pet.ts, src/party/create.ts nextPetId). 2026-10-02 에 더했다
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
  mail?: { applied: string[]; read: string[] }; // 우편함 — 선물을 넣은 편지·읽은 편지 id (src/mail/gifts.ts)
  find?: FindV3; // 줍기 — 활동 시간 진행과 최근 기록 (src/find/pickup.ts)
  counts: CountsV3; // 업적이 세는 누적 값 — 새 저장과 정규화가 늘 채운다 (src/save/normalize.ts)
  achRev?: number; // 업적 목록의 판 — ACHIEVEMENT_REV 보다 작으면 다음 판정에서 달성한 업적을 조용히 기록한다
}
