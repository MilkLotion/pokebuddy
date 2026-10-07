// 설정창의 모험 탭 — 탐험·배틀 칩, 가져오기·배틀 시작, 배틀 파티 6칸 (docs/specs/adventure.md "모험 탭", "배틀 파티")
// 탐험 칩과 배틀 시작은 누르지 못한다 — 탐험과 배틀은 아직 없다. 탭은 배틀 칩으로 열린다
// 카드는 바탕화면 파티 카드에서 레벨·친밀도·만복도를 뺀 모양이다. 그 자리에 작은 기술 칸 두 줄
// Figma 05 `15 모험` `Adventure / Battle Party` `1662:1187`, 카드는 02 `Adventure Slot Card` `1659:277`, 머리는 02 `Adventure Header` `1659:124`
import type { BattleSlotView, Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { genderIcon } from "../ui/gender-icon.js";
import { plusIconEl } from "../ui/line-icons.js";
import { movePillEl } from "../ui/move-pill.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { battleShown, openBattleDevice } from "./battle-link.js";
import { sendCommand } from "./command.js";
import { openAnyDialog } from "./dialog.js";
import { bodyEl, redrawBody } from "./shell.js";
import { pageHeadEl, segmentedEl } from "./widgets.js";

const SOON = "아직 준비 중이에요";
let menuSlot: number | null = null; // 우클릭 메뉴가 열린 칸

// 바깥을 눌렀다 — 열린 메뉴를 닫는다. 닫았으면 참 (manage.ts 의 바깥 누르기)
export function closeAdventureMenu(): boolean {
  if (menuSlot == null) return false;
  menuSlot = null;
  return true;
}

const pickSlot = (slot: number): void => openAnyDialog({ kind: "battle-pick", slot, page: 0 });

// 든 칸의 우클릭 메뉴 — 바꾸기·빼기
function slotMenu(slot: number): HTMLElement {
  const menu = el("div", "sort-menu battle-menu");
  menu.setAttribute("role", "menu");
  const item = (label: string, run: () => void): HTMLElement => {
    const b = buttonEl("sort-item", label);
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      menuSlot = null;
      run();
    });
    return b;
  };
  menu.append(
    item("바꾸기", () => pickSlot(slot)),
    item("빼기", () => void sendCommand("battle.clear", "", { slotIndex: slot })),
  );
  return menu;
}

function petCard(slot: BattleSlotView): HTMLElement {
  const pet = slot.pet!;
  const card = buttonEl("slot battle-card");
  const body = el("div", "battle-body");
  body.appendChild(portraitOf(pet.look, pet.shiny, "portrait"));
  const info = el("div", "info");
  // 이름 · 성별 · 이로치 — 레벨은 두지 않는다. 배틀은 50레벨로 계산한다
  const top = el("div", "top");
  top.appendChild(el("div", "name", pet.name));
  const sex = genderIcon(pet.gender, 16);
  if (sex) top.appendChild(sex);
  if (pet.shiny) top.appendChild(shinyIcon(16));
  info.appendChild(top);
  const tags = el("div", "tags");
  pet.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, pet.typeIds[i])));
  info.appendChild(tags);
  // 기술 두 줄 — 칸 폭은 줄의 70%. 첫째는 왼쪽, 둘째는 오른쪽에 붙인다
  const moves = el("div", "battle-moves");
  for (const m of slot.moves) moves.appendChild(movePillEl(m, "small", iconOf(`type:${m.typeId}`, "mp-icon")));
  info.appendChild(moves);
  body.appendChild(info);
  card.appendChild(body);
  if (slot.blocked) {
    card.classList.add("blocked");
    const why = el("span", "battle-blocked", slot.blocked);
    card.appendChild(why);
  }
  if (slot.index === battleShown()) card.classList.add("selected"); // 옆 기기 창에 떠 있는 칸 — 옅은 바탕만
  card.dataset.pet = pet.id;
  card.title = slot.blocked ? `${pet.name} · ${slot.blocked}` : pet.name;
  card.addEventListener("click", () => openBattleDevice(slot.index));
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menuSlot = slot.index;
    redrawBody();
  });
  return card;
}

function blankCard(slot: BattleSlotView): HTMLElement {
  const card = buttonEl("slot blank");
  const icon = el("span", "blank-icon");
  icon.appendChild(plusIconEl());
  // 글자는 Figma 02 `Adventure Slot Card` State=Empty 그대로
  card.append(icon, el("strong", undefined, "빈 칸"), el("small", undefined, "박스에서 배치"));
  card.addEventListener("click", () => pickSlot(slot.index));
  return card;
}

export function drawAdventure(v: Snapshot): void {
  const top = pageHeadEl("모험");
  const mode = segmentedEl(
    [
      { id: "explore", label: "탐험" },
      { id: "battle", label: "배틀" },
    ],
    "battle",
    () => undefined,
  );
  const explore = mode.querySelector("button");
  if (explore) {
    explore.disabled = true;
    explore.title = SOON;
  }
  top.appendChild(mode);
  const acts = el("div", "head-acts");
  const load = buttonEl("act", "가져오기");
  load.addEventListener("click", () => openAnyDialog({ kind: "preset-overview", battle: true }));
  const start = buttonEl("act primary", "배틀 시작");
  start.disabled = true; // 배틀은 아직 없다 — 출전 불가가 없어도 막는다 (v.battle.canStart)
  start.title = SOON;
  acts.append(load, start);
  top.appendChild(acts);
  bodyEl.appendChild(top);
  const grid = el("div", "grid");
  for (const slot of v.battle.slots) {
    const card = slot.pet ? petCard(slot) : blankCard(slot);
    if (slot.pet && menuSlot === slot.index) {
      const wrap = el("div", "battle-slot");
      wrap.append(card, slotMenu(slot.index));
      grid.appendChild(wrap);
    } else grid.appendChild(card);
  }
  bodyEl.appendChild(grid);
}
