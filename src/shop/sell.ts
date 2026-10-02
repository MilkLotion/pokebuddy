// 가방 판매 — 규칙은 docs/specs/game.md "가방", 판매가는 docs/specs/balance.md "가격표"
//
// 판매가 = 구매가(src/shop/catalog.ts toolPrice) × SHOP_RULES.sellRate, 내림.
// 가격이 없거나 0P 인 도구(기본먹이, 돌아오는 약)는 팔지 않는다.
// 한 번에 count 개를 판다. 검사를 모두 마친 뒤에만 가방과 포인트를 바꾼다.
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다
import type { DexOptions } from "../dex/data";
import { SHOP_RULES } from "./rules.js";
import type { SaveV3 } from "../shared/save-v3";
import { toolPrice } from "./catalog.js";
import type { ReasonOf } from "../shared/names/reasons.js";

export type SellFailure = ReasonOf<
  | "not-sellable" // 가격이 없거나 0P 인 도구다
  | "not-enough-items" // 가진 개수가 판매 수량보다 적다
  | "bad-count" // 수량이 1 이상의 정수가 아니다
>;

export interface SellResult {
  ok: boolean;
  reason?: SellFailure;
  itemId?: string;
  count?: number;
  earned?: number; // 받은 포인트
  left?: number; // 판 뒤 남은 개수
  balance?: number;
}

// 하나의 판매가 — 팔 수 없으면 null
export function sellPrice(itemId: string, opts?: DexOptions): number | null {
  const price = toolPrice(itemId, opts);
  if (price === null || price <= 0) return null;
  const each = Math.floor(price * SHOP_RULES.sellRate);
  return each > 0 ? each : null;
}

export function sell(save: SaveV3, itemId: string, count: number, opts?: DexOptions): SellResult {
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-count" };
  const each = sellPrice(itemId, opts);
  if (each === null) return { ok: false, reason: "not-sellable" };
  const have = save.bag[itemId] ?? 0;
  if (have < count) return { ok: false, reason: "not-enough-items" };

  const earned = each * count;
  const left = have - count;
  if (left > 0) save.bag[itemId] = left;
  else delete save.bag[itemId];
  save.points.balance += earned;
  return { ok: true, itemId, count, earned, left, balance: save.points.balance };
}
