// 배틀 창 전장의 날씨·필드·오라 상시 연출 (docs/specs/ui-components.md "배틀 창으로 더한 것", 시안 9판)
// - 필드: 바닥 위·포켓몬 아래. 가운데 타원은 비우고 바깥에만 그린다. 타원 테두리는 옅은 그라데이션 띠
// - 날씨: 포켓몬 위. 전장 색 보정 + 입자. 오라: 포켓몬 위, 전장 가장자리
// - 바닥·포켓몬이 DOM 이라 canvas 한 장으로 색 보정을 할 수 없다. 섞기 방식마다 canvas 를 두고 CSS mix-blend-mode 로 겹친다
// - 시안의 "효과 없는 장면을 (1 - mix) 만큼 덮기"는 canvas 마다 opacity = mix 로 바꿨다
// - 끝의대지 열기 일렁임(장면 전체 일그러짐)은 DOM 위에서 같은 방식으로 할 수 없어 뺐다

const W = 560;
const H = 336;
const FADE_MS = 600; // 룰렛 뒤 연출이 차오르는 시간
const TICK_MS = 5000; // 모래바람 피해·그래스필드 회복 판정 간격 (docs/specs/moves.md "날씨, 필드, 오라")

type Ctx = CanvasRenderingContext2D;
type Blend = "multiply" | "soft-light" | "screen" | "normal" | "plus-lighter" | "difference";
const BLEND_ORDER: Blend[] = ["multiply", "soft-light", "screen", "normal", "plus-lighter", "difference"];

export interface FieldFxKinds {
  weather: string | null; // 엔진 kind — sun·rain·sand·snow·harsh-sun·heavy-rain·strong-winds (none 은 연출 없음)
  field: string | null; // electric·grassy·psychic·misty
  aura: string | null; // fairy·dark·break
}

export interface FieldFx {
  draw(t: number): void; // t = 판 시계(ms). 배속이 그대로 연출 속도가 된다
}

// ── 공통 도구 ──
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const P = <T>(n: number, seed: number, make: (r: () => number) => T): T[] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => make(r));
};
const canvasOf = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const ctxOf = (c: HTMLCanvasElement): Ctx => {
  const g = c.getContext("2d");
  if (!g) throw new Error("canvas 2d 를 만들지 못했다");
  return g;
};

// 부드러운 빛 점 — 색마다 한 번 그려 두고 다시 쓴다
const GLOW = new Map<string, HTMLCanvasElement>();
function glowSprite(rgb: string): HTMLCanvasElement {
  let c = GLOW.get(rgb);
  if (c) return c;
  c = canvasOf(64, 64);
  const x = ctxOf(c);
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
  if (a <= 0.01) return;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2);
}
function blob(g: Ctx, rgb: string, x: number, y: number, rx: number, ry: number, a: number): void {
  if (a <= 0.01) return;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(glowSprite(rgb), x - rx, y - ry, rx * 2, ry * 2);
}
// 전장 전체 색 보정 — 섞기 방식은 그리는 canvas 가 정한다
function grade(g: Ctx, top: string, bottom: string, alpha = 1): void {
  g.globalAlpha = alpha;
  const gr = g.createLinearGradient(0, 0, W * 0.3, H);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
}
// 가장자리 빛·그림자 — 가로세로 같은 비율로 번지는 타원
function edge(g: Ctx, rgb: string, a: number, inner = 0.45): void {
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(1, H / W);
  const R = (W / 2) * 1.2;
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(inner, `rgba(${rgb},0)`);
  gr.addColorStop(0.82, `rgba(${rgb},${a * 0.75})`);
  gr.addColorStop(1, `rgba(${rgb},${a})`);
  g.fillStyle = gr;
  g.fillRect(-W / 2, -W / 2, W, W);
  g.restore();
}
// 5초 판정의 짧은 박동, 0~1
const tick5 = (t: number): number => {
  const k = mod(t, TICK_MS);
  return k < 900 ? Math.pow(1 - k / 900, 2) : 0;
};

// 빗줄기 한 가닥 — 아래로 갈수록 밝다
let streak: HTMLCanvasElement | null = null;
function streakSprite(): HTMLCanvasElement {
  if (streak) return streak;
  streak = canvasOf(4, 64);
  const x = ctxOf(streak);
  const gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "rgba(225,238,255,0)");
  gr.addColorStop(0.8, "rgba(230,242,255,0.55)");
  gr.addColorStop(1, "rgba(245,250,255,0.95)");
  x.fillStyle = gr;
  x.fillRect(1, 0, 2, 64);
  return streak;
}

