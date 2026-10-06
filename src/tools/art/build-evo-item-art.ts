// 진화 도구 8종 도트 그림 — `node dist/tools/art/build-evo-item-art.js [도구 id …]` 로 assets/items/<도구 id>.png 를 만든다. id 를 주면 그 그림만
//
// PokeAPI·pokesprite 에 그림이 없는 진화 도구를 원작 9세대 아이콘(포켓몬 위키, 160×160)을 보고 30×30 도트로 옮긴다.
// 순서: 면적 평균 축소 → 도구별 색 수 줄이기(k-평균) → 외톨이 화소 정리 → 1px 외곽선.
// 원작 아이콘은 저장소에 넣지 않는다. .cache/evo-icons/ 에 받아 두고 변환한다. 위키는 스크립트 요청을 막아(403) curl 에 브라우저 User-Agent 를 준다.
// 2026-09-27 사용자 결정: 결과 그림은 저장소에 넣는다. 결정 경과: worklog/records/item-art/item-art.md
// (예전 scripts/build-evo-item-art.cjs. 타입 검사를 받게 src/tools 로 옮겼다)
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { execFileSync } from "node:child_process";

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, ".cache", "evo-icons");
const OUT = path.join(ROOT, "assets", "items");
// 원작 9세대 아이콘 주소 — 포켓몬 위키(ko). 도구 id → [주소, 색 수]
const ICONS: Record<string, [string, number]> = {
  "auspicious-armor": ["https://static.wikia.nocookie.net/pokemon/images/6/6e/%EC%95%84%EC%9D%B4%EC%BD%98_%EC%B6%95%EB%B3%B5%EB%B0%9B%EC%9D%80%EA%B0%91%EC%98%B7_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20221210194723&path-prefix=ko", 6],
  "malicious-armor": ["https://static.wikia.nocookie.net/pokemon/images/4/46/%EC%95%84%EC%9D%B4%EC%BD%98_%EC%A0%80%EC%A3%BC%EB%B0%9B%EC%9D%80%EA%B0%91%EC%98%B7_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20221210194509&path-prefix=ko", 6],
  "metal-alloy": ["https://static.wikia.nocookie.net/pokemon/images/2/29/%EC%95%84%EC%9D%B4%EC%BD%98_%EB%B3%B5%ED%95%A9%EA%B8%88%EC%86%8D_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20231223144212&path-prefix=ko", 6],
  "syrupy-apple": ["https://static.wikia.nocookie.net/pokemon/images/6/63/%EC%95%84%EC%9D%B4%EC%BD%98_%EA%BF%80%EB%A7%9B%EC%82%AC%EA%B3%BC_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20230919090119&path-prefix=ko", 6],
  "unremarkable-teacup": ["https://static.wikia.nocookie.net/pokemon/images/c/c0/%EC%95%84%EC%9D%B4%EC%BD%98_%EB%B2%94%EC%9E%91%EC%B0%BB%EC%9E%94_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20230919090601&path-prefix=ko", 6],
  "black-augurite": ["https://static.wikia.nocookie.net/pokemon/images/c/c3/%EC%95%84%EC%9D%B4%EC%BD%98_%EA%B2%80%EC%9D%80%ED%9C%98%EC%84%9D_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20221210190752&path-prefix=ko", 5],
  "peat-block": ["https://static.wikia.nocookie.net/pokemon/images/e/e9/%EC%95%84%EC%9D%B4%EC%BD%98_%ED%94%BC%ED%8A%B8%EB%B8%94%EB%A1%9D_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20221210195534&path-prefix=ko", 5],
  "scroll-of-darkness": ["https://static.wikia.nocookie.net/pokemon/images/e/ee/%EC%95%84%EC%9D%B4%EC%BD%98_%EC%95%85%EC%9D%98_%EC%A1%B1%EC%9E%90_9%EC%84%B8%EB%8C%80.png/revision/latest?cb=20221210193928&path-prefix=ko", 6],
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

function decodeRGBA(file: string) {
  const b = fs.readFileSync(file); let o = 8, w!: number, h!: number, bit!: number, ct!: number, idat: Buffer[] = [], plte: Buffer | null = null, trns: Buffer | null = null;
  while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bit = d[8]!; ct = d[9]!; } else if (t === "IDAT") idat.push(d); else if (t === "PLTE") plte = d; else if (t === "tRNS") trns = d; o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 3 ? 1 : ct === 4 ? 2 : 1; const bpp = Math.max(1, (ch * bit) / 8); const stride = Math.ceil((w * ch * bit) / 8);
  const px: Rgba[] = new Array(w * h); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? line[i - bpp]! : 0, up = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
      line[i] = (line[i]! + (f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? (() => { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? up : c; })() : 0)) & 255; }
    for (let x = 0; x < w; x++) {
      if (ct === 6) px[y * w + x] = [line[x * 4]!, line[x * 4 + 1]!, line[x * 4 + 2]!, line[x * 4 + 3]!];
      else if (ct === 2) px[y * w + x] = [line[x * 3]!, line[x * 3 + 1]!, line[x * 3 + 2]!, 255];
      else if (ct === 3) { const idx = line[x]!; px[y * w + x] = [plte![idx * 3]!, plte![idx * 3 + 1]!, plte![idx * 3 + 2]!, trns && idx < trns.length ? trns[idx]! : 255]; }
      else if (ct === 4) px[y * w + x] = [line[x * 2]!, line[x * 2]!, line[x * 2]!, line[x * 2 + 1]!];
      else px[y * w + x] = [line[x]!, line[x]!, line[x]!, 255];
    }
    prev = line; }
  return { w, h, px };
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
function png(img: (Rgb | null)[], w: number, h: number) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = img[y * w + x]; const o = y * (w * 4 + 1) + 1 + x * 4; if (p) { raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }

