// 낮·밤 반원 게이지 — 앱 머리 포인트 왼쪽 (2026-10-11 사용자 "반원게이지모양으로 밤낮표기하는 그런게", "게이지 괜찮네. 이대로 하면 될듯")
// Figma 02 `Day Gauge` `1954:2696`(Part=Day·Night), 05 `02 파티` `Party / Base · 낮 게이지`·`밤 게이지`
//   40×24 알약 안에 반원 띠 — 바탕 띠 위에 지금 시간대에서 지난 몫만큼 진행 띠, 그 끝에 해(낮) 또는 초승달(밤)
//   가리키면 "낮 · 8분 뒤 밤". 낮·밤 규칙은 src/shared/clock.ts (10분마다)
import type { Snapshot } from "../../shared/model/snapshot.js";

const NS = "http://www.w3.org/2000/svg";
// 원 중심(20, 19), 띠 가운데 반지름 12.45, 띠 두께 3.1 — Figma 의 반지름 14·안쪽 비율 0.78 띠와 같다
const CX = 20;
const CY = 19;
const R = 12.45;
const BAND = 3.1;

const COLORS = {
  day: { bg: "#e7f3f6", track: "#cfe3e8", fill: "#f5b73b", dot: "#ffb020", ring: "#ffe08a" },
  night: { bg: "#26324f", track: "#3d4a6b", fill: "#8e9cf0", dot: "#f4f1d0", ring: "" },
} as const;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// 반원 위의 점 — p 는 0(왼쪽 끝)~1(오른쪽 끝)
const at = (p: number, r = R): [number, number] => {
  const a = Math.PI + Math.PI * p;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
};
const arc = (p: number): string => {
  const [x0, y0] = at(0);
  const [x1, y1] = at(p);
  return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

// 남은 시간 글자 — "낮 · 8분 뒤 밤". 분은 올림
export const dayGaugeText = (day: Snapshot["day"]): string => {
  const now = day.part === "night" ? "밤" : "낮";
  const next = day.part === "night" ? "낮" : "밤";
  return `${now} · ${Math.max(1, Math.ceil(day.leftMs / 60_000))}분 뒤 ${next}`;
};

export function drawDayGauge(host: HTMLElement, day: Snapshot["day"]): void {
  const c = COLORS[day.part];
  const p = Math.min(1, Math.max(0, day.progress));
  const svg = node("svg", { width: 40, height: 24, viewBox: "0 0 40 24", "aria-hidden": "true" });
  svg.append(
    node("rect", { width: 40, height: 24, rx: 12, fill: c.bg }),
    node("path", { d: arc(1), fill: "none", stroke: c.track, "stroke-width": BAND }),
  );
  if (p > 0) svg.appendChild(node("path", { d: arc(p), fill: "none", stroke: c.fill, "stroke-width": BAND }));
  const [dx, dy] = at(p); // 해·달은 띠 가운데 — Figma 의 반지름 14 × 0.89 와 같다
  if (day.part === "day") svg.appendChild(node("circle", { cx: dx, cy: dy, r: 4, fill: c.dot, stroke: c.ring, "stroke-width": 1 }));
  else svg.append(node("circle", { cx: dx, cy: dy, r: 4, fill: c.dot }), node("circle", { cx: dx + 1.6, cy: dy - 0.8, r: 3.2, fill: c.bg }));
  host.replaceChildren(svg);
  const label = dayGaugeText(day);
  host.title = label;
  host.setAttribute("aria-label", label);
}
