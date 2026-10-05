// 값 막대의 트랙과 채움 — 파티 칸(설정창)과 파티 상세 기기 창이 같이 쓴다. 이름 줄은 창마다 모양이 달라 각 창에 둔다
import { el } from "./dom.js";

export const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

// 만복도 구간의 채움 색 — 배고픔·매우 배고픔만 색이 바뀐다
export const zoneClassOf = (zone: string | undefined): string => (zone === "hungry" || zone === "starving" ? zone : "");

// div.track > div.fill. cls 는 채움에 더할 클래스(구간·심심함)
export function fillBarEl(value: number, cls = ""): HTMLElement {
  const track = el("div", "track");
  const fill = el("div", cls ? `fill ${cls}` : "fill");
  fill.style.width = `${clampPercent(value)}%`;
  track.appendChild(fill);
  return track;
}
