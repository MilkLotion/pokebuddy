// 시계 — 모듈은 Date.now 를 직접 부르지 않고 이걸 주입받아 시험에서 시각을 돌린다 (brain.js · economy.js 의 태도)

export type Clock = () => number;

export const realClock: Clock = () => Date.now();

// 게임 시간 — 10분마다 낮과 밤이 바뀐다. 매시 0~10·21~30·41~50분이 낮, 11~20·31~40·51~59분이 밤이다
//   (2026-10-11 사용자 "낮밤은 10분마다로 바꾸자. 0~10, 21~30, 41~50 낮 11~20, 31~40, 51~00 밤". 그 전에는 30분마다 — 0~29분 낮, 30~59분 밤)
//   진화와 해금이 같은 기준을 쓴다 — 하루를 기다리지 않아도 시간대 조건을 볼 수 있게 한 사용자 결정
//   바뀌는 분 — 낮 → 밤은 11·31·51분, 밤 → 낮은 21·41분과 다음 시 0분
const GAME_DAY_SWITCH = [11, 21, 31, 41, 51, 60] as const;
export const gameDayPart = (now: number): "day" | "night" => {
  const m = new Date(now).getMinutes();
  return m > 0 && Math.floor((m - 1) / 10) % 2 === 1 ? "night" : "day";
};
// 다음에 낮·밤이 바뀌기까지 남은 시간(ms) — 파티 상세 진화 줄의 "8분 뒤 밤" (src/view/pet.ts)
export function gameDayLeftMs(now: number): number {
  const d = new Date(now);
  const inHour = d.getMinutes() * 60_000 + d.getSeconds() * 1000 + d.getMilliseconds();
  const next = GAME_DAY_SWITCH.find((min) => min * 60_000 > inHour) ?? 60;
  return next * 60_000 - inHour;
}

// 로컬 날짜 YYYY-MM-DD — 하루 상한·스트릭의 기준. UTC 가 아니라 사용자의 하루
export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