// ── 필드 타원 — 가운데는 비우고 바깥에만 효과 ──
const RX = 302;
const RY = 181;
const cornerAngle = (r: () => number): number => [0.79, Math.PI - 0.79, Math.PI + 0.79, -0.79][Math.floor(r() * 4)]! + (r() - 0.5) * 0.5; // 네 모서리 근처 — 효과가 보이는 곳
const ringAt = (a: number, d: number): [number, number] => [W / 2 + Math.cos(a) * RX * d, H / 2 + Math.sin(a) * RY * d];
function outerGlow(g: Ctx, rgb: string, a: number): void {
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(1, RY / RX);
  const gr = g.createRadialGradient(0, 0, RX * 0.85, 0, 0, RX * 1.45);
  gr.addColorStop(0, `rgba(${rgb},0)`);
  gr.addColorStop(1, `rgba(${rgb},${a})`);
  g.fillStyle = gr;
  g.fillRect(-W, -W, W * 2, W * 2);
  g.restore();
}

// ── 섞기 방식별 canvas 묶음 — 쓰는 방식만 만든다. opacity 는 효과 세기(mix) × 차오름 ──
class Layers {
  private readonly made = new Map<Blend, { canvas: HTMLCanvasElement; g: Ctx }>();
  private readonly used = new Set<Blend>();
  constructor(
    private readonly host: HTMLElement,
    private readonly dpr: number,
  ) {}
  get(b: Blend): Ctx {
    let one = this.made.get(b);
    if (!one) {
      const canvas = canvasOf(Math.round(W * this.dpr), Math.round(H * this.dpr));
      canvas.className = "field-fx";
      if (b !== "normal") canvas.style.mixBlendMode = b;
      one = { canvas, g: ctxOf(canvas) };
      this.made.set(b, one);
      // 섞는 순서 — 색 보정(곱하기·부드러운 빛·스크린) 먼저, 입자(보통·더하기) 나중
      const after = BLEND_ORDER.slice(BLEND_ORDER.indexOf(b) + 1).map((x) => this.made.get(x)?.canvas).find((c) => c);
      this.host.insertBefore(canvas, after ?? null);
    }
    if (!this.used.has(b)) {
      this.used.add(b);
      one.g.setTransform(1, 0, 0, 1, 0, 0);
      one.g.clearRect(0, 0, one.canvas.width, one.canvas.height);
      one.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      one.g.globalAlpha = 1;
      one.g.globalCompositeOperation = "source-over";
    }
    return one.g;
  }
  // 프레임 시작 — 지난 프레임에 쓴 canvas 는 get 때 지운다. 이번에 안 쓴 canvas 는 끝에서 지운다
  begin(): void {
    this.used.clear();
  }
  end(opacity: number): void {
    for (const [b, one] of this.made) {
      if (!this.used.has(b)) {
        one.g.setTransform(1, 0, 0, 1, 0, 0);
        one.g.clearRect(0, 0, one.canvas.width, one.canvas.height);
      }
      const o = opacity.toFixed(3);
      if (one.canvas.style.opacity !== o) one.canvas.style.opacity = o;
    }
  }
}

interface WeatherFx {
  mix: number;
  draw(L: Layers, t: number): void;
}
interface FieldOnly {
  mix: number;
  ring: string; // 타원 테두리 색
  draw(g: Ctx, t: number): void; // 전장 전체에 그린다 — 가운데는 나중에 지운다
}

// ── 날씨 ──
function sunFx(): WeatherFx {
  const motes = P(34, 3, (r) => ({ x: r() * W, y: r() * H, r: 1.2 + r() * 2.4, v: 0.004 + r() * 0.008, p: r() * 9 }));
  return {
    mix: 0.5,
    draw(L, t) {
      grade(L.get("soft-light"), "rgba(255,196,110,0.9)", "rgba(255,170,90,0.35)");
      grade(L.get("screen"), "rgba(255,220,160,0.10)", "rgba(255,200,140,0)");
      const g = L.get("plus-lighter");
      const sx = -40;
      const sy = -70;
      for (let i = 0; i < 6; i++) {
        const a = 0.5 + i * 0.13 + Math.sin(t / 5200 + i * 1.7) * 0.025;
        const w = 0.022 + (i % 3) * 0.012;
        const k = 0.07 + 0.045 * Math.sin(t / 2100 + i * 2.3);
        const gr = g.createRadialGradient(sx, sy, 20, sx, sy, 560);
        gr.addColorStop(0, `rgba(255,232,180,${k * 1.6})`);
        gr.addColorStop(1, "rgba(255,232,180,0)");
        g.globalAlpha = 1;
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + Math.cos(a - w) * 700, sy + Math.sin(a - w) * 700);
        g.lineTo(sx + Math.cos(a + w) * 700, sy + Math.sin(a + w) * 700);
        g.closePath();
        g.fill();
      }
      dot(g, "255,214,150", 6, -6, 150, 0.28 + 0.05 * Math.sin(t / 1500));
      for (const m of motes) dot(g, "255,240,205", mod(m.x + t * m.v * 2, W), mod(m.y - t * m.v, H), m.r * 2.2, 0.15 + 0.45 * Math.max(0, Math.sin(t / 700 + m.p)));
    },
  };
}

