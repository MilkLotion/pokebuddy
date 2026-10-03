// 숫자 글자 — 천 단위 쉼표(한국어)와 포인트 표기

export const numberText = (n: number): string => n.toLocaleString("ko-KR");

export const pointText = (n: number): string => `${numberText(n)}P`;
