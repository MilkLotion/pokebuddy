// 모듈이 함께 쓰는 타입 — docs/design.md 2판의 저장 v2 · 성격 · 종 프로필 · 해금 조건 · 커맨드.
// 데이터를 소유하는 모듈은 각자(save · dex · state …)이고, 여기는 모양만 둔다. 값·규칙 숫자는 각 모듈의 규칙표에.

export type Lang = "ko" | "en";

// 훅이 알려 주는 에이전트 상태 (src/follow/state.ts resolveState 가 주는 값 그대로)
export type AgentState = "idle" | "running" | "waiting" | "waving" | "failed";

// 펫이 무엇에 묶여 사는가 (config.js MODES)
export type Mode = "session" | "window" | "companion";

// 연결할 수 있는 CLI 에이전트
export type AgentName = "claude" | "codex" | "gemini";

// ── 성격 ──────────────────────────────────────────────────────────────────────
// 다섯 축. 값은 +1 · 0 · −1 이고 앱 안에서는 전부 배율로 작동한다 (design.md "성격")
export type Axis = "activity" | "boldness" | "steadiness" | "sociability" | "patience";
export type AxisValue = -1 | 0 | 1;

// 원작 25개 성격 — 영어 식별자는 게임의 영어 이름 소문자
export type NatureId =
  | "hardy" | "lonely" | "brave" | "adamant" | "naughty"
  | "bold" | "docile" | "relaxed" | "impish" | "lax"
  | "timid" | "hasty" | "serious" | "jolly" | "naive"
  | "modest" | "mild" | "quiet" | "bashful" | "rash"
  | "calm" | "gentle" | "sassy" | "careful" | "quirky";

export interface Nature {
  id: NatureId;
  name: Record<Lang, string>;
  axes: Record<Axis, AxisValue>;
  // 변덕(quirky)만 — 가끔 아무 축이나 잠깐 튄다
  quirk?: "random";
}

// ── 종 프로필 ──────────────────────────────────────────────────────────────────
// data/species.defaults.json(PokeAPI 에서 뽑은 기본값) 위에 data/species.overrides.json 을 덧씌운 결과
export type Like = "work" | "play" | "company" | "food";

// 원작의 경험치 타입 6종 — 레벨 곡선을 고른다 (docs/specs/balance.md "성장")
export type GrowthRate = "fast" | "medium-fast" | "medium-slow" | "slow" | "erratic" | "fluctuating";

export interface SpeciesProfile {
  slug: string;
  dex: number;
  growthRate: GrowthRate; // 레벨 곡선
  bst: number; // 종족값 합계 — 수집 난이도 계산에 쓴다
  stage: number; // 사슬 뿌리부터의 거리 + 1 (1 이 진화 전)
  rank: number; // 수집 난이도 1~5 — 1 이 흔하고 5 가 귀하다
  affinityRate: number; // 시간 원천(켜 두기·일한 양·턴) 배율 — 1 이 기준
  hungerRate: number; // 배고픔이 차는 속도 배율 — 1 이 기준
  sleepiness: number; // 잠이 드는 빠름 배율 — 1 이 기준
  moodBase: number; // 기분 기준값 0~100
  moodSwing: number; // 기분 변동 폭 배율 — 1 이 기준
  likes: Like[]; // 무엇에 더 반응하나
  types: string[]; // 타입 이름 (PokeAPI 식별자)
  weightKg?: number;
  baseSpeed?: number;
}

// ── 해금 조건 ──────────────────────────────────────────────────────────────────
// data/unlocks.json — 종 하나에 규칙 하나. 적힌 조건은 전부 만족해야 한다 (design.md "도감 · 해금")
export type DayPart = "day" | "night";

// ── 진화 조건 ──────────────────────────────────────────────────────────────────
// data/evo.json 의 간선마다 하나. 원작 조건을 우리 게임의 조건으로 바꾼 결과다 (docs/specs/s5.md "진화 계약")
//   level    원작 레벨 그대로
//   affinity 친밀도 0~100. 원작 친밀도(0~255)를 환산하고, 우리에 없는 특수 조건도 여기로 모은다
//   item     진화용 도구 슬러그. 원작 도구와 새 도구(bond-cord · blank-cd)를 함께 쓴다
export type EvoNeed =
  | { kind: "level"; level: number }
  | { kind: "affinity"; value: number }
  | { kind: "item"; item: string };

