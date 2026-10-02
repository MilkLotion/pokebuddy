// 그림 크기 단계 — 단계 번호(1부터) 순서의 도트 배율. 저장(Pet.size)은 배율을 적고, 화면·명령은 단계 번호를 쓴다.
// 더 큰 크기가 필요하면 배열 끝에 배율을 더한다(예: 3.5). 단계 수·단추 수는 이 배열 길이를 따른다.
// 2026-09-27 사용자 결정: 옛 1과 2 사이 단계를 두고, 옛 3을 가장 크게 한다. 옛 저장의 더 큰 배율은 가장 큰 단계로 줄인다
// 새 개체의 크기는 단계 2 다 (src/party/rules.ts PET_RULES.size, 2026-09-27 사용자 결정 "기본크기 2로")
export const SIZE_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3];

// 배율에서 가장 가까운 단계 번호 — 같은 거리면 작은 쪽
export function sizeLevelOf(zoom: number): number {
  let best = 0;
  for (let i = 1; i < SIZE_STEPS.length; i++) if (Math.abs((SIZE_STEPS[i] ?? 0) - zoom) < Math.abs((SIZE_STEPS[best] ?? 0) - zoom)) best = i;
  return best + 1;
}

// 단계 번호의 배율. 없는 단계면 null
export const zoomOfLevel = (level: number): number | null => (Number.isInteger(level) ? (SIZE_STEPS[level - 1] ?? null) : null);

// 저장 값을 단계 배율로 맞춘다
export const snapSize = (zoom: number): number => SIZE_STEPS[sizeLevelOf(zoom) - 1] ?? 2;
