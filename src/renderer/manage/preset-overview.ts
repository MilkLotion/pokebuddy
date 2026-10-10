// 프리셋 전체보기 모달 — 가진 프리셋을 한 줄씩, 줄마다 파티 순서대로 칸 6개 (2026-10-07 사용자 "프리셋 세로 5줄, 그 1줄에 포켓몬 파티 순서대로 주루룩 6개")
// 적용한 프리셋 줄은 옅은 바탕과 `적용 중` 글자다. 강조 테두리는 쓰지 않는다. 바닥 단추 줄은 없다.
// 줄을 누르면 그 프리셋을 적용하고 닫는다 — 박스 순서 모달의 타일과 같은 관례. 적용한 줄은 닫기만 한다
// Figma 05 `Party / Preset Overview · 5` `1590:63534`, 본문은 03 `Preset Overview Panel` `1590:60879`, 줄은 02 `Preset Row` `1590:60878`, 칸은 02 `Preset Cell` `1601:66627`
// 여는 곳은 파티 탭 머리의 햄버거 메뉴 `전체보기` 다.
// 모험 탭의 `가져오기`도 이 모달을 연다(battle) — 제목은 `기존 파티 가져오기`, `적용 중` 표시는 없고, 줄을 누르면 그 프리셋을 배틀 파티로 가져온다
// (docs/specs/adventure.md "기존 파티 가져오기", Figma 05 `15 모험` `Adventure / Import Preset` `1662:1955`)
import type { PresetView, SlotView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { lockIconEl, plusIconEl } from "../ui/line-icons.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { closeDialog, dialogEl } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

// 칸 하나 — 초상만. 빈 칸은 +, 잠긴 칸은 자물쇠 아이콘만 (2026-10-07 사용자 "레벨·이름 안 보이고 프로필만 보이게 하자").
// 이름·레벨은 마우스를 올린 title 과 읽어 주는 이름(aria-label)에만 둔다
function overviewCell(slot: SlotView): HTMLElement {
  const cell = el("div", "po-cell");
  const pet = slot.pet;
  if (slot.state === "pokemon" && pet) {
    cell.appendChild(portraitOf(pet.look, pet.shiny, "dot"));
    if (pet.shiny) cell.appendChild(shinyIcon(10));
    cell.title = `${pet.name} Lv.${pet.level}`;
    cell.setAttribute("aria-label", cell.title);
    return cell;
  }
  const locked = slot.state === "locked";
  cell.classList.add(locked ? "locked" : "blank");
  const icon = el("span", "blank-icon");
  icon.appendChild(locked ? lockIconEl() : plusIconEl());
  cell.appendChild(icon);
  cell.title = locked ? "잠긴 칸" : "빈 칸";
  cell.setAttribute("aria-label", cell.title);
  return cell;
}

function presetRow(p: PresetView, active: boolean, battle: boolean): HTMLButtonElement {
  const row = buttonEl(active ? "preset-row on" : "preset-row");
  row.setAttribute("aria-pressed", String(active));
  const head = el("div", "po-head");
  head.appendChild(el("span", "po-name", p.name));
  if (active) head.appendChild(el("span", "po-state", "적용 중"));
  const cells = el("div", "po-cells");
  for (const s of p.slots) cells.appendChild(overviewCell(s));
  row.append(head, cells);
  // 보낸 뒤 성공하면 닫는다 — 먼저 닫으면 처리 중 점을 달 줄이 없고 실패 문구도 보일 곳이 없다(2026-10-10 조작 점검 공통 원인 2·3)
  row.addEventListener("click", () => {
    if (!battle && active) {
      closeDialog();
      return;
    }
    void (async () => {
      const ok = battle
        ? await sendCommand("battle.import", "", { preset: p.index }, { keepOpen: true, busyOn: row })
        : await sendCommand("party.preset", "", { preset: p.index }, { keepOpen: true, busyOn: row });
      if (ok) closeDialog();
    })();
  });
  return row;
}

export function drawPresetOverview(battle = false): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, battle ? "기존 파티 가져오기" : "프리셋 전체보기"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const list = el("div", "preset-list scroll");
  for (const p of v.party.presets) list.appendChild(presetRow(p, !battle && p.index === v.party.preset.index, battle));
  dialogEl.append(top, list);
}
