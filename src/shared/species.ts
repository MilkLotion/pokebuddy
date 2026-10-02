// 종·성격·성별·진화 조건·해금 조건의 모양 — 데이터를 소유하는 모듈은 dex 다. 여기는 타입만 둔다

import type { AgentName, AgentState } from "./names/agents.js";
import type { CommandName, CommandSource } from "./names/commands.js";

// 이름 목록에서 얻는 타입 — 원본은 ./names/ 다. [임시] 이 파일을 주제별로 나눌 때 다시 내보내기를 없앤다
export type { AgentName, AgentState } from "./names/agents.js";
export type { CommandName, CommandSource } from "./names/commands.js";

export type Lang = "ko" | "en";

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
  genderRate: number; // 원작 성비 — 암컷 비율 8 분의 몇(0 수컷만 · 8 암컷만), -1 은 무성 (src/dex/gender.ts)
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

// ── 성별 ───────────────────────────────────────────────────────────────────────
// 개체의 성별. none 은 무성 종(코일·전설 등) — 원작 성비를 따른다 (src/dex/gender.ts, 2026-09-30 사용자 결정)
export type Gender = "male" | "female" | "none";

// ── 진화 조건 ──────────────────────────────────────────────────────────────────
// data/evo.json 의 간선마다 하나. 원작 조건을 우리 게임의 조건으로 바꾼 결과다 (docs/specs/game.md "진화 계약")
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
  bond?: { of: string; affinity: number };
  time?: DayPart;
  event?: { date: string }; // "MM-DD"
}
