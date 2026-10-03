// 숫자·포인트·남은 시간 글자 — 메인의 화면 값(view)과 렌더러가 같이 쓴다. node·DOM 을 쓰지 않는다

// 천 단위 쉼표(한국어)
export const numberText = (n: number): string => n.toLocaleString("ko-KR");

export const pointText = (n: number): string => `${numberText(n)}P`;

// 남은 시간 — 1분 미만은 초, 1시간 미만은 분(올림), 그 위는 시간과 분. 쿨타임·알 준비가 10분·몇 시간이라 초로 쓰면 읽기 어렵다
export function waitText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 버프 배지 — 이름과 남은 시간. 1시간 미만은 분(0분이면 1분), 그 위는 시간(올림). 파티 칸 오른쪽 위 한 줄 폭에 맞춘 짧은 꼴이다
// (2026-09-30 사용자 결정 "추천대로 진행해")
export const buffText = (b: { name: string; remainMin: number }): string =>
  `${b.name} ${b.remainMin < 60 ? `${Math.max(1, b.remainMin)}분` : `${Math.ceil(b.remainMin / 60)}시간`}`;
