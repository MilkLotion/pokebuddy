// 가상 도구 도트 그림 — `node scripts/build-item-art.cjs` 로 assets/items/<도구 id>.png 를 만든다. 무대 말풍선 아이콘(고기·금화)도 여기서 그린다
//
// 원작에 그림이 없는 이 게임만의 도구를 원작 도구 아이콘 규칙으로 그린다(30×30, 1px 외곽선, 4~5단계 명암, 왼쪽 위 빛, 흰 반짝임).
// 우리가 새로 그린 그림이라 저장소와 설치본에 넣는다. 원작 그림(PokeAPI·pokesprite)은 넣지 않고 실행 때 받는다.
// 기법: 그늘 쪽(아래·오른쪽) 외곽선은 재질의 짙은 색, 그늘 쪽 가장자리 안쪽은 한 단계 밝은 반사광.
// 시안과 결정 경과: worklog/records/item-art/record.md, Figma `99 · 시안 (테스트)` 의 가상 도구 도트 시안.
// 새 패키지 없이 Node 기본 모듈로 PNG 를 쓴다.
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
const OUT = path.join(__dirname, "..", "assets", "items");
const W = 30, H = 30;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const INK = hex("#313131");

// ── PNG ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(img, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = img[y * w + x]; const o = y * (w * 4 + 1) + 1 + x * 4; if (p) { raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ── 캔버스 — 칸마다 { c: 색, m: 재질 이름 } ──
const blank = () => new Array(W * H).fill(null);
const at = (img, x, y) => (x >= 0 && y >= 0 && x < W && y < H ? img[y * W + x] : null);
const put = (img, x, y, c, m) => { if (x >= 0 && y >= 0 && x < W && y < H) img[y * W + x] = c ? { c, m } : null; };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const edge = (img, x, y) => at(img, x, y) && N4.some(([dx, dy]) => !at(img, x + dx, y + dy));
// 부분 외곽선 — 물체 중심에서 아래·오른쪽(그늘)에 있는 외곽선은 재질의 짙은 색, 위·왼쪽은 먹색
function outline(img, mats, cx, cy) {
  const add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(img, x, y)) continue;
    const nb = N4.map(([dx, dy]) => at(img, x + dx, y + dy)).find(Boolean);
    if (!nb) continue;
    const shade = (x - cx) * 0.55 + (y - cy) * 0.85 > 4.5;
    const m = mats[nb.m];
    add.push([x, y, shade && m && m.line ? m.line : INK]);
  }
  for (const [x, y, c] of add) put(img, x, y, c, "ink");
}
// 반사광 — 그늘 쪽 가장자리 칸을 한 단계 밝게
function rimLight(img, mats, cx, cy) {
  const change = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = at(img, x, y); if (!p || !edge(img, x, y)) continue;
    const m = mats[p.m]; if (!m || !m.rim) continue;
    if ((x - cx) * 0.4 + (y - cy) > 5) change.push([x, y, m.rim]);
  }
  for (const [x, y, c] of change) put(img, x, y, c, at(img, x, y).m);
}
const save = (name, img) => { fs.writeFileSync(path.join(OUT, name + ".png"), png(img.map((p) => (p ? p.c : null)), W, H)); return img; };


