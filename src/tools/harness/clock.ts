// 시험의 기준 시각과 난수 — 실행마다 같은 결과가 나오게 고정한다
//
// T0 는 2026-09-24 10:00 로컬이다. 게임 시간은 매시 0~10·21~30·41~50분이 낮, 11~20·31~40·51~59분이 밤이다(src/shared/clock.ts).
// 날짜에 기대는 검사(하루 기록, 이벤트 날짜)는 at() 으로 자기 시각을 만든다
export const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

// from(기본 T0)에서 min 분 뒤
export const at = (min: number, from: number = T0): number => from + min * 60_000;

// 늘 같은 값을 주는 난수
export const fixedRand = (value: number): (() => number) => () => value;

// 씨앗으로 정해지는 난수(선형 합동) — worklog 의 ab/models-dump.cjs 와 같은 식
export function seededRand(seed: number): () => number {
  let n = seed >>> 0;
  return () => (n = (n * 1664525 + 1013904223) >>> 0) / 0x100000000;
}