function harshFx(): WeatherFx {
  const em = P(46, 5, (r) => ({ x: r() * W, y: r() * H, v: 0.018 + r() * 0.03, r: 1 + r() * 1.6, p: r() * 9 }));
  return {
    mix: 0.5,
    draw(L, t) {
      grade(L.get("soft-light"), "rgba(255,120,40,1)", "rgba(220,60,20,0.8)");
      grade(L.get("multiply"), "rgba(255,200,170,0.5)", "rgba(255,160,120,0.6)");
      const g = L.get("plus-lighter");
      const gr = g.createLinearGradient(0, H, 0, H * 0.45);
      gr.addColorStop(0, `rgba(255,110,30,${0.28 + 0.06 * Math.sin(t / 600)})`);
      gr.addColorStop(1, "rgba(255,110,30,0)");
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      dot(g, "255,150,70", 10, -10, 170, 0.35);
      for (const e of em) {
        const y = mod(e.y - t * e.v, H + 20) - 10;
        const sway = Math.sin(t / 380 + e.p);
        const x = e.x + sway * 7;
        const fl = 0.55 + 0.45 * Math.sin(t / 90 + e.p * 3);
        for (let k = 3; k >= 0; k--) dot(g, "255,140,50", x - sway * k * 0.6, y + k * 3.2, e.r * (2.6 - k * 0.4), fl * (0.75 - k * 0.17));
      }
    },
  };
}

function rainFx(dense: boolean): WeatherFx {
  const spec: [number, number, number, number, number][] = dense
    ? [[120, 0.55, 14, 1, 0.3], [60, 0.85, 24, 1.4, 0.5], [26, 1.3, 38, 2, 0.7]]
    : [[64, 0.5, 13, 1, 0.26], [34, 0.8, 22, 1.3, 0.45], [12, 1.2, 34, 1.8, 0.62]];
  const layers = spec.map(([n, v, l, w, a], li) => ({ v, l, w, a, drops: P(n, 70 + li + (dense ? 9 : 0), (r) => ({ x: r(), y: r(), j: 0.85 + r() * 0.3 })) }));
  const splashes = P(dense ? 16 : 9, dense ? 13 : 12, (r) => ({ p: r() * 700 }));
  return {
    mix: 0.5,
    draw(L, t) {
      if (dense) {
        grade(L.get("multiply"), "rgba(110,125,150,1)", "rgba(80,95,125,1)", 0.55);
        grade(L.get("soft-light"), "rgba(40,60,100,1)", "rgba(30,40,80,1)", 0.45);
      } else {
        grade(L.get("multiply"), "rgba(170,185,205,1)", "rgba(150,170,195,1)", 0.4);
        grade(L.get("soft-light"), "rgba(70,100,150,1)", "rgba(60,80,130,1)", 0.3);
      }
      const g = L.get("plus-lighter");
      if (dense) {
        // 시작의바다 — 6.2초마다 번개 번쩍임
        const ph = mod(t, 6200);
        const f = ph < 90 ? 1 : ph < 160 ? 0.25 : ph < 240 ? 0.75 : ph < 600 ? 0.75 * (1 - (ph - 240) / 360) : 0;
        if (f > 0) {
          g.globalAlpha = 1;
          g.fillStyle = `rgba(200,215,255,${f * 0.16})`;
          g.fillRect(0, 0, W, H);
        }
      }
      const sprite = streakSprite();
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(0.2);
      const SW = W * 1.4;
      const SH = H * 1.5;
      for (const ly of layers) {
        g.globalAlpha = ly.a;
        for (const d of ly.drops) {
          const x = d.x * SW - SW / 2;
          const y = mod(d.y * SH + t * ly.v * d.j, SH) - SH / 2;
          g.drawImage(sprite, x, y - ly.l, ly.w * 2, ly.l);
        }
      }
      g.restore();
      splashes.forEach((s, i) => {
        const cyc = Math.floor((t + s.p) / 700);
        const k = mod(t + s.p, 700) / 700;
        const r = rng(cyc * 131 + i * 7 + (dense ? 1 : 0));
        const x = 10 + r() * (W - 20);
        const y = 30 + r() * (H - 40);
        g.globalAlpha = 1;
        g.strokeStyle = `rgba(220,235,255,${(1 - k) * 0.45})`;
        g.lineWidth = 1;
        const rx = 2 + k * 10;
        g.beginPath();
        g.ellipse(x, y, rx, rx * 0.32, 0, 0, Math.PI * 2);
        g.stroke();
        if (k < 0.5) for (const sd of [-1, 1]) dot(g, "230,240,255", x + sd * k * 10, y - Math.sin(k * 2 * Math.PI) * 5, 1.6, 0.6 * (1 - k * 2));
      });
    },
  };
}

