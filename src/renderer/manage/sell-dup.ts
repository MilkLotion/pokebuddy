// 설정창의 중복 팔기 모달 — 박스 머리 메뉴의 `중복 팔기` (2026-10-05, docs/specs/game.md "중복 팔기")
import { pointText } from "../../shared/count-text.js";
import { el } from "../ui/dom.js";
import { boxSlot } from "./box-tab.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, openAnyDialog } from "./dialog.js";
import { petInView, ui } from "./state.js";

// 중복 팔기 — 후보 칸을 박스 칸 모양(Compact)으로 보인다. 팔 칸은 톤 배경, 누르면 판매에서 빠져 흰 칸이 된다.
// 바닥 줄은 마릿수와 받는 포인트. 하나도 안 남으면 `팔기` 를 끈다. 명령 하나(pet.sell.many)로 한 거래에서 판다
// (2026-10-05 사용자 결정 "이런느낌으로 가보자", Figma 05 `Box / Sell Duplicates` · 03 `Sell Duplicates Body`)
export function drawSellDuplicates(off: string[]): void {
  const list = (ui.view?.sellDuplicates ?? []).filter((c) => petInView(c.petId));
  const picked = list.filter((c) => !off.includes(c.petId));
  const earned = picked.reduce((sum, c) => sum + c.price, 0);
  dialogEl.append(...dialogHead("중복 팔기", ""));
  const body = el("div", "sell-dup-body");
  if (list.length === 0) {
    body.appendChild(el("p", "hint", "팔 수 있는 중복 포켓몬이 없어요."));
  } else {
    body.appendChild(el("p", "hint", "같은 종에서 한 마리씩 남기고 골랐어요. 칸을 누르면 판매에서 빠져요."));
    const grid = el("div", "sell-dup-grid");
    for (const c of list) {
      const pet = petInView(c.petId);
      if (!pet) continue;
      const out = off.includes(c.petId);
      const cell = boxSlot(pet, () => openAnyDialog({ kind: "sell-dup", off: out ? off.filter((id) => id !== c.petId) : [...off, c.petId] }));
      cell.classList.toggle("selected", !out);
      cell.setAttribute("aria-pressed", String(!out));
      grid.appendChild(cell);
    }
    body.append(grid, el("p", "sum", `${picked.length}마리 · 받는 ${pointText(earned)}`));
  }
  const go = actionButtonEl(`${picked.length}마리 팔기`, true, picked.length === 0, () => void sendCommand("pet.sell.many", "", { petIds: picked.map((c) => c.petId) }));
  dialogEl.append(body, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), go));
}
