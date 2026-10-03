// PNG 해석·저장 — 대체 그림 두 모듈(portrait-art.ts · overworld-art.ts)이 함께 쓴다.
// node:zlib 만 쓴다 — 메인 밖(selftest)에서도 돈다. 비월(interlace)·16비트 PNG 는 받지 않는다(null)
import zlib from "node:zlib";

export interface Rgba {
  w: number;
  h: number;
  px: Buffer; // 한 점에 RGBA 4바이트, 줄 순서
  idx: Buffer | null; // 팔레트 PNG 만 — 한 점에 팔레트 번호 1바이트. 팔레트만 바꿔 다시 칠할 때 쓴다 (overworld-art.ts 이로치)
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
  const idx = type === 3 ? Buffer.alloc(w * h) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) {
        const i = sample(y, x);
        idx![y * w + x] = i;
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
  return { w, h, px, idx };
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

// PNG 조각 하나 — 길이 · 이름 · 내용 · CRC
export function pngChunk(name: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export const PNG_SIGNATURE = SIGNATURE;

// RGBA → PNG (8비트 RGBA, 필터 없음)
export function encodePng(img: Pick<Rgba, "w" | "h" | "px">): Buffer {
  const stride = img.w * 4;
  const raw = Buffer.alloc(img.h * (stride + 1));
  for (let y = 0; y < img.h; y++) img.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// 앞 4바이트가 PNG 서명인가 — 받은 그림을 캐시에 둘지 가르는 가벼운 검사(전체를 풀지 않는다)
export const isPng = (buf: Buffer): boolean => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

// IHDR 머리말 — 너비·높이·색 형식(3 이면 팔레트). 33바이트보다 짧거나 "PNG" 글자가 없으면 null
export function pngHeaderOf(buf: Buffer): { w: number; h: number; colorType: number } | null {
  if (buf.length < 33 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] ?? -1 };
}

// 불투명한 점을 모두 덮는 사각형. 다 투명하면 null — 판정은 부르는 쪽이 준다(알파 0 아님 · 팔레트 번호 0 아님)
export function opaqueRectOf(w: number, h: number, isOpaque: (x: number, y: number) => boolean): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isOpaque(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
