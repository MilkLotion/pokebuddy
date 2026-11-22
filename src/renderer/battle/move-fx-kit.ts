// 기술 연출 공용 도구 — 전장 크기·재질·빛 도구·입자·장면 상태·맞는 시각. move-fx.ts(형태)와 move-fx-flying.ts(비행 기술)가 함께 쓴다
// (docs/specs/ui-components.md "기술 연출")
import type { MoveFxShape, MoveFxView } from "../../shared/model/battle-screen.js";

export const W = 560;
export const H = 336;
export const PAD = 32; // 위쪽 끝 연출이 잘리지 않게 전장보다 넓게
export const CELL = 56; // 화면 칸
export const PX = 1.5; // 도트 한 칸 — 포켓몬 그림(크기 2단계)의 한 픽셀

export type Ctx = CanvasRenderingContext2D;
export type Pt = { x: number; y: number };
export const clampUnit = (u: number): number => Math.max(0, Math.min(1, u));
export const easeOut = (u: number): number => 1 - Math.pow(1 - clampUnit(u), 3);
export const lerpTo = (a: number, b: number, u: number): number => a + (b - a) * u;
export const randomIn = (a: number, b: number): number => a + Math.random() * (b - a);

// 타입 재질 — c 본색, l 밝은색, d 어두운색, p 입자 종류
export type PartKind = "ember" | "glow" | "spark" | "streak" | "drop" | "bolt" | "leaf" | "shard" | "chunk" | "dust" | "wisp" | "star" | "feather" | "snow";
export interface Mat {
  c: string;
  l: string;
  d: string;
  p: PartKind;
}
export const MAT: Record<string, Mat> = {
  normal: { c: "245,238,220", l: "255,255,255", d: "120,110,90", p: "star" },
  fire: { c: "255,128,32", l: "255,236,140", d: "130,36,8", p: "ember" },
  water: { c: "60,140,255", l: "210,240,255", d: "16,50,150", p: "drop" },
  electric: { c: "255,214,30", l: "255,255,215", d: "150,100,0", p: "bolt" },
  grass: { c: "175,228,150", l: "242,255,225", d: "100,150,85", p: "leaf" }, // 어두운 경기장에서 너무 진해 보여 옅게 (2026-11-22 사용자 "풀기술 색감이 너무 진하고", 이어 "조금만 더 연했으면")
  ice: { c: "110,215,255", l: "245,255,255", d: "40,110,170", p: "shard" },
  fighting: { c: "255,110,50", l: "255,230,190", d: "150,30,20", p: "spark" },
  poison: { c: "190,90,220", l: "238,205,250", d: "80,20,100", p: "drop" },
  ground: { c: "215,165,85", l: "250,228,175", d: "110,75,35", p: "dust" },
  flying: { c: "105,165,240", l: "212,232,255", d: "38,66,138", p: "feather" }, // 본색의 가장 낮은 값이 0.6 아래라야 도트에서 흰색이 아니라 본색 칸이 된다. 옛 180,195,255 는 모두 흰 덩어리로 보였다 (2026-11-22 사용자 "그림이 이상하긴했어")
  psychic: { c: "255,95,170", l: "255,215,236", d: "135,25,80", p: "star" },
  bug: { c: "170,200,40", l: "232,246,170", d: "70,90,10", p: "leaf" },
  rock: { c: "185,155,90", l: "240,225,180", d: "85,65,35", p: "chunk" },
  ghost: { c: "150,85,230", l: "235,205,255", d: "35,12,70", p: "wisp" },
  dragon: { c: "125,85,255", l: "220,205,255", d: "40,15,125", p: "ember" },
  dark: { c: "140,60,170", l: "225,175,245", d: "28,8,40", p: "wisp" },
  steel: { c: "205,215,235", l: "255,255,255", d: "90,100,125", p: "spark" },
  fairy: { c: "255,130,200", l: "255,232,246", d: "150,45,110", p: "star" },
};
export const matOf = (type: string): Mat => MAT[type] ?? MAT.normal!;

// ── 빛 도구 ──
const SOFT = new Map<string, HTMLCanvasElement>();
export function softDot(col: string, hard: boolean): HTMLCanvasElement {
  const key = col + (hard ? "h" : "s");
  let c = SOFT.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) {
    gr.addColorStop(0, `rgba(${col},1)`);
    gr.addColorStop(0.45, `rgba(${col},0.9)`);
    gr.addColorStop(1, `rgba(${col},0)`);
  } else {
    gr.addColorStop(0, `rgba(${col},1)`);
    gr.addColorStop(0.2, `rgba(${col},0.55)`);
    gr.addColorStop(0.55, `rgba(${col},0.12)`);
    gr.addColorStop(1, `rgba(${col},0)`);
  }
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  SOFT.set(key, c);
  return c;
}
export function drawGlow(g: Ctx, col: string, x: number, y: number, r: number, a: number, hard = false): void {
  if (a <= 0.01 || r <= 0.5) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.min(1, a);
  g.drawImage(softDot(col, hard), x - r, y - r, r * 2, r * 2);
  g.restore();
}
export function drawShade(g: Ctx, col: string, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01) return;
  g.save();
  g.globalAlpha = Math.min(1, a);
  g.drawImage(softDot(col, true), x - r, y - r, r * 2, r * 2);
  g.restore();
}
export function drawStar(g: Ctx, x: number, y: number, r: number, col: string, a: number, rot = 0): void {
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.max(0, a);
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = `rgb(${col})`;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.18 : r;
    const an = (i / 8) * Math.PI * 2;
    g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
  }
  g.closePath();
  g.fill();
  g.restore();
}
export function drawBolt(g: Ctx, x1: number, y1: number, x2: number, y2: number, col: string, w: number, a: number): void {
  g.save();
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.lineJoin = "round";
  const segs = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  g.beginPath();
  g.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const u = i / segs;
    const o = randomIn(-9, 9);
    g.lineTo(x1 + dx * u + (-dy / len) * o, y1 + dy * u + (dx / len) * o);
  }
  g.lineTo(x2, y2);
  g.globalAlpha = a * 0.5;
  g.strokeStyle = `rgb(${col})`;
  g.lineWidth = w * 3;
  g.stroke();
  g.globalAlpha = a;
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = "#fff";
  g.lineWidth = Math.max(1, w * 0.4);
  g.stroke();
  g.restore();
}

