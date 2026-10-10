// 배틀 고르기 모달 — 모험 탭의 `배틀 시작` 이 연다. 랜덤 배틀·친선 배틀 두 줄
// (2026-10-10 사용자 "배틀시작을 누르면 랜덤배틀 친선배틀 고르는 모달이 나오게", Figma 03 `Battle Mode Body`, 05 `Adventure / 배틀 고르기`)
//   랜덤 배틀  상대 고르기 모달(battle-opponent.ts). 배틀 파티가 비었거나 출전 불가가 있으면 흐리고 까닭 한 줄
//   친선 배틀  친선 배틀 모달(friendly-battle.ts). 준비 화면이 출전 불가를 보이므로 막지 않는다
// 고르기 모달이라 ✕ 로 닫는다. 바닥 단추 줄은 없다
import { buttonEl, el } from "../ui/dom.js";
import { openBattleOpponent } from "./battle-opponent.js";
import { closeDialog, dialogEl, dialogHead, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";

function modeRow(title: string, desc: string, off: boolean, go: () => void): HTMLElement {
  const row = buttonEl("battle-mode");
  row.append(el("strong", undefined, title), el("span", undefined, desc));
  row.disabled = off;
  row.addEventListener("click", go);
  return row;
}

export function drawBattleStart(): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const blocked = v.battle.slots.some((s) => s.blocked);
  const empty = !v.battle.slots.some((s) => s.pet);
  const why = blocked ? "출전 불가 포켓몬이 있어요" : empty ? "배틀 파티가 비었어요" : null;
  const list = el("div", "battle-modes");
  list.append(
    modeRow("랜덤 배틀", why ?? "다른 사용자의 배틀 파티와 싸워요 · 보상 · 5분에 한 번", !v.battle.canStart, () => openBattleOpponent(() => openAnyDialog({ kind: "battle-opponent" }))),
    modeRow("친선 배틀", "링크로 친구를 불러 한 판 · 보상 없음", false, () => openAnyDialog({ kind: "friendly" })),
  );
  dialogEl.append(...dialogHead("배틀 시작", "", { close: true }), list);
}
