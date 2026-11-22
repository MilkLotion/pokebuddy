// 비행 타입 기술 20개의 연출 — 기술마다 따로 그린다. 형태와 맞는 시각(HIT)은 move-fx-kit.ts 의 형태 규칙 그대로
// (docs/specs/ui-components.md "기술 연출", 시안 worklog/records/battle-move-shape/evidence/flying-fx-v2.html)
// - 바람 기술은 얇은 바람 칼날·물결치는 바람 줄기·회오리, 몸 기술은 날개 빛·깃털
// - 원작에서 색이 다른 다섯은 재질을 따로 둔다(FLYING_MAT)
import { CELL, HIT, PAD, addRing, clampUnit, drawGlow, drawStar, easeOut, emitParts, firstTime, lerpTo, pushPart, randomIn } from "./move-fx-kit.js";
import type { Ctx, Mat, Pt, Scene, ShapeFn } from "./move-fx-kit.js";

const easeIn = (u: number): number => clampUnit(u) * clampUnit(u);
const C = CELL;
// 기술마다 따로 둔 재질 — 그 밖의 비행 기술은 타입 재질(MAT.flying)
export const FLYING_MAT: Record<string, Mat> = {
  "beak-blast": { c: "255,150,60", l: "255,236,170", d: "150,50,10", p: "ember" }, // 달군 부리
  "bleakwind-storm": { c: "95,198,238", l: "218,246,255", d: "30,96,150", p: "snow" }, // 찬 바람
  "sky-attack": { c: "255,212,110", l: "255,250,222", d: "160,98,18", p: "feather" }, // 금빛 새
  "dragon-ascent": { c: "105,228,150", l: "228,255,236", d: "18,108,58", p: "ember" }, // 초록 빛
  "oblivion-wing": { c: "236,72,96", l: "255,204,214", d: "108,10,32", p: "feather" }, // 붉은 빛
};

// 빛 줄기 꼬리 — 앱 돌진과 같은 세 겹
function comet(g: Ctx, x: number, y: number, tx: number, ty: number, m: Mat, ws: readonly [number, number, number], core = "255,255,255"): void {
  g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
  for (const [w, col, al] of [[ws[0], m.c, 0.3], [ws[1], m.c, 0.7], [ws[2], core, 1]] as const) {
    const gr = g.createLinearGradient(x, y, tx, ty); gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.strokeStyle = gr; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
  }
  g.restore(); drawGlow(g, m.c, x, y, ws[0] * 0.9, 0.9); drawGlow(g, "255,255,255", x, y, ws[2] * 1.7, 1, true);
}

