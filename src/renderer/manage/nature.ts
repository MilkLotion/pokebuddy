// 설정창의 성격 변경 — 민트로 성격을 바꾼다. 화면에 보일지는 src/shared/features.ts NATURE_SHOWN (P10p)
// 왼쪽은 지금, 오른쪽은 바꾼 후다. 가운데에 민트 그림을 둔다 (Figma Detail / Nature Change).
// 민트는 한 종류다. 원작 25 성격 가운데 아무 성격이나 고른다. 지금 성격은 고를 수 없다 (2026-09-29 사용자 결정).
// 성격은 원작 성격표처럼 5×5 격자로 한 번에 보인다 — 스크롤 목록을 두지 않는다. 순서는 data/natures.json(원작 성격 번호 순)이다.
// `취소` 는 아무것도 바꾸지 않는다
import { numberText } from "../../shared/count-text.js";
import { buttonEl, el } from "../ui/dom.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, openAnyDialog } from "./dialog.js";
import { findPartySlot, petInView, ui } from "./state.js";

const MINT = "mint";

export function drawNature(petId: string, pick: string | undefined): void {
  const pet = petInView(petId);
  if (!pet || !ui.view) {
    closeDialog();
    return;
  }
  const picked = ui.view.natures.find((n) => n.id === pick && n.id !== pet.natureId);
  const slot = findPartySlot(petId);
  dialogEl.append(...dialogHead("성격을 바꿀까요?", `${pet.name} Lv.${pet.level} · ${slot != null ? `파티 ${slot + 1}번` : "박스"}`, { close: true }));
  const redraw = (next: string): void => openAnyDialog({ kind: "nature", petId, pick: next });

  const before = el("div", "nat-card");
  before.append(portraitOf(pet.look, pet.shiny, "portrait"), el("div", "name", pet.name), el("div", "note", pet.nature), el("div", "note", "지금"));

  const mid = el("div", "mint-mid");
  mid.append(iconOf(`item:${MINT}`, "thumb"), el("div", undefined, "→"));

  const after = el("div", "nat-card");
  after.append(portraitOf(pet.look, pet.shiny, "portrait"), el("div", "name", pet.name), el("div", picked ? "note picked" : "note", picked ? picked.name : "성격 고르기"), el("div", "note", "바꾼 후"));

  const row = el("div", "compare");
  row.append(before, mid, after);
  dialogEl.appendChild(row);

  // 성격표 — 5×5. 지금 성격 칸은 눌리지 않고 `지금` 을 붙인다. 고른 칸은 톤 배경
  const grid = el("div", "nature-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "바꿀 성격");
  for (const n of ui.view.natures) {
    const cell = buttonEl("nature-cell");
    const current = n.id === pet.natureId;
    cell.appendChild(el("span", undefined, n.name));
    if (current) cell.appendChild(el("span", "hint", "지금")); // 빈 줄을 두지 않는다 — 이름이 칸 가운데에 온다
    cell.disabled = current;
    cell.setAttribute("aria-pressed", String(n.id === picked?.id));
    cell.addEventListener("click", () => redraw(n.id));
    grid.appendChild(cell);
  }
  dialogEl.appendChild(grid);

  const have = ui.view.bag.find((b) => b.id === MINT)?.count ?? 0;
  // 안내 상자 자리는 고르기 전에도 잡아 둔다(보이지 않게) — 고를 때 창 높이가 늘어 위로 튀지 않게
  const info = el("div", picked ? "info-box" : "info-box reserve");
  if (!picked) info.setAttribute("aria-hidden", "true");
  if (have > 0 || !picked) info.append(el("div", undefined, "성격민트 1개를 씁니다"), el("div", "note", `가방에 ${numberText(have)}개 있어요 · 레벨·친밀도는 그대로`));
  else {
    const price = ui.view.shop.find((p) => p.id === MINT)?.price;
    info.append(el("div", undefined, "성격민트가 없어요"), el("div", "note", price != null ? `상점 도구 분류에서 ${price}P 에 살 수 있어요` : "상점에서 살 수 있어요"));
  }
  dialogEl.appendChild(info);

  const change = actionButtonEl("바꾸기", true, !picked || have === 0, () => {
    if (!picked) return;
    void sendCommand("bag.use", MINT, { petId, nature: picked.id }).then((ok) => {
      if (ok) openAnyDialog({ kind: "pet", petId });
    });
  });
  dialogEl.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), change)); // 단추 순서는 다른 모달과 같다(C-13 7번). 개체 상세 기기 창에서 열었다 — 닫으면 그 창이 그대로 있다
}
