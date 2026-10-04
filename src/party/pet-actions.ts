// 개체에 지금 할 수 있는 일의 공통 조건 — 친구 교환에 걸린 개체는 값을 바꾸거나 없애는 일을 하지 않는다
// (worklog/records/trade/record.md "로컬 저장과 복구"). 저장의 trade.pending 만 읽는다. 진화 판정만 도감(dex/evolve)을 함께 본다
import type { DexOptions } from "../dex/data";
import { canEvolve } from "../dex/evolve.js";
import type { DayPart } from "../shared/species";
import type { SaveV3, TradePendingV3 } from "../shared/save-v3";

// 개체에 하는 일 — 교환 잠금이 막는 것은 TRADE_LOCKED_ACTIONS 다
export type PetAction = "use" | "evolve" | "form" | "sell" | "care" | "move" | "hide" | "size" | "home";

// 교환에 걸린 개체에 막는 일 — 값을 바꾸거나 개체를 없애는 일. 돌봄·옮기기·숨기기·크기·자리는 막지 않는다
const TRADE_LOCKED_ACTIONS: readonly PetAction[] = ["use", "evolve", "form", "sell"];

// 교환에 걸린 개체 — 없으면 null
export const pendingTradeOf = (save: Pick<SaveV3, "trade">): TradePendingV3 | null => save.trade?.pending ?? null;

// 교환에 걸려 값을 바꾸면 안 되는 개체인가
export const isTradeLocked = (save: Pick<SaveV3, "trade">, petId: string): boolean => pendingTradeOf(save)?.petId === petId;

// 이 일을 지금 할 수 있는가 — 교환에 걸린 개체에 막힌 일이면 trade-locked
export function checkPetFree(save: Pick<SaveV3, "trade">, petId: string, action: PetAction): { ok: true } | { ok: false; reason: "trade-locked" } {
  if (TRADE_LOCKED_ACTIONS.includes(action) && isTradeLocked(save, petId)) return { ok: false, reason: "trade-locked" };
  return { ok: true };
}

// 지금 진화할 수 있는가 — 진화 규칙(dex/evolve canEvolve)과 교환 잠금을 함께 본다. 배너·진화 튜토리얼이 이것을 쓴다.
// 실행(evolve 명령)이 교환에 걸린 개체를 trade-locked 로 거절하므로, 알리는 쪽도 같은 판정이어야 한다 (94 항목 9-5-1)
export const evolveAllowed = (save: SaveV3, petId: string, dayPart: DayPart, opts?: DexOptions): boolean =>
  checkPetFree(save, petId, "evolve").ok && canEvolve(save, petId, dayPart, opts);
