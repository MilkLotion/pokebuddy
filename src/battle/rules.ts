// 배틀 파티 규칙 숫자 — 규칙은 docs/specs/adventure.md "배틀 파티", "출전 제한", "실제 능력치"
export const BATTLE_RULES = {
  slots: 6, // 배틀 파티 칸 수 — 6 대 6 전투
  level: 50, // 배틀 능력치는 모든 개체를 이 레벨로 계산한다
  iv: 31, // 개체값 — 여섯 능력치 모두 31(6V)
  ev: 0, // 노력치
  // 출전 제한 — 초전설 칸 1마리, 초전설·준전설 합 3마리, 메가 칸 1마리. 메가 칸은 메가진화·원시회귀를 모두 센다
  // (2026-10-22 사용자 "전설1,준전설2으로하거나 준전설3 으로 되게 해"). 세는 함수는 src/battle/fighter-core.ts blockedOf
  limits: { legendary: 1, legend: 3, mega: 1 },
} as const;

export type BattleTier = keyof typeof BATTLE_RULES.limits; // 출전 불가 까닭 — 넘은 제한
export type SpeciesTier = "legendary" | "sub"; // 종으로 정해지는 칸
