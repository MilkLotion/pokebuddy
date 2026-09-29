// 앱이 게임 시간을 적용·저장하는 주기 — 적립·만복도 수치는 src/save/rules.ts 의 TIME_V3_RULES 와 docs/specs/balance.md 다
export const STATE_RULES = {
  maxTickMs: 5_000, // 시계 틱 사이가 이보다 벌어지면 절전·중단으로 보고 작업 시간·줍기로 세지 않는다
  saveMs: 15_000, // 1초마다 메모리에 적용한 게임 시간을 파일에 쓰는 주기. 적용은 전역 시계의 1초 틱마다다 (src/main/clock.ts, 2026-09-29 사용자 결정)
};