// 초승달 칼날 — 볼록한 쪽이 ang 쪽
function crescent(g: Ctx, x: number, y: number, r: number, ang: number, thick: number, m: Mat, a: number, span = 1.2): void {
  if (a <= 0.01) return;
  g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = Math.min(1, a); g.translate(x, y); g.rotate(ang);
  g.fillStyle = `rgb(${m.c})`; g.beginPath(); g.arc(0, 0, r, -span, span); g.arc(-thick, 0, r * 0.95, span * 0.97, -span * 0.97, true); g.closePath(); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(0, 0, r, -span * 0.78, span * 0.78); g.arc(-thick * 0.45, 0, r * 0.98, span * 0.76, -span * 0.76, true); g.closePath(); g.fill();
  g.restore();
}
// 날개 칼날 — 초승달 바깥에 깃 끝 넷
function featherBlade(g: Ctx, x: number, y: number, r: number, ang: number, m: Mat, a: number): void {
  crescent(g, x, y, r, ang, r * 0.32, m, a, 1.05);
  g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = Math.min(1, a); g.translate(x, y); g.rotate(ang); g.fillStyle = `rgb(${m.l})`;
  for (let i = 0; i < 4; i++) {
    const an = -0.8 + i * 0.53, cx = Math.cos(an) * r, cy = Math.sin(an) * r;
    g.beginPath(); g.moveTo(cx + Math.cos(an - 0.25) * -4, cy + Math.sin(an - 0.25) * -4);
    g.lineTo(cx + Math.cos(an + 0.35) * 11, cy + Math.sin(an + 0.35) * 11); g.lineTo(cx + Math.cos(an + 0.6) * -2, cy + Math.sin(an + 0.6) * -2); g.closePath(); g.fill();
  }
  g.restore();
}
// 펼친 날개 하나 — ang 은 날개가 뻗는 쪽, side 는 위(-1)·아래(1)
function wing(g: Ctx, x: number, y: number, ang: number, size: number, side: number, m: Mat, a: number): void {
  if (a <= 0.01) return;
  g.save(); g.translate(x, y); g.rotate(ang); g.scale(1, side); g.globalAlpha = Math.min(1, a);
  const tips = [[1.0, -0.15], [0.86, 0.12], [0.68, 0.3], [0.48, 0.42]] as const;
  const path = () => {
    g.beginPath(); g.moveTo(0, 0.08 * size); g.quadraticCurveTo(size * 0.45, -size * 0.38, size * 1.05, -size * 0.32);
    for (const [tx, ty] of tips) { g.lineTo(tx * size, ty * size); g.lineTo((tx - 0.12) * size, (ty - 0.02) * size); }
    g.quadraticCurveTo(size * 0.2, size * 0.42, 0, 0.08 * size); g.closePath();
  };
  g.fillStyle = `rgb(${m.c})`; path(); g.fill();
  // 깃 사이 선 — 날개가 덩어리로 보이지 않게
  g.strokeStyle = `rgb(${m.d})`; g.lineWidth = 1.5;
  for (const [tx, ty] of tips) { g.beginPath(); g.moveTo(size * 0.12, size * 0.1); g.lineTo((tx - 0.1) * size, (ty - 0.03) * size); g.stroke(); }
  // 앞 깃 가장자리만 밝게
  g.strokeStyle = "#fff"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0.08 * size); g.quadraticCurveTo(size * 0.45, -size * 0.38, size * 1.05, -size * 0.32); g.stroke();
  g.restore();
}
// 회오리 — 바닥 base 에서 위로 넓어진다
function tornado(g: Ctx, x: number, base: number, h: number, wTop: number, rot: number, m: Mat, a: number): void {
  if (a <= 0.01) return;
  g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
  const N = 9;
  for (let k = 0; k < N; k++) {
    const v = k / (N - 1), y = base - v * h, rw = lerpTo(wTop * 0.18, wTop, Math.pow(v, 0.8)), cx = x + Math.sin(rot * 0.7 + v * 4) * wTop * 0.12;
    const s0 = rot * (1.6 - v * 0.6) + k * 0.9;
    g.globalAlpha = a * 0.35; g.strokeStyle = `rgb(${m.c})`; g.lineWidth = 6;
    g.beginPath(); g.ellipse(cx, y, rw, rw * 0.28, 0, s0, s0 + 4.2); g.stroke();
    g.globalAlpha = a; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.ellipse(cx, y, rw, rw * 0.28, 0, s0 + 0.6, s0 + 2.6); g.stroke();
  }
  g.restore();
  drawGlow(g, m.c, x, base - h * 0.45, wTop * 1.1, a * 0.45);
}
// 곧은 베기 선
function slashLine(g: Ctx, x: number, y: number, ang: number, len: number, m: Mat, a: number): void {
  if (a <= 0.01) return;
  g.save(); g.globalCompositeOperation = "lighter"; g.translate(x, y); g.rotate(ang); g.globalAlpha = Math.min(1, a);
  g.fillStyle = `rgb(${m.c})`; g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -6, len / 2, 0); g.quadraticCurveTo(0, 6, -len / 2, 0); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(-len / 2 * 0.9, 0); g.quadraticCurveTo(0, -2.5, len / 2 * 0.9, 0); g.quadraticCurveTo(0, 2.5, -len / 2 * 0.9, 0); g.fill();
  g.restore();
}
// 몸 둘레 기운 — 원작의 "몸을 감싸는 빛"
function aura(g: Ctx, x: number, y: number, r: number, m: Mat, a: number, t: number): void {
  drawGlow(g, m.c, x, y, r * 1.5, a * 0.6);
  g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = a * 0.9; g.strokeStyle = `rgb(${m.l})`; g.lineWidth = 2;
  for (let k = 0; k < 3; k++) { const s = t / 120 + k * 2.1; g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, s, s + 1.3); g.stroke(); }
  g.restore();
}
// 맞는 순간 — 바람 기술용 작은 섬광과 바람 줄기(공용 impact 는 옅은 색에서 흰 덩어리가 된다)
function hitFx(S: Scene, m: Mat, x: number, y: number, p = 1): void {
  S.flashes.push({ m, x, y, r: 20 * p, life: 0, max: 180 });
  addRing(S, m, x, y + 14, 4, 34 * p, 320, 3);
  emitParts(S, m, x, y, Math.round(10 * p), { kind: "streak", min: 220, max: 420 * p, life: [120, 240] });
  emitParts(S, m, x, y, Math.round(5 * p), { kind: "spark", min: 100, max: 260 });
}
// 바람 칼날 — 양 끝이 가늘어지는 얇은 호. 납작하게 눕히고 기울여 기호처럼 보이지 않게, 뒤로 번지는 자취를 둔다
function windBlade(g: Ctx, x: number, y: number, r: number, ang: number, tilt: number, m: Mat, a: number, trail = 3): void {
  if (a <= 0.01) return;
  const span = 1.45, N = 18;
  const shape = (r0: number, th: number): void => {
    g.beginPath();
    for (let i = 0; i <= N; i++) { const an = -span + 2 * span * (i / N); g.lineTo(Math.cos(an) * r0, Math.sin(an) * r0); }
    for (let i = N; i >= 0; i--) { const q = i / N, an = -span + 2 * span * q, rr = r0 - th * Math.pow(Math.sin(Math.PI * q), 1.5); g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    g.closePath();
  };
  g.save(); g.globalCompositeOperation = "lighter"; g.translate(x, y); g.rotate(ang); g.scale(1, 0.6);
  for (let k = trail; k >= 1; k--) { g.save(); g.translate(-k * 8, 0); g.rotate(tilt); g.globalAlpha = a * 0.16 * (trail + 1 - k) / trail; g.fillStyle = `rgb(${m.c})`; shape(r, r * 0.22); g.fill(); g.restore(); }
  g.rotate(tilt);
  g.globalAlpha = a; g.fillStyle = `rgb(${m.c})`; shape(r, r * 0.24); g.fill();
  g.fillStyle = "#fff"; shape(r, r * 0.09); g.fill();
  g.restore();
}
// 바람 줄기 — 머리(hx,hy)에서 뒤로 len 만큼, 물결치며 가늘어지는 선
function stream(g: Ctx, hx: number, hy: number, ang: number, len: number, amp: number, phase: number, w: number, m: Mat, a: number): void {
  if (a <= 0.01) return;
  const N = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const q = i / N, along = -q * len, off = Math.sin(q * 5 + phase) * amp * (0.3 + q);
    pts.push([hx + Math.cos(ang) * along - Math.sin(ang) * off, hy + Math.sin(ang) * along + Math.cos(ang) * off]);
  }
  g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
  for (let i = 0; i < N; i++) {
    const q = i / N, k = Math.sin(Math.PI * Math.min(1, q * 1.4 + 0.08)) * (1 - q * 0.5);
    g.globalAlpha = a * 0.45 * k; g.strokeStyle = `rgb(${m.c})`; g.lineWidth = w * 2.6 * k + 0.5;
    const p0 = pts[i]!, p1 = pts[i + 1]!;
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
    g.globalAlpha = a * k; g.strokeStyle = "#fff"; g.lineWidth = w * k + 0.3; g.stroke();
  }
  g.restore();
}
const dirOf = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x);

