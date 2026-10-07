// 설정창의 상점 탭 — 분류 칩, 상품 줄·포켓몬 격자, 알에서 나오는 포켓몬 창 (P10r)
// 탭의 상태(분류·검색·지방·쪽·보는 방식)는 여기에 있다. 고른 상품과 기기 창은 shop-link.ts
// 종 목록이 정해진 알(단일 포켓몬 알·태고의돌)의 후보를 보인다 (2026-10-03 사용자 결정, worklog/records/egg-pool/egg-pool.md).
// 상점 기기 창의 `나오는 포켓몬` 줄이 연다. 칸은 도감 칸과 같다 — 얻은 종은 획득 칸, 못 얻은 종은 실루엣과 `???`(번호는 보인다).
// 한 쪽 15칸(5열 3줄)이라 알마다 창 높이가 같다 (Figma 03 `Egg Pool Panel`, 05 `Shop / Egg Pool Dialog`)
// 단일 포켓몬 알은 남은 종 수를, 태고의돌은 얻은 종 수를 센다 — 태고의돌은 얻은 종도 다시 나온다
import type { EggPoolView, ShopItemView, Snapshot } from "../../shared/model/snapshot.js";
import { pointText } from "../../shared/count-text.js";
import { buttonEl, el } from "../ui/dom.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { closeDialog, dialogEl, openAnyDialog } from "./dialog.js";
import { dexNoText, GRID_PAGE, gridPager, inDexRegion, loadView, pageOf, regionEl, saveView, scrollListAfterSwitch, switchView, viewToggle, type ViewMode } from "./grid-view.js";
import { findBarEl, matchesName, normQuery } from "./search.js";
import { bodyEl, redrawBody } from "./shell.js";
import { pickShop, shopPickOf } from "./shop-link.js";
import { ui } from "./state.js";
import { chipsEl, dialogCloseEl, pageHeadEl } from "./widgets.js";

// 상점 분류 — `전체` 는 두지 않는다. 처음 여는 탭은 첫 탭 `알` (2026-09-29 사용자 결정 "상점에 전체는 없애")
const SHOP_TABS = [
  { id: "egg", label: "알" },
  // 포켓몬 탭은 잠시 숨긴다 (2026-09-30 사용자 결정 "상점의 포켓몬 탭을 지금은 없애놔"). 다시 열려면 { id: "pokemon", label: "포켓몬" } 를 이 자리에 되돌린다
  { id: "tool", label: "도구" },
  { id: "evolution", label: "진화" },
  { id: "slot", label: "파티" }, // 파티 칸과 파티 프리셋 (2026-10-02 사용자 결정 "\"파티\" 로 상점 탭 이름 변경")
];
let shopFilter = "egg";
// 상점 포켓몬 격자 — 도감과 같은 지방·검색 (2026-09-29 사용자 결정 "도감처럼 격자 칸")
let shopQuery = "";
let shopRegion = "all";
let shopRegionOpen = false;
let shopPageNo = 0;
let shopView: ViewMode = loadView("shop");

// 지방 목록 — 바깥을 누르면 닫는다(설정창의 바깥 누르기 리스너)
export const isShopRegionOpen = (): boolean => shopRegionOpen;
export function closeShopRegion(): void {
  shopRegionOpen = false;
}
// 기기 창의 이전·다음이 도는 순서 — 지금 분류의 상품. 포켓몬 분류는 지방·검색으로 좁힌 순서
export function shopStepRows(shop: readonly ShopItemView[]): ShopItemView[] {
  const rows = shop.filter((i) => i.category === shopFilter);
  return shopFilter === "pokemon" ? shopPokemonShown(rows) : rows;
}

// 상점 줄의 그림 — 알은 알 그림(메인이 칠한다), 도구는 도구 그림. 칸 늘리기처럼 그림이 없는 상품은 빈 칸(icon 이 null)
// 포켓몬 상품은 두 방식 모두 격자 칸(shopCell)이라 줄로 그리지 않는다 (2026-09-30)
function shopThumb(item: ShopItemView): HTMLElement {
  return iconOf(item.icon, "thumb");
}

