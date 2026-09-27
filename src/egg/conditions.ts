// 알 행동 조건 — 규칙은 docs/specs/game.md "알 행동 조건", 표는 data/egg-conditions.json
//
// 조건은 쓰다듬기와 노래 들려주기의 인정 횟수로 갈린다. 일곱 조건은 서로 겹치지 않는다.
// 어디에도 맞지 않는 조합이 있다. 그런 알은 일반 추첨으로 간다 — 부화를 막지 않는다.
import { loadJson, type DexOptions } from "../dex/data.js";

export interface EggActions {
  pat: number;
  song: number;
}

export interface EggCondition {
  pat: [number, number | null]; // [최소, 최대]. 최대 null 이면 상한 없음
  song: [number, number | null];
  ko: string; // 도감에 그대로 적는 문구
}

export interface EggConditionTable {
  conditions: Record<string, EggCondition>;
  species: Record<string, string>; // 종 → 조건 식별자
}

const table = (opts?: DexOptions): EggConditionTable => loadJson<EggConditionTable>("egg-conditions.json", opts);

const inRange = (v: number, [lo, hi]: [number, number | null]): boolean => v >= lo && (hi === null || v <= hi);

// 인정 횟수에 맞는 조건 식별자. 맞는 것이 없으면 null
export function matchCondition(actions: EggActions, opts?: DexOptions): string | null {
  const { conditions } = table(opts);
  for (const [id, c] of Object.entries(conditions)) {
    if (inRange(actions.pat, c.pat) && inRange(actions.song, c.song)) return id;
  }
  return null;
}

// 그 조건이 부르는 종 목록
export function speciesOf(conditionId: string, opts?: DexOptions): string[] {
  const { species } = table(opts);
  return Object.entries(species)
    .filter(([, id]) => id === conditionId)
    .map(([slug]) => slug);
}

// 그 종을 부르는 조건 식별자. 조건 종이 아니면 null
export const conditionOf = (slug: string, opts?: DexOptions): string | null => table(opts).species[slug] ?? null;

// 도감에 적는 조건 문구
export function textOf(conditionId: string, opts?: DexOptions): string | null {
  return table(opts).conditions[conditionId]?.ko ?? null;
}
