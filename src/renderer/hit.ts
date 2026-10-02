// 히트 — 무대 좌표가 어느 마리의 그림 위인가. DOM 을 쓰지 않는 순수 계산 (stage.ts 가 시트 알파를 넣어 준다)
//
// 그림 위만 클릭을 받는다. 작업 동작(공격 등)이 칸을 키워 프레임이 몸보다 크다 — 투명한 곳까지 받으면 그만큼 아래 창을 못 누른다.
// 검사 순서: 배열 뒤(위에 그려진 것)에서 앞으로 → 프레임 사각형(패딩 포함) 안이면 시트 픽셀로 되돌려 알파를 본다
import type { Rect } from "../shared/geometry.js";
import type { StageFrame, StagePet, StageSize } from "../shared/model/stage.js";

// 그림 가장자리에서 이만큼(DIP) 떨어진 곳까지 그림으로 친다 — 도트 사이 틈에서 클릭이 새지 않게 (옛 pointer.js HIT_PAD_PX)
export const HIT_PAD_PX = 3;

export type { Rect }; // 원본은 src/shared/geometry.ts

// 시트 안 프레임 하나. alpha 는 시트 전체 RGBA (ImageData 와 같은 모양 — width 가 시트 너비)
export interface HitSprite {
  fw: number;
  fh: number;
  col: number; // 프레임 열 (SpriteSheet.frames[i].x)
  row: number; // 방향 행
  alpha: { data: Uint8ClampedArray; width: number; height: number };
}

export interface HitTarget {
  body: StageSize; // 몸 칸 (도트) — 자리의 기준
  sprite: HitSprite;
}

// 마리 → 지금 그려진 프레임. 시트가 아직 없거나 그릴 것이 없으면 null (그 마리는 히트에서 빠진다)
export type HitLookup = (pet: StagePet) => HitTarget | null;

type Placed = Pick<StagePet, "x" | "y" | "zoom">;

// 프레임이 놓이는 무대 사각형(DIP) — 몸 칸 가운데에 프레임을 맞춘다 (art/pmd.js · 옛 renderer/pmd.js 의 정렬 규칙).
// PMD 의 정렬 기준점은 칸 안의 (칸너비/2, 칸높이/2 + 4). 프레임을 몸 칸 가운데에 놓으면 이 점이 몸 칸의 (w/2, h/2+4) 에 떨어진다 —
// 칸 크기와 무관한 상수라 동작이 바뀌어도 발 위치가 그대로다. 몸 칸 = 작업 동작을 뺀 칸이라 공격 동작은 몸 밖으로 넘친다
export function rectOf(pet: Placed, body: StageSize, frame: { fw: number; fh: number }): Rect {
  const dx = Math.round((body.w - frame.fw) / 2);
  const dy = Math.round((body.h - frame.fh) / 2);
  return { x: pet.x + dx * pet.zoom, y: pet.y + dy * pet.zoom, w: frame.fw * pet.zoom, h: frame.fh * pet.zoom };
}

export function inRect(r: Rect, px: number, py: number, pad = 0): boolean {
  return px >= r.x - pad && py >= r.y - pad && px < r.x + r.w + pad && py < r.y + r.h + pad;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// 무대 좌표 → 시트 픽셀 좌표. 프레임 칸 안으로 가둔다 — 옆 프레임·다른 행의 픽셀을 읽지 않게 (패딩이 칸 밖을 가리킬 때)
export function sheetPoint(
  r: Rect,
  sprite: Pick<HitSprite, "fw" | "fh" | "col" | "row">,
  zoom: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const fx = clamp(Math.floor((px - r.x) / zoom), 0, sprite.fw - 1);
  const fy = clamp(Math.floor((py - r.y) / zoom), 0, sprite.fh - 1);
  return { x: sprite.col * sprite.fw + fx, y: sprite.row * sprite.fh + fy };
}

// 무대 좌표 (px, py) 둘레 pad 안에 투명하지 않은 픽셀이 하나라도 있으면 그림 위
export function opaqueNear(target: HitTarget, pet: Placed, px: number, py: number, pad = HIT_PAD_PX): boolean {
  const { sprite } = target;
  const r = rectOf(pet, target.body, sprite);
  if (!inRect(r, px, py, pad)) return false;
  const a = sheetPoint(r, sprite, pet.zoom, px - pad, py - pad);
  const b = sheetPoint(r, sprite, pet.zoom, px + pad, py + pad);
  const { data, width } = sprite.alpha;
  for (let y = a.y; y <= b.y; y++) {
    for (let x = a.x; x <= b.x; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) return true;
    }
  }
  return false;
}

// 무대 좌표가 가리키는 마리 id — 위에 그려진 것(배열 뒤)이 먼저. 없으면 null
export function hitAt(frame: StageFrame, lookup: HitLookup, px: number, py: number): string | null {
  for (let i = frame.pets.length - 1; i >= 0; i--) {
    const pet = frame.pets[i];
    if (!pet) continue;
    const target = lookup(pet);
    if (target && opaqueNear(target, pet, px, py)) return pet.id;
  }
  return null;
}
