// 설정창의 상점 기기 창 연결 — 고른 상품, 수량·구매, 이전·다음 (P10r)
// 상품 줄·칸을 누르면 관리 창 옆에 상점 기기 창이 뜬다 (src/main/shop-window.ts, Figma 05 `Shop / Device / Tool`·`Egg`·`Evolution`).
// 설명과 구매를 한 창에 둔다 — 구매 창(모달)은 없앴다 (2026-10-01 사용자 결정 A안, worklog/records/shop-device/shop-device.md).
// 여기서는 고른 값만 보내고 무엇을 보일지는 메인이 정한다 (src/view/device-shop.ts). 수량·구매 단추는 여기로 돌아와 명령으로 처리한다
import type { ShopItemView } from "../../shared/model/snapshot.js";
import type { ShopDeviceAction, ShopDeviceInput } from "../../shared/model/devices.js";
import { api } from "./api.js";
import { lastReplyOf, sendCommand } from "./command.js";
import { createDeviceLink } from "./device-link.js";
import { openAnyDialog } from "./dialog.js";
import { bodyEl, redrawBody } from "./shell.js";
import { ui } from "./state.js";

// 설정창이 거는 고리 — 탭의 순서를 이 파일이 가져오지 않게(탭이 이 파일의 고른 상품을 읽는다 — 서로 가져오면 순환이다)
export interface ShopLinkHooks {
  stepRows(shop: readonly ShopItemView[]): ShopItemView[]; // 이전·다음이 도는 순서 — 상점 탭의 shopStepRows
}
let hooks: ShopLinkHooks | null = null;
export function setShopLinkHooks(next: ShopLinkHooks): void {
  hooks = next;
}
function hooksOf(): ShopLinkHooks {
  if (!hooks) throw new Error("shop-link.ts 의 고리가 걸리지 않았다 — setShopLinkHooks 를 먼저 부른다");
  return hooks;
}

let shopPick: string | null = null; // 기기 창에 띄운 상품
let shopQty = 1;
let shopNotice = ""; // 마지막 구매 실패 — 기기 창의 합계 상자가 빨강으로 보인다
let shopDone: { lead: string; line: string } | null = null; // 방금 산 결과 — 합계 상자가 초록으로 보인다. 수량을 바꾸거나 다른 상품으로 가면 지운다
let shopSending = false; // 구매 명령을 보내는 중 — 두 번 누르기를 막는다
let shopBusy = false; // 0.3초 넘게 답이 없다 — 구매 단추가 점 세 개
// 상점 기기 창 연결 — 상품을 고른 동안 연다 (shopDeviceBuild)
export const shopLink = createDeviceLink<ShopDeviceInput>({
  build: shopDeviceBuild,
  stamp: () => ui.view,
  open: (input, gen) => api.shopOpen(input, gen),
  holding: () => shopSending, // 사는 중 — 결과가 붙은 뒤 한 번 보낸다 (device-link.ts)
  apply: (input) => {
    shopQty = input.qty;
  },
  afterClosed: () => {
    if (!shopPick) return false;
    shopPick = null;
    return true;
  },
  redraw: () => redrawBody(),
});

// 누른 상품 — 같은 상품을 다시 누르면 닫는다(도감 칸과 같다)
export function pickShop(id: string): void {
  shopPick = shopPick === id ? null : id;
  shopQty = 1;
  shopNotice = "";
  shopDone = null;
  redrawBody();
}

// 상점 기기 창에 보낼 고른 값 — 고른 상품이 없으면 null(닫는다). 모델은 메인이 만든다 (src/view/device-shop.ts)
function shopDeviceBuild(): ShopDeviceInput | null {
  const item = shopPick && ui.view ? ui.view.shop.find((i) => i.id === shopPick) : undefined;
  if (!item) return null;
  return { productId: item.id, qty: shopQty, notice: shopNotice, done: shopDone, busy: shopBusy }; // 그림은 메인이 icon 열쇠로 붙인다
}

export function syncShopDevice(): void {
  shopLink.sync();
}

// 이전·다음 — 지금 탭(분류)의 상품 순서로 돈다. 포켓몬 탭은 지방·검색으로 좁힌 순서
export function stepShop(delta: -1 | 1): void {
  if (!shopPick || !ui.view) return;
  const list = hooksOf().stepRows(ui.view.shop);
  if (list.length < 2) return;
  const at = list.findIndex((i) => i.id === shopPick);
  const next = list[(at + delta + list.length) % list.length];
  if (!next) return;
  shopPick = next.id;
  shopQty = 1;
  shopNotice = "";
  shopDone = null;
  redrawBody();
  bodyEl.querySelector<HTMLElement>('#body [aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
}

// 기기 창에서 누른 단추 — 기기 창이 다른 상품을 보이던 때 누른 것은 버린다
export function onShopAction(action: ShopDeviceAction): void {
  if (!shopPick || action.productId !== shopPick) return;
  if (action.kind === "qty") {
    shopQty = action.qty;
    shopNotice = "";
    shopDone = null;
    syncShopDevice();
    return;
  }
  if (action.kind === "pool") {
    openAnyDialog({ kind: "pool", productId: shopPick, page: 0 });
    return;
  }
  void buyShop(shopPick);
}

// 사기 — 여러 개도 명령 하나다. 하나라도 못 사면 실행기가 전부 되돌린다
async function buyShop(id: string): Promise<void> {
  const item = ui.view?.shop.find((i) => i.id === id);
  if (!item || !ui.view || shopSending) return;
  const count = shopQty; // 메인이 바로잡은 수량 — 하나씩 사는 상품은 1 (src/view/device-shop.ts)
  shopSending = true;
  shopDone = null;
  const slow = setTimeout(() => {
    shopBusy = true;
    shopLink.sync(true); // 처리 중 점 표시는 보내는 중에도 보낸다
  }, 300);
  const ok = await sendCommand("shop.buy", id, count > 1 ? { count } : {}, { keepOpen: true });
  clearTimeout(slow);
  shopSending = false;
  shopBusy = false;
  shopNotice = ok ? "" : ui.notice;
  ui.notice = ""; // 실패 문구는 기기 창의 합계 상자에만 보인다
  if (ok) {
    shopQty = 1;
    // 산 결과 — 기기 창은 닫지 않고 합계 상자를 초록 결과로 바꾼다 (2026-10-02 사용자 결정, Figma 05 `Shop / Device / Egg · 구매 결과`).
    // 두 줄은 메인이 거래 앞뒤 화면 값으로 만들어 답에 싣는다 (src/view/result-lines.ts)
    shopDone = lastReplyOf()?.result ?? null;
  }
  syncShopDevice();
}

// 지금 고른 상품 — 탭이 칸 표시에 쓴다
export const shopPickOf = (): string | null => shopPick;
// 상점 탭을 떠난다 — 다음 그리기의 syncShopDevice 가 기기 창을 닫는다
export function leaveShop(): void {
  shopPick = null;
}
// 고른 상품이 목록에서 사라졌으면 놓는다 — 본문 맞추기
export function dropGoneShopPick(): void {
  if (shopPick && ui.view && !ui.view.shop.some((i) => i.id === shopPick)) shopPick = null;
}
