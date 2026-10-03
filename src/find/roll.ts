// 줍기 굴림 — 마리별로 조건을 채운 시간만큼 굴려 주운 마리를 고른다. 저장을 보지 않는다. 규칙은 src/find/pickup.ts 머리말
import { type Rand } from "../shared/rand.js";
import { TIME_RULES } from "../state/rules.js";
import { FIND_RULES } from "./rules.js";
import type { FindKind } from "../shared/save-v3";

export { FIND_RULES };

// 항목 순서 — 가중치 누적 순서. 자주 나오는 것부터
export const KINDS: readonly FindKind[] = ["points", "item", "evo", "pokemon"];

// 주웠을 때 그 항목이 나올 몫 — 가중치 ÷ 가중치 합
export const shareOf = (kind: FindKind): number => FIND_RULES.weights[kind] / KINDS.reduce((a, k) => a + FIND_RULES.weights[k], 0);

// 마리가 조건을 채운 ms 동안 무언가를 주울 확률 — 1초마다 perSecond 인 독립 시행을 합친다. rate 는 개발용 배율
export function chanceFor(ms: number, rate = 1): number {
  const perSecond = Math.min(1, Math.max(0, FIND_RULES.perSecond * rate));
  const sec = Math.max(0, ms) / 1000;
  return 1 - (1 - perSecond) ** sec;
}

// 굴림 — 마리별로 조건을 채운 시간(ms)만큼 한 번씩 굴려 주운 마리를 돌려준다. 저장을 보지 않는다. 마리끼리 독립이다
export function rollHits(activeMs: Readonly<Record<string, number>>, rand: Rand, rate = 1): string[] {
  const hits: string[] = [];
  for (const [petId, raw] of Object.entries(activeMs)) {
    const ms = Math.max(0, raw);
    if (ms <= 0 || ms > TIME_RULES.maxGapMs) continue; // 긴 틈은 굴리지 않는다 — 절전 복귀 뒤에 몰아서 주지 않는다
    if (rand() < chanceFor(ms, rate)) hits.push(petId); // 대부분은 아무것도 줍지 않는다
  }
  return hits;
}
