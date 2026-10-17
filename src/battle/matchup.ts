// 타입 상성 줄 — 배틀 파티 상세 기기 창 `상세보기` 말풍선 (docs/specs/adventure.md "타입 상성", 2026-10-17)
// - 방어: 공격 타입마다 받는 배율. 두 타입이면 곱한다. 배율 ×4·×2·×0.5·×0.25·×0 줄만, 타입이 없는 줄은 뺀다
// - 공격: 자기 타입마다 그 타입으로 때릴 때의 배율. ×2·×0.5·×0 줄만
// - 상성표는 엔진과 같은 data/type-chart.json(공격 → 방어 → 배율). 특성·날씨는 넣지 않는다 — 타입만 본다
// - 타입 순서는 상성표의 키 순서(원작 도감 순서)다
export type TypeChart = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface MatchupRow {
  mul: number;
  types: string[]; // 타입 키
}

const DEFENSE_MULS = [4, 2, 0.5, 0.25, 0] as const;
const ATTACK_MULS = [2, 0.5, 0] as const;

function rowsOf(muls: readonly number[], pairs: [string, number][]): MatchupRow[] {
  return muls.map((mul) => ({ mul, types: pairs.filter(([, m]) => m === mul).map(([t]) => t) })).filter((r) => r.types.length > 0);
}

// 받는 배율 — typeIds 는 방어하는 쪽의 타입 1~2개
export function defenseRows(chart: TypeChart, typeIds: readonly string[]): MatchupRow[] {
  const pairs = Object.keys(chart).map((atk): [string, number] => [atk, typeIds.reduce((m, def) => m * (chart[atk]?.[def] ?? 1), 1)]);
  return rowsOf(DEFENSE_MULS, pairs);
}

// 때리는 배율 — typeId 는 공격하는 쪽의 타입 하나
export function attackRows(chart: TypeChart, typeId: string): MatchupRow[] {
  const row = chart[typeId] ?? {};
  return rowsOf(ATTACK_MULS, Object.keys(chart).map((def): [string, number] => [def, row[def] ?? 1]));
}
