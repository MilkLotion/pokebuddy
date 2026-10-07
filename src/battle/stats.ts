// 실제 능력치 — 원작 능력치 공식. 성격 보정과 도구 보정은 없다 (docs/specs/adventure.md "실제 능력치")
//   HP        ⌊(2B + IV + ⌊EV/4⌋) × L / 100⌋ + L + 10
//   그 밖     ⌊(2B + IV + ⌊EV/4⌋) × L / 100⌋ + 5
// 배틀은 레벨 50·개체값 31·노력치 0 이다. 탐험은 개체의 실제 레벨과 친밀도로 정한 개체값을 쓴다 (exploreBasis)
import { profileOf } from "../dex/species.js";
import { megaBattleTable } from "../dex/tables.js";
import type { DexOptions } from "../dex/data.js";
import { BATTLE_RULES } from "./rules.js";

const STAT_COUNT = 6; // HP, 공격, 방어, 특수공격, 특수방어, 스피드

export interface StatBasis {
  level: number;
  iv: number;
  ev: number;
}

const BATTLE_BASIS: Readonly<StatBasis> = { level: BATTLE_RULES.level, iv: BATTLE_RULES.iv, ev: BATTLE_RULES.ev };

// 종족값 하나 → 실제 능력치 하나. index 0 이 HP 다
export function realStat(base: number, index: number, basis: StatBasis = BATTLE_BASIS): number {
  const core = Math.floor(((2 * base + basis.iv + Math.floor(basis.ev / 4)) * basis.level) / 100);
  if (index !== 0) return core + 5;
  // 껍질몬처럼 HP 종족값이 1 인 종은 원작에서 HP 가 늘 1 이다
  if (base === 1) return 1;
  return core + basis.level + 10;
}

// 종의 종족값 6개 — 메가·원시회귀 모습이면 data/mega-battle.json. 표에 없으면 null
export function baseStatsOf(slug: string, opts?: DexOptions): number[] | null {
  const stats = megaBattleTable(opts)[slug]?.stats ?? profileOf(slug, opts).stats;
  return Array.isArray(stats) && stats.length === STAT_COUNT ? [...stats] : null;
}

// 종의 실제 능력치 6개 — 종족값이 없으면 null
export function realStatsOf(slug: string, basis: StatBasis = BATTLE_BASIS, opts?: DexOptions): number[] | null {
  const base = baseStatsOf(slug, opts);
  return base ? base.map((b, i) => realStat(b, i, basis)) : null;
}

// 탐험 능력치의 기준 — 개체의 실제 레벨, 개체값은 친밀도 3당 1(상한 31). 노력치·성격 보정은 배틀과 같이 쓰지 않는다 (docs/specs/adventure.md "실제 능력치")
export const exploreBasis = (pet: { level: number; affinity: number }): StatBasis => ({
  level: pet.level,
  iv: Math.min(BATTLE_RULES.iv, Math.floor(pet.affinity / 3)),
  ev: 0,
});
