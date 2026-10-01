// 초상 대체 그림 — PMD 그림이 없는 종(2026-10-01 기준 35종: 탄동·모으령 등)을 무대에 세운다.
//
// PokeAPI 초상(96 × 96 PNG, src/main/portraits.ts)을 절반으로 줄이고 투명 여백 없이 잘라 PMD 모양의 시트 하나로 만든다.
//   절반  초상은 PMD 보다 크게 그려져 있다 — 같은 크기 설정에서 혼자 커 보였다 (2026-10-01 사용자 "2여도 너무 크다").
//         두 그림이 다 있는 42종을 재니 불투명 높이가 초상/PMD 중앙값 2.22배(사분위 1.95~2.35)라 2 로 나눈다
//   열 2개  0 = 제자리, 1 = 1도트 위 — 번갈아 그려 숨 쉬듯 들썩인다
//   행 8개  PMD 방향 행(0 정면 2 오른쪽 4 뒤 6 왼쪽). 초상은 왼쪽을 보므로 오른쪽 행(1~3)만 좌우로 뒤집는다
// 동작은 Idle·Walk 두 개다. 같은 시트를 쓰고 프레임 길이만 다르다. 없는 동작은 움직임 모듈이 알아서 빼고 고른다
// PNG 해석·저장은 src/main/png.ts — 메인 밖(selftest)에서도 돈다. expansion 걷기 그림(overworld-art.ts)이 먼저고 이 그림은 그것도 못 받았을 때 쓴다
import type { PmdArt } from "./art";
import type { SpriteSheet } from "../shared/stage";
import { decodePng, encodePng, type Rgba } from "./png";

const SHRINK = 2; // 초상 → PMD 크기
const BOB = 1; // 들썩이는 높이 (도트)
const IDLE_MS = [600, 400]; // 제자리 → 위
const WALK_MS = [150, 150];
const FLIP_ROWS = new Set([1, 2, 3]); // 오른쪽을 보는 행
const ROWS = 8;

// 불투명한 점을 모두 덮는 사각형. 다 투명하면 null
function opaqueBox(img: Rgba): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.px[(y * img.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 도트 그림을 n 분의 1 로 — n × n 칸마다 절반 이상 불투명하면 그 칸에서 가장 많은 색, 아니면 투명
function shrink(img: Rgba, n: number): Rgba {
  const w = Math.ceil(img.w / n);
  const h = Math.ceil(img.h / n);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const count = new Map<number, number>();
      let solid = 0;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const sx = x * n + dx, sy = y * n + dy;
          if (sx >= img.w || sy >= img.h) continue;
          const o = (sy * img.w + sx) * 4;
          if (img.px[o + 3] === 0) continue;
          solid++;
          const key = img.px.readUInt32BE(o);
          count.set(key, (count.get(key) ?? 0) + 1);
        }
      }
      if (solid * 2 < n * n) continue;
      let best = 0, most = 0;
      for (const [key, c] of count) if (c > most) [best, most] = [key, c];
      px.writeUInt32BE(best, (y * w + x) * 4);
    }
  }
  return { w, h, px, idx: null };
}

// 초상 PNG → 무대가 쓰는 그림 묶음. 못 읽거나 빈 그림이면 null
export function portraitArt(png: Buffer, dex: string): PmdArt | null {
  const full = decodePng(png);
  const img = full && shrink(full, SHRINK);
  const box = img && opaqueBox(img);
  if (!img || !box) return null;
  const fw = box.w;
  const fh = box.h + BOB;
  const sheet: Rgba = { w: fw * 2, h: fh * ROWS, px: Buffer.alloc(fw * 2 * fh * ROWS * 4), idx: null };
  for (let row = 0; row < ROWS; row++) {
    const flip = FLIP_ROWS.has(row);
    for (let col = 0; col < 2; col++) {
      const top = row * fh + (col === 0 ? BOB : 0);
      for (let y = 0; y < box.h; y++) {
        for (let x = 0; x < box.w; x++) {
          const from = ((box.y + y) * img.w + box.x + (flip ? box.w - 1 - x : x)) * 4;
          const to = ((top + y) * sheet.w + col * fw + x) * 4;
          img.px.copy(sheet.px, to, from, from + 4);
        }
      }
    }
  }
  const dataUrl = `data:image/png;base64,${encodePng(sheet).toString("base64")}`;
  const anim = (ms: number[]): SpriteSheet => ({ fw, fh, rows: ROWS, frames: ms.map((d, x) => ({ x, ms: d })), dataUrl });
  const size = { w: fw, h: fh };
  return {
    kind: "portrait",
    cell: size,
    body: size,
    work: {},
    workOnly: [],
    zoom: 2,
    anims: { Idle: anim(IDLE_MS), Walk: anim(WALK_MS) },
    // art/pmd.js STATE_ANIMS 와 같은 상태 이름. 걷기만 오른쪽 행이고 나머지는 정면에서 숨 쉰다
    clips: {
      idle: { anim: "Idle", mode: "loop", row: 0 },
      running: { anim: "Walk", mode: "loop", row: 2 },
      waiting: { anim: "Idle", mode: "loop", row: 0 },
      waving: { anim: "Idle", mode: "loop", row: 0 },
      failed: { anim: "Idle", mode: "loop", row: 0 },
      review: { anim: "Idle", mode: "loop", row: 0 },
    },
    credits: [],
    dex,
    from: "portrait",
  };
}
