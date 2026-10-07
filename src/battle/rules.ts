// 배틀 파티 규칙 숫자 — 규칙은 docs/specs/adventure.md "배틀 파티", "출전 제한", "실제 능력치"
export const BATTLE_RULES = {
  slots: 6, // 배틀 파티 칸 수 — 6 대 6 전투
  level: 50, // 배틀 능력치는 모든 개체를 이 레벨로 계산한다
  iv: 31, // 개체값 — 여섯 능력치 모두 31(6V)
  ev: 0, // 노력치
  limits: { legendary: 1, sub: 2, mega: 1 }, // 출전 제한 — 초전설 칸·준전설 칸·메가 칸의 마릿수. 메가 칸은 메가진화·원시회귀를 모두 센다
} as const;

export type BattleTier = keyof typeof BATTLE_RULES.limits;
export type SpeciesTier = Exclude<BattleTier, "mega">; // 종으로 정해지는 칸