// ── 모습이 바뀌는 약 — 분무 머리 + 불룩한 병, 분홍·금빛 약, 반짝임 ──
function shinyPotion(name = "shiny-potion", glass = ["#fff4fb", "#ffd8ee", "#f4a8d4", "#d272ac", "#a04a86"], glassLine = "#6a2458", sparkle = true) {
  const img = blank();
  const M = {
    glass: { c: glass.map(hex), line: hex(glassLine), rim: hex(glass[2]) },
    cap: { c: ["#ffffff", "#dfe8ec", "#b2c2ca", "#86969e"].map(hex), line: hex("#4a5660"), rim: null },
  };
  // 병 몸통 — 아래가 넓은 눈물 모양
  const cx = 15.5, cy = 20;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5, py = y + 0.5;
    const ry = 8, rxb = 8.6, rxt = 5.4;
    const rx = py < cy ? rxt + (rxb - rxt) * ((py - (cy - ry)) / ry) : rxb;
    const nx = (px - cx) / rx, ny = (py - cy) / ry;
    if (nx * nx + ny * ny > 1 || py < 12) continue;
    const t = (py - 12) / 16 + Math.max(0, nx) * 0.35 - Math.max(0, -nx) * 0.1;
    put(img, x, y, M.glass.c[t < 0.15 ? 0 : t < 0.4 ? 1 : t < 0.68 ? 2 : t < 0.9 ? 3 : 4], "glass");
  }
  // 목
  for (let y = 10; y < 13; y++) for (let x = 13; x < 19; x++) put(img, x, y, M.glass.c[x < 15 ? 1 : x < 17 ? 2 : 3], "glass");
  // 분무 머리 — 둥근 뚜껑과 왼쪽으로 난 노즐
  for (let y = 4; y < 10; y++) for (let x = 12; x < 20; x++) {
    const inCap = !((y === 4 && (x === 12 || x === 19)));
    if (!inCap) continue;
    put(img, x, y, M.cap.c[y < 6 && x < 16 ? 0 : x < 15 ? 1 : x < 18 ? 2 : 3], "cap");
  }
  for (let x = 8; x < 12; x++) { put(img, x, 6, M.cap.c[1], "cap"); put(img, x, 7, M.cap.c[2], "cap"); }
  // 병 목 테두리 띠
  for (let x = 12; x < 20; x++) put(img, x, 10, M.cap.c[x < 15 ? 1 : 3], "cap");
  // 약 속 금빛 반짝임
  const G = hex("#fff6a8"), G2 = hex("#f4c440");
  if (sparkle) for (const [x, y, c] of [[13, 19, G], [12, 20, G2], [14, 20, G2], [13, 21, G2], [18, 23, G], [17, 23, G2], [19, 23, G2], [18, 22, G2], [18, 24, G2], [19, 16, G], [11, 24, G2], [16, 26, G], [21, 19, G2], [15, 16, G2]]) if (at(img, x, y)) put(img, x, y, c, "glass");
  // 유리 광
  for (const [x, y] of [[10, 17], [10, 18], [11, 16], [11, 19]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "glass");
  rimLight(img, M, cx, cy);
  outline(img, M, cx, cy - 2);
  if (!sparkle) return save(name, img);
  // 바깥 별 — 네 갈래 반짝임
  const Y = hex("#ffe070"), Y2 = hex("#f4b830"), Wt = hex("#ffffff");
  // 큰 별 — 오른쪽 위, 네 갈래 + 가운데 흰 점
  for (const [x, y, c] of [[25, 3, Y2], [25, 4, Y], [25, 5, Y], [22, 6, Y2], [23, 6, Y], [24, 6, Y], [25, 6, Wt], [26, 6, Y], [27, 6, Y], [28, 6, Y2], [24, 5, Y], [26, 5, Y], [24, 7, Y], [26, 7, Y], [25, 7, Y], [25, 8, Y], [25, 9, Y2]]) put(img, x, y, c, "star");
  // 작은 별 — 왼쪽 아래, 오른쪽 아래
  for (const [x, y, c] of [[4, 21, Y], [3, 22, Y], [4, 22, Wt], [5, 22, Y], [4, 23, Y], [26, 22, Y], [25, 23, Y], [26, 23, Wt], [27, 23, Y], [26, 24, Y]]) put(img, x, y, c, "star");
  // 반짝 점 — 병 둘레
  for (const [x, y] of [[21, 11], [6, 14], [23, 27]]) put(img, x, y, Wt, "star");
  return save(name, img);
}

// ── 새 가상 도구 — 같은 기법(부분 외곽선·반사광·왼쪽 위 빛) ──
// 둥근 덩어리 명암 — (nx, ny) 는 -1..1, 톤 배열은 밝음→어둠
function lumpTone(nx, ny, tones) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const i = -0.5 * nx - 0.62 * ny + 0.6 * nz;
  const k = i > 0.75 ? 0 : i > 0.45 ? 1 : i > 0.12 ? 2 : i > -0.2 ? 3 : 4;
  return tones[Math.min(k, tones.length - 1)];
}

