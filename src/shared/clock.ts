// 시계 — 모듈은 Date.now 를 직접 부르지 않고 이걸 주입받아 시험에서 시각을 돌린다 (brain.js · economy.js 의 태도)

export type Clock = () => number;

export const realClock: Clock = () => Date.now();

// 로컬 날짜 YYYY-MM-DD — 하루 상한·스트릭의 기준. UTC 가 아니라 사용자의 하루
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

