// 배틀 파티 교체 모달 — 왼쪽은 포켓몬 고르기 판(pet-box-panel.ts, 파티 교체·교환과 같다), 오른쪽은 배틀 파티 6칸 세로 한 줄
// (2026-10-09 사용자 "프리셋모음 + 박스들 … 그 우측엔 현재 파티 캐릭터들", "1x6 이라니까? 가로1 세로6칸", Figma 05 `15 모험` `Adventure / Battle Swap`)
// 여는 곳: 모험 탭의 빈 칸, 칸 우클릭 메뉴의 `바꾸기`. 연 칸이 고른 칸(톤 바탕)이다
//   오른쪽 칸을 누르면        그 칸을 고른다. 같은 칸을 다시 누르면 푼다
//   판의 개체를 누르면        고른 칸에 넣는다(battle.set). 칸에 개체가 있으면 바꾼다. 바꾸면 고르기가 풀린다
//   판의 박스 빈 칸을 누르면   고른 칸의 개체를 뺀다(battle.clear) — 파티 교체의 "박스 빈 칸에 보관"과 같은 자리
//   모두 빼기 · 완료          6칸을 비운다 · 닫는다 (사용자 "모두 박스로, 모두 빼기, 완료 + 검색")
// 끌어 놓기는 없다 — 교체·고르기 모달은 누르기만(2026-10-10 사용자 결정, worklog/records/interaction-audit). 칸 순서는 모험 탭에서 끌거나 우클릭 `옮기기`
// 고른 칸이 없으면 판의 개체는 누를 수 없다. 다른 칸에 든 개체는 판에서 흐리고 고르지 못한다. 바꿀 때마다 바로 저장한다
import type { BattleSlotView, PetView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog } from "./dialog.js";
import { petBoxPanelEl, resetPanel } from "./pet-box-panel.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

const PANEL_KEY = "battle-swap";
let target: number | null = null; // 고른 칸 — 판의 개체를 누르면 여기에 넣는다. 없으면 판은 누를 수 없다

// 모달을 새로 열 때 — 판은 첫 쪽, 고른 칸은 연 칸 (registerDialog 의 enter)
export function startBattlePick(slot: number): void {
  resetPanel(PANEL_KEY);
  target = slot;
}

// 고른 칸을 바꾼다 — 성공하면 고르기를 푼다(실패하면 그대로 두어 다시 누를 수 있게)
const change = (cmd: string, args: Record<string, unknown>): void => {
  void (async () => {
    if (await sendCommand(cmd, "", args, { keepOpen: true })) {
      target = null;
      drawDialog();
    }
  })();
};

function slotCell(s: BattleSlotView): HTMLElement {
  const pet = s.pet;
  const cell = buttonEl(pet ? "cell pp-cell bs-slot" : "cell blank pp-cell bs-slot");
  cell.setAttribute("aria-pressed", String(s.index === target));
  cell.setAttribute("aria-label", `배틀 파티 ${s.index + 1}번 칸`);
  if (pet) {
    cell.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", `Lv.${pet.level}`));
    if (pet.shiny) cell.appendChild(shinyIcon(10));
    cell.title = `${pet.name} Lv.${pet.level}`;
    cell.addEventListener("dragstart", (e) => e.preventDefault()); // 그림의 브라우저 기본 끌기를 막는다
  }
  cell.addEventListener("click", () => {
    target = target === s.index ? null : s.index;
    drawDialog();
  });
  return cell;
}

export function drawBattlePick(): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const inBattle = new Map<string, number>();
  for (const s of v.battle.slots) if (s.pet) inBattle.set(s.pet.id, s.index);
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "배틀 파티 교체"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const panel = petBoxPanelEl({
    key: PANEL_KEY,
    view: v,
    cell: (pet: PetView) => {
      const at = inBattle.get(pet.id);
      const other = at != null;
      return {
        disabled: other || target == null, // 처리 중 막기는 sendCommand 가 한다 — 칸에 굳혀 두면 명령 뒤 다시 그린 칸이 계속 막힌다
        off: other,
        ...(other ? { title: `배틀 파티 ${at + 1}번 칸에 있어요` } : target == null ? { title: `${pet.name} · 오른쪽에서 넣을 칸을 먼저 누르세요` } : {}),
        pick: () => {
          if (target != null) change("battle.set", { slotIndex: target, petId: pet.id });
        },
      };
    },
    // 고른 칸에 개체가 있으면 박스의 빈 칸을 눌러 뺀다 (파티 교체의 보관과 같은 자리)
    blankLabel: "고른 칸의 포켓몬을 배틀 파티에서 빼기",
    blank: (at) => {
      const slot = target;
      return at.kind === "box" && slot != null && v.battle.slots[slot]?.pet ? () => change("battle.clear", { slotIndex: slot }) : null;
    },
  });
  const side = el("div", "swap-side");
  side.appendChild(el("div", "swap-side-name", "배틀 파티"));
  const slots = el("div", "swap-side-slots");
  for (const s of v.battle.slots) slots.appendChild(slotCell(s));
  side.appendChild(slots);
  const body = el("div", "swap-body");
  body.append(panel, side);
  const filled = v.battle.slots.filter((s) => s.pet).map((s) => s.index);
  const clearAll = actionButtonEl("모두 빼기", false, filled.length === 0, () => {
    void (async () => {
      for (const slot of filled) if (!(await sendCommand("battle.clear", "", { slotIndex: slot }, { keepOpen: true }))) break;
    })();
  });
  const done = actionButtonEl("완료", true, false, closeDialog);
  const acts = el("div", "swap-acts");
  acts.append(clearAll, el("span", "spacer"), done);
  dialogEl.append(top, body, acts);
}