function shopRow(item: ShopItemView): HTMLElement {
  const card = buttonEl("row-card");
  card.appendChild(shopThumb(item));
  const body = el("div", "body");
  body.appendChild(el("div", "title", item.name));
  // 살 수 없어도 줄은 그대로다 — 문구를 바꾸면 줄 높이가 달라져 목록이 흔들린다 (2026-10-02 사용자 결정)
  if (item.note) body.appendChild(el("div", "note", item.note)); // 설명이 없는 상품은 이름 한 줄만
  // 줄 끝 › — 누르면 옆에 상점 기기 창이 뜬다 (Figma `Shop Layout` product 의 chevron)
  card.append(body, el("div", "price", pointText(item.price)), el("span", "chevron", "›"));
  // 살 수 없어도 누를 수 있다. 이유는 기기 창이 보여 준다. 고른 줄은 톤 배경
  card.setAttribute("aria-pressed", String(item.id === shopPickOf()));
  card.addEventListener("click", () => pickShop(item.id));
  if (item.id === "random") card.dataset.tut = "shop"; // 상점 튜토리얼이 밝히는 곳
  return card;
}

// 포켓몬 상품 칸 — 도감 칸(.dex-cell)에 가격 한 줄을 더한다. 누르면 상점 기기 창이 뜬다. 살 수 없는 이유는 기기 창이 보인다
function shopCell(item: ShopItemView): HTMLElement {
  const cell = buttonEl("dex-cell shop-cell");
  cell.dataset.slug = item.id;
  cell.append(el("div", "no", item.dex ? `#${dexNoText(item.dex, item.form, 4)}` : ""), portraitOf(item.id, false, "dot", "", true));
  cell.append(el("div", undefined, item.name), el("div", "price", pointText(item.price)));
  cell.setAttribute("aria-pressed", String(item.id === shopPickOf()));
  cell.addEventListener("click", () => pickShop(item.id));
  return cell;
}

// 포켓몬 상품 — 도감과 같은 지방·검색. 번호로 찾거나 이름으로 찾는다
function shopPokemonShown(items: ShopItemView[]): ShopItemView[] {
  const q = normQuery(shopQuery);
  return items.filter((i) => {
    const dex = i.dex ?? 0;
    if (!inDexRegion(shopRegion, dex, i.region)) return false;
    if (!q) return true;
    const m = /^(\d+)-(\d+)$/.exec(q);
    if (m) return dex === Number(m[1]) && i.form === Number(m[2]);
    return /^\d+$/.test(q) ? String(dex).startsWith(String(Number(q))) : matchesName(i.name, q);
  });
}

function shopGrid(items: ShopItemView[]): HTMLElement {
  const grid = el("div", "dex-grid");
  for (const item of items) grid.appendChild(shopCell(item));
  return grid;
}