// 태고의돌 — 울퉁불퉁한 회갈색 돌, 앞면에 나선 화석 자국
function ancientStone() {
  const img = blank();
  const T = ["#e8ddc8", "#c9b89a", "#a8957a", "#7f6e58", "#5e5040"].map(hex);
  const cx = 15, cy = 16.5;
  // 돌 윤곽 — 각도마다 반지름을 조금씩 흔든 둥근 덩어리
  const R = (a) => 11 + 0.9 * Math.sin(3 * a + 0.7) + 0.6 * Math.sin(5 * a + 2.1) - 0.8 * Math.max(0, Math.sin(a)) * 0.8;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 1.12, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
    const rr = R(a); if (r > rr) continue;
    put(img, x, y, lumpTone(dx / rr, dy / rr, T), "stone");
  }
  // 나선 화석 — 가운데에서 도는 밝은 선과 짙은 홈
  const L = hex("#f4ead4"), D = hex("#6e5e48");
  for (let t = 0.4; t < 15; t += 0.05) {
    const r = 0.55 * t, a = t * 0.95;
    const x = Math.round(cx - 0.5 + r * Math.cos(a)), y = Math.round(cy - 0.5 + r * Math.sin(a) * 0.9);
    if (!at(img, x, y) || r > 6.8) continue;
    put(img, x, y, D, "stone");
    const lx = x - 1, ly = y - (Math.sin(a) > 0 ? 0 : 1);
    if (at(img, lx, ly) && at(img, lx, ly).c !== D) put(img, lx, ly, L, "stone");
  }
  // 작은 금·반짝임 — 오래된 돌 느낌
  for (const [x, y] of [[8, 11], [9, 10]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "stone");
  const mats = { stone: { line: hex("#4a3c2c"), rim: T[2] } };
  rimLight(img, mats, cx, cy);
  outline(img, mats, cx, cy);
  return save("ancient-stone", img);
}

// 기본먹이 — 낮은 밥그릇에 갈색 알갱이
function basicFood() {
  const img = blank();
  const BOWL = ["#ffe0d4", "#f8a890", "#e0705c", "#b84838", "#8a2c24"].map(hex);
  const K = ["#e8b878", "#c8884c", "#9c6030", "#6e3c1c"].map(hex);
  const cx = 15;
  // 알갱이 더미 — 그릇 위로 봉긋
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / 9.2, dy = (y + 0.5 - 16.5) / 5.4;
    if (dx * dx + dy * dy > 1 || y > 17) continue;
    put(img, x, y, lumpTone(dx, dy, K), "kibble");
  }
  // 알갱이 결 — 둥근 낱알 경계
  for (const [x, y] of [[10, 14], [13, 12], [16, 13], [19, 14], [12, 16], [15, 15], [18, 16], [21, 16], [9, 16], [14, 17], [17, 17]]) if (at(img, x, y)) put(img, x, y, K[3], "kibble");
  for (const [x, y] of [[11, 13], [14, 11], [17, 12], [10, 15], [13, 15], [16, 15]]) if (at(img, x, y)) put(img, x, y, K[0], "kibble");
  // 그릇 — 윗테(타원) + 몸통(아래로 좁아짐)
  for (let y = 17; y < 27; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5 - cx, t = (y - 17) / 9;
    const half = 12.2 - t * 3.6;
    if (Math.abs(px) > half) continue;
    const side = px / half;
    const k = y < 19 ? (side < -0.5 ? 1 : 0) : side < -0.55 ? 1 : side < 0.25 ? 2 : side < 0.7 ? 3 : 4;
    put(img, x, y, BOWL[y === 26 ? 4 : k], "bowl");
  }
  // 그릇 광
  for (const [x, y] of [[6, 20], [6, 21], [7, 22]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "bowl");
  const mats = { bowl: { line: hex("#5c1c18"), rim: BOWL[3] }, kibble: { line: hex("#4a2810"), rim: null } };
  rimLight(img, mats, cx, 20);
  outline(img, mats, cx, 19);
  return save("basic-food", img);
}

