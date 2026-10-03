// 움직임 모듈의 타입 — 마리별 brain 의 입출력, 성격 배율과 주변 위치
import type { Play } from "../shared/model/stage";
import type { AgentState } from "../shared/names/agents";

// 성격 배율 자리 — S2 는 NEUTRAL_PARAMS (전부 1 · 0). S3 가 natures 축 → 값
export interface MotionParams {
  paceScale: number; // 걷는 속도 배율 (활동성)
  pauseScale: number; // 쉬는 시간 배율 (활동성 반대)
  fidgetScale: number; // 제자리 동작 확률 배율
  sleepScale: number; // 잠들기까지 시간 배율 (안정성)
  reactScale: number; // 만지기 반응 길이 배율 (대담함)
  socialPull: number; // −1~+1 다른 마리에게 다가감 (사교성) — S3 에서 씀
  cursorPull: number; // −1~+1 커서를 쫓음/피함 (대담함) — S3 에서 씀
}

// art 에서 뽑은 보유 동작 (옛 body.js capabilities)
export interface MotionCaps {
  have: Set<string>;
  durOf(anim: string): number;
  work: Record<string, "once" | "loop">;
  workOnly: Set<string>;
  zoom: number;
}

export interface RoamBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MotionInput {
  now: number;
  agent: AgentState;
  box: RoamBox | null;
  visible: boolean;
  // 집·돌봄 이동을 뺀 산책 좌표 — 중립이면 입력이 있어도 사용하지 않음
  company?: { x: number; y: number }[];
  cursor?: { x: number; y: number } | null;
}

export type Phase = "rest" | "walk" | "look" | "fidget" | "work" | "sleep" | "wake" | "react" | "react-yield" | "held" | "yield";

export interface MotionOut {
  roam: { x: number; y: number };
  act: Play | null;
  phase: Phase;
  rhythm: "idle" | "work";
}

export interface PetMotion {
  tune(params: MotionParams): void;
  // 설정 `잠들기 기준`(분)이 바뀌었다 — 0 이면 잠들지 않음, null 이면 규칙표 기본값 (params.ts withSleepAfter)
  sleepAfter(min: number | null): void;
  tick(input: MotionInput): MotionOut;
  // 옛 body.js state — 활동 bump 규칙 포함. promptAt 은 초 단위. now 를 안 주면 마지막 tick 의 now 로 친다
  state(agent: AgentState, promptAt: number | null, now?: number): void;
  focus(key: string | null, now?: number): void;
  pickup(now: number): void;
  drag(dx: number, dy: number): void;
  drop(now: number): void;
  click(now: number): void;
  rehome(now: number): void;
}

export interface PetMotionOptions {
  caps: MotionCaps;
  params?: MotionParams;
  sleepAfterMin?: number | null; // 설정 `잠들기 기준`(분). 0 이면 잠들지 않음. 없으면 규칙표 기본값
  mode?: "on" | "calm";
  timeScale?: number;
  rng?: () => number;
  reactMs?: number; // 작업 상태가 바뀐 뒤 반응하기까지 최대 지연(ms) — 마리마다 0~이 값 사이. 기본 0(바로)
  log?: ((o: Record<string, unknown>) => void) | null;
  now?: number; // 만든 시각 — 마지막 사용자 활동의 시작값 (막 켰으면 사용자가 있는 것). 없으면 첫 tick 의 now
}
