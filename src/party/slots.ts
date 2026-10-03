// 파티 칸 열기 — 규칙은 docs/specs/game.md "파티". 순수 함수이며 저장을 쓰지 않는다.
//
// 칸은 앞에서부터 연다. 상점 구매와 업적 보상은 둘 다 "칸 +1" 이다.
// 잠긴 칸의 `unlockBy` 는 어느 경로로 몇 칸을 더 열 수 있는지 세는 표시일 뿐, 칸 자리를 정하지 않는다.
import type { PartySlotV3, SlotState, SlotUnlockBy } from "../shared/save-v3";
import { PARTY_RULES } from "./rules.js";

// `by` 경로로 칸 하나를 연다. 연 칸 번호, 그 경로로 열 칸이 남지 않았으면 -1
//   첫 잠긴 칸을 열고, 쓴 경로 표시는 그 칸이 가졌던 표시와 맞바꾼다 — 경로별 남은 수가 그대로 맞는다
export function openSlot(slots: PartySlotV3[], by: SlotUnlockBy): number {
  const tagged = slots.findIndex((s) => s.state === "locked" && s.unlockBy === by);
  if (tagged < 0) return -1;
  const first = slots.findIndex((s) => s.state === "locked");
  if (first !== tagged) slots[tagged] = { state: "locked", unlockBy: slots[first]?.unlockBy };
  slots[first] = { state: "empty" };
  return first;
}

// 열린 칸을 앞으로 모은다 — 칸 순서는 유지하고 잠긴 칸만 뒤로 보낸다
//   예전 저장은 칸마다 여는 경로가 정해져 있어 1·2·5번이 열린 채일 수 있다
export function compactSlots(slots: PartySlotV3[]): PartySlotV3[] {
  return [...slots.filter((s) => s.state !== "locked"), ...slots.filter((s) => s.state === "locked")];
}

// 첫 프리셋의 새 칸 — 두 칸이 열려 있고, 상점 2칸·업적 2칸이 잠겨 있다
export function emptySlots(): PartySlotV3[] {
  const { total, openAtStart, shopUnlock } = PARTY_RULES;
  return Array.from({ length: total }, (_, i) => {
    if (i < openAtStart) return { state: "empty" as SlotState };
    const bought = i - openAtStart < shopUnlock;
    return { state: "locked" as SlotState, unlockBy: bought ? ("shop" as const) : ("achievement" as const) };
  });
}

// 프리셋 하나의 새 칸 — 첫 프리셋은 상점 2칸·업적 2칸이다. 나머지 프리셋은 잠긴 칸을 모두 상점에서 산다 (2026-10-02 사용자 결정)
export function presetSlots(index: number): PartySlotV3[] {
  if (index === 0) return emptySlots();
  const { total, openAtStart } = PARTY_RULES;
  return Array.from({ length: total }, (_, i) =>
    i < openAtStart ? { state: "empty" as SlotState } : { state: "locked" as SlotState, unlockBy: "shop" as const });
}
