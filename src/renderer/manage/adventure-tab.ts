// 설정창의 모험 탭 — 탐험·배틀 칩, 가져오기·배틀 시작, 배틀 파티 6칸 (docs/specs/adventure.md "모험 탭", "배틀 파티")
// 탐험 칩은 누르지 못한다 — 탐험은 아직 없다. 탭은 배틀 칩으로 열린다. `배틀 시작`은 상대 고르기 모달을 연다(배틀 파티가 있고 출전 불가가 없을 때)
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
import { dropZone, startDrag } from "./box-move.js";
import { hold } from "./box-state.js";
import { sendCommand } from "./command.js";
import { openAnyDialog } from "./dialog.js";
import { openBattleOpponent } from "./battle-opponent.js";
import { askBattleMenu } from "./pet-menu.js";
import { bodyEl, redrawBody } from "./shell.js";
import { pageHeadEl, segmentedEl } from "./widgets.js";

const SOON = "아직 준비 중이에요";
const pickSlot = (slot: number): void => openAnyDialog({ kind: "battle-pick", slot });

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
    askBattleMenu(slot.index);
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
  start.disabled = !v.battle.canStart; // 비었거나 출전 불가가 있으면 막는다 (docs/specs/adventure.md "출전 불가")
  start.addEventListener("click", () => openBattleOpponent(() => openAnyDialog({ kind: "battle-opponent" })));
  acts.append(load, start);
  top.appendChild(acts);
  bodyEl.appendChild(top);
  const grid = el("div", "grid");
  for (const slot of v.battle.slots) {
    const card = slot.pet ? petCard(slot) : blankCard(slot);
    // 칸 옮기기 — 파티 탭과 같은 포인터 끌기(startDrag). 빈 칸에 놓으면 옮기고, 개체 칸에 놓으면 맞바꾼다
    dropZone(card, () => {
      const from = hold.drag;
      if (from && "battleSlot" in from && from.battleSlot !== slot.index) void sendCommand("battle.move", "", { slotIndex: from.battleSlot, toSlot: slot.index });
    });
    if (slot.pet) {
      card.addEventListener("pointerdown", (e) => startDrag(e, card, { battleSlot: slot.index }));
      card.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다
    }
    grid.appendChild(card);
  }
  bodyEl.appendChild(grid);
}
