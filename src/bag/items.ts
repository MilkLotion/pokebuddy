// 가방의 도구 넣기 — 가방 상한(999)은 구매에만 있다. 상점은 사기 전에 bagRoomOf 로 본다.
// 줍기·업적 보상·우편처럼 사지 않고 받는 것은 막지 않는다 (2026-09-27 사용자 "구매는 … 999개로 제한", docs/specs/balance.md "가방 구매 상한")
import type { SaveV3 } from "../shared/save-v3";
import { BAG_RULES } from "./rules.js";

// 이 도구를 가방에 더 넣을 수 있는 수 — 가방 상한(BAG_RULES.max)까지
export const bagRoomOf = (save: Pick<SaveV3, "bag">, id: string): number => Math.max(0, BAG_RULES.max - (save.bag[id] ?? 0));

// 도구를 가방에 넣는다
export function addItem(save: Pick<SaveV3, "bag">, id: string, count: number): void {
  save.bag[id] = (save.bag[id] ?? 0) + count;
}
