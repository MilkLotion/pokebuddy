// 설정창의 가방 탭 — 분류 칩과 4열 도구 칸. 칸을 누르면 가방 기기 창이 뜬다 (P10s)
// Figma 05 `Bag / Base` `381:6555` — 분류 칩, 4열 도구 칸. 칸을 누르면 관리 창 옆에 가방 기기 창이 뜬다(아래 `가방 기기 창`).
// 여러 개 쓰기는 경험사탕·이상한사탕만 되고 한 거래다 (2026-09-27 사용자 결정 "수량 선택 + 최대", src/tx/handlers/items.ts useHandler)
import type { BagItemView, Snapshot } from "../../shared/model/snapshot.js";
import { numberText } from "../../shared/count-text.js";
import { buttonEl, el } from "../ui/dom.js";
import { iconOf } from "./art-cache.js";
import { bagPickOf, clearBagResult, pickBag } from "./bag-link.js";
import { bodyEl, redrawBody } from "./shell.js";
import { chipsEl, pageHeadEl } from "./widgets.js";
import { addTabTip } from "./tab-tips.js";

// 가방 분류 — 상점(SHOP_TABS)의 도구 분류와 같다. data/items.json 의 도구는 `도구`, data/evo-items.json 의 진화용 도구는 `진화`.
// `전체` 는 두지 않고 첫 탭 `도구` 를 연다 (2026-09-30 사용자 결정 "상점이랑 가방이랑 아이템분류가 달라. 가방쪽이 안맞는거같애.")
const BAG_TABS = [
  { id: "tool", label: "도구" },
  { id: "evolution", label: "진화" },
];
let bagFilter = "tool";

// 도구의 분류 — 상점과 같은 기준. evolution 은 data/evo-items.json 에 있는 도구 (src/tx/lists.ts isEvoItem)
function bagCategory(item: BagItemView): string {
  return item.evolution ? "evolution" : "tool";
}

// 기기 창의 이전·다음이 도는 순서 — 지금 분류의 도구
export function bagStepRows(bag: readonly BagItemView[]): BagItemView[] {
  return bag.filter((i) => bagCategory(i) === bagFilter);
}

function bagCard(item: BagItemView): HTMLElement {
  const card = buttonEl("bag-card");
  card.setAttribute("aria-pressed", String(item.id === bagPickOf()));
  const info = el("div", "info");
  info.append(el("div", "name", item.name), el("div", "qty", `×${numberText(item.count)}`)); // 천 단위 쉼표
  card.append(iconOf(item.icon, "thumb"), info);
  card.addEventListener("click", () => pickBag(item.id));
  return card;
}

export function drawBag(v: Snapshot): void {
  const head = pageHeadEl("가방");
  addTabTip(head, "bag");
  bodyEl.appendChild(head);
  if (!v.bag.length) {
    bodyEl.appendChild(el("div", "empty-note", "가방이 비었습니다."));
    return;
  }
  if (!BAG_TABS.some((t) => t.id === bagFilter)) bagFilter = BAG_TABS[0]?.id ?? "tool"; // 모르는 분류(옛 `all` 등)는 첫 탭으로
  bodyEl.appendChild(
    chipsEl(BAG_TABS, bagFilter, (id) => {
      bagFilter = id;
      clearBagResult();
      redrawBody();
    }),
  );
  const items = v.bag.filter((i) => bagCategory(i) === bagFilter);
  if (!items.length) bodyEl.appendChild(el("div", "empty-note", "이 분류의 도구가 없습니다."));
  else {
    const grid = el("div", "bag-grid");
    for (const item of items) grid.appendChild(bagCard(item));
    bodyEl.appendChild(grid);
  }
}
