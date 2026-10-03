// 파티 개체의 표시와 숨김 — 규칙은 docs/specs/game.md "파티". 순수 함수이며 저장을 쓰지 않는다.
//
// 숨겨도 포인트와 친밀도는 쌓인다. 박스 보관만 멈춘다.
// 여기서는 칸의 `hidden` 만 바꾼다. 저장은 거래 실행기가 한다 (docs/specs/modules.md "경계 원칙").
import type { PartySlotV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type VisibilityFailure = ReasonOf<"no-slot" | "not-pokemon" | "already">;

export type VisibilityResult = Outcome<VisibilityFailure> & {
  petId?: string;
};

// 개체가 든 칸을 찾는다. 없으면 -1
export const petSlotIndex = (slots: PartySlotV3[], petId: string): number =>
  slots.findIndex((s) => s.state === "pokemon" && s.petId === petId);

// hidden 을 바꾼다. 같은 상태로 다시 바꾸려 하면 실패로 본다 — 중복 반영을 눈에 보이게 한다
export function setHidden(slots: PartySlotV3[], petId: string, hidden: boolean): VisibilityResult {
  const i = petSlotIndex(slots, petId);
  if (i < 0) return { ok: false, reason: "no-slot" };
  const slot = slots[i];
  if (!slot || slot.state !== "pokemon") return { ok: false, reason: "not-pokemon" };
  if ((slot.hidden === true) === hidden) return { ok: false, reason: "already" };
  slot.hidden = hidden;
  return { ok: true, petId };
}

// 지금 보이는 개체 수 — 화면의 "N마리 표시 중"
export const shownCount = (slots: PartySlotV3[]): number =>
  slots.filter((s) => s.state === "pokemon" && s.hidden !== true).length;