export const FLYING: Record<string, ShapeFn> = {
  // 투사체 ─────────
  "air-slash"(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 18, oy = a.y - 6, charge = 180, ang0 = dirOf({ x: ox, y: oy }, b);
    if (t < charge) {
      const u = t / charge;
      S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 8 + u * 14, 0.5); windBlade(g, ox, oy, 6 + u * 8, ang0, 0.5, m, u, 0); });
      if (Math.random() < 0.7) { const an = randomIn(0, 6.3); pushPart(S, { kind: "streak", m, x: ox + Math.cos(an) * 46, y: oy + Math.sin(an) * 30, vx: -Math.cos(an) * 260, vy: -Math.sin(an) * 170, max: 170, size: 2, grav: 0, drag: 0 }); }
      return;
    }
    // 칼날 셋 — [늦게 출발, 위아래 어긋남, 닿는 시각, 기울기]
    const blades = [[0, -16, 440, -0.55], [30, 12, 470, 0.5], [60, -2, 500, -0.15]] as const;
    S.draws.push((g) => {
      for (const [dl, yo, arr, tilt] of blades) {
        const st = charge + dl, u = clampUnit((t - st) / (arr - st));
        if (t >= st && u < 1) {
          const e = u * (2 - u), x = lerpTo(ox, b.x - d * 6, e), y = lerpTo(oy + yo, b.y + yo * 0.3, e);
          drawGlow(g, m.c, x, y, 18, 0.35);
          windBlade(g, x, y, 20, ang0, tilt + Math.sin(t / 50 + dl) * 0.08, m, 1);
        }
        if (t >= arr && t < arr + 200) slashLine(g, b.x, b.y - 4, tilt + (d > 0 ? 0 : Math.PI) + 0.9, 70, m, 1 - (t - arr) / 200);
      }
    });
    for (const [, , arr] of blades) if (t >= arr && firstTime(S, "b" + arr)) emitParts(S, m, b.x, b.y, 6, { kind: "streak", min: 160, max: 320, life: [120, 240] });
    if (t >= HIT.projectile && firstTime(S, "hit")) hitFx(S, m, b.x, b.y, 0.9);
  },
  hurricane(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 10, base0 = a.y + 18, charge = 200, hit = HIT.projectile;
    if (t < charge) {
      const u = t / charge;
      S.draws.push((g) => tornado(g, ox, base0, 26 + u * 14, 10 + u * 8, t / 35, m, 0.4 + u * 0.6));
      return;
    }
    if (t < hit) {
      const u = easeOut((t - charge) / (hit - charge)), x = lerpTo(ox, b.x, u), base = lerpTo(base0, b.y + 18, u);
      S.draws.push((g) => tornado(g, x, base, 42, 20, t / 30, m, 1));
      if (Math.random() < 0.6) emitParts(S, m, x, base - randomIn(0, 40), 1, { kind: "streak", dir: d > 0 ? Math.PI : 0, spread: 0.4, min: 100, max: 220, life: [120, 220] });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1); addRing(S, m, b.x, b.y + 18, 10, 60, 500, 6); }
    const v = clampUnit((t - hit) / 480), grow = easeOut(Math.min(1, v * 3)), fade = v > 0.7 ? 1 - (v - 0.7) / 0.3 : 1;
    const h = 44 + grow * 56, wt = 20 + grow * 30, base = b.y + 20;
    S.draws.push((g) => {
      tornado(g, b.x, base, h, wt, t / 24, m, fade);
      for (let k = 0; k < 8; k++) {
        const an = t / 80 + k * 0.785, hh = (k / 8) * h, rw = lerpTo(wt * 0.25, wt, Math.pow(k / 8, 0.8)) * 1.05;
        const px = b.x + Math.cos(an) * rw, py = base - hh + Math.sin(an) * rw * 0.28;
        if (Math.sin(an) > -0.2) drawGlow(g, "255,255,255", px, py, 3, fade, true);
      }
    });
    if (v < 0.75 && Math.random() < 0.5) pushPart(S, { kind: "feather", m, x: b.x + randomIn(-wt, wt), y: base - randomIn(10, h), vx: randomIn(-90, 90), vy: randomIn(-60, 0), max: 520, size: randomIn(2.5, 4), vr: randomIn(-6, 6), grav: 45, drag: 3 });
  },
  gust(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 16, oy = a.y - 2, start = 120, hit = HIT.projectile, ang = dirOf({ x: ox, y: oy }, b);
    if (t < start) {
      S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 8 + t / 10, 0.5); for (let k = 0; k < 3; k++) stream(g, ox + Math.cos(ang) * (t / 8), oy + (k - 1) * 9, ang, 18 + t / 6, 3, t / 30 + k, 1.6, m, t / start); });
      if (firstTime(S, "r")) addRing(S, m, a.x, a.y + 18, 8, 40, 300, 4);
      return;
    }
    // 바람 줄기 여섯 — [늦게 출발, 위아래 자리, 물결 위상]
    const lines = [[0, -18, 0], [20, -6, 1.7], [40, 6, 3.1], [10, 16, 4.4], [55, -12, 2.2], [70, 2, 5.3]] as const;
    S.draws.push((g) => {
      for (const [dl, yo, ph] of lines) {
        const st = start + dl, u = clampUnit((t - st) / (hit - start - 30));
        if (t < st) continue;
        const fade = u < 1 ? 1 : Math.max(0, 1 - (t - st - (hit - start - 30)) / 160);
        const e = easeOut(u), x = lerpTo(ox, b.x + d * 26, e), y = lerpTo(oy + yo, b.y + yo * 0.8, e);
        stream(g, x, y, ang, 46 + u * 34, 5, ph - t / 45, 1.8, m, fade);
      }
    });
    if (t >= hit && firstTime(S, "hit")) {
      hitFx(S, m, b.x, b.y, 0.7);
      emitParts(S, m, b.x, b.y, 4, { kind: "feather", dir: d > 0 ? 0 : Math.PI, spread: 0.8, min: 60, max: 160, size: [2.5, 4], life: [500, 700], drag: 3 });
    }
  },
  aeroblast(S, t, dt, a, b, m, fx, d) {
    const ox = a.x + d * 20, oy = a.y - 6, charge = 230, hit = HIT.projectile, ang = dirOf({ x: ox, y: oy }, b);
    const vring = (g: Ctx, x: number, y: number, r: number, al: number): void => { g.save(); g.globalCompositeOperation = "lighter"; g.translate(x, y); g.rotate(ang); g.globalAlpha = al; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, r * 0.32, r, 0, 0, 7); g.stroke(); g.strokeStyle = `rgb(${m.c})`; g.lineWidth = 5; g.globalAlpha = al * 0.45; g.stroke(); g.restore(); };
    if (t < charge) {
      const u = t / charge;
      S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 10 + u * 22, 0.8); for (let k = 0; k < 3; k++) vring(g, ox + d * k * 6, oy, (24 - k * 6) * (1.2 - u * 0.4), 0.4 + u * 0.5); drawGlow(g, "255,255,255", ox, oy, 4 + u * 7, u, true); });
      if (Math.random() < 0.8) { const an = randomIn(0, 6.3); pushPart(S, { kind: "streak", m, x: ox + Math.cos(an) * 54, y: oy + Math.sin(an) * 40, vx: -Math.cos(an) * 300, vy: -Math.sin(an) * 220, max: 170, size: 2, grav: 0, drag: 0 }); }
      return;
    }
    if (t < hit) {
      const u = easeIn((t - charge) / (hit - charge)) * 0.5 + ((t - charge) / (hit - charge)) * 0.5, x = lerpTo(ox, b.x - d * 8, u), y = lerpTo(oy, b.y, u);
      if (Math.floor(t / 45) !== Math.floor((t - dt) / 45)) S.shock.push({ x, y, t0: t });
      S.draws.push((g) => {
        comet(g, x, y, lerpTo(ox, x, 0.2), lerpTo(oy, y, 0.2), m, [26, 12, 5]);
        for (let k = 0; k < 4; k++) { const back = k * 9; vring(g, x - Math.cos(ang) * back, y - Math.sin(ang) * back, 14 - k * 2 + Math.sin(t / 20 + k) * 2, 0.9 - k * 0.18); }
      });
    } else if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.3); addRing(S, m, b.x, b.y + 16, 8, 70, 520, 8); emitParts(S, m, b.x, b.y, 16, { kind: "streak", min: 200, max: 420, life: [140, 280] }); }
    S.draws.push((g) => { for (const s of S.shock) { const v = (t - s.t0) / 260; if (v < 1) vring(g, s.x, s.y, 14 + v * 22, (1 - v) * 0.7); } });
  },
  "beak-blast"(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 18, oy = a.y - 8, charge = 260, hit = HIT.projectile, ang = dirOf({ x: ox, y: oy }, b);
    const beak = (g: Ctx, x: number, y: number, s: number, al: number): void => {
      g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = al; g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgb(${m.c})`; g.beginPath(); g.moveTo(s * 1.4, 0); g.lineTo(-s * 0.6, -s * 0.75); g.lineTo(-s * 0.3, 0); g.lineTo(-s * 0.6, s * 0.75); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.moveTo(s * 1.15, 0); g.lineTo(-s * 0.2, -s * 0.32); g.lineTo(-s * 0.05, 0); g.lineTo(-s * 0.2, s * 0.32); g.closePath(); g.fill();
      g.restore();
    };
    if (t < charge) {
      const u = t / charge, pulse = 0.5 + 0.5 * Math.sin(t / 30);
      S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 10 + u * 18 + pulse * 4, 0.8); beak(g, ox, oy, 6 + u * 4, 0.6 + u * 0.4); });
      if (Math.random() < 0.7) emitParts(S, m, ox + randomIn(-10, 10), oy, 1, { kind: "ember", dir: -Math.PI / 2, spread: 0.5, min: 40, max: 110, size: [2, 4], life: [250, 450] });
      if (Math.floor(t / 90) !== Math.floor((t - 16) / 90)) addRing(S, m, ox, oy + 4, 4, 22, 260, 3);
      return;
    }
    if (t < hit) {
      const u = clampUnit((t - charge) / (hit - charge)), x = lerpTo(ox, b.x - d * 10, u), y = lerpTo(oy, b.y, u);
      S.draws.push((g) => { comet(g, x, y, lerpTo(ox, x, 0.4), lerpTo(oy, y, 0.4), m, [22, 10, 4]); beak(g, x, y, 11, 1); });
      emitParts(S, m, x, y, 2, { kind: "ember", min: 20, max: 80, size: [2.5, 4.5], life: [200, 360] });
    } else if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.2); emitParts(S, m, b.x, b.y, 18, { kind: "ember", min: 60, max: 240, size: [3, 6] }); }
  },
  chatter(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 18, oy = a.y - 8, ang = dirOf({ x: ox, y: oy }, b);
    if (t < 140) { S.draws.push((g) => drawGlow(g, m.c, ox, oy, 6 + t / 12, 0.6)); return; }
    S.draws.push((g) => {
      for (let k = 0; k < 6; k++) {
        const st = 140 + k * 50, u = clampUnit((t - st) / 360);
        if (t < st || u >= 1) continue;
        const x = lerpTo(ox, b.x - d * 6, u), y = lerpTo(oy, b.y, u) + Math.sin(u * 10 + k * 1.7) * 6, r = 10 + u * 18;
        g.save(); g.globalCompositeOperation = "lighter"; g.translate(x, y); g.rotate(ang); g.lineCap = "round";
        g.globalAlpha = (u < 0.85 ? 1 : (1 - u) / 0.15) * 0.5; g.strokeStyle = `rgb(${m.c})`; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, r, -0.9, 0.9); g.stroke();
        g.globalAlpha *= 2; g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); g.restore();
        if (k % 2 === 0) drawStar(g, x + Math.cos(t / 60 + k) * 10, y - 12 + Math.sin(t / 50 + k) * 4, 4, m.l, 1 - u, t / 200);
      }
    });
    if (t >= HIT.projectile && firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 0.8); emitParts(S, m, b.x, b.y - 6, 6, { kind: "star", min: 40, max: 120, size: [2, 3.5], life: [400, 600], drag: 2 }); }
    if (t >= 560 && t < 760 && Math.floor(t / 100) !== Math.floor((t - 16) / 100)) addRing(S, m, b.x, b.y + 10, 6, 34, 300, 3);
  },
  "oblivion-wing"(S, t, _dt, a, b, m, fx, d) {
    const ox = a.x + d * 18, oy = a.y - 8, charge = 250, hit = HIT.projectile;
    if (t < charge) {
      const u = t / charge;
      S.draws.push((g) => { aura(g, a.x, a.y - 2, 26, m, 0.4 + u * 0.6, t); drawGlow(g, m.c, ox, oy, 8 + u * 14, 0.8); });
      if (Math.random() < 0.5) { const an = randomIn(0, 6.3); pushPart(S, { kind: "feather", m, x: ox + Math.cos(an) * 50, y: oy + Math.sin(an) * 36, vx: -Math.cos(an) * 200, vy: -Math.sin(an) * 150, max: 240, size: randomIn(2.5, 3.5), vr: 4, grav: 0, drag: 0 }); }
      return;
    }
    const grow = clampUnit((t - charge) / (hit - charge)), fade = t > 700 ? Math.max(0, 1 - (t - 700) / 120) : 1;
    if (fade > 0) {
      const ex = lerpTo(ox, b.x, easeOut(grow)), ey = lerpTo(oy, b.y, easeOut(grow));
      S.draws.push((g) => {
        const len = Math.hypot(ex - ox, ey - oy), an = Math.atan2(ey - oy, ex - ox);
        g.save(); g.translate(ox, oy); g.rotate(an); g.globalCompositeOperation = "lighter";
        for (const [w, col, al] of [[18, m.c, 0.3], [9, m.c, 0.85], [3, "255,255,255", 1]] as const) { g.globalAlpha = al * fade; g.fillStyle = `rgb(${col})`; g.fillRect(0, -w / 2, len, w); }
        g.restore(); drawGlow(g, m.c, ox, oy, 20, 0.8 * fade);
      });
      if (Math.random() < 0.6) pushPart(S, { kind: "feather", m, x: lerpTo(ox, ex, Math.random()), y: lerpTo(oy, ey, Math.random()) + randomIn(-6, 6), vx: randomIn(-30, 30), vy: randomIn(-40, -10), max: 420, size: randomIn(2.2, 3.2), vr: 4, grav: 40, drag: 3 });
    }
    if (t >= hit && firstTime(S, "hit")) hitFx(S, m, b.x, b.y, 1);
    // 빨아들임 — 대상에서 공격자로 붉은 빛 알
    S.draws.push((g) => {
      for (let k = 0; k < 7; k++) {
        const st = hit + 40 + k * 45, u = clampUnit((t - st) / 300);
        if (t < st || u >= 1) continue;
        const e = u * u * (3 - 2 * u), x = lerpTo(b.x, a.x, e), y = lerpTo(b.y, a.y - 4, e) - Math.sin(e * Math.PI) * (16 + k * 4) * (k % 2 ? 1 : -1);
        drawGlow(g, m.c, x, y, 10, 0.9); drawGlow(g, m.l, x, y, 3.5, 1, true);
      }
      const back = clampUnit((t - hit - 300) / 200);
      if (back > 0 && back < 1) drawGlow(g, m.l, a.x, a.y, 30 * (1 - back) + 10, (1 - back) * 0.8);
    });
  },
  // 부채꼴 ─────────
  "air-cutter"(S, t, _dt, a, b, m) {
    const ox = a.x, oy = a.y - 4, dir = dirOf(a, b), len = Math.hypot(b.x - ox, b.y - oy) + C * 1.0;
    if (t < 150) { const u = t / 150; S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 8 + u * 12, 0.5); windBlade(g, ox + Math.cos(dir) * 14, oy, 6 + u * 6, dir, 0.4, m, u, 0); }); return; }
    // 칼날 여섯 — [퍼지는 각, 기울기]
    const blades = [[-0.42, 0.5], [0.28, -0.45], [-0.12, 0.35], [0.4, -0.55], [0.06, 0.45], [-0.3, -0.4]] as const;
    S.draws.push((g) => {
      blades.forEach(([off, tilt], k) => {
        const st = 150 + k * 28, u = clampUnit((t - st) / 280);
        if (t < st || u >= 1) return;
        const an = dir + off, r = 20 + easeOut(u) * (len - 20);
        windBlade(g, ox + Math.cos(an) * r, oy + Math.sin(an) * r, 13 + u * 3, an, tilt, m, u < 0.8 ? 1 : (1 - u) / 0.2);
      });
    });
    if (t > HIT.cone && firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 0.8); emitParts(S, m, b.x, b.y, 6, { kind: "streak", min: 160, max: 300, life: [120, 220] }); }
    if (t > HIT.cone && t < HIT.cone + 200) S.draws.push((g) => slashLine(g, b.x, b.y - 4, 0.7, 54, m, 1 - (t - HIT.cone) / 200));
  },
  "bleakwind-storm"(S, t, dt, a, b, m) {
    const ox = a.x, oy = a.y - 4, dir = dirOf(a, b), half = 0.45, len = Math.hypot(b.x - ox, b.y - oy) + C * 1.2;
    if (t < 160) { S.draws.push((g) => { drawGlow(g, m.c, ox, oy, 8 + t / 9, 0.7); }); if (Math.random() < 0.6) emitParts(S, m, ox, oy, 1, { kind: "snow", min: 20, max: 60, size: [1.5, 2.5] }); return; }
    if (t < 760) {
      if (Math.floor(t / 90) !== Math.floor((t - dt) / 90)) S.waves.push({ life: 0, max: 560, seed: randomIn(0, 6) });
      for (let i = 0; i < 3; i++) { const dd = dir + randomIn(-half, half), sp = randomIn(260, 420); pushPart(S, { kind: Math.random() < 0.75 ? "snow" : "shard", m, x: ox, y: oy, vx: Math.cos(dd) * sp, vy: Math.sin(dd) * sp, max: (len / sp) * 1000, size: randomIn(1.5, 3), rot: randomIn(0, 6), vr: randomIn(-8, 8), grav: 20, drag: 0.4 }); }
    }
    if (t > HIT.cone && firstTime(S, "hit")) hitFx(S, m, b.x, b.y, 0.9);
    S.draws.push((g) => {
      for (const w of S.waves) {
        const u = w.life / w.max, r = 20 + easeOut(u) * (len - 20);
        g.save(); g.globalCompositeOperation = "lighter"; g.translate(ox, oy); g.rotate(dir); g.lineCap = "round";
        for (let k = -2; k <= 2; k++) {
          const an = k * half * 0.42, rr = r * (1 - Math.abs(k) * 0.06);
          g.beginPath();
          for (let s = 0; s <= 10; s++) { const q = s / 10, along = rr - 26 + q * 26, wob = Math.sin(q * 6 + (w.seed ?? 0) + k) * 3.5; g.lineTo(Math.cos(an) * along - Math.sin(an) * wob, Math.sin(an) * along + Math.cos(an) * wob); }
          g.globalAlpha = (1 - u) * 0.45; g.strokeStyle = `rgb(${m.c})`; g.lineWidth = 6; g.stroke();
          g.globalAlpha = 1 - u; g.strokeStyle = "#fff"; g.lineWidth = 1.8; g.stroke();
        }
        g.restore();
      }
    });
  },
  // 돌진 ─────────
  "brave-bird"(S, t, _dt, a, b, m, fx, d) {
    const go = 150, hit = HIT.rush, back = d > 0 ? Math.PI : 0;
    if (t < go) {
      const u = t / go;
      S.draws.push((g) => { aura(g, a.x, a.y - 4, 24 + u * 6, m, 0.5 + u * 0.5, t); wing(g, a.x - d * 4, a.y - 6, back - d * 0.5, 22 * u + 6, -1, m, u); wing(g, a.x - d * 4, a.y - 2, back + d * 0.5, 22 * u + 6, 1, m, u); });
      if (Math.random() < 0.6) emitParts(S, m, a.x + randomIn(-14, 14), a.y + 10, 1, { kind: "ember", dir: -Math.PI / 2, spread: 0.4, min: 60, max: 140, size: [2, 4], life: [200, 380] });
      return;
    }
    if (t < hit) {
      const u = easeOut((t - go) / (hit - go)), x = lerpTo(a.x, b.x - d * 22, u), y = lerpTo(a.y, b.y, u), ang = dirOf(a, b) + Math.PI;
      S.draws.push((g) => {
        comet(g, x, y, lerpTo(a.x, x, 0.25), lerpTo(a.y, y, 0.25), m, [20, 10, 4]);
        wing(g, x - d * 4, y - 3, ang - 0.85, 36, -1, m, 1); wing(g, x - d * 4, y + 3, ang + 0.85, 36, 1, m, 1);
        drawGlow(g, "255,255,255", x, y, 9, 1, true);
      });
      emitParts(S, m, x, y, 2, { kind: "ember", dir: ang, spread: 0.3, min: 80, max: 220, size: [2.5, 4.5], life: [150, 300] });
      if (Math.random() < 0.5) emitParts(S, m, x - d * 20, y, 1, { kind: "feather", dir: ang, spread: 0.6, min: 30, max: 90, size: [2.5, 3.5], life: [450, 650], drag: 3 });
      return;
    }
    if (firstTime(S, "hit")) {
      hitFx(S, m, b.x, b.y, 1.5); addRing(S, m, b.x, b.y + 16, 10, 74, 520, 9);
      emitParts(S, m, b.x, b.y, 14, { kind: "feather", min: 80, max: 240, size: [2.5, 4.5], life: [500, 800], drag: 3 });
      emitParts(S, m, b.x, b.y, 10, { kind: "streak", dir: d > 0 ? 0 : Math.PI, spread: 0.7, min: 220, max: 420, life: [140, 260] });
    }
  },
  "aerial-ace"(S, t, _dt, a, b, m, fx, d) {
    const go = 120, hit = HIT.rush;
    const P = [a, { x: lerpTo(a.x, b.x, 0.34), y: a.y - 30 }, { x: lerpTo(a.x, b.x, 0.68), y: b.y + 26 }, { x: b.x - d * 14, y: b.y - 4 }] as const;
    const at = (u: number): Pt => { const s = clampUnit(u) * 3, i = Math.min(2, Math.floor(s)), f = s - i, p = P[i]!, q = P[i + 1]!; return { x: lerpTo(p.x, q.x, f), y: lerpTo(p.y, q.y, f) }; };
    if (t < go) { S.draws.push((g) => drawStar(g, a.x + d * 10, a.y - 10, 6 + t / 12, m.l, 0.9, t / 60)); return; }
    if (t < hit + 80) {
      const u = clampUnit((t - go) / (hit - go)), fade = t > hit ? 1 - (t - hit) / 80 : 1;
      S.draws.push((g) => {
        const N = 24;
        g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
        for (const [w, col, al] of [[12, m.c, 0.55], [3.5, "255,255,255", 1]] as const) {
          g.strokeStyle = `rgb(${col})`; g.lineWidth = w; g.globalAlpha = al * fade; g.beginPath();
          for (let i = 0; i <= N; i++) { const q = Math.max(0, u - 0.45) + (Math.min(u, 0.45) * i) / N; const p = at(q); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
          g.stroke();
        }
        g.restore();
        const h = at(u), h0 = at(Math.max(0, u - 0.04)), ha = Math.atan2(h.y - h0.y, h.x - h0.x);
        if (t < hit) { drawGlow(g, m.c, h.x, h.y, 14, 0.8); g.save(); g.translate(h.x, h.y); g.rotate(ha); g.fillStyle = "#fff"; g.strokeStyle = `rgb(${m.c})`; g.lineWidth = 2; g.beginPath(); g.moveTo(10, 0); g.lineTo(-10, -9); g.lineTo(-4, 0); g.lineTo(-10, 9); g.closePath(); g.fill(); g.stroke(); g.restore(); }
        for (const c of [1, 2]) if (u * 3 > c && u * 3 < c + 0.6) drawStar(g, P[c]!.x, P[c]!.y, 8, m.l, 1 - (u * 3 - c) / 0.6, 0.3);
      });
    }
    if (t >= hit) {
      if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 0.9); emitParts(S, m, b.x, b.y, 5, { kind: "feather", min: 60, max: 160, size: [2.5, 3.5], life: [450, 650], drag: 3 }); }
      const v = (t - hit) / 220;
      if (v < 1) S.draws.push((g) => { slashLine(g, b.x, b.y - 4, d > 0 ? -0.75 : 0.75, 92 * Math.min(1, v * 4), m, 1 - v); drawStar(g, b.x, b.y - 4, 18 * (1 - v), "255,255,255", 1 - v, 0.2); });
    }
  },
  acrobatics(S, t, _dt, a, b, m, fx, d) {
    const go = 120, hit = HIT.rush;
    const at = (u: number): Pt => ({ x: lerpTo(a.x, b.x - d * 18, u), y: lerpTo(a.y, b.y, u) - Math.sin(u * Math.PI) * 66 });
    if (t < go) { S.draws.push((g) => drawGlow(g, m.c, a.x, a.y - 4, 12 + t / 10, 0.6)); if (firstTime(S, "r")) addRing(S, m, a.x, a.y + 18, 6, 34, 280, 4); return; }
    if (t < hit) {
      const u = easeOut((t - go) / (hit - go));
      S.draws.push((g) => {
        g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = `rgba(${m.c},0.7)`; g.lineWidth = 2; g.setLineDash([4, 6]); g.beginPath(); for (let i = 0; i <= 24; i++) { const p = at((u * i) / 24); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke(); g.restore();
        for (let k = 4; k >= 1; k--) { const p = at(Math.max(0, u - k * 0.13)); drawGlow(g, m.c, p.x, p.y, 14 - k * 2, 0.5 - k * 0.1); drawStar(g, p.x, p.y, 7 - k, m.l, 0.6 - k * 0.12, t / 50 + k); }
        const h = at(u); drawGlow(g, m.c, h.x, h.y, 22, 0.9); drawGlow(g, "255,255,255", h.x, h.y, 8, 1, true); drawStar(g, h.x, h.y, 12, "255,255,255", 1, t / 40);
      });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.1); emitParts(S, m, b.x, b.y - 8, 8, { kind: "star", min: 60, max: 180, size: [2, 3.5], life: [350, 550] }); }
  },
  pluck(S, t, _dt, a, b, m, fx, d) {
    const go = 150, reach = 300, ang = dirOf(a, b);
    if (t < go) { S.draws.push((g) => drawGlow(g, m.c, a.x, a.y - 4, 10 + t / 14, 0.6)); return; }
    if (t < reach) {
      const u = easeOut((t - go) / (reach - go)), x = lerpTo(a.x, b.x - d * 30, u), y = lerpTo(a.y, b.y, u);
      S.draws.push((g) => comet(g, x, y, lerpTo(a.x, x, 0.45), lerpTo(a.y, y, 0.45), m, [18, 9, 3.5]));
      return;
    }
    const jabs = [330, 400, 470] as const;
    S.draws.push((g) => {
      for (let i = 0; i < jabs.length; i++) {
        const v = (t - jabs[i]! + 50) / 120;
        if (v < 0 || v > 1) continue;
        const push2 = Math.sin(Math.min(1, v * 1.6) * Math.PI) * 12, x = b.x - d * 22 + Math.cos(ang) * push2, y = b.y - 4 + (i - 1) * 8 + Math.sin(ang) * push2;
        g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = 1 - v; g.globalCompositeOperation = "lighter";
        g.fillStyle = `rgb(${m.c})`; g.beginPath(); g.moveTo(16, 0); g.lineTo(-4, -6); g.lineTo(-4, 6); g.closePath(); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.moveTo(13, 0); g.lineTo(0, -2.5); g.lineTo(0, 2.5); g.closePath(); g.fill(); g.restore();
      }
    });
    for (let i = 0; i < jabs.length; i++) if (t >= jabs[i]! && firstTime(S, "j" + i)) {
      if (i === 0) hitFx(S, m, b.x, b.y, 0.8);
      else S.flashes.push({ m, x: b.x - d * 4, y: b.y - 4 + (i - 1) * 8, r: 18, life: 0, max: 160 });
      emitParts(S, m, b.x, b.y, 3, { kind: "feather", min: 60, max: 160, size: [2.2, 3.2], life: [400, 600], drag: 3 });
    }
  },
  fly(S, t, _dt, a, b, m, fx, d) {
    const up = 170, hit = HIT.rush, top = -PAD - 30;
    if (firstTime(S, "lift")) { addRing(S, m, a.x, a.y + 18, 8, 50, 360, 6); emitParts(S, m, a.x, a.y + 10, 6, { kind: "feather", min: 40, max: 120, size: [2.5, 3.5], life: [500, 750], drag: 3 }); }
    if (t < up) {
      const u = easeIn(t / up), y = lerpTo(a.y, top, u);
      S.draws.push((g) => { comet(g, a.x, y, a.x, lerpTo(a.y, y, 0.4), m, [30, 15, 6]); wing(g, a.x - 4, y + 6, Math.PI / 2 + 0.5, 22, -1, m, 1); wing(g, a.x + 4, y + 6, Math.PI / 2 - 0.5, 22, 1, m, 1); });
      return;
    }
    if (t < hit) {
      const sx = b.x - d * 80, u = easeIn((t - up) / (hit - up)), x = lerpTo(sx, b.x, u), y = lerpTo(top, b.y - 6, u), ang = Math.atan2(top - b.y, sx - b.x);
      S.draws.push((g) => { comet(g, x, y, lerpTo(sx, x, 0.3), lerpTo(top, y, 0.3), m, [22, 11, 4]); wing(g, x, y, ang - 0.85, 30, -1, m, 1); wing(g, x, y, ang + 0.85, 30, 1, m, 1); });
      S.under.push((g) => { g.save(); g.globalAlpha = 0.35 * u; g.fillStyle = "rgb(10,14,24)"; g.beginPath(); g.ellipse(b.x, b.y + 20, 10 + u * 16, (10 + u * 16) * 0.4, 0, 0, 7); g.fill(); g.restore(); });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.4); addRing(S, m, b.x, b.y + 18, 10, 70, 500, 8); emitParts(S, m, b.x, b.y, 10, { kind: "feather", min: 80, max: 220, size: [2.5, 4], life: [500, 750], drag: 3 }); }
  },
  "wing-attack"(S, t, _dt, a, b, m, fx, d) {
    const go = 150, hit = HIT.rush, ang = dirOf(a, b) + Math.PI;
    if (t < go) { const u = t / go; S.draws.push((g) => { wing(g, a.x, a.y - 6, -Math.PI / 2 - d * 0.3, 10 + u * 18, d > 0 ? 1 : -1, m, u); wing(g, a.x, a.y - 6, -Math.PI / 2 + d * 0.3, 10 + u * 18, d > 0 ? -1 : 1, m, u); }); return; }
    if (t < hit) {
      const u = easeOut((t - go) / (hit - go)), x = lerpTo(a.x, b.x - d * 26, u), y = lerpTo(a.y, b.y, u), flap = Math.sin(t / 28) * 0.45;
      S.draws.push((g) => { comet(g, x, y, lerpTo(a.x, x, 0.35), lerpTo(a.y, y, 0.35), m, [22, 11, 4]); wing(g, x, y - 2, ang - 1.1 - flap, 30, -1, m, 1); wing(g, x, y + 2, ang + 1.1 + flap, 30, 1, m, 1); });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.0); emitParts(S, m, b.x, b.y, 10, { kind: "feather", min: 80, max: 200, size: [2.5, 4], life: [450, 700], drag: 3 }); }
    const v = (t - hit) / 240;
    if (v < 1) S.draws.push((g) => { featherBlade(g, b.x - d * 4, b.y - 10, 26, (d > 0 ? Math.PI : 0) + d * 0.6 - v * d * 0.6, m, 1 - v); featherBlade(g, b.x - d * 4, b.y + 2, 26, (d > 0 ? Math.PI : 0) - d * 0.6 + v * d * 0.6, m, 1 - v); });
  },
  "drill-peck"(S, t, _dt, a, b, m, fx, d) {
    const go = 150, hit = HIT.rush, ang = dirOf(a, b);
    const drill = (g: Ctx, x: number, y: number, al: number): void => {
      g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = al; g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgb(${m.c})`; g.beginPath(); g.moveTo(22, 0); g.lineTo(-12, -11); g.lineTo(-12, 11); g.closePath(); g.fill();
      g.save(); g.clip(); g.strokeStyle = "#fff"; g.lineWidth = 2.5;
      for (let k = 0; k < 5; k++) { const sx = -12 + ((k * 8 + t / 6) % 40); g.beginPath(); g.moveTo(sx, -12); g.lineTo(sx + 6, 12); g.stroke(); }
      g.restore(); g.restore();
    };
    if (t < go) { S.draws.push((g) => { drawGlow(g, m.c, a.x + d * 10, a.y - 4, 10 + t / 12, 0.6); drill(g, a.x + d * 14, a.y - 4, t / go); }); return; }
    if (t < hit) {
      const u = easeOut((t - go) / (hit - go)), x = lerpTo(a.x, b.x - d * 26, u), y = lerpTo(a.y, b.y, u);
      S.draws.push((g) => {
        g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
        for (const s of [1, -1]) {
          g.strokeStyle = s > 0 ? "#fff" : `rgb(${m.c})`; g.lineWidth = 2; g.globalAlpha = 0.85; g.beginPath();
          for (let i = 0; i <= 20; i++) { const q = i / 20, px = lerpTo(x, lerpTo(a.x, x, 0.5), q), py = lerpTo(y, lerpTo(a.y, y, 0.5), q), w = Math.sin(q * 12 - t / 18) * 9 * s * (1 - q); i ? g.lineTo(px - Math.sin(ang) * w, py + Math.cos(ang) * w) : g.moveTo(px, py); }
          g.stroke();
        }
        g.restore(); drawGlow(g, m.c, x, y, 20, 0.7); drill(g, x, y, 1);
      });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.2); emitParts(S, m, b.x, b.y, 16, { kind: "streak", min: 200, max: 400, life: [140, 260] }); }
    const v = (t - hit) / 300;
    if (v < 1) S.draws.push((g) => { g.save(); g.globalCompositeOperation = "lighter"; g.translate(b.x, b.y - 4); g.globalAlpha = 1 - v; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 40; i++) { const an = i * 0.4 + v * 6, r = i * 1.1 * (0.5 + v); g.lineTo(Math.cos(an) * r, Math.sin(an) * r * 0.7); } g.stroke(); g.restore(); });
  },
  "sky-attack"(S, t, dt, a, b, m, fx, d) {
    const go = 170, hit = HIT.rush, ang = dirOf(a, b) + Math.PI;
    if (t < go) {
      const u = t / go;
      S.draws.push((g) => { aura(g, a.x, a.y - 4, 26 + u * 8, m, 0.6 + u * 0.4, t * 2); drawGlow(g, "255,255,255", a.x, a.y - 4, 8 + u * 10, u, true); });
      if (Math.floor(t / 50) !== Math.floor((t - dt) / 50)) addRing(S, m, a.x, a.y + 16, 56, 12, 220, 4, m.l);
      if (Math.random() < 0.8) emitParts(S, m, a.x + randomIn(-20, 20), a.y + 14, 1, { kind: Math.random() < 0.5 ? "feather" : "ember", dir: -Math.PI / 2, spread: 0.3, min: 120, max: 240, size: [2, 3.5], life: [250, 400], grav: -60, drag: 1 });
      return;
    }
    if (t < hit) {
      const u = easeOut((t - go) / (hit - go)), x = lerpTo(a.x, b.x - d * 22, u), y = lerpTo(a.y, b.y, u);
      S.draws.push((g) => {
        comet(g, x, y, lerpTo(a.x, x, 0.15), lerpTo(a.y, y, 0.15), m, [28, 14, 5]);
        wing(g, x - d * 6, y - 4, ang - 0.8, 48, -1, m, 1); wing(g, x - d * 6, y + 4, ang + 0.8, 48, 1, m, 1);
        drawGlow(g, "255,255,255", x, y, 16, 1, true);
      });
      emitParts(S, m, x, y, 3, { kind: "ember", dir: ang, spread: 0.4, min: 80, max: 240, size: [3, 5], life: [180, 340] });
      return;
    }
    if (firstTime(S, "hit")) {
      hitFx(S, m, b.x, b.y, 1.7); addRing(S, m, b.x, b.y + 16, 10, 90, 560, 10); addRing(S, m, b.x, b.y + 16, 4, 56, 420, 5, m.l);
      emitParts(S, m, b.x, b.y, 18, { kind: "feather", min: 90, max: 260, size: [3, 5], life: [550, 850], drag: 3 });
    }
  },
  "dragon-ascent"(S, t, _dt, a, b, m, fx, d) {
    const up = 150, hit = HIT.rush, top = -PAD - 30;
    if (firstTime(S, "lift")) addRing(S, m, a.x, a.y + 18, 8, 60, 380, 7);
    const spiral = (g: Ctx, x1: number, y1: number, x2: number, y2: number, al: number): void => {
      g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = `rgb(${m.l})`; g.lineWidth = 2; g.globalAlpha = al; g.beginPath();
      const an = Math.atan2(y2 - y1, x2 - x1);
      for (let i = 0; i <= 30; i++) { const q = i / 30, w = Math.sin(q * 14 - t / 15) * 12 * (1 - q * 0.6); const px = lerpTo(x1, x2, q) - Math.sin(an) * w, py = lerpTo(y1, y2, q) + Math.cos(an) * w; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke(); g.restore();
    };
    if (t < up) {
      const u = easeIn(t / up), y = lerpTo(a.y, top, u);
      S.draws.push((g) => { comet(g, a.x, y, a.x, lerpTo(a.y, y, 0.25), m, [34, 17, 7]); spiral(g, a.x, y, a.x, lerpTo(a.y, y, 0.25), 0.9); });
      return;
    }
    if (t < hit) {
      const sx = b.x - d * 40, u = easeIn((t - up) / (hit - up)), x = lerpTo(sx, b.x, u), y = lerpTo(top, b.y - 6, u);
      S.draws.push((g) => { comet(g, x, y, lerpTo(sx, x, 0.15), lerpTo(top, y, 0.15), m, [40, 20, 8]); spiral(g, x, y, lerpTo(sx, x, 0.15), lerpTo(top, y, 0.15), 1); });
      S.under.push((g) => { g.save(); g.globalAlpha = 0.35 * u; g.fillStyle = "rgb(10,14,24)"; g.beginPath(); g.ellipse(b.x, b.y + 20, 10 + u * 18, (10 + u * 18) * 0.4, 0, 0, 7); g.fill(); g.restore(); });
      return;
    }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 1.6); addRing(S, m, b.x, b.y + 18, 10, 92, 560, 10); emitParts(S, m, b.x, b.y, 16, { kind: "ember", min: 100, max: 300, size: [3, 5] }); }
  },
  bounce(S, t, _dt, a, b, m, fx, d) {
    const up = 200, hit = HIT.rush, peak = { x: lerpTo(a.x, b.x, 0.55), y: -PAD - 10 };
    if (firstTime(S, "lift")) addRing(S, m, a.x, a.y + 18, 6, 40, 300, 5);
    if (t < up) {
      const u = t / up, x = lerpTo(a.x, peak.x, u), y = lerpTo(a.y, peak.y, 1 - (1 - u) * (1 - u));
      S.draws.push((g) => { drawGlow(g, m.c, x, y, 18, 0.8); drawGlow(g, "255,255,255", x, y, 7, 1, true); for (let k = 1; k <= 3; k++) { const q = Math.max(0, u - k * 0.08); drawGlow(g, m.c, lerpTo(a.x, peak.x, q), lerpTo(a.y, peak.y, 1 - (1 - q) * (1 - q)), 12 - k * 2, 0.5 - k * 0.12); } });
      return;
    }
    if (t < hit) {
      const u = easeIn((t - up) / (hit - up)), x = lerpTo(peak.x, b.x, u), y = lerpTo(peak.y, b.y - 6, u);
      S.draws.push((g) => comet(g, x, y, lerpTo(peak.x, x, 0.5), lerpTo(peak.y, y, 0.5), m, [26, 13, 5]));
      S.under.push((g) => { g.save(); g.globalAlpha = 0.35 * u; g.fillStyle = "rgb(10,14,24)"; g.beginPath(); g.ellipse(b.x, b.y + 20, 8 + u * 16, (8 + u * 16) * 0.4, 0, 0, 7); g.fill(); g.restore(); });
      return;
    }
    if (firstTime(S, "hit")) {
      hitFx(S, m, b.x, b.y, 1.1); addRing(S, m, b.x, b.y + 18, 10, 80, 520, 8);
      emitParts(S, m, b.x, b.y + 16, 6, { kind: "streak", dir: 0, spread: 0.15, min: 200, max: 340, life: [140, 240] });
      emitParts(S, m, b.x, b.y + 16, 6, { kind: "streak", dir: Math.PI, spread: 0.15, min: 200, max: 340, life: [140, 240] });
    }
  },
  // 근접 ─────────
  "dual-wingbeat"(S, t, _dt, a, b, m, fx, d) {
    const hit = HIT.melee, second = hit + 130, face = d > 0 ? Math.PI : 0;
    if (t < hit) { if (t > 60) S.draws.push((g) => { wing(g, a.x, a.y - 6, -Math.PI / 2 - d * 0.4, 12 + (t / hit) * 12, d > 0 ? 1 : -1, m, t / hit); }); return; }
    if (firstTime(S, "hit")) { hitFx(S, m, b.x, b.y, 0.8); emitParts(S, m, b.x, b.y, 6, { kind: "feather", min: 60, max: 180, size: [2.5, 3.8], life: [450, 700], drag: 3 }); }
    if (t >= second && firstTime(S, "hit2")) { S.flashes.push({ m, x: b.x, y: b.y + 4, r: 26, life: 0, max: 200 }); emitParts(S, m, b.x, b.y, 6, { kind: "feather", min: 60, max: 180, size: [2.5, 3.8], life: [450, 700], drag: 3 }); }
    S.draws.push((g) => {
      const v1 = (t - hit + 40) / 200, v2 = (t - second + 40) / 200;
      if (v1 > 0 && v1 < 1) featherBlade(g, b.x - d * 10, b.y - 6, 28, face - d * (1.1 - v1 * 1.4), m, 1 - v1);
      if (v2 > 0 && v2 < 1) featherBlade(g, b.x - d * 10, b.y + 2, 28, face + d * (1.1 - v2 * 1.4), m, 1 - v2);
    });
  },
};

