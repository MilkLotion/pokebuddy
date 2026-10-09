// 파티 교체 모달 — 왼쪽은 포켓몬 고르기 판(pet-box-panel.ts, 배틀 파티 교체·교환과 같다), 오른쪽은 지금 프리셋의 파티 6칸 세로 한 줄
// (2026-10-09 사용자 "기존에 교체하면 박스로 이동 + 교체기기가 뜨던거였잖아. 원래 이느낌이아니었거든", Figma 05 `02 파티` `Party / Swap Modal`)
// 여는 곳: 파티 탭 머리 메뉴의 `교체`, 빈 파티 칸, 박스 머리 메뉴의 `교체`, 포켓몬 메뉴의 `교체`(그 개체를 찾아 둔다). 고치는 프리셋은 파티 탭에서 고른 프리셋이다
//   오른쪽 칸을 누르면          그 칸을 고른다(톤 바탕). 처음은 첫 빈 칸이다
//   판의 개체를 누르면           고른 파티 칸에 넣는다 — 박스 개체는 빈 칸이면 배치(party.place), 개체 칸이면 맞바꾼다(party.swap).
//                               다른 프리셋 개체는 데려온다(party.pull, 사용자 "다른 프리셋에서도 끌어오기")
//   박스의 빈 칸을 누르면        고른 파티 칸의 개체를 그 칸에 보관한다(party.keep). 고른 칸이 비었으면 누를 수 없다
//   모두 박스로 · 완료           지금 파티를 모두 보관한다 · 닫는다 (사용자 "모두 박스로, 모두 빼기, 완료 + 검색")
// 끌어 놓기는 없다 — 누르기로만 바꾼다(2026-10-10 사용자 "파티교체에 드래그드랍 막고"). 파티 칸 순서는 파티 탭에서 끌어 바꾼다
// 지금 프리셋에 든 개체는 판의 프리셋 쪽에서 흐리고 고르지 못한다. 바꿀 때마다 바로 저장한다
import type { PetView, SlotView, Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { lockIconEl } from "../ui/line-icons.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import { focusPanel, panelPages, petBoxPanelEl, resetPanel, type PanelAt } from "./pet-box-panel.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

const PANEL_KEY = "party-swap";
let target = 0; // 고른 파티 칸

// 교체 모달을 연다 — focus 는 포켓몬 메뉴의 `교체` 로 연 개체. 박스·다른 프리셋에 있으면 판을 그 쪽으로 넘겨 그 칸을 강조하고, 파티에 있으면 그 칸을 고른다
export function openSwap(focus?: string): void {
  openAnyDialog({ kind: "swap", ...(focus ? { focus } : {}) });
}

// 모달을 새로 열 때 (registerDialog 의 enter)
export function startSwap(focus: string | undefined): void {
  resetPanel(PANEL_KEY);
  const v = ui.view;
  if (!v) return;
  const empty = v.party.slots.find((s) => s.state === "empty");
  target = empty?.index ?? 0;
  if (!focus) return;
  const inParty = v.party.slots.find((s) => s.pet?.id === focus);
  if (inParty) {
    target = inParty.index;
    return;
  }
  const page = panelPages(v).findIndex((p) => (p.kind === "box" ? p.slots.some((x) => x?.id === focus) : p.presets.some((pr) => pr.slots.some((s) => s.pet?.id === focus))));
  if (page >= 0) focusPanel(PANEL_KEY, page, focus);
}

const send = (cmd: string, petId: string, args: Record<string, unknown>): void => {
  void sendCommand(cmd, petId, args, { keepOpen: true });
};

// 판의 개체가 어디 있는가 — 박스면 box, 지금 프리셋이 아닌 프리셋이면 preset
function placeOf(v: Snapshot, petId: string): "box" | "preset" | null {
  if (v.boxes.some((b) => b.slots.some((p) => p?.id === petId))) return "box";
  if (v.party.presets.some((p) => p.index !== v.party.preset.index && p.slots.some((s) => s.pet?.id === petId))) return "preset";
  return null;
}

// 판의 개체를 파티 칸에 넣는다 — 박스 개체는 배치·맞바꾸기, 다른 프리셋 개체는 데려오기
function bring(v: Snapshot, petId: string, slot: SlotView): void {
  if (slot.state === "locked") return;
  const where = placeOf(v, petId);
  if (where === "box") send(slot.pet ? "party.swap" : "party.place", petId, { slotIndex: slot.index });
  else if (where === "preset") send("party.pull", petId, { slotIndex: slot.index });
}

function slotCell(v: Snapshot, s: SlotView): HTMLElement {
  if (s.state === "locked") {
    const cell = el("div", "pp-blank locked swap-locked");
    const icon = el("span", "blank-icon");
    icon.appendChild(lockIconEl());
    cell.appendChild(icon);
    cell.title = "잠긴 칸";
    return cell;
  }
  const pet = s.pet;
  const cell = buttonEl(pet ? "cell pp-cell" : "cell blank pp-cell");
  cell.setAttribute("aria-pressed", String(s.index === target));
  cell.setAttribute("aria-label", `파티 ${s.index + 1}번 칸`);
  if (pet) {
    cell.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", `Lv.${pet.level}`));
    if (pet.shiny) cell.appendChild(shinyIcon(10));
    cell.title = `${pet.name} Lv.${pet.level}`;
    cell.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다
  }
  cell.addEventListener("click", () => {
    target = s.index;
    drawDialog();
  });
  return cell;
}

export function drawSwap(): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const active = v.party.preset.index;
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "파티 교체"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const slotOf = (index: number): SlotView | undefined => v.party.slots[index];
  const panel = petBoxPanelEl({
    key: PANEL_KEY,
    view: v,
    cell: (pet: PetView, at: PanelAt) => {
      const mine = at.kind === "preset" && at.preset === active;
      const slot = slotOf(target);
      return {
        disabled: mine, // 처리 중 막기는 sendCommand 가 한다 — 칸에 굳혀 두면 명령 뒤 다시 그린 칸이 계속 막힌다
        off: mine,
        ...(mine ? { title: `${pet.name} · 지금 파티에 있어요` } : {}),
        pick: () => {
          if (slot) bring(v, pet.id, slot);
        },
      };
    },
    // 고른 칸에 개체가 있으면 박스의 빈 칸을 눌러 그 칸에 보관 (2026-10-10 사용자 "우측프리셋에 있는 포켓몬을 누르고 박스의 빈칸을 눌러도 빈칸으로 안가져")
    blank: (at) => {
      const pet = slotOf(target)?.pet;
      return at.kind === "box" && pet ? () => send("party.keep", pet.id, { toBoxId: at.boxId, toSlot: at.slot }) : null;
    },
  });
  const side = el("div", "swap-side");
  side.appendChild(el("div", "swap-side-name", v.party.preset.name));
  const slots = el("div", "swap-side-slots");
  for (const s of v.party.slots) slots.appendChild(slotCell(v, s));
  side.appendChild(slots);
  const body = el("div", "swap-body");
  body.append(panel, side);
  const pets = v.party.slots.flatMap((s) => (s.pet ? [s.pet.id] : []));
  const keepAll = actionButtonEl("모두 박스로", false, pets.length === 0, () => {
    void (async () => {
      for (const id of pets) if (!(await sendCommand("party.keep", id, {}, { keepOpen: true }))) break;
    })();
  });
  const done = actionButtonEl("완료", true, false, closeDialog);
  const acts = el("div", "swap-acts");
  acts.append(keepAll, el("span", "spacer"), done);
  dialogEl.append(top, body, acts);
}
