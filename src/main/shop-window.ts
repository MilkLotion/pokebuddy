// 상점 기기 창 — 관리 창 옆에 붙어 상품 하나의 설명과 구매를 보이는 창. 문서는 src/renderer/shop.html
//
// 관리 창의 상품 줄·칸을 누르면 뜬다 (2026-10-01 사용자 "상품눌렀을때 무슨상품인지 모르겠어서 파티/도감상세처럼 상품정보다 옆에 창뜨게", A안 —
// Figma 05 `Shop / Device / Tool`, worklog/records/shop-device/record.md). 창의 동작은 공통 틀(src/main/item-window.ts)이다.
// 수량·구매 단추는 관리 창으로 돌려보낸다 — 명령은 관리 창이 보낸다
import type { ShopDeviceAction, ShopDeviceChannel, ShopDeviceOpen } from "../shared/manage";
import { createItemWindow, type ItemWindow } from "./item-window.js";

const CH = {
  show: "shopdev:show",
  size: "shopdev:size",
  step: "shopdev:step",
  close: "shopdev:close",
  act: "shopdev:act",
} satisfies Record<string, ShopDeviceChannel>;

// Figma `Shop / Device / Tool` 폭. 높이는 첫 그림 전 어림값이다
export const SHOP_WINDOW = { width: 380, height: 594 };

export interface ShopWindowOptions {
  preload: string;
  html: string;
  onStep: (delta: -1 | 1) => void;
  onAct: (action: ShopDeviceAction) => void;
  onClosed: (gen: number) => void;
}

export type ShopWindow = ItemWindow<ShopDeviceOpen>;

export function createShopWindow(opts: ShopWindowOptions): ShopWindow {
  return createItemWindow<ShopDeviceOpen, ShopDeviceAction>({ ...opts, channels: CH, size: SHOP_WINDOW, keyOf: (o) => o.productId, isAction });
}

// 렌더러가 보낸 값은 믿지 않는다 — 정해진 모양만 넘긴다
function isAction(v: unknown): v is ShopDeviceAction {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (typeof a.productId !== "string" || !a.productId || a.productId.length > 80) return false;
  if (a.kind === "qty") return typeof a.qty === "number" && Number.isInteger(a.qty) && a.qty >= 1 && a.qty <= 999;
  return a.kind === "buy" || a.kind === "pool";
}
