// 설정창의 파티 탭 — 프리셋 넘김·이름, 파티 카드·빈 칸·잠긴 칸 (P10 13a)
import type { PetView, SlotView, Snapshot } from "../../shared/model/snapshot.js";
import { genderIcon } from "../ui/gender-icon.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { buttonEl, el } from "../ui/dom.js";
import { lockIconEl, plusIconEl } from "../ui/line-icons.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { portraitOf } from "./art-cache.js";
import { hold } from "./box-state.js";
import { dropZone, startDrag } from "./box-move.js";
import { sendCommand } from "./command.js";
import { wrapPage } from "./grid-view.js";
import { openSwap } from "./party-link.js";
import { bodyEl, redrawBody } from "./shell.js";
import { ui } from "./state.js";
import { boxNameCell, meterEl, NATURE_UI, pageHeadEl } from "./widgets.js";

// 설정창이 거는 고리 — 개체 상세 열기와 포켓몬 메뉴를 이 파일이 가져오지 않게
export interface PartyTabHooks {
  openPet(id: string): void; // 카드를 눌렀다 — 개체 상세(이미 떠 있으면 닫는다)
  askPetMenu(id: string): void; // 오른쪽 누르기 — 포켓몬 메뉴
}
let hooks: PartyTabHooks | null = null;
export function setPartyTabHooks(next: PartyTabHooks): void {
  hooks = next;
}
function hooksOf(): PartyTabHooks {
  if (!hooks) throw new Error("party-tab.ts 의 고리가 걸리지 않았다 — setPartyTabHooks 를 먼저 부른다");
  return hooks;
}

let presetRenaming = false;
// 탭을 옮긴다 — 프리셋 이름 고치기를 끝낸다 (shell.ts setTab 의 고리)
export function stopPresetRename(): void {
  presetRenaming = false;
}

function petCard(pet: PetView): HTMLElement {
  const card = buttonEl("slot");

  const portrait = portraitOf(pet.look, pet.shiny, "portrait");
  if (pet.hidden) {
    const mark = el("span", "mark");
    mark.title = "숨긴 상태";
    portrait.appendChild(mark);
  }
  card.appendChild(portrait);

  // 레벨 · 이름 · 성별 · 성격을 한 줄에 — Figma `Party Slot Card` 123:149 의 `identity-copy`. 다음 레벨까지는 칸의 title 로 옮겼다
  // 성격은 타입 줄에서 이름 옆으로 옮겼다 (2026-09-30 사용자 결정 "성격은 … 이름 옆에")
  const info = el("div", "info");
  const top = el("div", "top");
  top.append(el("span", undefined, `Lv.${pet.level}`), el("div", "name", pet.name));
  const sex = genderIcon(pet.gender, 16);
  if (sex) top.appendChild(sex);
  // 이로치 아이콘 — 성별 아이콘 옆 16 (Figma `Party Slot Card` 의 `Show Shiny`, 2026-10-02 사용자 결정)
  if (pet.shiny) top.appendChild(shinyIcon(16));
  if (NATURE_UI) top.appendChild(el("span", "nature", pet.nature));
  info.appendChild(top);

  const tags = el("div", "tags");
  pet.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, pet.typeIds[i])));
  info.appendChild(tags);

  const meters = el("div", "meters");
  meters.append(meterEl("친밀도", pet.affinity, undefined, { pet: pet.id, field: "affinity" }), meterEl("만복도", pet.fullness, pet.zone, { pet: pet.id, field: "fullness" }));
  info.appendChild(meters);

  card.appendChild(info);
  // 상태 배지 — 디버프(배고픔·매우 배고픔, 스냅샷의 pet.debuff) 뒤에 켜진 버프(든든함·신남·들뜸). Figma `Party Slot Card` 의 debuff 자리.
  // 버프도 배고픔처럼 칸 오른쪽 위에 둔다 (2026-09-30 사용자 결정 "들뜸, 신남 도 배고픔처럼"). 하나도 없으면 두지 않는다
  const badges: HTMLElement[] = [];
  const debuff = pet.debuff;
  if (debuff) {
    const badge = el("span", `debuff ${debuff.tone}`, debuff.label);
    badge.title = debuff.note;
    badges.push(badge);
  }
  for (const buff of pet.buffs ?? []) {
    const badge = el("span", "debuff success", buff.text);
    badge.dataset.liveBuff = `${pet.id}|${buff.kind}`; // 남은 분은 1초 시계가 고친다 (applyLive)
    badges.push(badge);
  }
  if (badges.length) {
    const box = el("div", "debuffs");
    box.append(...badges);
    card.appendChild(box);
  }
  card.dataset.pet = pet.id; // 진화 튜토리얼이 이 카드를 찾는다
  // 좌클릭은 개체 상세, 우클릭은 포켓몬 메뉴 (2026-10-02 사용자 결정 "좌클릭에 메뉴생기는게 생각보다 어색하네 … 우클릭으로 바꾸고 … 좌클릭으로 상세 열게")
  card.addEventListener("click", () => hooksOf().openPet(pet.id));
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    hooksOf().askPetMenu(pet.id);
  });
  if (pet.id === ui.detailPet) card.classList.add("selected"); // 옆 기기 창에 떠 있는 개체 — 옅은 배경만 (강조 테두리 없음)
  card.title = `${pet.name} · ${pet.zoneText} · 다음 레벨까지 ${pet.percentToNext}%`;
  return card;
}

