// 공식 일러스트 → 96 × 96 도트 초상 — PokeAPI 도트 초상이 없는 모습(메가지가르데 10301)에 쓴다
// (2026-11-09 사용자 결정 "b를 a방식으로", worklog/records/zygarde-mega-look)
//
// 앱이 받은 일러스트를 그 자리에서 바꾼다. 설치 파일에 그림을 넣지 않는 규칙(docs/specs/companion.md "설정창의 초상")을 지키려는 것이다
// 순서: 불투명 네모를 FIT 칸에 맞춰 면적 평균으로 줄이기 → 알파 문턱 → 색 COLORS 개로 줄이기(k-means) → 외톨이 점 지우기 → 대비 올리기 → 바깥 한 칸 테두리
// 같은 일러스트면 같은 그림이 나온다(난수 없음)
import { decodePng, encodePng, opaqueRectOf } from "../../platform/png.js";

const SIZE = 96; // PokeAPI 도트 초상과 같은 크기
const FIT = 86; // 몸의 긴 변 — 바깥 테두리 한 칸과 여백을 남긴다
const ALPHA_MIN = 110; // 줄인 칸의 평균 알파가 이 값 이상이면 불투명
const COLORS = 24;
const ROUNDS = 15; // k-means 반복
const CONTRAST = 1.12;
const OUTLINE = 0.22; // 테두리 색 — 안쪽 이웃 색의 밝기 비율
const N4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 일러스트 PNG → 초상 PNG. 못 읽거나 빈 그림이면 null
export function portraitFromArt(art: Buffer): Buffer | null {
  const img = decodePng(art);
  if (!img) return null;
  const box = opaqueRectOf(img.w, img.h, (x, y) => (img.px[(y * img.w + x) * 4 + 3] ?? 0) >= 128);
  if (!box) return null;
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : (y * SIZE + x) * 4);
  const solid = (i: number): boolean => i >= 0 && (px[i + 3] ?? 0) > 0;

  // 줄이기 — 칸마다 원본 점들의 알파 가중 평균
  const scale = FIT / Math.max(box.w, box.h);
  const ow = Math.round(box.w * scale);
  const oh = Math.round(box.h * scale);
  const ox = Math.floor((SIZE - ow) / 2);
  const oy = SIZE - oh - Math.floor((SIZE - FIT) / 2); // 발이 아래 여백 위에 서게
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const x0 = Math.floor(box.x + x / scale), x1 = Math.min(img.w, Math.ceil(box.x + (x + 1) / scale));
      const y0 = Math.floor(box.y + y / scale), y1 = Math.min(img.h, Math.ceil(box.y + (y + 1) / scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.w + sx) * 4;
          const al = img.px[i + 3] ?? 0;
          r += (img.px[i] ?? 0) * al;
          g += (img.px[i + 1] ?? 0) * al;
          b += (img.px[i + 2] ?? 0) * al;
          a += al;
          n++;
        }
      }
      if (!a || a / n < ALPHA_MIN) continue;
      const o = at(ox + x, oy + y);
      px[o] = r / a;
      px[o + 1] = g / a;
      px[o + 2] = b / a;
      px[o + 3] = 255;
    }
  }

  // 색 줄이기 — 처음 중심은 불투명 점을 고르게 건너뛰며 고른다
  const pts: number[] = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) pts.push(i);
  if (!pts.length) return null;
  let centers = Array.from({ length: COLORS }, (_, k) => {
    const i = pts[Math.floor(((k + 0.5) * pts.length) / COLORS)] ?? 0;
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
  });
  const nearest = (i: number): number => {
    let best = 0, bestD = Infinity;
    centers.forEach((c, k) => {
      const d = ((px[i] ?? 0) - (c[0] ?? 0)) ** 2 + ((px[i + 1] ?? 0) - (c[1] ?? 0)) ** 2 + ((px[i + 2] ?? 0) - (c[2] ?? 0)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  };
  for (let round = 0; round < ROUNDS; round++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const i of pts) {
      const s = sum[nearest(i)]!;
      s[0]! += px[i] ?? 0;
      s[1]! += px[i + 1] ?? 0;
      s[2]! += px[i + 2] ?? 0;
      s[3]!++;
    }
    centers = sum.map((s, k) => (s[3] ? [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]] : centers[k]!));
  }
  for (const i of pts) {
    const c = centers[nearest(i)]!;
    px[i] = c[0] ?? 0;
    px[i + 1] = c[1] ?? 0;
    px[i + 2] = c[2] ?? 0;
  }

  // 외톨이 점 — 불투명 이웃이 하나 이하인 점은 지운다
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = at(x, y);
      if (solid(i) && N4.filter(([dx, dy]) => solid(at(x + dx, y + dy))).length <= 1) px[i + 3] = 0;
    }
  }
  // 대비
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, ((px[i + c] ?? 0) - 128) * CONTRAST + 128));
  }
  // 바깥 테두리 — 몸에 닿은 투명 칸을 안쪽 색의 어두운 색으로 칠한다
  const rim: [number, number][] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = at(x, y);
      if (solid(i)) continue;
      const inner = N4.map(([dx, dy]) => at(x + dx, y + dy)).find(solid);
      if (inner != null) rim.push([i, inner]);
    }
  }
  for (const [i, j] of rim) {
    px[i] = (px[j] ?? 0) * OUTLINE;
    px[i + 1] = (px[j + 1] ?? 0) * OUTLINE;
    px[i + 2] = (px[j + 2] ?? 0) * OUTLINE + 8; // 순검정보다 살짝 푸른 테두리
    px[i + 3] = 255;
  }
  return encodePng({ w: SIZE, h: SIZE, px });
}
