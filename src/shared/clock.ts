// 시계 — 모듈은 Date.now 를 직접 부르지 않고 이걸 주입받아 시험에서 시각을 돌린다 (brain.js · economy.js 의 태도)

export type Clock = () => number;

export const realClock: Clock = () => Date.now();

// 게임 시간 — 30분마다 낮과 밤이 바뀐다. 매시 0~29분이 낮이고 30~59분이 밤이다
//   진화와 해금이 같은 기준을 쓴다 — 하루를 기다리지 않아도 시간대 조건을 볼 수 있게 한 사용자 결정
export const GAME_DAY = { halfMin: 30 };
export const gameDayPart = (now: number): "day" | "night" => (new Date(now).getMinutes() < GAME_DAY.halfMin ? "day" : "night");

// 로컬 날짜 YYYY-MM-DD — 하루 상한·스트릭의 기준. UTC 가 아니라 사용자의 하루
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

