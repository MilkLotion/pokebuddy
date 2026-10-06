// 알의 규칙표 — 수치는 docs/specs/balance.md "확률과 알". 가져오는 것이 없는 파일이다
export const EGG_RULES = {
  readyMs: 5 * 60_000, // 준비 시간 5분. 알 돌봄(단축)은 2026-09-28 삭제했다
  maxEggs: 6, // 돌보미집 칸 수
  shinyOneIn: 1000, // 이로치 확률 1/1000. 랜덤알과 태고의돌이 같다
  // 수집 난이도별 추첨 가중치. 1등급 100 · 2등급 50 · 3등급 20 · 4등급 5 · 5등급 1
  rankWeight: { 1: 100, 2: 50, 3: 20, 4: 5, 5: 1 } as Readonly<Record<number, number>>,
  // 다 모은 단일 포켓몬 알의 포인트 — 랜덤알에서 그 알이 나왔는데 줄 수 없으면 알 값 × allCaughtRate, allCaughtUnit 단위로 내림
  // (2026-10-07 사용자 결정 "전체 다 구했을 경우에는 포인트지급", 지급액은 상점가의 절반)
  allCaughtRate: 0.5,
  allCaughtUnit: 10,
};
