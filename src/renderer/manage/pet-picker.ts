// 개체 고르기판 — `◀ ▶` 로 쪽(파티·프리셋·박스)을 넘기며 6열 칸에서 개체를 고른다.
// 교환의 보낼 포켓몬(trade-cards.ts)과 배틀 파티 칸의 개체 고르기(battle-pick.ts)가 같이 쓴다 (docs/specs/adventure.md "배틀 파티")
// 칸은 정사각 64, 칸 영역은 5줄 높이로 고정해 넘겨도 창 높이가 그대로다. 고를 수 없는 칸은 흐리게 막는다.
// 모양은 Figma 03 `Trade Dialog` `State=Offer` 의 고르기판, 배틀 쪽은 03 `Battle Pet Picker` `1716:5299`
import type { PetView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import { wrapPage } from "./grid-view.js";

export interface PickerPage {
  name: string; // 넘김 가운데 글자 — "파티" · "프리셋 1" · "박스 1"
  slots: (PetView | null)[]; // 빈 칸은 null
}

export interface PickerCell {
  disabled?: boolean;
  off?: boolean; // 흐리게 — 고를 수 없는 까닭이 있는 칸
  title?: string;
  pressed?: boolean; // 지금 고른 칸
  pick: () => void;
}

export interface PetPicker {
  title: string; // 머리 왼쪽 — "보낼 포켓몬" · "넣을 포켓몬"
  pages: PickerPage[];
  page: number;
  setPage: (page: number) => void; // 넘긴 뒤 다시 그리는 것은 부르는 쪽이 한다
  cell: (pet: PetView) => PickerCell;
}

export function petPickerEl(p: PetPicker): HTMLElement {
  const box = el("div", "trade-pick");
  const page = p.pages[p.page] ?? p.pages[0];
  const slots = page?.slots ?? [];
  const pager = el("div", "pager trade-pager");
  const prev = buttonEl("", "◀");
  prev.setAttribute("aria-label", "앞 판");
  prev.addEventListener("click", () => p.setPage(wrapPage(p.page - 1, p.pages.length)));
  const next = buttonEl("", "▶");
  next.setAttribute("aria-label", "다음 판");
  next.addEventListener("click", () => p.setPage(wrapPage(p.page + 1, p.pages.length)));
  const used = slots.filter((x) => x != null).length;
  pager.append(prev, el("span", "label", page?.name ?? ""), next, el("span", "used", `${used} / ${slots.length}`));
  const head = el("div", "trade-pick-head");
  head.append(el("strong", undefined, p.title), pager);
  box.appendChild(head);
  const grid = el("div", "trade-grid");
  for (const pet of slots) {
    if (!pet) {
      grid.appendChild(el("div", "cell blank trade-cell"));
      continue;
    }
    const c = p.cell(pet);
    const b = buttonEl("cell trade-cell");
    b.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", `Lv.${pet.level}`));
    if (pet.shiny) b.appendChild(shinyIcon(10));
    b.disabled = c.disabled === true;
    if (c.off) b.classList.add("off");
    if (c.title) b.title = c.title;
    b.setAttribute("aria-pressed", String(c.pressed === true));
    b.addEventListener("click", c.pick);
    grid.appendChild(b);
  }
  box.appendChild(grid);
  return box;
}