// 빈 칸·잠긴 칸 그림 — Figma `Party Slot` state/empty·state/locked 의 +·자물쇠
function blankIcon(locked: boolean): HTMLElement {
  const box = el("span", "blank-icon");
  box.appendChild(locked ? lockIconEl() : plusIconEl());
  return box;
}

function blankCard(slot: SlotView): HTMLElement {
  const card = buttonEl("slot blank");
  if (slot.state === "locked") {
    card.classList.add("locked");
    card.disabled = true;
    card.append(blankIcon(true), el("strong", undefined, "잠긴 칸"));
    return card;
  }
  // 문구는 Figma `Party Slot` state/empty 의 "박스에서 배치"
  card.append(blankIcon(false), el("strong", undefined, "빈 칸"), el("small", undefined, "박스에서 배치"));
  card.addEventListener("click", openSwap);
  return card;
}

// 프리셋 이름 — 박스 이름과 같은 규칙이다. 누르면 입력칸이 된다. Enter·바깥 클릭으로 저장, Esc 로 취소. 비우면 기본 이름(프리셋 N)
function presetNameEl(preset: Snapshot["party"]["preset"]): HTMLElement {
  if (!presetRenaming) {
    const name = buttonEl("label box-name", preset.name);
    name.title = "눌러서 이름 바꾸기";
    name.addEventListener("click", () => {
      presetRenaming = true;
      redrawBody();
    });
    return name;
  }
  const input = document.createElement("input");
  input.className = "search box-name-input";
  input.value = preset.name;
  if (ui.view) input.maxLength = ui.view.limits.presetNameMax; // 프리셋 이름 상한은 박스 이름과 같다 (src/box/rules.ts BOX_RULES.nameMax)
  input.setAttribute("aria-label", "프리셋 이름");
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    presetRenaming = false;
    const name = input.value;
    if (document.activeElement === input) input.blur(); // 포커스가 남아 있으면 다시 그리기가 미뤄져(typingSearch) 입력칸이 그대로 남는다
    if (save && name.trim() !== preset.name) void sendCommand("party.preset.rename", "", { preset: preset.index, name });
    else redrawBody();
  };
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") {
      e.stopPropagation(); // 관리 창의 Esc(대화상자 닫기)로 번지지 않게
      finish(false);
    }
  });
  // 다시 그려서 빠진 칸의 blur 는 저장으로 치지 않는다
  input.addEventListener("blur", () => setTimeout(() => input.isConnected && finish(true), 0));
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

// 앞·뒤 프리셋을 적용한다 — 가진 프리셋 안에서 끝과 끝이 이어져 돈다. 바탕화면의 파티도 바뀐다.
// 파티 탭 머리 줄, 가방 기기 창의 파티 줄, 파티 기기 창의 방향키가 같이 쓴다 (2026-10-02 사용자 결정)
export function stepPreset(delta: -1 | 1): void {
  const p = ui.view?.party.preset;
  if (!p || p.count < 2) return;
  hold.party = null;
  void sendCommand("party.preset", "", { preset: wrapPage(p.index + delta, p.count) }, { keepOpen: true });
}

// 파티 칸 옮기기 — 개체 칸을 끌어 빈 칸에 놓으면 옮기고, 개체 칸에 놓으면 맞바꾼다. 잠긴 칸에는 놓지 않는다.
// 끌기는 박스 칸과 같은 포인터 끌기(startDrag)를 쓴다. 놓을 칸은 옅은 바탕으로만 보인다
export function drawParty(v: Snapshot): void {
  // 머리 줄 — 파티 ◀ [프리셋 이름] ▶ … 교체. 넘김은 박스 넘김 줄과 같은 부품이다. 누르면 바로 그 프리셋을 적용한다.
  // 마릿수·칸 수 부제는 두지 않는다 (2026-10-02 사용자 결정 "프리셋이름만 보여줘도 될거같아", Figma 05 `Party / Base` `217:1705`)
  const top = pageHeadEl("파티");
  const preset = v.party.preset;
  const pager = el("div", "pager box-pager preset-pager");
  const prev = buttonEl("", "◀");
  prev.disabled = preset.count < 2;
  prev.setAttribute("aria-label", "앞 프리셋");
  prev.addEventListener("click", () => stepPreset(-1));
  const next = buttonEl("", "▶");
  next.disabled = preset.count < 2;
  next.setAttribute("aria-label", "다음 프리셋");
  next.addEventListener("click", () => stepPreset(1));
  pager.append(prev, boxNameCell(presetNameEl(preset)), next);
  top.appendChild(pager);
  // 머리 오른쪽 `교체` — 박스 탭으로 가고 파티 기기 창을 띄운다 (Figma 05 `Party / Swap · Open` `1248:2567`)
  const swap = buttonEl("act swap-open", "교체");
  swap.addEventListener("click", openSwap);
  top.appendChild(swap);
  bodyEl.appendChild(top);
  const grid = el("div", "grid");
  for (const slot of v.party.slots) {
    const card = slot.pet ? petCard(slot.pet) : blankCard(slot);
    if (slot.state !== "locked") {
      dropZone(card, () => {
        const from = hold.drag;
        if (from && "partyPet" in from && from.partyPet !== slot.pet?.id) void sendCommand("party.move", from.partyPet, { toSlot: slot.index });
      });
    }
    if (slot.pet) {
      const petId = slot.pet.id;
      card.addEventListener("pointerdown", (e) => startDrag(e, card, { partyPet: petId }));
      card.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다
    }
    grid.appendChild(card);
  }
  bodyEl.appendChild(grid);
}
