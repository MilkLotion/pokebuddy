// 배틀 창 전장의 기술 연출 — 기술마다 형태(근접·투사체·빔·부채꼴·대상 중심 원·자기 중심 원·돌진·낙하)를 타입 색·재질로 그린다
// (docs/specs/ui-components.md "기술 연출", 시안 worklog/records/battle-move-shape 8판)
// - 판정과는 상관없다. 맞는 순간(hit)이 엔진 damage 시각과 겹치게 그보다 먼저 시작한다
// - 바닥 층(갈라짐·경고 원)은 포켓몬 아래, 나머지는 포켓몬 위 canvas 에 그린다
// - 그리는 방식: 도트(포켓몬 그림 한 픽셀 크기로 끊어 타입 4색 + 1px 테두리) · 매끈(빛) · 섞기(도트 + 매끈 빛 45%)
// - 입자는 상태를 가진다. 판 시계가 뒤로 가면 그 연출을 처음부터 다시 만든다
import type { MoveFxShape, MoveFxView } from "../../shared/model/battle-screen.js";

const W = 560;
const H = 336;
const PAD = 32; // 위쪽 끝 연출이 잘리지 않게 전장보다 넓게
const CELL = 56; // 화면 칸
const PX = 1.5; // 도트 한 칸 — 포켓몬 그림(크기 2단계)의 한 픽셀
const MIX_GLOW = 0.45; // 섞기의 매끈 빛 세기

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };
const clamp = (u: number): number => Math.max(0, Math.min(1, u));
const ease = (u: number): number => 1 - Math.pow(1 - clamp(u), 3);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// 타입 재질 — c 본색, l 밝은색, d 어두운색, p 입자 종류
type PartKind = "ember" | "glow" | "spark" | "streak" | "drop" | "bolt" | "leaf" | "shard" | "chunk" | "dust" | "wisp" | "star";
interface Mat {
  c: string;
  l: string;
  d: string;
  p: PartKind;
}
const MAT: Record<string, Mat> = {
  normal: { c: "245,238,220", l: "255,255,255", d: "120,110,90", p: "star" },
  fire: { c: "255,128,32", l: "255,236,140", d: "130,36,8", p: "ember" },
  water: { c: "60,140,255", l: "210,240,255", d: "16,50,150", p: "drop" },
  electric: { c: "255,214,30", l: "255,255,215", d: "150,100,0", p: "bolt" },
  grass: { c: "100,210,60", l: "225,255,170", d: "25,90,20", p: "leaf" },
  ice: { c: "110,215,255", l: "245,255,255", d: "40,110,170", p: "shard" },
  fighting: { c: "255,110,50", l: "255,230,190", d: "150,30,20", p: "spark" },
  poison: { c: "190,90,220", l: "238,205,250", d: "80,20,100", p: "drop" },
  ground: { c: "215,165,85", l: "250,228,175", d: "110,75,35", p: "dust" },
  flying: { c: "180,195,255", l: "255,255,255", d: "80,80,170", p: "streak" },
  psychic: { c: "255,95,170", l: "255,215,236", d: "135,25,80", p: "star" },
  bug: { c: "170,200,40", l: "232,246,170", d: "70,90,10", p: "leaf" },
  rock: { c: "185,155,90", l: "240,225,180", d: "85,65,35", p: "chunk" },
  ghost: { c: "150,85,230", l: "235,205,255", d: "35,12,70", p: "wisp" },
  dragon: { c: "125,85,255", l: "220,205,255", d: "40,15,125", p: "ember" },
  dark: { c: "140,60,170", l: "225,175,245", d: "28,8,40", p: "wisp" },
  steel: { c: "205,215,235", l: "255,255,255", d: "90,100,125", p: "spark" },
  fairy: { c: "255,130,200", l: "255,232,246", d: "150,45,110", p: "star" },
};
const matOf = (type: string): Mat => MAT[type] ?? MAT.normal!;