// 프리미엄먹이 — 금색 뚜껑의 통조림, 붉은 띠 라벨과 별
function premiumFood() {
  const img = blank();
  const CAN = ["#ffffff", "#e8ecf2", "#c4ccd8", "#98a2b4", "#6c7688"].map(hex);
  const LAB = ["#ff9a88", "#e84c3c", "#b82c24", "#861c18"].map(hex);
  const GOLD = ["#fff6c0", "#f8d860", "#e0a828", "#a87010"].map(hex);
  const cx = 15, top = 8, bot = 26, half = 9.5;
  for (let y = top; y <= bot; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5 - cx; if (Math.abs(px) > half) continue;
    const side = px / half;
    const k = side < -0.6 ? 1 : side < 0.1 ? 0 : side < 0.55 ? 2 : side < 0.85 ? 3 : 4;
    const lab = y >= 13 && y <= 21;
    put(img, x, y, lab ? LAB[Math.min(3, Math.max(0, k - 0))] : CAN[k], lab ? "label" : "can");
  }
  // 아래 둥근 끝
  for (let x = 0; x < W; x++) { const px = x + 0.5 - cx; if (Math.abs(px) <= half - 1.5) put(img, x, bot + 1, CAN[3], "can"); }
  // 뚜껑 — 금색 타원
  for (let y = 4; y < 12; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / (half + 0.3), dy = (y + 0.5 - 8) / 3.4;
    if (dx * dx + dy * dy > 1) continue;
    const ring = dx * dx + dy * dy > 0.55;
    put(img, x, y, ring ? (dy > 0.2 ? GOLD[2] : GOLD[1]) : (dx < -0.2 && dy < 0 ? GOLD[0] : GOLD[1]), "lid");
  }
  // 따개 고리
  for (const [x, y] of [[15, 6], [16, 6], [17, 6], [17, 7], [15, 7]]) put(img, x, y, GOLD[3], "lid");
  // 라벨 별
  const S = hex("#fff2a0");
  for (const [x, y] of [[15, 15], [14, 16], [15, 16], [16, 16], [13, 17], [17, 17], [15, 17], [14, 18], [16, 18], [15, 19]]) put(img, x, y, S, "label");
  // 캔 광
  for (let y = 10; y < 25; y++) if (y < 13 || y > 21) put(img, 8, y, hex("#ffffff"), "can");
  const mats = { can: { line: hex("#3e4656"), rim: CAN[3] }, label: { line: hex("#5c1410"), rim: LAB[2] }, lid: { line: hex("#6e4410"), rim: null } };
  outline(img, mats, cx, 14);
  return save("premium-food", img);
}

// 장난감 — 노란 고무공에 파란 줄 둘, 방울 달린 매듭
function toy() {
  const img = blank();
  const Y = ["#fffbd8", "#fff080", "#f8d030", "#d8a018", "#a8700c"].map(hex);
  const B = ["#a8d8ff", "#5aa0f0", "#3070d0", "#1c4aa0", "#10307a"].map(hex);
  const cx = 15, cy = 16, r = 10.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
    if (nx * nx + ny * ny > 1) continue;
    // 휘어진 줄 — 공을 가로지르는 두 띠
    const band = Math.abs(ny - 0.35 * nx * nx + 0.1) < 0.14 || Math.abs(nx + 0.3 * ny * ny - 0.05) < 0.13;
    const pal = band ? B : Y;
    put(img, x, y, lumpTone(nx, ny, pal), band ? "band" : "ball");
  }
  // 광
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [9, 12]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "ball");
  const mats = { ball: { line: hex("#6e4a08"), rim: Y[2] }, band: { line: hex("#0c2460"), rim: B[2] } };
  rimLight(img, mats, cx, cy);
  outline(img, mats, cx, cy);
  return save("toy", img);
}

