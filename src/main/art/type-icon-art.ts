// 흰 타입 아이콘 — 원작 타입 아이콘(타입 색 네모 + 흰 그림)에서 바탕색을 빼고 흰 그림만 남긴다.
// 원작에 흰 그림만 있는 아이콘이 없어서다 (docs/specs/adventure.md "배틀 파티 상세 기기 창" 타입 아이콘 White).
// 그림 열쇠 type:<타입> 을 그림 받기(src/main/art/portraits.ts icons·all)가 이 함수로 푼다
import { decodePng, encodePng } from "../../platform/png.js";

// 바탕색 — 불투명한 점 가운데 가장 많은 색
function backgroundOf(px: Buffer): [number, number, number] | null {
  const count = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] ?? 0) < 250) continue;
    const k = ((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let best = -1;
  let n = 0;
  for (const [k, c] of count) if (c > n) [best, n] = [k, c];
  return best < 0 ? null : [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

// 흰 그림 PNG — 바탕색에서 흰색 쪽으로 간 정도를 불투명도로 쓴다(테두리의 섞인 점도 부드럽게 남는다). 못 읽으면 null
export function whitenTypeIcon(base: Buffer): Buffer | null {
  const img = decodePng(base);
  if (!img) return null;
  const bg = backgroundOf(Buffer.from(img.px));
  if (!bg) return null;
  const px = Buffer.from(img.px);
  for (let i = 0; i < px.length; i += 4) {
    let t = 1;
    for (let c = 0; c < 3; c += 1) {
      const b = bg[c]!;
      if (b >= 250) continue; // 그 채널은 흰색과 구별되지 않는다
      t = Math.min(t, ((px[i + c] ?? 0) - b) / (255 - b));
    }
    t = Math.max(0, Math.min(1, t));
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = Math.round(t * (px[i + 3] ?? 0));
  }
  return encodePng({ w: img.w, h: img.h, px });
}