export function drawShop(v: Snapshot): void {
  bodyEl.appendChild(pageHeadEl("상점"));
  bodyEl.appendChild(
    chipsEl(SHOP_TABS, shopFilter, (id) => {
      shopFilter = id;
      shopPageNo = 0;
      redrawBody();
    }),
  );
  if (!SHOP_TABS.some((t) => t.id === shopFilter)) shopFilter = SHOP_TABS[0]?.id ?? "egg"; // 모르는 분류(옛 `all` 등)는 첫 탭으로
  // 상점 튜토리얼은 알 탭의 랜덤알 카드(data-tut="shop")를 가리킨다 — 그동안은 알 탭을 연다. 코치마크가 막아 다른 칩은 누를 수 없다
  if (v.tutorial === "shop") shopFilter = "egg";
  const rows = v.shop.filter((i) => i.category === shopFilter);
  if (!rows.length) {
    bodyEl.appendChild(el("div", "empty-note", shopFilter === "pokemon" ? "아직 파는 포켓몬이 없습니다." : "파는 것이 없습니다."));
    return;
  }

  // 포켓몬 탭 — 도감 같은 격자. 지방·검색으로 좁힌다
  if (shopFilter === "pokemon") {
    const bar = el("div", "search-row");
    bar.appendChild(
      regionEl(shopRegion, shopRegionOpen, (open) => (shopRegionOpen = open), (id) => {
        shopRegion = id;
        shopPageNo = 0;
      }),
    );
    bar.appendChild(
      findBarEl({
        key: "shop",
        value: shopQuery,
        placeholder: "이름 또는 번호 검색",
        onSearch: (q) => {
          if (q === shopQuery) return; // 같은 말 — 다시 그리지 않는다
          shopQuery = q;
          shopPageNo = 0;
          redrawBody();
        },
      }),
    );
    bar.appendChild(
      viewToggle(shopView, (mode) => {
        shopPageNo = switchView("shop", shopView, mode, shopPageNo);
        shopView = mode;
        saveView("shop", mode);
        redrawBody();
      }),
    );
    bodyEl.appendChild(bar);
    const found = shopPokemonShown(rows);
    if (!found.length) {
      bodyEl.appendChild(el("div", "empty-note", normQuery(shopQuery) ? "검색 결과 없음" : "해당하는 포켓몬이 없습니다."));
      return;
    }
    // 스크롤 방식 — 쪽 방식과 같은 칸 격자를 넘김 줄 없이 전부. 도감 스크롤과 같다 (2026-09-30 사용자 결정, Figma 05 `967:22565`).
    // 화면 밖 칸은 CSS content-visibility 로 그리기를 미루고, 초상은 보이는 칸만 받는다
    if (shopView === "list") {
      const grid = shopGrid(found);
      bodyEl.appendChild(grid);
      scrollListAfterSwitch("shop", grid);
      return;
    }
    const shown = pageOf(found, shopPageNo);
    shopPageNo = shown.page;
    bodyEl.appendChild(
      gridPager(shown.page, shown.pages, (page) => {
        shopPageNo = page;
        redrawBody();
      }),
    );
    bodyEl.appendChild(shopGrid(shown.items));
    return;
  }

  // 그 밖의 탭 — 상품 줄
  const list = el("div", "rows");
  for (const item of rows) list.appendChild(shopRow(item));
  bodyEl.appendChild(list);
}

function poolCount(pool: EggPoolView): string {
  const total = pool.entries.length;
  const got = pool.entries.filter((e) => e.obtained).length;
  return pool.single ? `${total}종 중 ${total - got}종 남음` : `${total}종 중 ${got}종 얻음`;
}

export function drawPool(productId: string, page: number): void {
  const item = ui.view?.shop.find((i) => i.id === productId);
  const pool = item?.pool;
  if (!item || !pool) {
    closeDialog();
    return;
  }
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, `${item.name}에서 나오는 포켓몬`));
  titles.appendChild(el("p", undefined, `${poolCount(pool)} · ${pool.single ? "얻은 포켓몬은 다시 나오지 않아요" : "얻은 포켓몬도 다시 나와요"}`));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const shown = pageOf(pool.entries, page, GRID_PAGE);
  const grid = el("div", "dex-grid egg-pool-grid");
  for (const e of shown.items) {
    const cell = el("div", e.obtained ? "dex-cell dex-box" : "dex-cell dex-box locked");
    cell.append(portraitOf(e.slug, false, "dot", "", true), el("div", "who", e.obtained ? e.name : "???"), el("div", "no", `#${dexNoText(e.dex, e.form, 4)}`));
    if (e.obtained) {
      const got = el("span", "got");
      got.title = "획득";
      got.setAttribute("role", "img");
      got.setAttribute("aria-label", got.title);
      cell.appendChild(got);
    }
    grid.appendChild(cell);
  }
  // 마지막 쪽이 덜 차도 격자 높이는 세 줄이다 — 쪽을 넘겨도 창 높이가 같다
  for (let i = shown.items.length; i < GRID_PAGE; i++) grid.appendChild(el("div", "dex-cell dex-box blank"));
  dialogEl.append(top, grid, gridPager(shown.page, shown.pages, (to) => openAnyDialog({ kind: "pool", productId, page: to })));
}