function sandFx(): WeatherFx {
  // 알갱이 3겹 — 왼쪽에서 오른쪽으로만 흐른다. 돌풍은 속도가 아니라 꼬리 길이·짙기만 바꾼다
  const spec: [number, number, number, string, number][] = [[64, 0.16, 1, "214,178,120", 0.5], [48, 0.27, 1.4, "168,122,62", 0.72], [22, 0.44, 2, "118,80,36", 0.85]];
  const grains = spec.map(([n, v, s, c, a], li) => ({ v, s, c, a, ps: P(n, 17 + li, (r) => ({ x: r() * W, y: r() * H, j: 0.8 + r() * 0.4 })) }));
  const bands = P(5, 19, (r) => ({ y: r() * H, v: 0.07 + r() * 0.06, w: 200 + r() * 160, h: 26 + r() * 30, p: r() * W }));
  return {
    mix: 0.65,
    draw(L, t) {
      const pulse = tick5(t);
      const gust = 0.8 + 0.2 * Math.sin(t / 1700) + pulse * 0.8;
      grade(L.get("multiply"), "rgba(235,208,165,1)", "rgba(218,180,125,1)", 0.5 + pulse * 0.15);
      grade(L.get("soft-light"), "rgba(200,140,60,1)", "rgba(170,110,50,1)", 0.35);
      const g = L.get("normal");
      for (const b of bands) {
        const run = mod(b.p + t * b.v, W + b.w * 2);
        blob(g, "222,186,130", run - b.w, b.y + (run / (W + b.w * 2)) * 12, b.w, b.h, 0.2 + pulse * 0.15);
      }
      for (const ly of grains) {
        g.fillStyle = `rgb(${ly.c})`;
        for (const q of ly.ps) {
          const run = t * ly.v * q.j;
          const x = mod(q.x + run, W + 40) - 20;
          const y = mod(q.y + run * 0.1, H);
          const len = ly.s * (3 + gust * 4);
          const h = ly.s * 0.8;
          g.globalAlpha = ly.a * 0.35;
          g.fillRect(x - len, y, len, h);
          g.globalAlpha = ly.a;
          g.fillRect(x - len * 0.35, y, len * 0.35, h);
        }
      }
    },
  };
}

