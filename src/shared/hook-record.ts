// 훅이 상태 기록에 적는 값의 모양 — 쓰는 쪽(src/hooks/pokebuddy-state.ts)과 읽는 쪽(src/terminal, src/agents)이 같은 타입을 본다.
// 타입만 둔다. 훅은 복사된 한 파일로 돌기 때문에 값을 가져오지 못한다 — import type 만 쓴다
import type { AgentState } from "./names/agents";

// ── 에이전트 사용량 ────────────────────────────────────────────────────────────
// 훅이 턴 끝(Stop)에 대화 기록에서 읽어 상태 기록에 누적해 적는 값. 상태 모듈은 증분만 본다
export interface Usage {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── 세션 상태 파일 한 장 (state/<세션>.json) ───────────────────────────────────
// 쓰는 쪽의 완전판이 원본이다
export interface HookStateRecord {
  state: AgentState;
  hold?: number; // 초. state 를 이만큼 보인 뒤 then 으로 본다 — 훅(전환 대상 갱신)과 읽는 쪽(src/terminal/state.ts agentStateOf)이 같은 뜻으로 쓴다
  then?: AgentState;
  cli: string; // --cli 인자. 인자가 없던 옛 등록은 "claude"
  event: string;
  at: number; // 초 (Date.now() / 1000)
  cwd: string;
  ancestors: number[];
  promptAt?: number | null; // 마지막 프롬프트 시각(초) — 이어 간다. 이전 기록이 없으면 null
  usage: Usage;
  usageOffset: number; // 대화 기록에서 읽은 바이트 자리
  usageBase: boolean; // 기준점을 잡았는가
  usageAt?: number;
}

// 읽는 쪽은 모든 필드를 의심한다 — 옛 훅이 쓴 기록, 쓰는 중인 파일, 손으로 고친 파일이 있다
export type HookStateRead = Partial<HookStateRecord>;
