// 숫자·포인트·남은 시간 글자 — 메인의 화면 값(view)과 렌더러가 같이 쓴다. node·DOM 을 쓰지 않는다

// 천 단위 쉼표(한국어)
export const numberText = (n: number): string => n.toLocaleString("ko-KR");

export const pointText = (n: number): string => `${numberText(n)}P`;

// 남은 ms → 초·분 정수. 올림이다 — 기다리는 동안 0 을 보이지 않는다 (94 항목 9-3-1). 화면 값의 남은 초·분 칸이 이것을 쓴다
export const ceilSec = (ms: number): number => Math.ceil(ms / 1000);
export const ceilMin = (ms: number): number => Math.ceil(ms / 60_000);

// 남은 시간 — 1분 미만은 초, 1시간 미만은 분(올림), 그 위는 시간과 분. 쿨타임·알 준비가 10분·몇 시간이라 초로 쓰면 읽기 어렵다
// 남은 시간 글자는 이것 하나다 — 단추·알·버프 갱신·첫 돌봄 말풍선이 같이 쓴다 (94 항목 5-1). 언어는 부르는 쪽이 준다(shared 는 설정 언어를 모른다)
const WAIT_UNIT = { ko: { s: "초", m: "분", h: "시간", gap: " " }, en: { s: "s", m: "m", h: "h", gap: " " } } as const;
export function waitText(sec: number, lang: "ko" | "en" = "ko"): string {
  const u = WAIT_UNIT[lang];
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}${u.s}`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min}${u.m}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}${u.h}${u.gap}${m}${u.m}` : `${h}${u.h}`;
}

// 버프 배지 — 이름과 남은 시간. 1시간 미만은 분(0분이면 1분), 그 위는 시간(올림). 파티 칸 오른쪽 위 한 줄 폭에 맞춘 짧은 꼴이다
// (2026-09-30 사용자 결정 "추천대로 진행해")
export const buffText = (b: { name: string; remainMin: number }): string =>
  `${b.name} ${b.remainMin < 60 ? `${Math.max(1, b.remainMin)}분` : `${Math.ceil(b.remainMin / 60)}시간`}`;
