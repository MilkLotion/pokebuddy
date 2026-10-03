// 숫자·시간 글자 — 기기 창 모델이 쓴다. 렌더러의 ui/number-text.ts·ui/time-text.ts 와 같은 글자다(기기 창 모델을 메인이 만들면 렌더러 쪽은 없어진다)

// 천 단위 쉼표(한국어)
export const numberText = (n: number): string => n.toLocaleString("ko-KR");

export const pointText = (n: number): string => `${numberText(n)}P`;

// 남은 시간 — 1분 미만은 초, 1시간 미만은 분(올림), 그 위는 시간과 분
export function waitText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