const N = 30, INNER = 28, INK: Rgb = [0x31, 0x31, 0x31];
function kmeans(pts: Rgb[], k: number) {
  // 밝기 순 초기값 — 결과가 매번 같게
  const sorted = [...pts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let c = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!.slice(0, 3) as Rgb);
  for (let it = 0; it < 20; it++) {
    const sum = c.map((): [number, number, number, number] => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = 1e9; c.forEach((q, i) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); const s = sum[bi]!; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    c = c.map((q, i) => (sum[i]![3] ? [sum[i]![0] / sum[i]![3], sum[i]![1] / sum[i]![3], sum[i]![2] / sum[i]![3]] : q));
  }
  return c.map((q) => q.map(Math.round) as Rgb);
}
function toDot(file: string, k: number) {
  const { w, h, px } = decodeRGBA(file);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  px.forEach((p, i) => { if (p[3] > 24) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1), cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const sx = cx - side / 2, sy = cy - side / 2, cell = side / INNER;
  const small: (Rgb | null)[] = new Array(N * N).fill(null);
  for (let Y = 0; Y < INNER; Y++) for (let X = 0; X < INNER; X++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = Math.floor(sy + Y * cell); yy < Math.ceil(sy + (Y + 1) * cell); yy++) for (let xx = Math.floor(sx + X * cell); xx < Math.ceil(sx + (X + 1) * cell); xx++) {
      n++; const p: Rgba = xx >= 0 && yy >= 0 && xx < w && yy < h ? px[yy * w + xx]! : [0, 0, 0, 0]; const al = p[3] / 255; r += p[0] * al; g += p[1] * al; b += p[2] * al; a += al; }
    if (a / n < 0.5) continue;
    small[(Y + 1) * N + (X + 1)] = [r / a, g / a, b / a];
  }
  const pts = small.filter(Boolean) as Rgb[];
  const pal = kmeans(pts, k);
  const near = (p: Rgb) => pal.reduce((best, q) => ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < (p[0] - best[0]) ** 2 + (p[1] - best[1]) ** 2 + (p[2] - best[2]) ** 2 ? q : best), pal[0]!);
  let img = small.map((p) => (p ? near(p) : null));
  // 잡티 정리 — 이웃 8칸 중 같은 색이 1칸 이하인 칸은 가장 많은 이웃 색으로 (두 번)
  for (let pass = 0; pass < 2; pass++) { const next = img.slice(); for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { const p = img[y * N + x]; if (!p) continue; const nb: Rgb[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const q = img[(y + dy) * N + x + dx]; if (q) nb.push(q); } if (nb.filter((q) => q === p).length <= 1 && nb.length >= 5) { const cnt = new Map<Rgb, number>(); for (const q of nb) cnt.set(q, (cnt.get(q) || 0) + 1); next[y * N + x] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]![0]; } } img = next; }
  // 외곽선 — 모양 가장자리 칸을 먹색으로 (원작 아이콘의 굵은 테를 1px 로)
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? img[y * N + x] : null);
  const edge: number[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(x, y) && ([[1, 0], [-1, 0], [0, 1], [0, -1]] satisfies [number, number][]).some(([dx, dy]) => !at(x + dx, y + dy))) edge.push(y * N + x);
  for (const i of edge) img[i] = INK;
  return img;
}

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
const todo = Object.entries(ICONS).filter(([id]) => want.length === 0 || want.includes(id));
for (const [id, [url, k]] of todo) {
  const src = path.join(SRC, id + ".png");
  // 원본 PNG — 위키는 기본으로 WebP 를 주므로 format=original 을 붙인다
  if (!fs.existsSync(src)) execFileSync("curl", ["-sL", "-A", UA, "-H", "Accept: image/png", "-o", src, url + "&format=original"]);
  if (fs.readFileSync(src).subarray(1, 4).toString() !== "PNG") throw new Error(`PNG 가 아니다: ${src} — 위키가 요청을 막았을 수 있다`);
  fs.writeFileSync(path.join(OUT, id + ".png"), png(toDot(src, k), N, N));
}
process.stdout.write(`그림 ${todo.length}개 → ${path.relative(process.cwd(), OUT)}\n`);
