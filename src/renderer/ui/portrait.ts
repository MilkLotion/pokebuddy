// 포켓몬 그림 공통 — 창마다 따로 두던 그림 맞춤을 한곳에 둔다 (2026-10-03 사용자 지적 "공통코드로 되어있는게아니야?")
// - portraitImg: 목록의 초상(<img>). 관리 창·파티 기기 창·가방 기기 창의 파티 줄·도감 기기 창의 진화 트리·포켓몬 메뉴·첫 포켓몬 선택 창이 쓴다
// - spriteCanvas: 기기 창의 큰 그림(<canvas>). 파티 상세·도감·상점·가방 기기 창이 쓴다
// 그림은 PokeAPI 기본 그림(96 × 96)이고 data URI 로 온다 (src/main/portraits.ts)
import { opaqueBoxOf, readPixels } from "./image.js";

interface OpaqueBox {
  x: number;
  y: number;
  w: number;
  h: number;
  width: number; // 그림 전체
  height: number;
}

// 불투명한 영역 — 알파 128 이상인 점을 모두 담는 네모. 빈 그림은 null
function opaqueBox(img: HTMLImageElement): { box: OpaqueBox; canvas: HTMLCanvasElement } | null {
  const pixels = readPixels(img);
  const box = pixels && opaqueBoxOf(pixels.data, 128);
  if (!pixels || !box) return null;
  return { box: { ...box, width: pixels.data.width, height: pixels.data.height }, canvas: pixels.canvas };
}

// ── 목록의 초상 ────────────────────────────────────────────────────────────────
// 기본은 둘레 14% 를 잘라 가운데만 보인다 — 둘레 여백이 큰 그림이 대부분이다 (CSS `object-view-box: inset(14%)`).
// 몸이 그 밖으로 나가는 그림(레쿠쟈·메가 모습)은 잘린다. 그런 그림만 보는 네모를 몸이 다 들어가게 넓힌다.
// 몸이 기본 네모 안에 드는 그림은 그대로다 — 작은 포켓몬을 칸에 꽉 차게 키우지 않는다
// (2026-10-03 사용자 "이런식으로 프로필잘리는건 해결될까?")
const CROP = 0.14;

// 그림 주소 → 보는 네모(object-view-box 값). 기본 네모로 충분하면 빈 문자열이다
const viewBoxes = new Map<string, string>();

function viewBoxOf(b: OpaqueBox): string {
  const left = b.width * CROP;
  const top = b.height * CROP;
  if (b.x >= left && b.y >= top && b.x + b.w <= b.width - left && b.y + b.h <= b.height - top) return "";
  // 몸을 다 담는 정사각형 — 기본 네모보다 작아지지 않고 그림 밖으로 나가지 않는다
  const side = Math.min(Math.max(b.width * (1 - 2 * CROP), b.w, b.h), b.width, b.height);
  const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max);
  const x = clamp(b.x + b.w / 2 - side / 2, b.width - side);
  const y = clamp(b.y + b.h / 2 - side / 2, b.height - side);
  const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(3)}%`;
  return `inset(${pct(y, b.height)} ${pct(b.width - x - side, b.width)} ${pct(b.height - y - side, b.height)} ${pct(x, b.width)})`;
}

// 읽은 그림 하나의 보는 네모를 재서 기억한다
function measure(img: HTMLImageElement): string {
  const known = viewBoxes.get(img.src);
  if (known !== undefined) return known;
  const found = opaqueBox(img);
  const value = found ? viewBoxOf(found.box) : "";
  viewBoxes.set(img.src, value);
  return value;
}

// 미리 읽어 둔 그림의 보는 네모를 재 둔다 — 칸을 그릴 때 첫 프레임부터 맞는 네모로 보인다 (관리 창 loadArt)
export function rememberPortrait(img: HTMLImageElement): void {
  if (img.naturalWidth) measure(img);
}

// 초상 그림 하나 — 보는 네모를 그림에 맞춘 <img>. 크기와 object-fit 은 각 창의 CSS 가 정한다
export function portraitImg(uri: string, cls?: string): HTMLImageElement {
  const img = document.createElement("img");
  if (cls) img.className = cls;
  img.alt = "";
  img.decoding = "sync"; // 칸과 그림이 한 프레임에 같이 보이게 한다
  const apply = (value: string): void => {
    if (value) img.style.setProperty("object-view-box", value);
  };
  img.src = uri;
  const known = viewBoxes.get(img.src);
  if (known !== undefined) apply(known);
  else img.addEventListener("load", () => apply(measure(img)), { once: true });
  return img;
}

// ── 기기 창의 큰 그림 ──────────────────────────────────────────────────────────
// 빈 테두리를 잘라 자리에 들어가는 가장 큰 정수 배로 그린다. 도트가 번지지 않게 정수 배만 쓴다.
// w·h 는 그림 자리, maxScale 은 배율 상한이다. maxSide 가 있으면 배율을 그 변 길이에 맞춰 정한다(자리는 w·h 그대로)
export interface SpriteBox {
  w: number;
  h: number;
  maxScale: number;
  maxSide?: number;
}

export function spriteCanvas(uri: string, box: SpriteBox): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = 0;
  out.height = 0;
  const img = new Image();
  img.onload = () => {
    const found = opaqueBox(img);
    if (!found) return;
    const { x, y, w, h } = found.box;
    const scale = Math.max(1, Math.min(box.maxScale, Math.floor((box.maxSide ?? box.w) / w), Math.floor((box.maxSide ?? box.h) / h)));
    out.width = Math.min(w * scale, box.w);
    out.height = Math.min(h * scale, box.h);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(found.canvas, x, y, w, h, (out.width - w * scale) / 2, (out.height - h * scale) / 2, w * scale, h * scale);
  };
  img.src = uri;
  return out;
}
