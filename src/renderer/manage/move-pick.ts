// 기술 바꾸기 모달 — 배틀 파티 상세 기기 창의 기술 칸을 누르면 연다 (docs/specs/adventure.md "보유 기술", Figma 05 `15 모험` `Adventure / Move Pick`)
// (2026-10-10 사용자 "포켓몬 상세에서 기술을 누르면 기술목록 모달이 나오게", "내 기술 누르고 목록의 기술 누르거나 드래그드랍으로 기술 변경 가능하게")
//   왼쪽 기술 목록       고를 수 있는 기술 — 기본 2개 뒤에 후보 4개. 쓰는 중인 기술은 흐리고 `사용 중`. 진화 전 종은 기본 2개뿐이다
//   오른쪽 사용 중인 기술  1번·2번 칸, 사이에 순서 바꾸기(battle.moves), 아래에 기술 상세(타입·분류·위력·명중·쿨타임·효과·원작 설명)
//   내 칸을 누르면        그 칸을 고른다(톤 바탕). 같은 칸을 다시 누르면 푼다. 처음은 고른 칸이 없다
//   목록의 기술을 누르면   고른 칸이 없으면 상세만 바꾼다. 있으면 그 칸을 바꾸고(battle.pick, 다른 칸의 기술이면 순서 바꾸기) 고르기를 푼다
// 끌어 놓기는 없다 — 교체·고르기 모달은 누르기만(2026-10-10 사용자 결정, worklog/records/interaction-audit). 순서는 가운데 순서 바꾸기 단추
// (2026-10-10 사용자 "사용중인기술을 누르고 목록에서 눌러야 바뀌게. 1번 바뀌면 사용중인기술 클릭한거 해제.(목록 눌러도 설명보이게)", Figma 05 `Adventure / Move Pick`·`· Slot Picked`)
// 본문 높이는 고정이다 — 상세 칸이 남은 자리를 채우고 넘치면 칸 안에서 스크롤한다(기술마다 모달 크기가 바뀌지 않게)
// 바꿀 때마다 바로 저장한다. `완료` 는 닫는다
import type { BattleSlotView, MoveView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { swapIconEl } from "../ui/line-icons.js";
import { movePillEl } from "../ui/move-pill.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { iconOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

let petId = "";
let target: number | null = null; // 고른 사용 중인 기술 칸 — 목록의 기술을 누르면 여기를 바꾼다. 없으면 목록은 상세만 바꾼다
let opened = 0; // 기기 창에서 누른 칸 — 처음 상세 칸에 그 칸의 기술을 보인다
let shown: string | null = null; // 상세 칸에 보이는 기술 — 없으면 opened 칸의 기술

// 모달을 새로 열 때 (registerDialog 의 enter)
export function startMovePick(id: string, slot: number): void {
  petId = id;
  target = null;
  opened = slot === 1 ? 1 : 0;
  shown = null;
}

const pill = (m: MoveView): HTMLElement => movePillEl(m, "large", iconOf(`type:${m.typeId}`, "mp-icon"));

// 고른 칸(at)을 기술 id 로 바꾼다 — 다른 칸의 기술이면 순서 바꾸기. 성공하면 고르기를 푼다(실패하면 그대로 두어 다시 누를 수 있게)
function put(slot: BattleSlotView, at: number, id: string): void {
  const cur = slot.moves.map((m) => m.id);
  if (cur.length < 2) return;
  if (cur[at] === id) {
    target = null; // 이미 그 칸의 기술 — 바꿀 것 없이 고르기만 푼다
    drawDialog();
    return;
  }
  const next = [...cur];
  next[at] = id;
  void (async () => {
    const ok = cur[1 - at] === id ? await sendCommand("battle.moves", petId, {}, { keepOpen: true }) : await sendCommand("battle.pick", petId, { moves: next }, { keepOpen: true });
    if (ok) {
      target = null;
      drawDialog();
    }
  })();
}

function optionEl(slot: BattleSlotView, m: MoveView): HTMLElement {
  const used = slot.moves.some((u) => u.id === m.id);
  const row = buttonEl(used ? "mp-option used" : "mp-option");
  row.append(pill(m));
  const meta = el("div", "mp-meta");
  meta.appendChild(el("span", "mp-meta-text", m.meta));
  if (used) meta.appendChild(el("span", "mp-in-use", "사용 중"));
  row.appendChild(meta);
  row.setAttribute("aria-label", target == null ? `${m.name} 상세 보기` : `${m.name}을 ${target + 1}번 칸에`);
  row.setAttribute("aria-current", String(m.id === (shown ?? slot.moves[opened]?.id))); // 지금 상세 칸에 보이는 줄
  row.addEventListener("click", () => {
    shown = m.id;
    if (target != null) put(slot, target, m.id);
    drawDialog();
  });
  row.addEventListener("dragstart", (e) => e.preventDefault()); // 그림의 브라우저 기본 끌기를 막는다
  return row;
}

function slotEl(slot: BattleSlotView, at: number): HTMLElement {
  const m = slot.moves[at]!;
  const cell = buttonEl("mp-slot");
  cell.setAttribute("aria-pressed", String(at === target));
  cell.setAttribute("aria-label", `${at + 1}번 기술 ${m.name}`);
  cell.append(el("span", "mp-slot-no", `${at + 1}번`), pill(m));
  cell.addEventListener("click", () => {
    target = target === at ? null : at;
    shown = m.id;
    drawDialog();
  });
  cell.addEventListener("dragstart", (e) => e.preventDefault());
  return cell;
}

// 기술 상세 — 이름, 타입·분류·사거리·접촉, 위력·명중·쿨타임 세 칸, 효과 줄, 원작 설명 (Figma 03 `Move Pick Body` `detail · 기술 상세`)
function detailEl(m: MoveView): HTMLElement {
  const box = el("div", "mp-detail");
  box.appendChild(el("strong", "mp-detail-name", m.name));
  const d = m.detail;
  const tags = el("div", "mp-tags");
  tags.appendChild(typeBadgeEl(m.typeName, m.typeId));
  tags.appendChild(el("span", "mp-kind", d?.kind ?? m.meta));
  box.appendChild(tags);
  if (d) {
    const stats = el("div", "mp-stats");
    for (const s of d.stats) {
      const cell = el("div", "mp-stat");
      cell.append(el("span", undefined, s.label), el("strong", undefined, s.value));
      stats.appendChild(cell);
    }
    box.appendChild(stats);
    if (d.effects.length) {
      const fx = el("div", "mp-effects");
      for (const line of d.effects) fx.appendChild(el("div", undefined, `· ${line}`));
      box.appendChild(fx);
    }
  }
  if (m.text) {
    box.appendChild(el("div", "mp-rule"));
    box.appendChild(el("div", "mp-desc-text", m.text)); // 원작 설명이 없는 기술은 뺀다
  }
  return box;
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
  // 칸을 고르면 이 자리의 글자만 바꾼다(줄을 끼우지 않는다)
  list.appendChild(el("strong", "mp-label", target == null ? "기술 목록" : `기술 목록 · ${target + 1}번에 넣을 기술을 누르세요`));
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
  const focus = options.find((m) => m.id === shown) ?? slot.moves.find((m) => m.id === shown) ?? slot.moves[opened]!;
  side.appendChild(detailEl(focus));

  const body = el("div", "mp-body");
  body.append(list, side);
  const acts = el("div", "swap-acts");
  acts.append(el("span", "spacer"), actionButtonEl("완료", true, false, closeDialog));
  dialogEl.append(top, body, acts);
}
