// 알 그림 색칠 — 원작 알 그림(sprites/pokemon/egg.png)의 색 아홉 개를 알 종류의 색표(data/eggs.json palette)로 바꾼다.
// 그림 열쇠 egg:<종류>(src/view/device-art.ts)를 그림 받기(src/main/art/portraits.ts icons)가 이 함수로 푼다.
// 알파가 0 인 점은 건너뛴다. 원작 색에 없는 점은 그대로 둔다
import { decodePng, encodePng } from "../../platform/png.js";

// 원작 알 그림이 쓰는 색 — 색표의 같은 자리 색으로 바꾼다
export const EGG_SOURCE = ["#5a5241", "#ffffff", "#cdbd83", "#181818", "#fff6de", "#9ccd83", "#cde6b4", "#e6deb4", "#83b46a"] as const;

const hex = (n: number): string => n.toString(16).padStart(2, "0");

// 색을 바꾼 PNG. 색표 길이가 원작 색 수와 다르거나 그림을 못 읽으면 null(부르는 쪽이 기본 알 그림을 쓴다)
export function tintEgg(base: Buffer, palette: readonly string[]): Buffer | null {
  if (palette.length !== EGG_SOURCE.length) return null;
  const img = decodePng(base);
  if (!img) return null;
  const swap = new Map<string, string>(EGG_SOURCE.map((c, i) => [c, palette[i] ?? c]));
  const px = Buffer.from(img.px);
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const to = swap.get(`#${hex(px[i] ?? 0)}${hex(px[i + 1] ?? 0)}${hex(px[i + 2] ?? 0)}`);
    if (!to) continue;
    px[i] = parseInt(to.slice(1, 3), 16);
    px[i + 1] = parseInt(to.slice(3, 5), 16);
    px[i + 2] = parseInt(to.slice(5, 7), 16);
  }
  return encodePng({ w: img.w, h: img.h, px });
}