// 연결의끈 — 감긴 검은 케이블, 양 끝에 단자 (원작 레전드 아르세우스 연결의끈 소재, 그림은 새로 그림)
function bondCord() {
  const img = blank();
  const C = ["#9c9ca8", "#6c6c78", "#4a4a54", "#303038", "#202026"].map(hex); // 케이블 밝음→어둠
  const PLUG = ["#8c8c98", "#5c5c68", "#3c3c46"].map(hex);
  const PIN = ["#fff4c0", "#e8c050", "#a87c20"].map(hex); // 금속 단자
  // 둥근 관 한 칸 — 관 중심선에서의 거리(d, -1..1)로 명암
  const tube = (x, y, d, ax, ay) => { const l = -0.55 * ax - 0.65 * ay - d * 0.45; put(img, x, y, C[l > 0.45 ? 0 : l > 0.05 ? 1 : l > -0.35 ? 2 : 3], "cable"); };
  // 감긴 고리 — 좌우로 어긋난 두 고리가 엇갈린다. 앞 고리는 먹색 테를 먼저 둘러 겹친 곳에 경계를 남긴다
  const INKC = hex("#101014");
  for (const [cx, cy, rx, ry, front] of [[12.6, 19.6, 6.6, 5.2, false], [17.4, 20.4, 6.6, 5.2, true]]) {
    for (const pass of [0, 1]) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.hypot(dx / rx, dy / ry);
      const d = (rr - 1) * Math.min(rx, ry) / 1.05;
      if (pass === 0 && front && Math.abs(d) <= 1.9 && at(img, x, y)) put(img, x, y, INKC, "ink");
      if (pass === 1 && Math.abs(d) <= 1.0) tube(x, y, d, dx / rx, dy / ry);
    }
  }
  // 두 가닥 — 고리에서 위로 뻗는 선 (두께 2)
  const strand = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3; for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; for (const [ox, oy, d] of [[0, 0, -0.5], [1, 0, 0.5]]) tube(Math.round(x + ox), Math.round(y + oy), d, 0, 0); } } };
  strand([[8, 16], [7, 12], [7, 9]]);
  strand([[22, 16], [22, 12], [22, 8]]);
  // 단자 — 몸통(짙은 회색) + 금속 핀
  const plug = (x0, y0) => {
    for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) put(img, x, y, PLUG[x === x0 ? 0 : x === x0 + 3 ? 2 : 1], "plug");
    for (let x = x0 + 1; x < x0 + 3; x++) { put(img, x, y0 - 1, PIN[x === x0 + 1 ? 0 : 1], "pin"); put(img, x, y0 - 2, PIN[x === x0 + 1 ? 1 : 2], "pin"); }
  };
  plug(6, 5);
  plug(21, 4);
  // 광
  for (const [x, y] of [[9, 16], [10, 15], [7, 6], [22, 5]]) if (at(img, x, y)) put(img, x, y, hex("#d4d4dc"), "cable");
  const mats = { cable: { line: hex("#101014"), rim: null }, plug: { line: hex("#101014"), rim: null }, pin: { line: hex("#5c4010"), rim: null } };
  outline(img, mats, 15, 16);
  return save("bond-cord", img);
}

// ── 무대 말풍선 아이콘 — 도구가 아니라 말풍선에 넣는 그림이다 (2026-09-29 사용자 결정 "말풍선에 아이콘들 넣어") ──

// 만화 고기 — 뼈 달린 고깃덩이. 오른쪽 위로 기운 붉은 갈색 살, 양끝에 두 알 뼈 머리
function meat() {
  const img = blank();
  const FLESH = ["#ffc49a", "#f08650", "#cc5428", "#983418", "#66200e"].map(hex);
  const BONE = ["#ffffff", "#f6eedc", "#dfd0ae", "#b8a27a"].map(hex);
  const cx = 15, cy = 15.5, ang = -0.62; // 기운 각도(라디안) — 오른쪽 위로
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const local = (x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; return [dx * ca + dy * sa, -dx * sa + dy * ca]; }; // 긴 축 u, 짧은 축 v
  // 뼈 — 긴 축을 따라 가는 막대와 양끝의 두 알 머리. 살 뒤에 먼저 그린다
  const boneAt = (x, y) => {
    const [u, v] = local(x, y);
    const stick = Math.abs(v) <= 1.3 && Math.abs(u) <= 9.6;
    const knob = [-10.4, 10.4].some((ku) => [-1.7, 1.7].some((kv) => Math.hypot(u - ku, v - kv) <= 1.9));
    return stick || knob ? [u, v] : null;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = boneAt(x, y); if (!b) continue;
    const [u, v] = b;
    const k = v < -0.9 ? 0 : v < 0.3 ? 1 : v < 1.4 ? 2 : 3;
    put(img, x, y, BONE[Math.abs(u) > 9.5 && v < 0 ? Math.max(0, k - 1) : k], "bone");
  }
  // 살 — 긴 축 9, 짧은 축 6.8 의 통통한 타원
  const RU = 7.6, RV = 6.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = local(x, y);
    const nu = u / RU, nv = v / RV;
    if (nu * nu + nv * nv > 1) continue;
    // 빛은 화면 왼쪽 위 — 화면 좌표로 명암을 정한다
    const nx = (x + 0.5 - cx) / RU, ny = (y + 0.5 - cy) / RU;
    put(img, x, y, lumpTone(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)), FLESH), "flesh");
  }
  // 살결 — 짙은 줄 둘, 광택 흰 점
  for (const [x, y] of [[17, 17], [18, 16], [19, 15], [14, 19], [15, 18], [16, 18]]) if (at(img, x, y) && at(img, x, y).m === "flesh") put(img, x, y, FLESH[3], "flesh");
  for (const [x, y] of [[11, 14], [12, 13], [12, 14], [13, 13]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "flesh");
  const mats = { flesh: { line: hex("#4a1406"), rim: FLESH[2] }, bone: { line: hex("#6e5a36"), rim: BONE[2] } };
  rimLight(img, mats, cx, cy);
  outline(img, mats, cx, cy);
  return save("meat", img);
}

