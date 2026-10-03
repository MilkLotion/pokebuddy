// 상점 기기 창 — 메인이 만들어 보낸 상품 하나를 그린다 (src/main/shop-window.ts). Figma 05 `Shop / Device / Tool`
// 틀은 가방 기기 창과 같다(item-face.ts). 가운데는 구매 칸(수량·합계). 수량·구매는 관리 창으로 돌려보낸다(관리 창이 명령을 보낸다)
import type { ShopDeviceView } from "../../shared/model/devices.js";
import { createDeviceFrame } from "./device-frame.js";
import { drawItemFace, goButtonEl, qtyRowEl } from "./item-face.js";
import { el } from "../ui/dom.js";

const api = window.pokebuddyShop;
const frame = createDeviceFrame({ api, windowName: "shop" });

function render(v: ShopDeviceView): void {
  // 구매 칸 — 수량(여러 개 살 수 있는 상품)과 합계 상자. 산 직후는 합계 상자가 초록, 실패는 빨강으로 바뀐다
  // 살 수 없어도 줄 구성은 그대로다 — 수량 단추와 구매 단추만 막는다 (2026-10-02 사용자 결정)
  const card = el("div", "buy-card");
  card.appendChild(el("div", "buy-label", "구매"));
  if (v.qty) card.appendChild(qtyRowEl(v.qty, (qty) => api.act({ productId: v.productId, kind: "qty", qty }), v.qty.cap < 1));
  const total = el("div", v.total.tone ? `total ${v.total.tone}` : "total");
  total.appendChild(el("strong", undefined, v.total.lead));
  if (v.total.line) total.appendChild(el("div", undefined, v.total.line));
  card.appendChild(total);
  const go = goButtonEl(v.buy.label, v.buy.disabled, v.buy.busy, () => api.act({ productId: v.productId, kind: "buy" }));
  drawItemFace(frame, { ...v, title: "상점" }, card, go, () => api.act({ productId: v.productId, kind: "pool" }));
}

frame.showWith((cb) => api.onShow(cb), render);
