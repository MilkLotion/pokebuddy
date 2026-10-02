// 개체가 앉는 자리와 그림 크기 — 자리는 따라가는 창의 오른쪽 아래를 기준으로 한 어긋남이다 (docs/specs/game.md "놀이공간")
//
// 사용자가 마리를 끌어다 놓으면 그 자리를 기억한다. 파티 칸이나 박스와는 상관이 없다.
// 박스에 있는 개체의 자리도 그대로 둔다 — 다시 꺼내면 놓아 둔 자리로 돌아간다.
import { zoomOfLevel } from "./size.js";
import { screenRefOf } from "../save/v3.js";
import type { SaveV3, ScreenRefV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export interface HomePoint {
  dx: number;
  dy: number;
}

export type HomeFailure = ReasonOf<"no-pet" | "bad-value">;

export interface HomeResult {
  ok: boolean;
  reason?: HomeFailure;
  petId?: string;
  home?: HomePoint;
  screen?: ScreenRefV3;
}

const isFinitePoint = (v: unknown): v is HomePoint => {
  if (v == null || typeof v !== "object") return false;
  const { dx, dy } = v as { dx?: unknown; dy?: unknown };
  return typeof dx === "number" && typeof dy === "number" && Number.isFinite(dx) && Number.isFinite(dy);
};

// screen 을 주면 사는 화면도 함께 바꾼다 — 모든 화면 방식에서 끌어다 놓았을 때. 주지 않으면(undefined) 사는 화면은 그대로다
export function setHome(save: SaveV3, petId: string, home: unknown, screen?: unknown): HomeResult {
  if (!isFinitePoint(home)) return { ok: false, reason: "bad-value" };
  const ref = screen === undefined ? undefined : screenRefOf(screen);
  if (ref === null) return { ok: false, reason: "bad-value" };
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  pet.home = { dx: home.dx, dy: home.dy };
  if (ref) pet.screen = ref;
  return { ok: true, petId, home: { ...pet.home }, ...(pet.screen ? { screen: { ...pet.screen } } : {}) };
}

// 그림 크기 — 단계 번호(1~SIZE_STEPS 길이)를 받아 그 배율을 저장한다. 무대가 도트 배율로 쓴다 (src/main/art.ts zoomOf).
// 상세의 크기 단추가 한 번 누를 때 한 번 저장한다. 단계표는 src/party/size.ts SIZE_STEPS

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
