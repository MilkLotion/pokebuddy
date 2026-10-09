// 기술 바꾸기 모달 — 배틀 파티 상세 기기 창의 기술 칸을 누르면 연다 (docs/specs/adventure.md "보유 기술", Figma 05 `15 모험` `Adventure / Move Pick`)
// (2026-10-10 사용자 "포켓몬 상세에서 기술을 누르면 기술목록 모달이 나오게", "내 기술 누르고 목록의 기술 누르거나 드래그드랍으로 기술 변경 가능하게")
//   왼쪽 기술 목록       고를 수 있는 기술 — 기본 2개 뒤에 후보 4개. 쓰는 중인 기술은 흐리고 `사용 중`. 진화 전 종은 기본 2개뿐이다
//   오른쪽 사용 중인 기술  1번·2번 칸, 사이에 순서 바꾸기(battle.moves), 아래에 고른 기술의 설명
//   내 칸을 누르면        그 칸을 고른다(톤 바탕). 처음은 기기 창에서 누른 칸이다
//   목록의 기술을 누르면   고른 칸을 그 기술로 바꾼다(battle.pick). 다른 칸에서 쓰는 중인 기술이면 두 칸의 순서를 바꾼다
//   목록의 기술을 끌어 칸에  그 칸을 그 기술로 바꾼다. 칸을 다른 칸에 끌어 놓으면 순서를 바꾼다
// 바꿀 때마다 바로 저장한다. `완료` 는 닫는다
import type { BattleSlotView, MoveView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { swapIconEl } from "../ui/line-icons.js";
import { movePillEl } from "../ui/move-pill.js";
import { iconOf } from "./art-cache.js";
import { hold } from "./box-state.js";
import { dropZone, startDrag } from "./box-move.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

let petId = "";
let target = 0; // 고른 사용 중인 기술 칸 — 목록의 기술을 누르면 여기를 바꾼다
let shown: string | null = null; // 설명 칸에 보이는 기술 — 없으면 고른 칸의 기술

// 모달을 새로 열 때 (registerDialog 의 enter)
export function startMovePick(id: string, slot: number): void {
  petId = id;
  target = slot === 1 ? 1 : 0;
  shown = null;
}

const pill = (m: MoveView): HTMLElement => movePillEl(m, "large", iconOf(`type:${m.typeId}`, "mp-icon"));

// 고른 칸(at)을 기술 id 로 바꾼다 — 다른 칸의 기술이면 순서 바꾸기
function put(slot: BattleSlotView, at: number, id: string): void {
  const cur = slot.moves.map((m) => m.id);
  if (cur.length < 2 || cur[at] === id) return;
  if (cur[1 - at] === id) {
    void sendCommand("battle.moves", petId, {}, { keepOpen: true });
    return;
  }
  const next = [...cur];
  next[at] = id;
  void sendCommand("battle.pick", petId, { moves: next }, { keepOpen: true });
}

function optionEl(slot: BattleSlotView, m: MoveView): HTMLElement {
  const used = slot.moves.some((u) => u.id === m.id);
  const row = buttonEl(used ? "mp-option used" : "mp-option");
  row.append(pill(m));
  const meta = el("div", "mp-meta");
  meta.appendChild(el("span", "mp-meta-text", m.meta));
  if (used) meta.appendChild(el("span", "mp-in-use", "사용 중"));
  row.appendChild(meta);
  row.setAttribute("aria-label", used ? `${m.name} · 사용 중` : `${m.name}을 ${target + 1}번 칸에`);
  row.addEventListener("click", () => {
    shown = m.id;
    put(slot, target, m.id);
    drawDialog();
  });
  if (!used) {
    row.addEventListener("pointerdown", (e) => startDrag(e, row, { pickMove: m.id }));
    row.addEventListener("dragstart", (e) => e.preventDefault()); // 그림의 브라우저 기본 끌기를 막는다
  }
  return row;
}

function slotEl(slot: BattleSlotView, at: number): HTMLElement {
  const m = slot.moves[at]!;
  const cell = buttonEl("mp-slot");
  cell.setAttribute("aria-pressed", String(at === target));
  cell.setAttribute("aria-label", `${at + 1}번 기술 ${m.name}`);
  cell.append(el("span", "mp-slot-no", `${at + 1}번`), pill(m));
  cell.addEventListener("click", () => {
    target = at;
    shown = null;
    drawDialog();
  });
  cell.addEventListener("pointerdown", (e) => startDrag(e, cell, { moveSlot: at }));
  cell.addEventListener("dragstart", (e) => e.preventDefault());
  // 놓기 — 목록의 기술은 이 칸에 넣고, 다른 칸은 순서를 바꾼다
  dropZone(cell, () => {
    const from = hold.drag;
    if (from && "pickMove" in from) {
      target = at;
      shown = from.pickMove;
      put(slot, at, from.pickMove);
    } else if (from && "moveSlot" in from && from.moveSlot !== at) void sendCommand("battle.moves", petId, {}, { keepOpen: true });
  });
  return cell;
}

export function drawMovePick(): void {
  const slot = ui.view?.battle.slots.find((s) => s.pet?.id === petId);
  const pet = slot?.pet;
  if (!slot || !pet || slot.moves.length < 2) {
    closeDialog();
    return;
  }
  const options = slot.options ?? slot.moves;
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, `기술 바꾸기 · ${pet.name}`));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);

  const list = el("div", "mp-list");
  list.appendChild(el("strong", "mp-label", "기술 목록"));
  for (const m of options) list.appendChild(optionEl(slot, m));
  if (options.length <= 2) list.appendChild(el("div", "mp-note", "진화하면 고를 수 있는 기술이 늘어나요"));

  const side = el("div", "mp-side");
  side.appendChild(el("strong", "mp-label", "사용 중인 기술"));
  side.appendChild(slotEl(slot, 0));
  const swapRow = el("div", "mp-swap-row");
  const swap = buttonEl("mp-swap", "", () => void sendCommand("battle.moves", petId, {}, { keepOpen: true }));
  swap.appendChild(swapIconEl());
  swap.title = "기술 순서 바꾸기";
  swap.setAttribute("aria-label", "기술 순서 바꾸기");
  swapRow.appendChild(swap);
  side.appendChild(swapRow);
  side.appendChild(slotEl(slot, 1));
  const focus = options.find((m) => m.id === shown) ?? slot.moves[target]!;
  const desc = el("div", "mp-desc");
  desc.appendChild(el("strong", undefined, focus.name));
  if (focus.text) desc.appendChild(el("div", "mp-desc-text", focus.text)); // 설명이 없는 기술은 이름만
  side.appendChild(desc);

  const body = el("div", "mp-body");
  body.append(list, side);
  const acts = el("div", "swap-acts");
  acts.append(el("span", "spacer"), actionButtonEl("완료", true, false, closeDialog));
  dialogEl.append(top, body, acts);
}
