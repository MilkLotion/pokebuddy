// 그림 읽기 — 데이터 URI 를 이미지로, 이미지를 픽셀로, 픽셀에서 불투명한 네모를. 초상·무대 시트·말풍선 아이콘이 같이 쓴다

// 디코딩까지 기다린 이미지 — 깨진 그림이면 null(부르는 쪽이 건너뛴다)
export async function decodeImage(uri: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = uri;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

// 이미지 픽셀 — 그림마다 새 숨긴 캔버스로 한 번 읽고 버린다. 한 캔버스를 여러 번 되읽으면 Chrome 이 willReadFrequently 를 권하는 경고를 낸다.
// 크기가 0 이거나 2D 문맥을 못 얻으면 null
export function readPixels(img: HTMLImageElement): { data: ImageData; canvas: HTMLCanvasElement } | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 1 || h < 1) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, w, h), canvas };
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 알파가 minAlpha 이상인 점을 모두 담는 네모 — 그런 점이 없으면 null. 기준은 쓰임마다 다르다(초상 128, 말풍선 아이콘 16)
export function opaqueBoxOf(pixels: ImageData, minAlpha: number): PixelBox | null {
  const { data, width, height } = pixels;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((data[(y * width + x) * 4 + 3] ?? 0) >= minAlpha) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