function snowFx(): WeatherFx {
  // 차갑게 한 톤 낮춘 바탕 위에 흰 눈송이 + 옅은 그림자 — 밝은 바탕에서도 보이게
  const spec: [number, number, number, number, number][] = [[60, 0.014, 1.1, 0.8, 6], [36, 0.024, 1.8, 0.92, 10], [12, 0.042, 3, 0.85, 16]];
  const flakes = spec.map(([n, v, r0, a, sw], li) => ({ v, r0, a, sw, ps: P(n, 23 + li, (r) => ({ x: r() * W, y: r() * H, p: r() * 9, j: 0.8 + r() * 0.4 })) }));
  return {
    mix: 0.75,
    draw(L, t) {
      grade(L.get("multiply"), "rgba(200,212,230,1)", "rgba(178,194,218,1)", 0.6);
      grade(L.get("soft-light"), "rgba(120,150,200,1)", "rgba(100,130,190,1)", 0.3);
      const g = L.get("normal");
      for (const ly of flakes) {
        for (const f of ly.ps) {
          const y = mod(f.y + t * ly.v * f.j, H + 20) - 10;
          const x = mod(f.x + Math.sin(t / 900 + f.p) * ly.sw + t * ly.v * 0.3, W);
          g.globalAlpha = ly.a * 0.3;
          g.fillStyle = "rgb(70,90,125)";
          g.beginPath();
          g.arc(x + 0.6, y + 0.9, ly.r0, 0, Math.PI * 2);
          g.fill();
          dot(g, "255,255,255", x, y, ly.r0 * 2.4, ly.a * 0.45);
          g.globalAlpha = ly.a;
          g.fillStyle = "#ffffff";
          g.beginPath();
          g.arc(x, y, ly.r0, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  };
}

function windsFx(): WeatherFx {
  // 에메랄드 바람결 — 짙은 청록 밑줄 위에 본색, 머리 쪽은 흰 빛
  const rib = P(8, 29, (r) => ({ y: 24 + r() * (H - 48), v: 0.2 + r() * 0.12, len: 160 + r() * 140, amp: 4 + r() * 8, p: r() * 6000, a: 0.5 + r() * 0.3, w: 1.6 + r() * 1.4 }));
  const specks = P(18, 31, (r) => ({ x: r() * W, y: r() * H, v: 0.45 + r() * 0.35, p: r() * 9 }));
  const strokes: [string, number, number][] = [["rgb(18,104,84)", 1.6, 0.3], ["rgb(58,210,165)", 0, 1]];
  return {
    mix: 0.7,
    draw(L, t) {
      grade(L.get("soft-light"), "rgba(80,200,160,1)", "rgba(40,150,130,1)", 0.35);
      grade(L.get("multiply"), "rgba(222,242,235,1)", "rgba(205,232,224,1)", 0.4);
      const g = L.get("normal");
      g.lineCap = "round";
      const N = 24;
      for (const s of rib) {
        const head = mod((t + s.p) * s.v, W + s.len * 2) - s.len * 0.2;
        const pts: [number, number, number][] = [];
        for (let k = 0; k <= N; k++) {
          const u = k / N;
          const x = head - (1 - u) * s.len;
          pts.push([x, s.y + Math.sin(x / 46 + t / 900) * s.amp, u]);
        }
        for (const [col, wAdd, aMul] of strokes) {
          g.strokeStyle = col;
          for (let k = 1; k < pts.length; k++) {
            const [x0, y0] = pts[k - 1]!;
            const [x1, y1, u] = pts[k]!;
            g.globalAlpha = s.a * aMul * u;
            g.lineWidth = 0.4 + u * s.w + wAdd;
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x1, y1);
            g.stroke();
          }
        }
        g.strokeStyle = "rgb(235,255,248)";
        g.lineWidth = 0.8;
        g.globalAlpha = s.a * 0.8;
        for (let k = Math.floor(N * 0.8) + 1; k < pts.length; k++) {
          const [x0, y0] = pts[k - 1]!;
          const [x1, y1] = pts[k]!;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
      }
      g.fillStyle = "rgb(40,170,135)";
      g.globalAlpha = 0.5;
      for (const q of specks) g.fillRect(mod(q.x + t * q.v, W + 20) - 18, q.y + Math.sin(t / 300 + q.p) * 3, 8, 1);
    },
  };
}

// ── 필드 ──
function electricFx(): FieldOnly {
  const bolts = P(7, 37, (r) => ({ p: r() * 900, len: 0.25 + r() * 0.25 }));
  const sparks = P(22, 41, (r) => ({ a: r() * Math.PI * 2, v: 0.00035 + r() * 0.0003, p: r() }));
  return {
    mix: 0.8,
    ring: "240,196,40",
    draw(g, t) {
      g.fillStyle = "rgba(255,222,80,0.22)";
      g.fillRect(0, 0, W, H);
      outerGlow(g, "250,200,40", 0.28);
      g.lineCap = "round";
      g.lineJoin = "round";
      bolts.forEach((b, i) => {
        const cyc = Math.floor((t + b.p) / 900);
        const ph = mod(t + b.p, 900);
        if (ph > 240) return;
        const r0 = rng(cyc * 977 + i * 13);
        const a = cornerAngle(r0);
        const jit = rng(cyc * 31 + Math.floor(t / 50) + i * 7);
        const fade = 1 - ph / 240;
        const pts: [number, number][] = [];
        for (let k = 0; k <= 7; k++) pts.push(ringAt(a + (k === 0 ? 0 : (jit() - 0.5) * 0.12), 0.9 + (k / 7) * b.len));
        const lines: [number, string][] = [[5, `rgba(255,214,60,${0.32 * fade})`], [1.6, `rgba(255,250,205,${0.95 * fade})`]];
        for (const [lw, col] of lines) {
          g.globalAlpha = 1;
          g.strokeStyle = col;
          g.lineWidth = lw;
          g.beginPath();
          pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        }
        const [ex, ey] = pts[pts.length - 1]!;
        dot(g, "255,236,120", ex, ey, 10, 0.6 * fade);
      });
      g.globalCompositeOperation = "lighter";
      for (const s of sparks) {
        const k = mod(t * s.v + s.p, 1);
        const [x, y] = ringAt(s.a, 0.9 + k * 0.5);
        dot(g, "255,220,80", x, y, 3.5, (1 - k) * 0.8);
      }
      g.globalCompositeOperation = "source-over";
    },
  };
}

function grassyFx(): FieldOnly {
  const leaves = P(30, 47, (r) => ({ x: r() * W, y: r() * H, v: 0.025 + r() * 0.025, s: 3 + r() * 3, spin: (r() - 0.5) * 0.008, p: r() * 9, c: r() < 0.5 ? "#5aa83a" : "#8ccd58" }));
  const motes = P(16, 53, (r) => ({ x: r() * W, y: r() * H, v: 0.008 + r() * 0.012, p: r() * 9 }));
  return {
    mix: 0.8,
    ring: "80,165,60",
    draw(g, t) {
      const pulse = tick5(t);
      g.fillStyle = "rgba(100,180,74,0.30)";
      g.fillRect(0, 0, W, H);
      outerGlow(g, "60,140,44", 0.3);
      for (const l of leaves) {
        const x = mod(l.x + t * l.v, W + 30) - 15;
        const y = mod(l.y + t * l.v * 0.25 + Math.sin(t / 650 + l.p) * 10, H + 20) - 10;
        const flip = Math.abs(Math.cos(t / 400 + l.p));
        g.save();
        g.translate(x, y);
        g.rotate(t * l.spin + l.p);
        g.scale(1, 0.35 + flip * 0.65);
        g.globalAlpha = 0.9;
        g.fillStyle = l.c;
        g.beginPath();
        g.ellipse(0, 0, l.s, l.s * 0.45, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "rgba(40,100,30,0.7)";
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(-l.s, 0);
        g.lineTo(l.s, 0);
        g.stroke();
        g.restore();
      }
      g.globalCompositeOperation = "lighter";
      for (const m of motes) dot(g, "210,255,150", m.x + Math.sin(t / 900 + m.p) * 6, mod(m.y - t * m.v * (1 + pulse * 3), H), 3, 0.35 + 0.3 * Math.sin(t / 500 + m.p) + pulse * 0.4);
      g.globalCompositeOperation = "source-over";
    },
  };
}

function psychicFx(): FieldOnly {
  const strokes: [number, number][] = [[16, 0.2], [2.2, 0.7]];
  return {
    mix: 0.8,
    ring: "205,95,215",
    draw(g, t) {
      g.fillStyle = "rgba(220,120,215,0.24)";
      g.fillRect(0, 0, W, H);
      outerGlow(g, "150,80,205", 0.3);
      for (let i = 0; i < 3; i++) {
        const k = mod(t / 2600 + i / 3, 1);
        const sc = 0.85 + k * 0.6;
        const a = Math.pow(1 - k, 1.4);
        const cr = Math.round(lerp(255, 170, k));
        const cg = Math.round(lerp(130, 100, k));
        const cb = Math.round(lerp(210, 235, k));
        for (const [lw, al] of strokes) {
          g.globalAlpha = 1;
          g.strokeStyle = `rgba(${cr},${cg + (lw < 3 ? 70 : 0)},${cb},${al * a})`;
          g.lineWidth = lw;
          g.beginPath();
          g.ellipse(W / 2, H / 2, RX * sc, RY * sc, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
    },
  };
}

function mistyFx(): FieldOnly {
  const blobs = P(10, 61, (r) => ({ a: cornerAngle(r), d: 1.02 + r() * 0.3, s: 34 + r() * 30, v: (r() - 0.5) * 0.00012, p: r() * 9 }));
  return {
    mix: 0.8,
    ring: "255,140,128",
    draw(g, t) {
      g.fillStyle = "rgba(255,176,166,0.20)";
      g.fillRect(0, 0, W, H);
      outerGlow(g, "255,150,140", 0.26);
      for (let i = 0; i < 3; i++) {
        const col = i % 2 ? "255,205,218" : "255,142,124";
        g.globalAlpha = 1;
        g.strokeStyle = `rgba(${col},0.24)`;
        g.lineWidth = 20 + i * 4;
        g.beginPath();
        for (let k = 0; k <= 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          const d = 0.98 + i * 0.12 + 0.03 * Math.sin(a * 5 + t / 700 + i * 2) + 0.02 * Math.sin(a * 3 - t / 1100 + i);
          const [x, y] = ringAt(a, d);
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
      for (const b of blobs) {
        const [x, y] = ringAt(b.a + t * b.v, b.d + 0.05 * Math.sin(t / 900 + b.p));
        blob(g, "255,190,200", x, y, b.s, b.s * 0.6, 0.22);
      }
    },
  };
}

// ── 오라 ──
// 가장자리 띠 근처 자리 — 위아래·좌우 가장자리에서 e 만큼 안쪽
const nearEdge = (r: () => number, depth: number): { x: number; y: number } => {
  const s = r();
  const e = r() * depth;
  return { x: s < 0.5 ? (r() < 0.5 ? e : W - e) : r() * W, y: s >= 0.5 ? (r() < 0.5 ? e : H - e) : r() * H };
};

function fairyFx(): WeatherFx {
  const st = P(30, 71, (r) => ({ ...nearEdge(r, 30), v: 0.006 + r() * 0.01, p: r() * 9 }));
  return {
    mix: 0.7,
    draw(L, t) {
      edge(L.get("multiply"), "255,165,215", 0.6 + 0.08 * Math.sin(t / 900), 0.42);
      edge(L.get("soft-light"), "255,90,180", 0.6, 0.5);
      const g = L.get("normal");
      for (const s of st) {
        const a = Math.max(0, Math.sin(t / 650 + s.p));
        if (a < 0.05) continue;
        const y = mod(s.y - t * s.v, H);
        dot(g, "255,120,200", s.x, y, 7 * a, 0.45 * a);
        const len = 7 * a;
        g.globalAlpha = 0.9 * a;
        g.fillStyle = "rgb(240,80,170)";
        g.fillRect(s.x - len, y - 0.6, len * 2, 1.2);
        g.fillRect(s.x - 0.6, y - len, 1.2, len * 2);
        g.fillStyle = "rgb(255,245,252)";
        g.fillRect(s.x - 1.2, y - 1.2, 2.4, 2.4);
      }
    },
  };
}

function darkFx(): WeatherFx {
  const smoke = P(26, 73, (r) => ({ ...nearEdge(r, 26), life: 3000 + r() * 2500, p: r() * 5000, s: 26 + r() * 30 }));
  const embers = P(10, 79, (r) => ({ x: r() < 0.5 ? r() * 40 : W - r() * 40, y: r() * H, v: 0.01 + r() * 0.015, p: r() * 9 }));
  return {
    mix: 0.4,
    draw(L, t) {
      edge(L.get("multiply"), "60,30,80", 0.75 + 0.08 * Math.sin(t / 1300), 0.42);
      edge(L.get("soft-light"), "40,10,60", 0.8, 0.5);
      const g = L.get("normal");
      for (const s of smoke) {
        const k = mod(t + s.p, s.life) / s.life;
        blob(g, "35,15,50", s.x + Math.sin(k * 6 + s.p) * 6, s.y - k * 26, s.s * (0.6 + k * 0.8), s.s * (0.45 + k * 0.6), Math.sin(k * Math.PI) * 0.3);
      }
      const add = L.get("plus-lighter");
      for (const e of embers) dot(add, "170,90,230", e.x + Math.sin(t / 700 + e.p) * 4, mod(e.y - t * e.v, H), 3, 0.25 + 0.3 * Math.sin(t / 400 + e.p));
    },
  };
}

function breakFx(): WeatherFx {
  return {
    mix: 0.4,
    draw(L, t) {
      const m = (Math.sin(t / 1400) + 1) / 2;
      edge(L.get("multiply"), "60,30,80", 0.5 * (1 - m), 0.45);
      edge(L.get("screen"), "255,150,215", 0.4 * m, 0.5);
      const k = mod(t, 2600) / 2600;
      if (k >= 0.55) return;
      // 가운데에서 퍼지는 반전 고리
      const u = k / 0.55;
      const r = 10 + u * 300;
      const w = 14 + u * 10;
      const a = Math.pow(1 - u, 1.4);
      const diff = L.get("difference");
      diff.save();
      diff.translate(W / 2, H / 2);
      diff.scale(1, (H / W) * 1.05);
      diff.fillStyle = `rgba(255,255,255,${0.28 * a})`;
      diff.beginPath();
      diff.arc(0, 0, r + w, 0, Math.PI * 2);
      diff.arc(0, 0, r, 0, Math.PI * 2, true);
      diff.fill();
      diff.restore();
      const add = L.get("plus-lighter");
      add.save();
      add.translate(W / 2, H / 2);
      add.scale(1, (H / W) * 1.05);
      add.globalAlpha = 1;
      add.strokeStyle = `rgba(255,240,255,${0.7 * a})`;
      add.lineWidth = 1.2;
      add.beginPath();
      add.arc(0, 0, r + w, 0, Math.PI * 2);
      add.stroke();
      add.restore();
    },
  };
}

const WEATHER: Record<string, () => WeatherFx> = {
  sun: sunFx,
  rain: () => rainFx(false),
  sand: sandFx,
  snow: snowFx,
  "harsh-sun": harshFx,
  "heavy-rain": () => rainFx(true),
  "strong-winds": windsFx,
};
const FIELD: Record<string, () => FieldOnly> = { electric: electricFx, grassy: grassyFx, psychic: psychicFx, misty: mistyFx };
const AURA: Record<string, () => WeatherFx> = { fairy: fairyFx, dark: darkFx, break: breakFx };

// under: 바닥 위·포켓몬 아래 층, over: 포켓몬 위·알약 아래 층. 걸린 효과가 하나도 없으면 null
export function createFieldFx(under: HTMLElement, over: HTMLElement, kinds: FieldFxKinds): FieldFx | null {
  const weather = kinds.weather ? WEATHER[kinds.weather]?.() : undefined;
  const field = kinds.field ? FIELD[kinds.field]?.() : undefined;
  const aura = kinds.aura ? AURA[kinds.aura]?.() : undefined;
  if (!weather && !field && !aura) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fieldLayers = new Layers(under, dpr);
  const weatherLayers = new Layers(over, dpr);
  const auraLayers = new Layers(over, dpr);
  const scratch = field ? canvasOf(Math.round(W * dpr), Math.round(H * dpr)) : null; // 필드는 따로 그린 뒤 가운데를 지워 얹는다
  const sg = scratch ? ctxOf(scratch) : null;

  function drawField(t: number): void {
    if (!field || !scratch || !sg) return;
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, scratch.width, scratch.height);
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.globalAlpha = 1;
    sg.globalCompositeOperation = "source-over";
    field.draw(sg, t);
    // 가운데 타원을 지운다 — 테두리 쪽 20% 는 부드럽게
    sg.save();
    sg.globalCompositeOperation = "destination-out";
    sg.globalAlpha = 1;
    sg.translate(W / 2, H / 2);
    sg.scale(1, RY / RX);
    const m = sg.createRadialGradient(0, 0, 0, 0, 0, RX);
    m.addColorStop(0, "rgba(0,0,0,1)");
    m.addColorStop(0.8, "rgba(0,0,0,1)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = m;
    sg.fillRect(-RX, -RX, RX * 2, RX * 2);
    sg.restore();
    const g = fieldLayers.get("normal");
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(scratch, 0, 0);
    g.restore();
    // 타원 테두리 — 테두리에서 가장 짙고 안팎으로 옅어지는 띠. 은은하게 숨 쉰다
    const peak = 0.1 + 0.04 * (0.5 + 0.5 * Math.sin(t / 1400));
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(1, RY / RX);
    const band = g.createRadialGradient(0, 0, RX * 0.82, 0, 0, RX * 1.14);
    band.addColorStop(0, `rgba(${field.ring},0)`);
    band.addColorStop(0.4, `rgba(${field.ring},${peak * 0.5})`);
    band.addColorStop(0.56, `rgba(${field.ring},${peak})`);
    band.addColorStop(0.75, `rgba(${field.ring},${peak * 0.45})`);
    band.addColorStop(1, `rgba(${field.ring},0)`);
    g.fillStyle = band;
    g.fillRect(-RX * 1.2, -RX * 1.2, RX * 2.4, RX * 2.4);
    g.restore();
  }

  return {
    draw(t) {
      const fade = Math.min(1, Math.max(0, t / FADE_MS));
      fieldLayers.begin();
      drawField(t);
      fieldLayers.end((field?.mix ?? 0) * fade);
      weatherLayers.begin();
      weather?.draw(weatherLayers, t);
      weatherLayers.end((weather?.mix ?? 0) * fade);
      auraLayers.begin();
      aura?.draw(auraLayers, t);
      auraLayers.end((aura?.mix ?? 0) * fade);
    },
  };
}