// ── 연출 하나의 상태 ──
export interface Part {
  kind: PartKind;
  m: Mat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  grav: number;
  drag: number;
}
export interface Ring {
  m: Mat;
  col?: string;
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  w: number;
}
export interface Flash {
  m: Mat;
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
}
export interface Wave {
  life: number;
  max: number;
  seed?: number; // 물결 위상 — 찬바람폭풍
}
export type Draw = (g: Ctx, pixel: boolean) => void;
export interface Scene {
  parts: Part[];
  rings: Ring[];
  flashes: Flash[];
  waves: Wave[];
  draws: Draw[]; // 이번 장면의 위 층 그리기
  under: Draw[]; // 이번 장면의 바닥 층 그리기
  done: Set<string>; // 한 번만 하는 일
  cracks: [number, number][][] | null;
  crater: number;
  shock: { x: number; y: number; t0: number }[]; // 지나간 자리 충격파 — 에어로블라스트
}
const GRAV: Record<PartKind, number> = { ember: -120, drop: 420, chunk: 620, shard: 260, leaf: 60, dust: -20, wisp: -40, star: 0, spark: 140, bolt: 0, streak: 0, glow: 0, feather: 45, snow: 30 };
export interface EmitOpts {
  kind?: PartKind;
  dir?: number;
  spread?: number;
  min?: number;
  max?: number;
  life?: [number, number];
  size?: [number, number];
  jx?: number;
  jy?: number;
  grav?: number;
  drag?: number;
}
export function emitParts(S: Scene, m: Mat, x: number, y: number, n: number, o: EmitOpts = {}): void {
  const kind = o.kind ?? m.p;
  for (let i = 0; i < n; i++) {
    const spread = o.spread ?? Math.PI;
    const dir = (o.dir ?? randomIn(0, Math.PI * 2)) + randomIn(-spread, spread);
    const sp = randomIn(o.min ?? 40, o.max ?? 180);
    S.parts.push({
      kind,
      m,
      x: x + randomIn(-(o.jx ?? 0), o.jx ?? 0),
      y: y + randomIn(-(o.jy ?? 0), o.jy ?? 0),
      vx: Math.cos(dir) * sp,
      vy: Math.sin(dir) * sp,
      life: 0,
      max: randomIn(o.life?.[0] ?? 300, o.life?.[1] ?? 650),
      size: randomIn(o.size?.[0] ?? 3, o.size?.[1] ?? 7),
      rot: randomIn(0, 6.3),
      vr: randomIn(-12, 12),
      grav: o.grav ?? GRAV[kind],
      drag: o.drag ?? 2.2,
    });
  }
}
export function pushPart(S: Scene, p: Omit<Part, "life" | "rot" | "vr"> & Partial<Pick<Part, "rot" | "vr">>): void {
  S.parts.push({ life: 0, rot: 0, vr: 0, ...p });
}
export function addRing(S: Scene, m: Mat, x: number, y: number, r0: number, r1: number, max: number, w = 6, col?: string): void {
  S.rings.push({ m, col, x, y, r0, r1, life: 0, max, w });
}
// 맞는 순간 — 하얀 섬광 + 고리 + 재질 조각
export function hitBurst(S: Scene, m: Mat, x: number, y: number, power = 1): void {
  S.flashes.push({ m, x, y, r: 34 * power, life: 0, max: 220 });
  addRing(S, m, x, y + 14, 6, 46 * power, 380, 7);
  emitParts(S, m, x, y, Math.round(14 * power), { min: 80, max: 260 * power });
  emitParts(S, m, x, y, Math.round(8 * power), { kind: "spark", min: 120, max: 320 });
}

export const firstTime = (S: Scene, key: string): boolean => {
  if (S.done.has(key)) return false;
  S.done.add(key);
  return true;
};

// ── 형태 ── t 는 연출 시작부터 ms. a 공격자 몸 가운데, b 대상 몸 가운데, d 공격자가 보는 방향(오른쪽 1)
export type ShapeFn = (S: Scene, t: number, dt: number, a: Pt, b: Pt, m: Mat, fx: MoveFxView, d: number) => void;

// 맞는 순간(연출 시작부터 ms) — 엔진 damage 시각에 맞춘다
export const HIT: Record<MoveFxShape, number> = { melee: 230, projectile: 500, beam: 450, cone: 330, area: 360, ring: 240, rush: 330, drop: 620 };
// 맞은 뒤 남는 시간
export const TAIL: Record<MoveFxShape, number> = { melee: 520, projectile: 520, beam: 830, cone: 730, area: 620, ring: 760, rush: 520, drop: 860 };
