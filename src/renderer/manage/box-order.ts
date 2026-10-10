// 설정창의 박스 머리 메뉴와 박스 순서 모달 — 햄버거 단추(교체·박스 순서·교환·중복 팔기), 박스 타일 끌어 놓기 (P10 17)
import { buttonEl, el } from "../ui/dom.js";
import { boxUi, hold } from "./box-state.js";
import { dropZone, startDrag } from "./box-move.js";
import { sendCommand } from "./command.js";
import { closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import { openSwap } from "./party-swap.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";
import { loadTrade, tradeInProgress } from "./trade-state.js";
import { dialogCloseEl, headMenuEl } from "./widgets.js";

// 박스 머리의 햄버거 단추 — 누르면 메뉴가 단추 아래에 뜬다. 메뉴는 떠 있는 층이라 본문을 밀지 않는다. 바깥을 누르면 닫힌다.
// 교환이 진행 중이면 단추 오른쪽 위에 점을 둔다 (2026-10-02 사용자 결정 "햄버거 버튼 두고, 그거 누르면 메뉴나오게"·"교환도 메뉴로")
// 모양과 여닫기는 공용 머리 메뉴(widgets.ts headMenuEl)다
export function boxMenuEl(): HTMLElement {
  return headMenuEl({
    cls: "box-menu",
    label: "박스 메뉴",
    open: boxUi.menuOpen,
    dot: tradeInProgress(),
    toggle: () => {
      boxUi.menuOpen = !boxUi.menuOpen;
      boxUi.sortOpen = false;
      redrawBody();
    },
    pick: () => {
      boxUi.menuOpen = false;
      redrawBody();
    },
    items: [
      // 교체는 파티 탭 메뉴의 `교체` 와 같은 교체 화면을 연다 (2026-10-04 사용자 결정 "박스에도 교체 추가. 햄버거 버튼에 교체 추가", Figma `Dropdown Menu` Kind=Box `1362:95`)
      ["교체", () => openSwap()],
      ["박스 순서", () => openAnyDialog({ kind: "box-order" })],
      [
        "교환",
        () => {
          openAnyDialog({ kind: "trade" });
          void loadTrade();
        },
      ],
      // 중복 팔기 — 같은 종에서 한 마리를 남기고 나머지를 한 번에 판다 (2026-10-05 사용자 결정, Figma 05 `Box / Sell Duplicates`)
      ["중복 팔기", () => openAnyDialog({ kind: "sell-dup" })],
    ],
  });
}

// 박스 순서 모달 — 박스 타일을 한 줄에 4개씩 보인다. 타일은 이름과 사용 칸 수다. 지금 보는 박스는 옅은 바탕이다.
// 타일을 끌어 다른 타일에 놓으면 그 자리로 옮긴다(box.order). 사이의 박스는 한 칸씩 밀린다. 타일을 누르면 그 박스로 간다
// (2026-10-02 사용자 결정 "a로 하자."·"한줄에 4개 들어가게", Figma 05 `Box / Order Modal`)
export function drawBoxOrder(): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "박스 순서"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const grid = el("div", "box-order-grid scroll");
  v.boxes.forEach((box, i) => {
    const tile = buttonEl(i === boxUi.page ? "box-tile on" : "box-tile");
    tile.title = box.name;
    tile.append(el("span", "tile-name", box.name), el("span", "tile-count", `${box.used} / ${box.size}`));
    tile.addEventListener("click", () => {
      boxUi.page = i;
      boxUi.note = "";
      closeDialog();
      redrawBody();
    });
    tile.addEventListener("pointerdown", (e) => startDrag(e, tile, { box: box.id }));
    tile.addEventListener("dragstart", (e) => e.preventDefault());
    dropZone(tile, () => {
      const from = hold.drag;
      if (from && "box" in from && from.box !== box.id) void orderBox(from.box, i, tile);
    });
    grid.appendChild(tile);
  });
  dialogEl.append(top, grid);
}

// 박스를 to 자리로 옮긴다 — 보던 박스는 옮긴 뒤에도 같은 박스다
async function orderBox(boxId: string, to: number, busyOn?: HTMLElement): Promise<void> {
  const shown = ui.view?.boxes[boxUi.page]?.id;
  await sendCommand("box.order", boxId, { to }, busyOn ? { busyOn } : {});
  const at = ui.view?.boxes.findIndex((b) => b.id === shown) ?? -1;
  if (at >= 0 && at !== boxUi.page) {
    boxUi.page = at;
    redrawBody();
    drawDialog();
  }
}
