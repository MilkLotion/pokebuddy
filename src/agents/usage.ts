// 에이전트 토큰 사용량 — 훅이 세션 기록에 누적해 둔 usage 를 읽고, 펫이 마지막으로 본 값과의 증분을 낸다.
//
// 훅(src/hooks/pokebuddy-state.ts)은 claude 의 턴이 끝날 때 대화 기록에서 usage 를 읽어 `state/<세션>.json` 에 누적값으로 적는다.
// 상태 모듈은 누적값이 아니라 "지난 tick 뒤 얼마나 늘었나" 만 쓰므로 여기서 증분을 만든다.
// 펫이 처음 뜰 때는 기존 세션의 누적값을 기준점(baseline)으로 잡아 옛 사용량을 세지 않는다.
// 파일·시각을 모르는 순수 함수와, 폴더를 읽는 함수 하나(readSessionUsages)로 나뉜다
import type { AgentName } from "../shared/names/agents";
import type { Usage } from "../shared/hook-record";
import { cliOf, readHookFiles } from "./hook-records";

export const ZERO_USAGE: Readonly<Usage> = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };

// 토큰 수로 접을 때의 가중치 — 캐시 읽기는 싼 토큰이라 낮게. 상태 모듈이 자기 규칙표로 덮어쓴다 [스펙 미확정]
export interface UsageWeights {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}
export const DEFAULT_WEIGHTS: Readonly<UsageWeights> = { in: 1, out: 1, cacheRead: 0.1, cacheWrite: 1 };

export interface SessionUsage {
  sessionId: string;
  cli: AgentName | string;
  usage: Usage;
  at: number; // 기록이 마지막으로 바뀐 시각 (ms)
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  in: a.in + b.in,
  out: a.out + b.out,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

// 누적값 차이 — 줄었으면(기록이 새로 시작됨) 지금 값 전체를 증분으로 본다
export function diffUsage(now: Usage, prev: Usage): Usage {
  const d = (a: number, b: number) => (a >= b ? a - b : a);
  return { in: d(now.in, prev.in), out: d(now.out, prev.out), cacheRead: d(now.cacheRead, prev.cacheRead), cacheWrite: d(now.cacheWrite, prev.cacheWrite) };
}

export const tokensOf = (u: Usage, w: Readonly<UsageWeights> = DEFAULT_WEIGHTS): number =>
  Math.round(u.in * w.in + u.out * w.out + u.cacheRead * w.cacheRead + u.cacheWrite * w.cacheWrite);

export const isUsage = (v: unknown): v is Usage =>
  !!v && typeof v === "object" && ["in", "out", "cacheRead", "cacheWrite"].every((k) => {
    const n = (v as Record<string, unknown>)[k];
    return typeof n === "number" && Number.isFinite(n) && n >= 0;
  });

// 훅 기록 폴더 → 세션별 사용량. 파일 이름이 세션 id 다. usage 가 없는 기록(codex·gemini·옛 훅)은 뺀다
export function readSessionUsages(stateDir: string): SessionUsage[] {
  const out: SessionUsage[] = [];
  for (const { session, record } of readHookFiles(stateDir)) {
    if (!isUsage(record.usage)) continue;
    const atSec = Number(record.usageAt ?? record.at) || 0;
    out.push({ sessionId: session, cli: cliOf(record), usage: record.usage, at: Math.round(atSec * 1000) });
  }
  return out;
}

// 세션별 "마지막으로 본 누적값" — 상태 모듈이 저장(acc)에 넣어 둔다
export type SeenUsage = Record<string, Usage>;

// 처음 뜰 때의 기준점 — 지금 누적값을 전부 본 것으로 친다 (옛 사용량은 세지 않는다)
export const usageBaseline = (current: SessionUsage[]): SeenUsage => Object.fromEntries(current.map((s) => [s.sessionId, { ...s.usage }]));

// 지난번 본 뒤 늘어난 양. 일시적으로 못 읽은 세션도 기준점을 유지 — 다음 읽기에서 전체가 다시 적립되지 않게
export function deltaSince(current: SessionUsage[], seen: SeenUsage): { delta: Usage; perSession: Record<string, Usage>; seen: SeenUsage } {
  let delta: Usage = { ...ZERO_USAGE };
  const perSession: Record<string, Usage> = {};
  const next: SeenUsage = Object.fromEntries(Object.entries(seen).map(([id, u]) => [id, { ...u }]));
  for (const s of current) {
    const prev = seen[s.sessionId] ?? ZERO_USAGE;
    const d = diffUsage(s.usage, prev);
    if (d.in || d.out || d.cacheRead || d.cacheWrite) perSession[s.sessionId] = d;
    delta = addUsage(delta, d);
    next[s.sessionId] = { ...s.usage };
  }
  return { delta, perSession, seen: next };
}
