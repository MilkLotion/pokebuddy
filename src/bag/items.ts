// 가방의 도구 넣기 — 상점·줍기는 가방 상한을 넘지 않는다. 업적 보상·우편처럼 사지 않고 받는 것은 막지 않는다 (2026-09-27 사용자 결정)
import type { SaveV3 } from "../shared/save-v3";
import type { Check } from "../shared/names/reasons.js";
import { BAG_RULES } from "./rules.js";

// 이 도구를 가방에 더 넣을 수 있는 수 — 가방 상한(BAG_RULES.max)까지
export const bagRoomOf = (save: Pick<SaveV3, "bag">, id: string): number => Math.max(0, BAG_RULES.max - (save.bag[id] ?? 0));

// 도구를 가방에 넣는다. capped 면 상한을 넘을 때 넣지 않고 bag-full
export function addItem(save: Pick<SaveV3, "bag">, id: string, count: number, o: { capped?: boolean } = {}): Check<"bag-full"> {
  if (o.capped && bagRoomOf(save, id) < count) return { ok: false, reason: "bag-full" };
  save.bag[id] = (save.bag[id] ?? 0) + count;
  return { ok: true };
}
