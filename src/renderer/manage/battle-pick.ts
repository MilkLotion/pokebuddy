// 배틀 파티 칸에 넣을 개체 고르기 모달 — 교환의 보낼 포켓몬 고르기판(pet-picker.ts)을 같이 쓴다.
// 쪽은 파티 프리셋(번호 순) → 박스 1 → 박스 2 … 다. 다른 칸에 이미 든 개체는 흐리고 고르지 못한다 (docs/specs/adventure.md "배틀 파티")
// Figma 05 `15 모험` `Adventure / Pick Battle Pet` `1718:5386`, 본문은 03 `Battle Pet Picker` `1716:5299`
import { el } from "../ui/dom.js";
import { sendCommand } from "./command.js";
import { closeDialog, dialogEl, openAnyDialog } from "./dialog.js";
import { petPickerEl, type PickerPage } from "./pet-picker.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

export function drawBattlePick(slot: number, page: number): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const pages: PickerPage[] = [
    ...v.party.presets.map((p) => ({ name: p.name, slots: p.slots.map((s) => s.pet ?? null) })),
    ...v.boxes.map((b) => ({ name: b.name, slots: b.slots })),
  ];
  const inBattle = new Map<string, number>();
  for (const s of v.battle.slots) if (s.pet) inBattle.set(s.pet.id, s.index);
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, `배틀 파티 ${slot + 1}번 칸`));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const picker = petPickerEl({
    title: "넣을 포켓몬",
    pages,
    page: Math.min(page, pages.length - 1),
    setPage: (p) => openAnyDialog({ kind: "battle-pick", slot, page: p }),
    cell: (pet) => {
      const at = inBattle.get(pet.id);
      const here = at === slot;
      const other = at != null && !here;
      return {
        disabled: other || ui.busy,
        off: other,
        ...(other ? { title: `배틀 파티 ${at + 1}번 칸에 있어요` } : {}),
        pressed: here,
        pick: () => {
          if (here) {
            closeDialog();
            return;
          }
          void sendCommand("battle.set", "", { slotIndex: slot, petId: pet.id }).then((ok) => ok && closeDialog());
        },
      };
    },
  });
  dialogEl.append(top, picker);
}
