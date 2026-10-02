// 파티와 개체의 규칙표 — 계약은 docs/specs/modules.md "저장 구조". 게임 숫자는 docs/specs/balance.md 를 따른다. 가져오는 것이 없는 파일이다

export const PARTY_RULES = {
  total: 6, // 파티 칸은 항상 여섯이다. 열림·빈 칸·잠김으로 상태를 나눈다
  openAtStart: 2, // 첫 선택을 마치면 두 칸으로 시작한다
  shopUnlock: 2, // 상점에서 살 수 있는 칸 수 — 첫 프리셋. 나머지 프리셋은 잠긴 칸을 모두 상점에서 산다 (2026-10-02 사용자 결정)
  // 파티 프리셋 — 두 개로 시작하고 상점에서 셋을 더 산다 (2026-10-02 사용자 결정). 이름 길이는 박스와 같다 (src/box/rules.ts BOX_RULES.nameMax)
  presets: { start: 2, max: 5 },
  startPoints: 120, // 첫 선택을 마치면 한 번 지급한다
};

// 새 개체의 시작 값과 값의 상한
export const PET_RULES = {
  level: 1,
  exp: 0,
  affinity: 0,
  fullness: 100, // 새 개체는 배부른 상태로 시작한다
  mood: 60,
  size: 1.5, // 도트 배율 — 크기 단계 2 의 배율 (src/party/size.ts SIZE_STEPS[1])
  home: { dx: -24, dy: -60 }, // 따라가는 창 오른쪽 아래 기준
  statMax: 100, // 친밀도·만복도·기분의 상한
};
