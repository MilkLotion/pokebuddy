// 배틀 창 전장의 몸 위 연출 — 상태 이상이 걸린 동안의 불씨·전기·거품·얼음·Z·별·땀, 걸림·5초 판정·풀림 순간, 능력 변화 꺾쇠
// (docs/specs/ui-components.md "배틀 창으로 더한 것", 시안 "상태 이상·판정")
// - 포켓몬 위·연출 알약 아래 canvas 한 장. 걸린 포켓몬에게만 그리고 전장 전체는 칠하지 않는다
// - 위쪽 줄 포켓몬의 별·Z 가 잘리지 않게 전장보다 PAD 만큼 넓게 둔다
import type { BattleStatusKind } from "../../shared/model/battle-screen.js";
import type { Mark } from "../../shared/battle-timeline.js";

const W = 448;
const H = 280;
const PAD = 32;
const BODY = 13; // 연출을 그린 몸 반높이(px) — 실제 몸 반높이 r 에 맞춰 r ÷ BODY 배로 키운다

// 상태 색 — 원작 상태 표시 색에 맞춤. 머리 위 칩의 점과 팝 숫자도 이 색을 쓴다. 표에 없는 상태는 색을 칠하지 않는다
export const STATUS_COLOR: Readonly<Partial<Record<BattleStatusKind, string>>> = {
  burn: "#f0703a",
  paralysis: "#f0c630",
  poison: "#b05ad0",
  toxic: "#8a3ac0",
  freeze: "#7fd4f0",
  sleep: "#a8a8c0",
  confusion: "#f08ac8",
  flinch: "#c0bcb0",
};
const STATUS_RGB: Readonly<Partial<Record<BattleStatusKind, string>>> = {
  burn: "240,112,58",
  paralysis: "240,198,48",
  poison: "176,90,208",
  toxic: "138,58,192",
  freeze: "127,212,240",
  sleep: "168,168,192",
  confusion: "240,138,200",
  flinch: "192,188,176",
};

// 포켓몬 하나 — 몸 가운데(px)·몸 반높이와 지금 걸린 것
export interface StatusFxUnit {
  x: number;
  y: number;
  r: number;
  major: BattleStatusKind | null;
  majorAt: number; // 걸린 시각 — 얼음이 덮이는 순간
  confused: boolean;
  flinched: boolean;
}
// 순간 연출 하나 — 그 포켓몬의 몸 가운데
export interface StatusFxMark extends Pick<Mark, "kind" | "status" | "t"> {
  x: number;
  y: number;
  r: number;
}

export interface StatusFx {
  draw(t: number, units: StatusFxUnit[], marks: StatusFxMark[], markMs: number): void;
}

