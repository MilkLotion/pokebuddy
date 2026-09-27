// 부화 결과 판정 — 규칙은 docs/specs/game.md "알", 수치는 docs/specs/balance.md
//
// 결정 순서
//   1. 쌓은 행동 조건에 맞는 조건이 있으면 그 조건의 종들에서 뽑는다. 조건은 구매 당시 후보 범위를 넘어선다
//   2. 맞는 조건이 없으면 알에 저장한 후보 범위에서 뽑는다
//   3. 어느 쪽이든 수집 난이도 가중치로 뽑는다. 1등급이 흔하고 5등급이 귀하다
//   4. 이로치는 따로 같은 확률로 뽑는다
// 단일 포켓몬 알은 행동 조건을 보지 않는다(conditions: false). 후보 범위에서만 뽑는다
// 무작위는 받아서 쓴다 — 자체 검사가 결과를 정할 수 있어야 한다.
import { loadJson, type DexOptions } from "../dex/data.js";
import { matchCondition, speciesOf, type EggActions } from "./conditions.js";

export const SHINY_ONE_IN = 1000; // 이로치 확률 1/1000. 랜덤알과 태고의돌이 같다

// 수집 난이도별 추첨 가중치. 1등급 100 · 2등급 50 · 3등급 20 · 4등급 5 · 5등급 1
export const RANK_WEIGHT: Readonly<Record<number, number>> = { 1: 100, 2: 50, 3: 20, 4: 5, 5: 1 };

export type Rand = () => number; // 0 이상 1 미만

interface SpeciesRank {
  rank?: number;
}

export interface HatchResult {
  species: string;
  shiny: boolean;
  conditionId: string | null; // 조건으로 정해졌으면 그 식별자. 발견 기록에 쓴다
}

const rankOf = (slug: string, opts?: DexOptions): number => {
  const table = loadJson<Record<string, SpeciesRank>>("species.defaults.json", opts);
  return table[slug]?.rank ?? 1;
};

// 난이도 가중치로 하나 뽑는다. 후보가 없으면 null
export function pickWeighted(candidates: string[], rand: Rand, opts?: DexOptions): string | null {
  if (!candidates.length) return null;
  const weights = candidates.map((slug) => RANK_WEIGHT[rankOf(slug, opts)] ?? 1);
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return candidates[0] ?? null;
  let roll = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return candidates[i] ?? null;
  }
  return candidates[candidates.length - 1] ?? null;
}

// 알 하나의 결과. 후보가 하나도 없으면 null
export function decide(actions: EggActions, candidates: string[], rand: Rand, opts?: DexOptions, how: { conditions?: boolean } = {}): HatchResult | null {
  const conditionId = how.conditions === false ? null : matchCondition(actions, opts);
  const byCondition = conditionId ? speciesOf(conditionId, opts) : [];
  const pool = byCondition.length ? byCondition : candidates;
  const species = pickWeighted(pool, rand, opts);
  if (!species) return null;
  return {
    species,
    shiny: rand() < 1 / SHINY_ONE_IN,
    conditionId: byCondition.length ? conditionId : null,
  };
}
