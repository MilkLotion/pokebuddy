// 설정창의 박스 머리 메뉴와 박스 순서 모달 — 햄버거 단추(박스 순서·교환), 박스 타일 끌어 놓기 (P10 17)
import { buttonEl, el } from "../ui/dom.js";
import { boxUi, hold } from "./box-state.js";
import { dropZone, startDrag } from "./box-move.js";
import { sendCommand } from "./command.js";
import { closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";
import { loadTrade, tradeInProgress } from "./trade.js";
import { BOX_ICON, dialogCloseEl } from "./widgets.js";

// 박스 머리의 햄버거 단추 — 누르면 메뉴가 단추 아래에 뜬다. 메뉴는 떠 있는 층이라 본문을 밀지 않는다. 바깥을 누르면 닫힌다.
// 교환이 진행 중이면 단추 오른쪽 위에 점을 둔다 (2026-10-02 사용자 결정 "햄버거 버튼 두고, 그거 누르면 메뉴나오게"·"교환도 메뉴로")
export function boxMenuEl(): HTMLElement {
  const wrap = el("div", "box-menu");
  const toggle = buttonEl("icon-button box-menu-toggle");
  toggle.innerHTML = BOX_ICON.menu; // 고정 그림 — 사용자 값이 들어가지 않는다
  toggle.setAttribute("aria-label", "박스 메뉴");
  toggle.setAttribute("aria-expanded", String(boxUi.menuOpen));
  const dot = el("span", "dot");
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = !tradeInProgress();
  toggle.appendChild(dot);
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    boxUi.menuOpen = !boxUi.menuOpen;
    boxUi.sortOpen = false;
    redrawBody();
  });
  wrap.appendChild(toggle);
  if (!boxUi.menuOpen) return wrap;
  const menu = el("div", "sort-menu");
  menu.setAttribute("role", "menu");
  const item = (label: string, run: () => void): void => {
    const b = buttonEl("sort-item", label);
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      boxUi.menuOpen = false;
      redrawBody();
      run();
    });
    menu.appendChild(b);
  };
  item("박스 순서", () => openAnyDialog({ kind: "box-order" }));
  item("교환", () => {
    openAnyDialog({ kind: "trade" });
    void loadTrade();
  });
  wrap.appendChild(menu);
  return wrap;
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
      if (from && "box" in from && from.box !== box.id) void orderBox(from.box, i);
    });
    grid.appendChild(tile);
  });
  dialogEl.append(top, grid);
}

// 박스를 to 자리로 옮긴다 — 보던 박스는 옮긴 뒤에도 같은 박스다
async function orderBox(boxId: string, to: number): Promise<void> {
  const shown = ui.view?.boxes[boxUi.page]?.id;
  await sendCommand("box.order", boxId, { to });
  const at = ui.view?.boxes.findIndex((b) => b.id === shown) ?? -1;
  if (at >= 0 && at !== boxUi.page) {
    boxUi.page = at;
    redrawBody();
    drawDialog();
  }
}