type Ctx = CanvasRenderingContext2D;
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const ease = (u: number): number => 1 - Math.pow(1 - clamp(u), 3);
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 부드러운 빛 점 — 색마다 한 번 그려 두고 다시 쓴다
const GLOW = new Map<string, HTMLCanvasElement>();
function glow(rgb: string): HTMLCanvasElement {
  let c = GLOW.get(rgb);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.18, `rgba(${rgb},0.65)`);
  gr.addColorStop(0.5, `rgba(${rgb},0.16)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  GLOW.set(rgb, c);
  return c;
}
function dot(g: Ctx, rgb: string, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01 || r <= 0) return;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(glow(rgb), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
}
function lighter(g: Ctx, fn: () => void): void {
  g.save();
  g.globalCompositeOperation = "lighter";
  fn();
  g.restore();
}
function star(g: Ctx, x: number, y: number, r: number): void {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = "#ffe066";
  g.fill();
  g.strokeStyle = "#a06a00";
  g.lineWidth = 0.8;
  g.stroke();
}

// ── 걸려 있는 동안 ──
function flames(g: Ctx, x: number, y: number, t: number): void {
  lighter(g, () => {
    for (let k = 0; k < 5; k++) {
      const ph = mod(t / 700 + k / 5, 1);
      const fx = x - 10 + k * 5 + Math.sin(t / 160 + k) * 1.5;
      const fy = y + 8 - ph * 22;
      const s = (1 - ph) * 4 + 1;
      dot(g, "255,150,60", fx, fy, s * 2.2, 0.75 * (1 - ph));
      dot(g, "255,230,150", fx, fy + 1, s, 0.8 * (1 - ph));
    }
  });
}
function sparks(g: Ctx, x: number, y: number, t: number): void {
  const cyc = Math.floor(t / 850);
  const ph = mod(t, 850) / 850;
  if (ph > 0.28) return;
  const r = rng(cyc * 71);
  const u = ph / 0.28;
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  for (let s = 0; s < 2; s++) {
    const a0 = r() * Math.PI * 2;
    const x0 = x + Math.cos(a0) * 8;
    const y0 = y + Math.sin(a0) * 9;
    const pts: [number, number][] = [[x0, y0]];
    for (let k = 1; k < 4; k++) pts.push([x0 + Math.cos(a0) * k * 4 + (r() - 0.5) * 6, y0 + Math.sin(a0) * k * 4 + (r() - 0.5) * 6]);
    for (const [lw, col] of [[3, `rgba(240,180,20,${0.45 * (1 - u)})`], [1.2, `rgba(255,250,200,${1 - u})`]] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.stroke();
    }
  }
  g.restore();
}
function bubbles(g: Ctx, x: number, y: number, t: number, rgb: string, n: number): void {
  for (let k = 0; k < n; k++) {
    const ph = mod(t / 1500 + k / n, 1);
    const bx = x - 9 + ((k * 7) % 18) + Math.sin(t / 300 + k) * 2;
    const by = y + 4 - ph * 26;
    const r = 1.6 + ((k * 3) % 3) * 0.8;
    g.globalAlpha = ph < 0.85 ? 0.85 : ((1 - ph) / 0.15) * 0.85;
    g.fillStyle = `rgba(${rgb},0.55)`;
    g.beginPath();
    g.arc(bx, by, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgb(${rgb})`;
    g.lineWidth = 0.9;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fillRect(bx - r * 0.5, by - r * 0.5, 1, 1);
  }
  g.globalAlpha = 1;
}
const ICE: readonly [number, number][] = [[-15, 6], [-13, -12], [-4, -18], [9, -16], [15, -6], [14, 10], [3, 15], [-10, 13]];
function ice(g: Ctx, x: number, y: number, grow: number): void {
  const s = ease(grow);
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = "rgba(170,225,250,0.55)";
  g.beginPath();
  ICE.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.closePath();
  g.fill();
  g.strokeStyle = "#3a8ab0";
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-11, -9);
  g.lineTo(-4, -15);
  g.moveTo(-12, 0);
  g.lineTo(-9, -6);
  g.stroke();
  g.restore();
}
// 얼음이 풀릴 때 — 조각이 바깥으로 흩어진다
function shatter(g: Ctx, x: number, y: number, k: number): void {
  ICE.forEach(([px, py], i) => {
    const [qx, qy] = ICE[(i + 1) % ICE.length]!;
    const d = k * 18;
    const mx = (px + qx) / 2;
    const my = (py + qy) / 2;
    g.globalAlpha = 1 - k;
    g.fillStyle = "rgba(190,235,255,0.85)";
    g.beginPath();
    g.moveTo(x + mx * 0.3 + (mx / 15) * d, y + my * 0.3 + (my / 15) * d);
    g.lineTo(x + px + (px / 15) * d, y + py + (py / 15) * d);
    g.lineTo(x + qx + (qx / 15) * d, y + qy + (qy / 15) * d);
    g.closePath();
    g.fill();
    g.strokeStyle = "#3a8ab0";
    g.lineWidth = 0.8;
    g.stroke();
  });
  g.globalAlpha = 1;
}
function zzz(g: Ctx, x: number, y: number, t: number): void {
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k < 3; k++) {
    const ph = mod(t / 2100 + k / 3, 1);
    const zx = x + 10 + ph * 12 + Math.sin(ph * 6) * 2;
    const zy = y - 14 - ph * 20;
    g.globalAlpha = ph < 0.15 ? ph / 0.15 : ph > 0.75 ? (1 - ph) / 0.25 : 1;
    g.font = `700 ${Math.round(8 + ph * 6)}px Galmuri11, sans-serif`;
    g.lineWidth = 3;
    g.strokeStyle = "#074540";
    g.strokeText("Z", zx, zy);
    g.fillStyle = "#e8e8f8";
    g.fillText("Z", zx, zy);
  }
  g.globalAlpha = 1;
}
// 혼란 — 머리 위를 도는 별 셋. spread 가 오르면 바깥으로 흩어진다
function stars(g: Ctx, x: number, y: number, t: number, spread: number): void {
  for (let k = 0; k < 3; k++) {
    const ang = t / 420 + (k * Math.PI * 2) / 3;
    const rx = 13 + spread * 30;
    const front = Math.sin(ang) > 0;
    g.globalAlpha = (front ? 1 : 0.6) * (1 - spread);
    star(g, x + Math.cos(ang) * rx, y - 17 + Math.sin(ang) * rx * 0.32 - spread * 10, (front ? 3.2 : 2.4) * (1 - spread * 0.5));
  }
  g.globalAlpha = 1;
}
function sweat(g: Ctx, x: number, y: number): void {
  g.fillStyle = "#bfe4ff";
  g.strokeStyle = "#2f6a9a";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 12, y - 17);
  g.quadraticCurveTo(x + 16, y - 10, x + 12, y - 8);
  g.quadraticCurveTo(x + 8, y - 10, x + 12, y - 17);
  g.fill();
  g.stroke();
}

