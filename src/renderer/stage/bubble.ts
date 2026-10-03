// 무대 말풍선 — 포켓몬 머리 위의 아이콘 말풍선을 캔버스에 그린다
// 말풍선 아이콘 — 열쇠별 그림과 불투명한 부분의 사각형. 그림의 빈 여백을 잘라 말풍선 칸에 맞춘다
// 글자는 그리지 않는다 (2026-09-29 사용자 결정 "말풍선에 아이콘들 넣어")
import { decodeImage, opaqueBoxOf, readPixels } from "../ui/image.js";

interface BubbleIcon {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface BubblePainterDeps {
  ctx: CanvasRenderingContext2D;
  dprOf: () => number;
  stageWidthOf: () => number; // 무대 폭(DIP) — 말풍선을 무대 안에 가둔다
  onChanged: () => void; // 아이콘이 들어왔다 — 다시 그린다
  onBadIcon: (key: string) => void; // 깨진 그림 — 진단으로 알린다
}

// 불투명한 픽셀을 모두 덮는 사각형 — 읽지 못하면 그림 전체
function opaqueBox(img: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  const pixels = readPixels(img);
  const box = pixels && opaqueBoxOf(pixels.data, 16);
  return box ? { sx: box.x, sy: box.y, sw: box.w, sh: box.h } : { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
}

// 말풍선 — Figma `Speech Bubble` `338:733`: 흰 바탕, 1px 테두리, 반경 12, 높이 28, 아래 왼쪽 꼬리. 모양은 글자 말풍선 때와 같다.
// 안에는 아이콘을 나란히 둔다 — 칸 22 × 22, 칸 사이 2, 좌우 여백 8. 도트가 뭉개지지 않게 보간 없이 그린다.
// 몸 가운데 위에 두고, 무대 밖으로 나가지 않게 가둔다. 그림이 아직 없는 열쇠가 있으면 그리지 않는다
const ICON_BOX = 22;
const ICON_GAP = 2;

export function createBubblePainter(deps: BubblePainterDeps): {
  putIcons(icons: Record<string, string>): Promise<void>;
  drawBubble(keys: string[], r: { x: number; y: number; w: number; h: number }): void;
} {
  const { ctx } = deps;
  const bubbleIcons = new Map<string, BubbleIcon>();

  async function putIcons(icons: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(icons).map(async ([key, uri]) => {
        const img = await decodeImage(uri);
        if (!img) {
          deps.onBadIcon(key);
          return; // 깨진 그림 — 그 열쇠의 말풍선은 그리지 않는다
        }
        bubbleIcons.set(key, { img, ...opaqueBox(img) });
      }),
    );
    deps.onChanged();
  }

  function drawBubble(keys: string[], r: { x: number; y: number; w: number; h: number }): void {
    const icons = keys.map((k) => bubbleIcons.get(k));
    if (!icons.length || icons.some((i) => !i)) return;
    const dpr = deps.dprOf();
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = icons.length * ICON_BOX + (icons.length - 1) * ICON_GAP + 16;
    const h = 28;
    const tailX = 13;
    const stageW = deps.stageWidthOf();
    let x = Math.round(r.x + r.w / 2 - tailX - 6);
    x = Math.max(2, Math.min(x, stageW - w - 2));
    const y = Math.max(2, Math.round(r.y - h - 8));
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w, h, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#dde1db";
    ctx.lineWidth = 1;
    ctx.stroke();
    // 꼬리 — 12 × 7 삼각형. 테두리 위를 흰색으로 덮어 이어 붙인다
    ctx.beginPath();
    ctx.moveTo(x + tailX, y + h);
    ctx.lineTo(x + tailX + 6, y + h + 7);
    ctx.lineTo(x + tailX + 12, y + h);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + tailX + 0.5, y + h + 0.5);
    ctx.lineTo(x + tailX + 6.5, y + h + 7.5);
    ctx.lineTo(x + tailX + 12.5, y + h + 0.5);
    ctx.stroke();
    ctx.restore();
    // 아이콘 — 장치 픽셀 좌표로 반올림해 그린다. 빈 여백을 자른 뒤 긴 변을 칸에 맞춘다
    ctx.imageSmoothingEnabled = false;
    icons.forEach((icon, i) => {
      if (!icon) return;
      const k = ICON_BOX / Math.max(icon.sw, icon.sh);
      const dw = icon.sw * k, dh = icon.sh * k;
      const bx = x + 8 + i * (ICON_BOX + ICON_GAP) + (ICON_BOX - dw) / 2;
      const by = y + (h - ICON_BOX) / 2 + (ICON_BOX - dh) / 2;
      ctx.drawImage(icon.img, icon.sx, icon.sy, icon.sw, icon.sh, Math.round(bx * dpr), Math.round(by * dpr), Math.round(dw * dpr), Math.round(dh * dpr));
    });
  }

  return { putIcons, drawBubble };
}