export interface UnlockRule {
  starter?: true;
  base?: true; // 진화 전 첫 단계 종 — 처음부터 해금한다 (2026-09-25 사용자 결정)
  evolve?: { from: string; affinity: number; when?: DayPart };
  shop?: number; // 포인트 가격 — 해금된 뒤 상점에서 산다
  party?: { count: number };
  work?: { hours: number }; // 에이전트와 함께 일한 누적 시간
  streak?: { days: number };
  bond?: { of: string; affinity: number };
  time?: DayPart;
  event?: { date: string }; // "MM-DD"
}

// 해금 판정에 필요한 세상 — 저장 + 시각
export interface World {
  now: number; // ms
  hour: number; // 0~23, 로컬
  save: SaveV2;
}

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

export interface Pet {
  id: string; // "p1" 처럼 고유. 진화해도 그대로
  species: string; // 게임상의 종 (진화 단계)
  look?: string; // 보이는 그림 — 없으면 species. 해금된 모습(같은 진화 사슬) 중에서
  shiny: boolean;
  nature: NatureId;
  nick: string | null;
  size: number; // 도트 배율 (config dotSize 와 같은 단위)
  shown: boolean; // 무대에 보이나
  home: { dx: number; dy: number }; // 따라가는 창 오른쪽 아래 기준 자리
  hunger: number; // 0~100, 높으면 배고프다
  mood: number; // 0~100
  affinity: number; // 누적, 감소 없음
  stage: number; // 진화 단계 (0 부터)
  since: number;
  fedAt: number | null;
  playedAt: number | null;
  daily: PetDaily;
  evolved: string[]; // 거쳐 온 종
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

export interface SaveV2 {
  v: 2;
  points: number;
  slots: number; // 파티 칸 수 — 처음 1, 최대 6. party 길이는 이를 넘지 않는다
  party: Pet[];
  daily: { date: string; streak: number; interacted: boolean };
  totals: Totals;
  agents: Partial<Record<AgentName, AgentStats>>;
  unlocked: string[]; // 해금된 종 슬러그
  inventory: Record<string, number>;
  acc: Record<string, unknown>; // 10분·1분이 차기 전의 누적기 — 상태 모듈이 소유
  log: LogEntry[]; // 최근 200건
}

// ── 커맨드 ─────────────────────────────────────────────────────────────────────
// 우클릭·트레이·설정창·CLI·확장이 같은 모양으로 보내고, 처리기 하나가 모듈에 분배한다 (design.md "커맨드 처리기")
export type CommandName =
  | "feed" | "play" | "poke" | "evolve"
  | "party.show" | "party.hide" | "party.remove"
  | "party.place" | "party.swap" | "party.keep"
  | "box.sort" | "box.move" | "box.rename"
  | "egg.care" | "egg.open"
  | "bag.use"
  | "achievement.claim"
  | "tutorial.skip" | "tutorial.done"
  | "pet.set" | "pet.look" | "pet.form"
  | "starter.pick"
  | "agent.connect" | "agent.disconnect"
  | "settings.set"
  | "shop.buy"
  | "snapshot"
  | "quit";

export type CommandSource = "menu" | "tray" | "settings" | "cli" | "vscode" | "pet";

export interface Command {
  cmd: CommandName;
  target?: string; // 마리 id · CLI 이름 · 설정 키
  args?: Record<string, unknown>;
  from: CommandSource;
  at?: number;
}

// 결과는 문구가 아니라 코드 — 문구는 표면이 언어 파일로 만든다
export interface CommandResult {
  ok: boolean;
  reason: string; // "ok" · "cooldown" · "daily-cap" · "no-pet" · "unknown-cmd" · "not-writer" · "timeout" …
  [key: string]: unknown;
}

// ── 에이전트 사용량 ────────────────────────────────────────────────────────────
// 훅이 턴 끝(Stop)에 대화 기록에서 읽어 상태 기록에 누적해 적는 값. 상태 모듈은 증분만 본다
export interface Usage {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}