// ── 순간 ──
// 걸림 — 상태 색 빛 고리가 퍼진다
function ring(g: Ctx, x: number, y: number, rgb: string, u: number): void {
  lighter(g, () => {
    dot(g, rgb, x, y, 18 + u * 18, 0.7 * (1 - u));
    g.strokeStyle = `rgba(${rgb},${0.9 * (1 - u)})`;
    g.lineWidth = 2.5 * (1 - u) + 0.5;
    g.beginPath();
    g.ellipse(x, y + 4, 10 + u * 22, (10 + u * 22) * 0.45, 0, 0, Math.PI * 2);
    g.stroke();
  });
}
// 5초 판정 — 몸이 상태 색으로 번쩍
function pulse(g: Ctx, x: number, y: number, rgb: string, u: number): void {
  lighter(g, () => dot(g, rgb, x, y, 20, 0.85 * (1 - u)));
}
// 능력 변화 — 오르면 주황 꺾쇠가 발밑에서 위로, 내리면 파랑 꺾쇠가 머리에서 아래로
function chevrons(g: Ctx, x: number, y: number, up: boolean, u: number): void {
  lighter(g, () => dot(g, up ? "255,140,70" : "90,150,240", x, y, 22, 0.35 * Math.sin(u * Math.PI)));
  g.lineJoin = "round";
  g.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const ph = clamp(u * 1.6 - k * 0.25);
    const yy = up ? y + 12 - ph * 30 : y - 18 + ph * 30;
    const a = Math.sin(ph * Math.PI);
    if (a <= 0.02) continue;
    const d = up ? -5 : 5;
    for (const [lw, col] of [[4, up ? "#8a3a10" : "#1f3f80"], [2, up ? "#ffb070" : "#a8ccff"]] as const) {
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x - 7, yy - d / 2);
      g.lineTo(x, yy + d / 2);
      g.lineTo(x + 7, yy - d / 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}

export function createStatusFx(host: HTMLElement): StatusFx {
  const canvas = document.createElement("canvas");
  canvas.className = "status-fx";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = (W + PAD * 2) * dpr;
  canvas.height = (H + PAD * 2) * dpr;
  host.appendChild(canvas);
  const g = canvas.getContext("2d")!;
  return {
    draw(t, units, marks, markMs) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
      // 몸 가운데를 원점으로 옮기고 몸 크기만큼 키운 뒤 그린다
      const at = (x: number, y: number, r: number, fn: () => void): void => {
        const k = Math.max(1, Math.min(2, r / BODY));
        g.save();
        g.translate(x, y);
        g.scale(k, k);
        fn();
        g.restore();
      };
      for (const u of units) {
        at(u.x, u.y, u.r, () => {
          if (u.major === "burn") flames(g, 0, 0, t);
          else if (u.major === "paralysis") sparks(g, 0, 0, t);
          else if (u.major === "poison") bubbles(g, 0, 0, t, STATUS_RGB.poison ?? "176,90,208", 4);
          else if (u.major === "toxic") bubbles(g, 0, 0, t, STATUS_RGB.toxic ?? "138,58,192", 6);
          else if (u.major === "freeze") ice(g, 0, 0, (t - u.majorAt) / 250);
          else if (u.major === "sleep") zzz(g, 0, 0, t);
          if (u.confused) stars(g, 0, 0, t, 0);
          if (u.flinched) sweat(g, 0, 0);
        });
      }
      for (const m of marks) {
        const k = clamp((t - m.t) / markMs);
        const rgb = (m.status ? STATUS_RGB[m.status] : undefined) ?? "255,255,255";
        at(m.x, m.y, m.r, () => {
          if (m.kind === "on") ring(g, 0, 0, rgb, k);
          else if (m.kind === "tick") pulse(g, 0, 0, rgb, k);
          else if (m.kind === "up" || m.kind === "down") chevrons(g, 0, 0, m.kind === "up", k);
          else if (m.kind === "off") {
            if (m.status === "freeze") shatter(g, 0, 0, k);
            else if (m.status === "confusion") stars(g, 0, 0, t, k);
            else if (m.status !== "flinch") lighter(g, () => dot(g, "255,255,255", 0, -4, 16 + k * 8, 0.5 * (1 - k))); // 풀죽음은 다음 기술과 함께 조용히 풀린다
          }
        });
      }
    },
  };
}
