// 초상 대체 그림 — PMD 그림이 없는 종(2026-10-01 기준 35종: 탄동·모으령 등)을 무대에 세운다.
//
// PokeAPI 초상(96 × 96 PNG, src/main/portraits.ts)을 절반으로 줄이고 투명 여백 없이 잘라 PMD 모양의 시트 하나로 만든다.
//   절반  초상은 PMD 보다 크게 그려져 있다 — 같은 크기 설정에서 혼자 커 보였다 (2026-10-01 사용자 "2여도 너무 크다").
//         두 그림이 다 있는 42종을 재니 불투명 높이가 초상/PMD 중앙값 2.22배(사분위 1.95~2.35)라 2 로 나눈다
//   열 2개  0 = 제자리, 1 = 1도트 위 — 번갈아 그려 숨 쉬듯 들썩인다
//   행 8개  PMD 방향 행(0 정면 2 오른쪽 4 뒤 6 왼쪽). 초상은 왼쪽을 보므로 오른쪽 행(1~3)만 좌우로 뒤집는다
// 동작은 Idle·Walk 두 개다. 같은 시트를 쓰고 프레임 길이만 다르다. 없는 동작은 움직임 모듈이 알아서 빼고 고른다
// PNG 해석·저장은 node:zlib 만 쓴다 — 메인 밖(selftest)에서도 돈다. 비월(interlace)·16비트 PNG 는 받지 않는다(null)
import zlib from "node:zlib";
import type { PmdArt } from "./art";
import type { SpriteSheet } from "../shared/stage";

const SHRINK = 2; // 초상 → PMD 크기
const BOB = 1; // 들썩이는 높이 (도트)
const IDLE_MS = [600, 400]; // 제자리 → 위
const WALK_MS = [150, 150];
const FLIP_ROWS = new Set([1, 2, 3]); // 오른쪽을 보는 행
const ROWS = 8;

export interface Rgba {
  w: number;
  h: number;
  px: Buffer; // 한 점에 RGBA 4바이트, 줄 순서
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// PNG → RGBA. 못 읽으면 null
export function decodePng(buf: Buffer): Rgba | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  let w = 0, h = 0, depth = 0, type = -1, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(at);
    const name = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (name === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8] ?? 0;
      type = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (name === "PLTE") palette = data;
    else if (name === "tRNS") trns = data;
    else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    at += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!ch || w < 1 || h < 1 || depth > 8 || interlace !== 0 || (type === 3 && !palette)) return null;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const bpp = Math.max(1, (ch * depth) >> 3); // 필터가 왼쪽 이웃으로 보는 바이트 수
  const stride = Math.ceil((w * ch * depth) / 8);
  if (raw.length < h * (stride + 1)) return null;

  // 필터 풀기 — 줄마다 첫 바이트가 필터 종류다
  const rows = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? rows[out + i - bpp]! : 0;
      const b = y > 0 ? rows[out - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? rows[out - stride + i - bpp]! : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else if (filter !== 0) return null;
      rows[out + i] = v & 0xff;
    }
  }

  // 한 줄의 n 번째 표본 — 8비트 미만은 한 바이트에 여러 표본이 들어 있다
  const max = (1 << depth) - 1;
  const sample = (y: number, n: number): number => {
    if (depth === 8) return rows[y * stride + n]!;
    const bit = n * depth;
    return (rows[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max;
  };
  const scale = (v: number): number => (depth === 8 ? v : Math.round((v * 255) / max));

  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) {
        const i = sample(y, x);
        px[o] = palette![i * 3] ?? 0;
        px[o + 1] = palette![i * 3 + 1] ?? 0;
        px[o + 2] = palette![i * 3 + 2] ?? 0;
        px[o + 3] = trns && i < trns.length ? trns[i]! : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(y, x * ch);
        px[o] = px[o + 1] = px[o + 2] = scale(g);
        px[o + 3] = type === 4 ? sample(y, x * ch + 1) : trns && trns.length >= 2 && g === trns.readUInt16BE(0) ? 0 : 255;
      } else {
        const r = sample(y, x * ch), g = sample(y, x * ch + 1), b = sample(y, x * ch + 2);
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        const key = trns && trns.length >= 6 && r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && b === trns.readUInt16BE(4);
        px[o + 3] = type === 6 ? sample(y, x * ch + 3) : key ? 0 : 255;
      }
    }
  }
  return { w, h, px };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// RGBA → PNG (8비트 RGBA, 필터 없음)
export function encodePng(img: Rgba): Buffer {
  const stride = img.w * 4;
  const raw = Buffer.alloc(img.h * (stride + 1));
  for (let y = 0; y < img.h; y++) img.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

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
  return { w, h, px };
}

// 초상 PNG → 무대가 쓰는 그림 묶음. 못 읽거나 빈 그림이면 null
export function portraitArt(png: Buffer, dex: string): PmdArt | null {
  const full = decodePng(png);
  const img = full && shrink(full, SHRINK);
  const box = img && opaqueBox(img);
  if (!img || !box) return null;
  const fw = box.w;
  const fh = box.h + BOB;
  const sheet: Rgba = { w: fw * 2, h: fh * ROWS, px: Buffer.alloc(fw * 2 * fh * ROWS * 4) };
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
