// 개체가 앉는 자리와 그림 크기 — 자리는 따라가는 창의 오른쪽 아래를 기준으로 한 어긋남이다 (docs/specs/game.md "놀이공간")
//
// 사용자가 마리를 끌어다 놓으면 그 자리를 기억한다. 파티 칸이나 박스와는 상관이 없다.
// 박스에 있는 개체의 자리도 그대로 둔다 — 다시 꺼내면 놓아 둔 자리로 돌아간다.
import { zoomOfLevel } from "../save/rules.js";
import type { SaveV3 } from "../shared/save-v3";

export interface HomePoint {
  dx: number;
  dy: number;
}

export type HomeFailure = "no-pet" | "bad-value";

export interface HomeResult {
  ok: boolean;
  reason?: HomeFailure;
  petId?: string;
  home?: HomePoint;
}

const isFinitePoint = (v: unknown): v is HomePoint => {
  if (v == null || typeof v !== "object") return false;
  const { dx, dy } = v as { dx?: unknown; dy?: unknown };
  return typeof dx === "number" && typeof dy === "number" && Number.isFinite(dx) && Number.isFinite(dy);
};

export function setHome(save: SaveV3, petId: string, home: unknown): HomeResult {
  if (!isFinitePoint(home)) return { ok: false, reason: "bad-value" };
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  pet.home = { dx: home.dx, dy: home.dy };
  return { ok: true, petId, home: { ...pet.home } };
}

// 그림 크기 — 단계 번호(1~SIZE_STEPS 길이)를 받아 그 배율을 저장한다. 무대가 도트 배율로 쓴다 (src/main/art.ts zoomOf).
// 상세의 크기 단추가 한 번 누를 때 한 번 저장한다. 단계표는 src/save/rules.ts SIZE_STEPS

export interface SizeResult {
  ok: boolean;
  reason?: HomeFailure;
  petId?: string;
  size?: number;
}

export function setSize(save: SaveV3, petId: string, size: unknown): SizeResult {
  const zoom = typeof size === "number" ? zoomOfLevel(size) : null;
  if (zoom === null) return { ok: false, reason: "bad-value" };
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  pet.size = zoom;
  return { ok: true, petId, size: size as number };
}