// 금화 — 두툼한 금빛 동전, 테두리 홈과 가운데 돋을새김 P (포인트)
function coin() {
  const img = blank();
  const G = ["#fffbd4", "#ffe68a", "#f8c838", "#d89a18", "#a0680a"].map(hex);
  const cx = 15, cy = 15, r = 10.5;
  // 앞면 — 바깥 테는 오른쪽 아래가 짙다
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r, d = nx * nx + ny * ny;
    if (d > 1) continue;
    const ring = d > 0.58 && d < 0.72; // 테두리 홈 — 왼쪽 위는 그늘, 오른쪽 아래는 빛을 받는다
    const edgeBand = d >= 0.8; // 바깥 테
    put(img, x, y, ring ? (nx + ny < 0 ? G[3] : G[1]) : edgeBand ? (nx + ny > 0.2 ? G[3] : G[2]) : lumpTone(nx * 0.8, ny * 0.8, G), "coin");
  }
  // 돋을새김 P — 짙은 글자 + 왼쪽 위 밝은 턱
  const P = [
    "####.",
    "#...#",
    "#...#",
    "####.",
    "#....",
    "#....",
    "#....",
  ];
  const ox = 13, oy = 12;
  for (let j = 0; j < P.length; j++) for (let i = 0; i < 5; i++) if (P[j][i] === "#") {
    put(img, ox + i - 1, oy + j - 1, G[0], "coin");
  }
  for (let j = 0; j < P.length; j++) for (let i = 0; i < 5; i++) if (P[j][i] === "#") put(img, ox + i, oy + j, G[4], "coin");
  // 광
  for (const [x, y] of [[9, 8], [10, 7], [8, 9]]) if (at(img, x, y)) put(img, x, y, hex("#ffffff"), "coin");
  const mats = { coin: { line: hex("#6a4006"), rim: G[3] } };
  rimLight(img, mats, cx, cy);
  outline(img, mats, cx, cy);
  return save("coin", img);
}

fs.mkdirSync(OUT, { recursive: true });
// 인자로 이름을 주면 그 그림만 다시 만든다 — node scripts/build-item-art.cjs meat coin
const ALL = {
  "shiny-potion": () => shinyPotion(),
  "normal-potion": () => shinyPotion("normal-potion", ["#ffffff", "#e4ecf2", "#bccad6", "#8c9cac", "#667688"], "#3e4a58", false),
  "ancient-stone": ancientStone,
  "basic-food": basicFood,
  "premium-food": premiumFood,
  "toy": toy,
  "bond-cord": bondCord,
  "meat": meat,
  "coin": coin,
};
const want = process.argv.slice(2);
const made = (want.length ? want : Object.keys(ALL)).filter((n) => ALL[n]).map((n) => (ALL[n](), n));
process.stdout.write(`그림 ${made.length}개: ${made.join(", ")} → ${path.relative(process.cwd(), OUT)}
`);