// ── 빛 도구 ──
const SOFT = new Map<string, HTMLCanvasElement>();
function soft(col: string, hard: boolean): HTMLCanvasElement {
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
function glow(g: Ctx, col: string, x: number, y: number, r: number, a: number, hard = false): void {
  if (a <= 0.01 || r <= 0.5) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.min(1, a);
  g.drawImage(soft(col, hard), x - r, y - r, r * 2, r * 2);
  g.restore();
}
function shade(g: Ctx, col: string, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01) return;
  g.save();
  g.globalAlpha = Math.min(1, a);
  g.drawImage(soft(col, true), x - r, y - r, r * 2, r * 2);
  g.restore();
}
function star4(g: Ctx, x: number, y: number, r: number, col: string, a: number, rot = 0): void {
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
function bolt(g: Ctx, x1: number, y1: number, x2: number, y2: number, col: string, w: number, a: number): void {
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
    const o = rnd(-9, 9);
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
interface Part {
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
interface Ring {
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
interface Flash {
  m: Mat;
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
}
interface Wave {
  life: number;
  max: number;
}
type Draw = (g: Ctx, pixel: boolean) => void;
interface Scene {
  parts: Part[];
  rings: Ring[];
  flashes: Flash[];
  waves: Wave[];
  draws: Draw[]; // 이번 장면의 위 층 그리기
  under: Draw[]; // 이번 장면의 바닥 층 그리기
  done: Set<string>; // 한 번만 하는 일
  cracks: [number, number][][] | null;
  crater: number;
}
const GRAV: Record<PartKind, number> = { ember: -120, drop: 420, chunk: 620, shard: 260, leaf: 60, dust: -20, wisp: -40, star: 0, spark: 140, bolt: 0, streak: 0, glow: 0 };
interface EmitOpts {
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
function emit(S: Scene, m: Mat, x: number, y: number, n: number, o: EmitOpts = {}): void {
  const kind = o.kind ?? m.p;
  for (let i = 0; i < n; i++) {
    const spread = o.spread ?? Math.PI;
    const dir = (o.dir ?? rnd(0, Math.PI * 2)) + rnd(-spread, spread);
    const sp = rnd(o.min ?? 40, o.max ?? 180);
    S.parts.push({
      kind,
      m,
      x: x + rnd(-(o.jx ?? 0), o.jx ?? 0),
      y: y + rnd(-(o.jy ?? 0), o.jy ?? 0),
      vx: Math.cos(dir) * sp,
      vy: Math.sin(dir) * sp,
      life: 0,
      max: rnd(o.life?.[0] ?? 300, o.life?.[1] ?? 650),
      size: rnd(o.size?.[0] ?? 3, o.size?.[1] ?? 7),
      rot: rnd(0, 6.3),
      vr: rnd(-12, 12),
      grav: o.grav ?? GRAV[kind],
      drag: o.drag ?? 2.2,
    });
  }
}
function push(S: Scene, p: Omit<Part, "life" | "rot" | "vr"> & Partial<Pick<Part, "rot" | "vr">>): void {
  S.parts.push({ life: 0, rot: 0, vr: 0, ...p });
}
function ring(S: Scene, m: Mat, x: number, y: number, r0: number, r1: number, max: number, w = 6, col?: string): void {
  S.rings.push({ m, col, x, y, r0, r1, life: 0, max, w });
}
// 맞는 순간 — 하얀 섬광 + 고리 + 재질 조각
function impact(S: Scene, m: Mat, x: number, y: number, power = 1): void {
  S.flashes.push({ m, x, y, r: 34 * power, life: 0, max: 220 });
  ring(S, m, x, y + 14, 6, 46 * power, 380, 7);
  emit(S, m, x, y, Math.round(14 * power), { min: 80, max: 260 * power });
  emit(S, m, x, y, Math.round(8 * power), { kind: "spark", min: 120, max: 320 });
}
function stepScene(S: Scene, dt: number): void {
  const s = dt / 1000;
  for (const p of S.parts) {
    p.life += dt;
    p.vy += p.grav * s;
    const k = Math.exp(-p.drag * s);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * s;
    p.y += p.vy * s;
    p.rot += p.vr * s;
  }
  S.parts = S.parts.filter((p) => p.life < p.max);
  for (const r of S.rings) r.life += dt;
  for (const f of S.flashes) f.life += dt;
  for (const w of S.waves) w.life += dt;
  S.rings = S.rings.filter((r) => r.life < r.max);
  S.flashes = S.flashes.filter((f) => f.life < f.max);
  S.waves = S.waves.filter((w) => w.life < w.max);
}
function drawParts(g: Ctx, S: Scene, pixel: boolean): void {
  for (const p of S.parts) {
    const u = p.life / p.max;
    const a = 1 - u;
    const m = p.m;
    switch (p.kind) {
      case "ember":
        glow(g, u < 0.3 ? m.l : m.c, p.x, p.y, p.size * 2.6 * (1 - u * 0.5), a);
        glow(g, "255,255,255", p.x, p.y, p.size * 0.8, a * 0.7, true);
        break;
      case "glow":
        glow(g, m.c, p.x, p.y, p.size * 3, a);
        break;
      case "spark":
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = a;
        g.strokeStyle = u < 0.4 ? "#fff" : `rgb(${m.l})`;
        g.lineWidth = 2;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        g.stroke();
        g.restore();
        glow(g, m.c, p.x, p.y, p.size * 1.6, a * 0.8);
        break;
      case "streak":
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = a * 0.9;
        g.strokeStyle = "#fff";
        g.lineWidth = 2.5;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
        g.stroke();
        g.restore();
        break;
      case "drop":
        g.save();
        g.globalAlpha = a;
        g.fillStyle = `rgb(${m.c})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size * 0.7, 0, 7);
        g.fill();
        g.fillStyle = `rgb(${m.l})`;
        g.beginPath();
        g.arc(p.x - p.size * 0.2, p.y - p.size * 0.2, p.size * 0.28, 0, 7);
        g.fill();
        g.restore();
        glow(g, m.l, p.x, p.y, p.size * 1.4, a * 0.5);
        break;
      case "bolt":
        if (u < 0.6 && Math.random() < 0.8) bolt(g, p.x, p.y, p.x + Math.cos(p.rot) * p.size * 4, p.y + Math.sin(p.rot) * p.size * 4, m.c, 2, a);
        glow(g, m.c, p.x, p.y, p.size * 1.8, a * 0.7);
        break;
      case "leaf":
        g.save();
        g.globalAlpha = a;
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = `rgb(${m.c})`;
        g.strokeStyle = `rgb(${m.d})`;
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(0, 0, p.size * 1.2, p.size * 0.5, 0, 0, 7);
        g.fill();
        g.stroke();
        g.restore();
        break;
      case "shard":
        g.save();
        g.globalAlpha = a;
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = `rgb(${m.l})`;
        g.strokeStyle = `rgb(${m.c})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, -p.size * 1.3);
        g.lineTo(p.size * 0.6, p.size * 0.6);
        g.lineTo(-p.size * 0.6, p.size * 0.4);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
        glow(g, m.l, p.x, p.y, p.size * 1.5, a * 0.6);
        break;
      case "chunk":
        g.save();
        g.globalAlpha = a;
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = `rgb(${m.c})`;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        g.fillStyle = `rgb(${m.d})`;
        g.fillRect(-p.size / 2, p.size / 6, p.size, p.size / 3);
        g.fillStyle = `rgba(${m.l},0.8)`;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, 2);
        g.restore();
        break;
      case "dust":
        // 도트에서는 겹친 먼지가 덩어리가 되어 작은 알갱이로
        if (!pixel) shade(g, m.d, p.x, p.y, p.size * (1.5 + u * 2.5), a * 0.35);
        else if (u < 0.6) {
          g.fillStyle = `rgb(${m.l})`;
          g.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
        break;
      case "wisp":
        shade(g, m.d, p.x, p.y, p.size * (1.4 + u * 2), a * 0.55);
        glow(g, m.c, p.x, p.y, p.size * 1.6, a * 0.35);
        break;
      case "star":
        star4(g, p.x, p.y, p.size * 1.6 * (1 - u * 0.4), m.l, a, p.rot);
        glow(g, m.c, p.x, p.y, p.size * 2, a * 0.6);
        break;
    }
  }
}
function drawRings(g: Ctx, S: Scene): void {
  for (const r of S.rings) {
    const u = r.life / r.max;
    const rr = lerp(r.r0, r.r1, ease(u));
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = (1 - u) * 0.9;
    g.strokeStyle = `rgb(${r.col ?? r.m.c})`;
    g.lineWidth = r.w * (1 - u) + 1;
    g.beginPath();
    g.ellipse(r.x, r.y, rr, rr * 0.5, 0, 0, 7);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = Math.max(1, r.w * 0.3 * (1 - u));
    g.stroke();
    g.restore();
  }
}
function drawFlashes(g: Ctx, S: Scene): void {
  for (const f of S.flashes) {
    const u = f.life / f.max;
    glow(g, "255,255,255", f.x, f.y, f.r * (0.6 + u * 0.8), (1 - u) * 1.1, true);
    glow(g, f.m.c, f.x, f.y, f.r * (1.2 + u * 1.4), (1 - u) * 0.9);
    star4(g, f.x, f.y, f.r * 1.3 * (1 - u * 0.5), "255,255,255", 1 - u, 0.4);
  }
}
const once = (S: Scene, key: string): boolean => {
  if (S.done.has(key)) return false;
  S.done.add(key);
  return true;
};

// ── 형태 ── t 는 연출 시작부터 ms. a 공격자 몸 가운데, b 대상 몸 가운데, d 공격자가 보는 방향(오른쪽 1)
type ShapeFn = (S: Scene, t: number, dt: number, a: Pt, b: Pt, m: Mat, fx: MoveFxView, d: number) => void;
const SHAPE: Record<MoveFxShape, ShapeFn> = {
  melee(S, t, _dt, a, b, m, fx, d) {
    const hit = HIT.melee;
    if (t < hit) {
      if (t > 60) S.draws.push((g) => glow(g, m.c, a.x + d * 14, a.y, 10 + (t / hit) * 10, 0.5));
      return;
    }
    if (once(S, "hit")) {
      impact(S, m, b.x, b.y, fx.sub ? 0.8 : 1.2);
      if (fx.sub === "punch") {
        for (let i = 0; i < 14; i++) emit(S, m, b.x, b.y, 1, { kind: "streak", min: 380, max: 520, life: [140, 260] });
        emit(S, m, b.x, b.y, 10, { kind: "ember", min: 60, max: 200 });
      }
      if (fx.sub === "slicing") emit(S, m, b.x, b.y, 12, { min: 60, max: 200 });
    }
    const u = clamp((t - hit) / 300);
    if (fx.sub === "slicing")
      S.draws.push((g) => {
        for (let k = 0; k < 2; k++) {
          const v = clamp(u * 1.5 - k * 0.2);
          if (v <= 0 || v >= 1) continue;
          const cx = b.x - d * 6;
          const cy = b.y - 4;
          const R = 26 + k * 8;
          const a0 = -2.5 + v * 0.5 + k * 0.4;
          const a1 = a0 + 2.2;
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 1 - v;
          g.fillStyle = `rgb(${m.c})`;
          g.beginPath();
          g.arc(cx, cy, R + 7, a0, a1);
          g.arc(cx + 6, cy + 2, R, a1, a0, true);
          g.closePath();
          g.fill();
          g.fillStyle = "#fff";
          g.beginPath();
          g.arc(cx, cy, R + 7, a0 + 0.2, a1 - 0.2);
          g.arc(cx + 3, cy + 1, R + 4, a1 - 0.2, a0 + 0.2, true);
          g.closePath();
          g.fill();
          g.restore();
        }
      });
    if (fx.sub === "bite")
      S.draws.push((g) => {
        const close = Math.min(1, u * 4);
        const gap = 22 - close * 13;
        g.save();
        g.globalAlpha = 1 - clamp((u - 0.5) * 2);
        for (const s of [-1, 1]) {
          g.fillStyle = `rgb(${m.d})`;
          g.fillRect(b.x - 26, b.y + s * gap - (s < 0 ? 8 : 0), 52, 8);
          for (let i = 0; i < 4; i++) {
            const x = b.x - 20 + i * 13;
            const y = b.y + s * gap;
            g.fillStyle = "#fff";
            g.strokeStyle = `rgb(${m.c})`;
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(x - 6, y);
            g.lineTo(x + 6, y);
            g.lineTo(x, y - s * 14);
            g.closePath();
            g.fill();
            g.stroke();
          }
        }
        g.restore();
        if (close >= 1 && u < 0.5) glow(g, m.c, b.x, b.y, 40, 0.8 - u);
      });
  },
  projectile(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 16;
    const oy = a.y - 4;
    const hit = hitOf(fx);
    if (fx.type === "fire") {
      // 화염류 — 불길의 흐름
      const start = 140;
      const end = hit + 260;
      const dist = Math.hypot(b.x - ox, b.y - oy);
      const speed = dist / ((hit - start) / 1000);
      if (t < start) {
        S.draws.push((g) => glow(g, m.c, ox, oy, 6 + t / 12, 0.8));
        return;
      }
      if (t < end)
        for (let i = 0; i < 4; i++) {
          const dir = Math.atan2(b.y - oy, b.x - ox) + rnd(-0.08, 0.08);
          push(S, { kind: "ember", m, x: ox, y: oy, vx: Math.cos(dir) * speed * rnd(0.9, 1.1), vy: Math.sin(dir) * speed * rnd(0.9, 1.1), max: hit - start + 60, size: rnd(5, 9), grav: -40, drag: 0.2 });
        }
      if (t >= hit && once(S, "hit")) impact(S, m, b.x, b.y, 0.9);
      if (t >= hit && t < end + 200 && Math.random() < 0.6) emit(S, m, b.x - d * 6, b.y, 3, { min: 60, max: 200 });
      if (t < end) S.draws.push((g) => glow(g, m.l, ox, oy, 14, 0.9));
      return;
    }
    if (fx.type === "electric") {
      // 전기류 — 번개 줄기가 몇 번 번쩍인다
      if (t < hit) {
        S.draws.push((g) => glow(g, m.c, a.x, a.y - 10, 10 + t / 8, 0.7));
        if (Math.random() < 0.5) emit(S, m, a.x, a.y - 10, 1, { min: 30, max: 80, size: [3, 5] });
        return;
      }
      if (t < hit + 420 && Math.floor(t / 70) % 2 === 0)
        S.draws.push((g) => {
          bolt(g, ox, oy, b.x, b.y, m.c, 5, 1);
          bolt(g, ox, oy, b.x, b.y, m.l, 2, 0.8);
          glow(g, m.c, b.x, b.y, 40, 0.7);
        });
      if (once(S, "hit")) {
        impact(S, m, b.x, b.y, 1);
        emit(S, m, b.x, b.y, 8, { min: 40, max: 160 });
      }
      if (t < hit + 420 && Math.random() < 0.4) emit(S, m, b.x, b.y, 2, { min: 60, max: 180 });
      return;
    }
    const charge = 200;
    if (t < charge) {
      const u = t / charge;
      S.draws.push((g) => {
        glow(g, m.c, ox, oy, 8 + u * 14, 0.9);
        glow(g, "255,255,255", ox, oy, 3 + u * 5, u, true);
      });
      if (Math.random() < 0.6) {
        const an = rnd(0, 6.3);
        push(S, { kind: "glow", m, x: ox + Math.cos(an) * 40, y: oy + Math.sin(an) * 40, vx: -Math.cos(an) * 220, vy: -Math.sin(an) * 220, max: 180, size: 3, grav: 0, drag: 0 });
      }
      return;
    }
    const u = clamp((t - charge) / (hit - charge));
    const e = u * u * (3 - 2 * u);
    const x = lerp(ox, b.x, e);
    const y = lerp(oy, b.y, e) - Math.sin(e * Math.PI) * 10;
    if (u < 1) {
      if (fx.type === "rock") {
        S.draws.push((g) => {
          g.save();
          g.translate(x, y);
          g.rotate(t / 60);
          g.fillStyle = `rgb(${m.c})`;
          g.strokeStyle = `rgb(${m.d})`;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(-10, -6);
          g.lineTo(2, -11);
          g.lineTo(11, -2);
          g.lineTo(7, 9);
          g.lineTo(-8, 8);
          g.closePath();
          g.fill();
          g.stroke();
          g.fillStyle = `rgba(${m.l},0.9)`;
          g.fillRect(-6, -7, 7, 3);
          g.restore();
        });
        emit(S, m, x, y, 1, { kind: "dust", min: 0, max: 20, size: [4, 7] });
      } else {
        S.draws.push((g) => {
          glow(g, m.c, x, y, 30, 0.75);
          shade(g, m.d, x, y, 13, 0.95);
          g.save();
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = `rgb(${m.l})`;
          g.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            g.globalAlpha = 0.8;
            g.beginPath();
            g.arc(x, y, 9 + k * 2, t / 90 + k * 2, t / 90 + k * 2 + 1.6);
            g.stroke();
          }
          g.restore();
          glow(g, m.l, x - 3, y - 3, 5, 0.9, true);
        });
        emit(S, m, x, y, 2, { kind: "wisp", min: 0, max: 30, size: [5, 8], life: [250, 420] });
      }
    } else if (once(S, "hit")) {
      impact(S, m, b.x, b.y, 1.1);
      emit(S, m, b.x, b.y, 10, { min: 40, max: 200 });
    }
  },
  beam(S, t, dt, a, b, m, fx, d) {
    const ox = a.x + d * 18;
    const oy = a.y - 4;
    const charge = 380;
    const end = 980;
    if (t < charge) {
      const u = t / charge;
      if (Math.random() < 0.9) {
        const an = rnd(0, 6.3);
        const r = rnd(40, 60);
        push(S, { kind: "glow", m, x: ox + Math.cos(an) * r, y: oy + Math.sin(an) * r, vx: -Math.cos(an) * r * 4.5, vy: -Math.sin(an) * r * 4.5, max: 220, size: 2.5, grav: 0, drag: 0 });
      }
      S.draws.push((g) => {
        glow(g, m.c, ox, oy, 10 + u * 24, 0.9);
        glow(g, "255,255,255", ox, oy, 4 + u * 8, 0.6 + u * 0.4, true);
      });
      if (Math.floor(t / 120) !== Math.floor((t - dt) / 120)) ring(S, m, ox, oy, 30, 4, 200, 3);
      return;
    }
    if (t < end) {
      const grow = clamp((t - charge) / 70);
      const ex = lerp(ox, b.x, grow);
      const ey = lerp(oy, b.y, grow);
      const fade = t > end - 120 ? (end - t) / 120 : 1;
      S.draws.push((g) => {
        const len = Math.hypot(ex - ox, ey - oy);
        const ang = Math.atan2(ey - oy, ex - ox);
        g.save();
        g.translate(ox, oy);
        g.rotate(ang);
        g.globalCompositeOperation = "lighter";
        const wob = (k: number): number => Math.sin(t / 25 + k) * 2;
        const band = (w: number, col: string, al: number): void => {
          g.globalAlpha = al * fade;
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(0, -w / 2);
          for (let x = 0; x <= len; x += 8) g.lineTo(x, -w / 2 - wob(x / 20));
          for (let x = len; x >= 0; x -= 8) g.lineTo(x, w / 2 + wob(x / 17));
          g.closePath();
          g.fill();
        };
        band(40, `rgb(${m.c})`, 0.28);
        band(22, `rgb(${m.c})`, 0.85);
        band(9, "#fff", 1);
        for (let k = 0; k < 6; k++) {
          const x = (t * 0.9 + (k * len) / 6) % Math.max(1, len);
          g.globalAlpha = 0.9 * fade;
          g.drawImage(soft(m.l, false), x - 14, -14, 28, 28);
        }
        g.restore();
        glow(g, m.c, ox, oy, 30, 0.9 * fade);
        glow(g, "255,255,255", ox, oy, 12, fade, true);
        if (grow >= 1) {
          glow(g, m.c, b.x, b.y, 46 + Math.sin(t / 30) * 6, 0.9 * fade);
          glow(g, "255,255,255", b.x, b.y, 16, fade, true);
        }
      });
      if (grow >= 1) {
        if (once(S, "hit")) impact(S, m, b.x, b.y, 1);
        emit(S, m, b.x - d * 8, b.y, 3, { dir: d > 0 ? Math.PI : 0, spread: 1.4, min: 120, max: 300 });
        if (fx.type === "ice" && Math.random() < 0.5) emit(S, m, lerp(ox, b.x, Math.random()), lerp(oy, b.y, Math.random()), 1, { min: 10, max: 60 });
      }
    } else if (once(S, "end")) {
      impact(S, m, b.x, b.y, 1.4);
      emit(S, m, b.x, b.y, 18, { min: 80, max: 300 });
    }
  },
  cone(S, t, dt, a, b, m, fx) {
    const ox = a.x;
    const oy = a.y;
    const dir = Math.atan2(b.y - oy, b.x - ox);
    const half = 0.45;
    const len = Math.hypot(b.x - ox, b.y - oy) + CELL * 1.2;
    if (t < 160) {
      S.draws.push((g) => glow(g, m.c, ox, oy, 8 + t / 10, 0.7));
      return;
    }
    if (t < 760) {
      if (Math.floor(t / 110) !== Math.floor((t - dt) / 110)) S.waves.push({ life: 0, max: 520 });
      if (fx.type !== "normal")
        for (let i = 0; i < 4; i++) {
          const dd = dir + rnd(-half, half);
          const sp = rnd(280, 460);
          push(S, { kind: fx.type === "ice" ? (Math.random() < 0.5 ? "shard" : "glow") : m.p === "leaf" ? "leaf" : "ember", m, x: ox, y: oy, vx: Math.cos(dd) * sp, vy: Math.sin(dd) * sp, max: (len / sp) * 1000, size: rnd(2.5, 5), rot: rnd(0, 6), vr: rnd(-10, 10), grav: 0, drag: 0.3 });
        }
      else if (Math.random() < 0.3) push(S, { kind: "star", m, x: ox, y: oy, vx: Math.cos(dir + rnd(-half, half)) * 300, vy: Math.sin(dir + rnd(-half, half)) * 300, max: 600, size: 4, vr: 3, grav: 0, drag: 0.5 });
    }
    if (t > HIT.cone && once(S, "hit")) impact(S, m, b.x, b.y, 0.8);
    S.draws.push((g) => {
      for (const w of S.waves) {
        const u = w.life / w.max;
        const r = 18 + ease(u) * (len - 18);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(ox, oy);
        g.rotate(dir);
        g.globalAlpha = (1 - u) * 0.9;
        g.strokeStyle = `rgb(${m.c})`;
        g.lineWidth = 10 * (1 - u) + 2;
        g.lineCap = "round";
        g.beginPath();
        g.arc(0, 0, r, -half * (0.6 + u * 0.4), half * (0.6 + u * 0.4));
        g.stroke();
        g.strokeStyle = "#fff";
        g.lineWidth = 3 * (1 - u) + 1;
        g.stroke();
        g.restore();
      }
    });
  },
  area(S, t, _dt, a, b, m, fx) {
    const mark = HIT.area;
    const R = CELL * 1.3;
    if (t < mark) {
      const u = t / mark;
      S.under.push((g) => {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(b.x, b.y + 16);
        g.scale(1, 0.5);
        g.globalAlpha = 0.5 + u * 0.5;
        g.strokeStyle = `rgb(${m.c})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(0, 0, R * (1.3 - u * 0.3), 0, 7);
        g.stroke();
        g.rotate(t / 300);
        g.lineWidth = 2;
        g.setLineDash([10, 8]);
        g.beginPath();
        g.arc(0, 0, R * 0.7, 0, 7);
        g.stroke();
        g.setLineDash([]);
        for (let i = 0; i < 6; i++) {
          g.rotate(Math.PI / 3);
          g.fillStyle = `rgb(${m.l})`;
          g.fillRect(R * 0.85, -3, 8, 6);
        }
        g.restore();
      });
      if (Math.random() < 0.7) push(S, { kind: m.p === "bolt" ? "glow" : "star", m, x: b.x + rnd(-R, R), y: b.y + 16 + rnd(-R / 2, R / 2), vx: 0, vy: -60, max: 400, size: 2.5, vr: 2, grav: 0, drag: 0 });
      S.draws.push((g) => glow(g, m.c, a.x, a.y - 30, 6 + u * 10, 0.8));
      return;
    }
    const u = clamp((t - mark) / 600);
    if (once(S, "hit")) {
      impact(S, m, b.x, b.y, 1.3);
      ring(S, m, b.x, b.y + 16, 10, R * 1.4, 520, 10);
      emit(S, m, b.x, b.y, 26, { min: 60, max: 260, jx: R * 0.6, jy: R * 0.3 });
    }
    S.draws.push((g) => {
      const w = 60 * (1 - u * 0.8);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 1 - u;
      const gr = g.createLinearGradient(0, b.y - 170, 0, b.y + 20);
      gr.addColorStop(0, `rgba(${m.c},0)`);
      gr.addColorStop(0.6, `rgba(${m.c},0.8)`);
      gr.addColorStop(1, `rgba(${m.l},1)`);
      g.fillStyle = gr;
      g.fillRect(b.x - w / 2, b.y - 170, w, 190);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(b.x - w / 6, b.y - 170, w / 3, 190);
      g.restore();
      if (fx.type === "electric" && u < 0.6)
        for (let i = 0; i < 3; i++) {
          const an = rnd(0, 6.3);
          bolt(g, b.x, b.y, b.x + Math.cos(an) * R, b.y + Math.sin(an) * R * 0.5, m.c, 2, 1 - u);
        }
    });
  },
  ring(S, t, _dt, a, b, m, fx) {
    const slam = HIT.ring;
    if (t < slam) {
      if (fx.type === "electric") S.draws.push((g) => glow(g, m.c, a.x, a.y, 20 + t / 8, 0.7));
      return;
    }
    if (once(S, "slam")) {
      ring(S, m, a.x, a.y + 16, 10, CELL * 2.2, 650, 12);
      ring(S, m, a.x, a.y + 16, 4, CELL * 1.4, 480, 6, m.l);
      S.cracks = Array.from({ length: 9 }, (_, i) => {
        const an = (i / 9) * 6.3 + rnd(-0.2, 0.2);
        const L = rnd(50, 95);
        const pts: [number, number][] = [[0, 0]];
        for (let k = 1; k <= 5; k++) pts.push([(Math.cos(an + rnd(-0.25, 0.25)) * L * k) / 5, ((Math.sin(an + rnd(-0.25, 0.25)) * L * k) / 5) * 0.5]);
        return pts;
      });
      const kind: PartKind = fx.type === "ground" ? "dust" : m.p;
      emit(S, m, a.x, a.y + 16, fx.type === "ground" ? 14 : 30, { kind, min: 120, max: 320, size: fx.type === "ground" ? [3, 5] : [3, 6] });
      if (fx.type === "ground") emit(S, m, a.x, a.y + 16, 14, { kind: "chunk", dir: -Math.PI / 2, spread: 1.2, min: 160, max: 320, size: [4, 7] });
      if (fx.type === "water") emit(S, m, a.x, a.y + 10, 30, { kind: "drop", dir: -Math.PI / 2, spread: 1.6, min: 120, max: 300 });
    }
    const u = clamp((t - slam) / 700);
    const cracks = S.cracks;
    if (cracks && fx.type === "ground")
      S.under.push((g) => {
        g.save();
        g.translate(a.x, a.y + 16);
        g.globalAlpha = 1 - u;
        g.strokeStyle = `rgb(${m.d})`;
        g.lineWidth = 3;
        g.lineJoin = "round";
        const k = ease(Math.min(1, u * 4));
        for (const c of cracks) {
          g.beginPath();
          c.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x, y)));
          g.stroke();
        }
        g.restore();
      });
    if (fx.type === "electric" && u < 0.7)
      S.draws.push((g) => {
        for (let i = 0; i < 6; i++) {
          const an = rnd(0, 6.3);
          const r = CELL * 2 * ease(u) + 10;
          bolt(g, a.x, a.y, a.x + Math.cos(an) * r, a.y + Math.sin(an) * r * 0.55, m.c, 2.5, 1 - u);
        }
      });
    if (fx.type === "water" && u < 0.8)
      S.draws.push((g) => {
        const r = 14 + CELL * 2 * ease(u);
        g.save();
        g.globalAlpha = 1 - u;
        g.fillStyle = `rgba(${m.c},0.55)`;
        g.beginPath();
        g.ellipse(a.x, a.y + 16, r, r * 0.5, 0, 0, 7);
        g.ellipse(a.x, a.y + 16, Math.max(0, r - 18), Math.max(0, r - 18) * 0.5, 0, 0, 7, true);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(a.x, a.y + 16, r, r * 0.5, 0, 0, 7);
        g.stroke();
        g.restore();
      });
    if (t > slam + 120 && once(S, "hit")) emit(S, m, b.x, b.y, 8, { min: 60, max: 200 });
  },
  rush(S, t, _dt, a, b, m, fx, d) {
    // 몸은 DOM 이라 옮기지 않는다 — 공격자에서 대상까지 빛 덩이가 달려가는 줄기로 그린다
    const go = 170;
    const hit = HIT.rush;
    if (t < go) {
      S.draws.push((g) => glow(g, m.c, a.x, a.y - 4, 18 + (t / go) * 16, 0.7));
      return;
    }
    if (t < hit) {
      const u = ease((t - go) / (hit - go));
      const x = lerp(a.x, b.x - d * 24, u);
      const y = lerp(a.y, b.y, u);
      S.draws.push((g) => {
        const tx = lerp(a.x, x, 0.3);
        const ty = lerp(a.y, y, 0.3);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.lineCap = "round";
        for (const [w, col, al] of [[30, m.c, 0.3], [16, m.c, 0.7], [6, "255,255,255", 1]] as const) {
          const gr = g.createLinearGradient(x, y, tx, ty);
          gr.addColorStop(0, `rgba(${col},${al})`);
          gr.addColorStop(1, `rgba(${col},0)`);
          g.strokeStyle = gr;
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(tx, ty);
          g.stroke();
        }
        g.restore();
        glow(g, m.c, x, y, 26, 0.9);
        glow(g, "255,255,255", x, y, 10, 1, true);
      });
      emit(S, m, x, y, 2, { kind: "streak", dir: d > 0 ? Math.PI : 0, spread: 0.15, min: 200, max: 400, jy: 14, life: [100, 200] });
      return;
    }
    if (once(S, "hit")) {
      impact(S, m, b.x, b.y, 1.4);
      emit(S, m, b.x, b.y, 12, { kind: fx.type === "flying" ? "streak" : "ember", min: 150, max: 320 });
    }
  },
  drop(S, t, _dt, a, b, m, fx) {
    const warn = 320;
    const fall = 300;
    const hit = warn + fall;
    const rocks: [number, number][] = fx.type === "rock" ? [[0, 0], [-26, 70], [24, 130]] : [[0, 0]];
    if (t < hit + 150)
      S.under.push((g) => {
        const u = clamp(t / hit);
        const pulse = 0.5 + 0.5 * Math.sin(t / 50);
        g.save();
        g.translate(b.x, b.y + 16);
        g.scale(1, 0.5);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.4 + pulse * 0.4;
        g.strokeStyle = `rgb(${m.c})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(0, 0, 30 + (1 - u) * 20, 0, 7);
        g.stroke();
        g.globalAlpha = 0.25;
        g.fillStyle = `rgb(${m.c})`;
        g.beginPath();
        g.arc(0, 0, 30 * u, 0, 7);
        g.fill();
        g.restore();
      });
    if (t < 260) {
      S.draws.push((g) => glow(g, m.c, a.x, a.y - 20, 10 + t / 14, 0.8));
      if (Math.random() < 0.5) emit(S, m, a.x, a.y - 24, 1, { dir: -Math.PI / 2, spread: 0.3, min: 200, max: 300 });
    }
    for (const [dx, delay] of rocks) {
      const st = warn + delay;
      const en = st + fall;
      const sx = b.x + dx - 120;
      const sy = -PAD - 10;
      if (t >= st && t < en) {
        const u = (t - st) / fall;
        const x = lerp(sx, b.x + dx, u * u);
        const y = lerp(sy, b.y, u * u);
        if (fx.type === "rock") {
          S.draws.push((g) => {
            g.save();
            g.translate(x, y);
            g.rotate(t / 80);
            g.fillStyle = `rgb(${m.c})`;
            g.strokeStyle = `rgb(${m.d})`;
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(-14, -8);
            g.lineTo(3, -15);
            g.lineTo(15, -3);
            g.lineTo(10, 12);
            g.lineTo(-11, 11);
            g.closePath();
            g.fill();
            g.stroke();
            g.restore();
          });
          emit(S, m, x, y, 1, { kind: "dust", min: 0, max: 20 });
        } else {
          S.draws.push((g) => {
            const tx = lerp(x, sx, 0.35);
            const ty = lerp(y, sy, 0.35);
            g.save();
            g.globalCompositeOperation = "lighter";
            g.lineCap = "round";
            for (const [w, col, al] of [[26, m.c, 0.35], [14, m.c, 0.8], [5, "255,255,255", 1]] as const) {
              const gr = g.createLinearGradient(x, y, tx, ty);
              gr.addColorStop(0, `rgba(${col},${al})`);
              gr.addColorStop(1, `rgba(${col},0)`);
              g.strokeStyle = gr;
              g.lineWidth = w;
              g.beginPath();
              g.moveTo(x, y);
              g.lineTo(tx, ty);
              g.stroke();
            }
            g.restore();
            glow(g, m.c, x, y, 34, 0.9);
            glow(g, "255,255,255", x, y, 12, 1, true);
          });
          emit(S, m, x, y, 2, { min: 10, max: 60, size: [1.5, 3], life: [200, 400] });
        }
      }
      if (t >= en && once(S, `rock${delay}`)) {
        impact(S, m, b.x + dx * 0.3, b.y + 4, delay ? 0.9 : 1.5);
        emit(S, m, b.x + dx * 0.3, b.y + 14, 14, { kind: "chunk", dir: -Math.PI / 2, spread: 1.3, min: 140, max: 300, size: [3, 6] });
        emit(S, m, b.x + dx * 0.3, b.y + 14, 12, { kind: "dust", min: 40, max: 140, size: [6, 10] });
        S.crater = t;
      }
    }
    const crater = S.crater;
    if (crater >= 0)
      S.under.push((g) => {
        const u = clamp((t - crater) / 700);
        g.save();
        g.globalAlpha = 0.5 * (1 - u);
        g.fillStyle = "rgb(20,15,10)";
        g.beginPath();
        g.ellipse(b.x, b.y + 16, 26, 10, 0, 0, 7);
        g.fill();
        g.restore();
      });
  },
};
// 맞는 순간(연출 시작부터 ms) — 엔진 damage 시각에 맞춘다
const HIT: Record<MoveFxShape, number> = { melee: 230, projectile: 500, beam: 450, cone: 330, area: 360, ring: 240, rush: 330, drop: 620 };
// 맞은 뒤 남는 시간
const TAIL: Record<MoveFxShape, number> = { melee: 520, projectile: 520, beam: 830, cone: 730, area: 620, ring: 760, rush: 520, drop: 860 };
export function hitOf(fx: MoveFxView): number {
  if (fx.shape === "projectile" && fx.type === "fire") return 440;
  if (fx.shape === "projectile" && fx.type === "electric") return 200;
  return HIT[fx.shape];
}
export const lengthOf = (fx: MoveFxView): number => hitOf(fx) + TAIL[fx.shape];

// ── 도트 층 — 전장 + 여백을 포켓몬 픽셀 크기로 ──
const FW = W + PAD * 2;
const FH = H + PAD * 2;
const LW = Math.ceil(FW / PX);
const LH = Math.ceil(FH / PX);
const hexRgb = (c: string): number[] => c.split(",").map(Number);
// 밝기·하양 → 타입 4색. 옅은 안개는 비우고, 칠한 칸에 닿은 빈 칸은 1px 어두운 테두리
function posterize(low: Ctx, m: Mat): void {
  const ramp = [hexRgb(m.d), hexRgb(m.c), hexRgb(m.l), [255, 255, 255]];
  const edge = hexRgb(m.d).map((v) => Math.round(v * 0.35));
  const img = low.getImageData(0, 0, LW, LH);
  const p = img.data;
  const n = LW * LH;
  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const a = p[k + 3]! / 255;
    const v = (Math.max(p[k]!, p[k + 1]!, p[k + 2]!) / 255) * a;
    const w = (Math.min(p[k]!, p[k + 1]!, p[k + 2]!) / 255) * a;
    if (v < 0.2 || a < 0.4) {
      p[k + 3] = 0;
      continue;
    }
    const c = (w > 0.93 ? ramp[3] : w > 0.6 ? ramp[2] : v > 0.5 ? ramp[1] : ramp[0])!;
    p[k] = c[0]!;
    p[k + 1] = c[1]!;
    p[k + 2] = c[2]!;
    p[k + 3] = 255;
    on[i] = 1;
  }
  for (let y = 0; y < LH; y++)
    for (let x = 0; x < LW; x++) {
      const i = y * LW + x;
      if (on[i]) continue;
      if ((x > 0 && on[i - 1]) || (x < LW - 1 && on[i + 1]) || (y > 0 && on[i - LW]) || (y < LH - 1 && on[i + LW])) {
        const k = i * 4;
        p[k] = edge[0]!;
        p[k + 1] = edge[1]!;
        p[k + 2] = edge[2]!;
        p[k + 3] = 220;
      }
    }
  low.putImageData(img, 0, 0);
}

// 재생 중인 연출 하나
export interface MoveFxPlay {
  key: string; // 같은 연출을 알아보는 열쇠 — 기술 이벤트마다 하나
  start: number; // 판 시각(ms) — 맞는 순간보다 hitOf 만큼 앞
  fx: MoveFxView;
  a: Pt; // 공격자 몸 가운데(전장 px)
  b: Pt; // 대상 몸 가운데
}
export interface MoveFx {
  draw(t: number, plays: MoveFxPlay[]): void;
}

// under 는 포켓몬 아래, over 는 포켓몬 위 — 둘 다 host 의 자식으로 끼운다(under 는 before 앞에)
export function createMoveFx(host: HTMLElement, before: Node | null): MoveFx {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const make = (cls: string): { c: HTMLCanvasElement; g: Ctx } => {
    const c = document.createElement("canvas");
    c.className = `move-fx ${cls}`;
    c.width = FW * dpr;
    c.height = FH * dpr;
    return { c, g: c.getContext("2d")! };
  };
  const under = make("under");
  const over = make("over");
  host.insertBefore(under.c, before);
  host.appendChild(over.c);
  const lowC = document.createElement("canvas");
  lowC.width = LW;
  lowC.height = LH;
  const low = lowC.getContext("2d", { willReadFrequently: true })!;
  const hiC = document.createElement("canvas");
  hiC.width = FW * dpr;
  hiC.height = FH * dpr;
  const hi = hiC.getContext("2d")!;
  const scenes = new Map<string, { S: Scene; last: number }>();
  let blank = true;

  // 그리기 묶음 하나를 방식대로 — fn 은 전장 좌표로 그린다
  const pass = (g: Ctx, fx: MoveFxView, fn: (q: Ctx, pixel: boolean) => void, glowLayer: boolean): void => {
    if (fx.style === "smooth") {
      fn(g, false);
      return;
    }
    low.setTransform(1, 0, 0, 1, 0, 0);
    low.clearRect(0, 0, LW, LH);
    low.setTransform(1 / PX, 0, 0, 1 / PX, PAD / PX, PAD / PX);
    fn(low, true);
    posterize(low, matOf(fx.type));
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(lowC, 0, 0, LW, LH, 0, 0, LW * PX * dpr, LH * PX * dpr);
    g.restore();
    if (fx.style === "mix" && glowLayer) {
      hi.setTransform(1, 0, 0, 1, 0, 0);
      hi.clearRect(0, 0, hiC.width, hiC.height);
      hi.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
      fn(hi, false);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = MIX_GLOW;
      g.drawImage(hiC, 0, 0);
      g.restore();
    }
  };

  return {
    draw(t, plays) {
      const empty = plays.length === 0;
      if (empty && blank) return;
      blank = empty;
      for (const x of [under, over]) {
        x.g.setTransform(1, 0, 0, 1, 0, 0);
        x.g.clearRect(0, 0, x.c.width, x.c.height);
        x.g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
      }
      const live = new Set<string>();
      for (const p of plays) {
        const local = t - p.start;
        if (local < 0 || local > lengthOf(p.fx)) continue;
        live.add(p.key);
        let sc = scenes.get(p.key);
        // 처음이거나 판 시계가 뒤로 갔으면 처음부터 다시 만든다
        if (!sc || local < sc.last) {
          sc = { S: { parts: [], rings: [], flashes: [], waves: [], draws: [], under: [], done: new Set(), cracks: null, crater: -1 }, last: 0 };
          scenes.set(p.key, sc);
        }
        const S = sc.S;
        const m = matOf(p.fx.type);
        const d = p.b.x >= p.a.x ? 1 : -1;
        // 큰 건너뜀은 잘게 나눠 진행한다 — 입자 물리가 튀지 않게
        let from = sc.last;
        while (from < local) {
          const dt = Math.min(33, local - from);
          from += dt;
          stepScene(S, dt);
          S.draws = [];
          S.under = [];
          SHAPE[p.fx.shape](S, from, dt, p.a, p.b, m, p.fx, d);
        }
        sc.last = local;
        const underDraws = S.under;
        if (underDraws.length) pass(under.g, p.fx, (q) => underDraws.forEach((f) => f(q, true)), false);
        pass(
          over.g,
          p.fx,
          (q, pixel) => {
            drawRings(q, S);
            drawParts(q, S, pixel);
            S.draws.forEach((f) => f(q, pixel));
            drawFlashes(q, S);
          },
          true,
        );
      }
      for (const k of [...scenes.keys()]) if (!live.has(k)) scenes.delete(k);
    },
  };
}
