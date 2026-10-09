// 설정창의 박스 탭 — 칸 격자, 넘김 줄(이름·정렬), 박스 명령 (P10 13b). 머리 메뉴와 박스 순서 모달은 box-order.ts
// 든 것·끄는 것의 상태는 box-state.ts, 옮기기·끌기는 box-move.ts, 교체 화면은 party-link.ts
import type { ManageReply } from "../../shared/ipc/manage.js";
import type { BoxView, FormView, PetView, Snapshot } from "../../shared/model/snapshot.js";
import { failTextOf } from "../../shared/fail-text.js";
import { buttonEl, el } from "../ui/dom.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import { boxUi, hold } from "./box-state.js";
import { drawHoldGhost, dropZone, endHold, startDrag, startHold } from "./box-move.js";
import { requestCommand } from "./command.js";
import { wrapPage } from "./grid-view.js";
import { refreshView } from "./live.js";
import { askPetMenu } from "./pet-menu.js";
import { openPet } from "./routes.js";
import { daycareOpenButton, hiddenHatchIds } from "./daycare.js";
import { markMega } from "./pet-forms.js";
import { bodyEl, redrawBody } from "./shell.js";
import { findPartySlot, ui } from "./state.js";
import { boxNameCell, pageHeadEl } from "./widgets.js";
import { boxMenuEl } from "./box-order.js";
import { boxFindEl } from "./box-find.js";

const BOX_SORTS: readonly { by: string; label: string }[] = [
  { by: "dex", label: "도감 번호" },
  { by: "level", label: "레벨 높은 순" },
  { by: "affinity", label: "친밀도 높은 순" },
  { by: "recent", label: "최근 얻은 순" },
  { by: "name", label: "이름순" },
];
// 박스마다 마지막으로 적용한 정렬 기준 — 단추와 목록에 보인다. 그 박스의 칸을 옮기면 순서가 흐트러지므로 지운다.
// 저장하지 않는다 — 관리 창을 다시 열면 "정렬" 로 돌아간다
const boxSortedBy = new Map<string, string>();

// ── 공유 sid 계열 ───────────────────────────────────────────────────────────────
// 박스 칸은 2×2 단체사진이다. 파티 카드와 개체 상세는 지금 종 하나만 보인다 (2026-09-26 사용자 결정 "너 제안대로 하자").
// 모습은 포켓몬 메뉴의 `모습 바꾸기` 로 바꾼다. 메뉴 옆의 말풍선에서 모습을 고르면 바꾸기 확인 창(drawForm)이 뜬다.
// 마우스를 올려 띄우던 툴팁은 없앴다 (2026-10-02 사용자 "마우스만 갔다대도 바로 떠버려서 … 클릭해야 나오게 하자")

function groupPhoto(forms: FormView[], shiny: boolean): HTMLElement {
  const photo = el("div", "group-photo");
  for (const f of forms.slice(0, 4)) photo.appendChild(portraitOf(f.species, shiny, "gp-face"));
  return photo;
}

// 박스 탭의 칸 — 95×86. 초상과 이름만 가운데에 두고 레벨은 오른쪽 위, 이로치 아이콘은 왼쪽 위 구석이다.
// 6×5 가 기본 창 높이에서 스크롤 없이 맞는다 (2026-10-02 사용자 결정 B안, Figma 05 `Box / Base`).
// 공유 sid 계열은 단체사진·계열 이름 아래에 지금 종을 한 줄 더 둔다
export function boxSlot(pet: PetView, onPick: () => void): HTMLButtonElement {
  const cell = buttonEl("cell tall");
  const forms = pet.forms;
  if (forms && forms.length > 1) {
    cell.classList.add("family");
    cell.append(groupPhoto(forms, pet.shiny), el("div", "who", `${forms[0]?.name ?? pet.name} 계열`), el("div", "note now", pet.name));
  } else {
    cell.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name));
  }
  cell.appendChild(el("div", "note lv", `Lv.${pet.level}`));
  if (pet.shiny) cell.appendChild(shinyIcon(10));
  markMega(cell, pet, 14);
  cell.addEventListener("click", onPick);
  return cell;
}

export function drawBox(v: Snapshot): void {
  const unseen = hiddenHatchIds(v); // 부화 결과 창에서 아직 확인하지 않은 개체 — 빈 칸으로 그리고 보관 수에서 뺀다
  const kept = v.boxes.reduce((sum, b) => sum + b.used, 0) - unseen.size;
  const top = pageHeadEl("박스", `보관 ${kept}마리 · 박스 ${v.boxes.length}개`); // 박스를 사서 늘리므로 박스 수도 적는다 (2026-10-02 사용자 결정 "박스 수도 타이틀에 표기")
  // 박스 명령이 실패하면 부제 자리의 글자만 바꾼다 — 빨간 점과 이유. 격자는 움직이지 않는다
  const sub = top.querySelector(".sub");
  if (boxUi.note && sub) {
    sub.className = "sub fail";
    sub.replaceChildren(el("i"), el("span", undefined, boxUi.note));
    (sub as HTMLElement).title = boxUi.note;
  }
  // 머리 오른쪽 — 햄버거 단추 하나. 누르면 메뉴(박스 순서·교환)가 뜬다 (2026-10-02 사용자 결정, Figma 04 템플릿 `Box Layout` `340:3665` 머리)
  // 찾기 줄은 햄버거 단추 앞이다 (2026-10-07 사용자 결정 "7번 시안대로 진행", Figma 05 `Box / Find · Found 2/3` `1590:65782`)
  const acts = el("div", "head-acts");
  acts.append(boxFindEl(v, unseen), boxMenuEl());
  top.appendChild(acts);
  bodyEl.appendChild(top);

  if (boxUi.page >= v.boxes.length) boxUi.page = 0;
  const box = v.boxes[boxUi.page];
  if (!box) return;

  // 든 개체가 그 칸에 없으면(다른 곳에서 옮겼거나 사라졌다) 내려놓는다
  if (hold.box) {
    const at = hold.box;
    if (v.boxes.find((b) => b.id === at.boxId)?.slots[at.slot]?.id !== at.petId) endHold();
  }
  const boxHeld = hold.box;

  // 넘김 줄 — ◀ [이름] ▶ … 정렬. 이름 칸은 고정 폭이다. 칸 수(12 / 30)는 두지 않는다 — 보관 수는 머리 부제에 있다 (2026-10-02 사용자 결정, Figma `Box Toolbar` Show Count 끔)
  // 끝에서 한 번 더 넘기면 반대쪽 끝으로 돈다 (2026-10-02 사용자 결정)
  const pager = el("div", "pager box-pager");
  const prevPage = wrapPage(boxUi.page - 1, v.boxes.length);
  const nextPage = wrapPage(boxUi.page + 1, v.boxes.length);
  const prev = buttonEl("", "◀");
  prev.disabled = v.boxes.length <= 1;
  prev.dataset.hold = ""; // 든 채로 박스를 넘긴다 — 든 것을 내려놓지 않는다
  prev.addEventListener("click", () => {
    boxUi.page = prevPage;
    boxUi.note = "";
    redrawBody();
  });
  const next = buttonEl("", "▶");
  next.disabled = v.boxes.length <= 1;
  next.dataset.hold = "";
  next.addEventListener("click", () => {
    boxUi.page = nextPage;
    boxUi.note = "";
    redrawBody();
  });
  // ◀·▶ 는 놓을 곳이 아니다 — 끌어 놓기는 지금 박스 안의 자리만 바꾼다. 다른 박스로는 포켓몬 메뉴의 `옮기기` 로만 보낸다 (2026-10-02 사용자 결정)
  pager.append(prev, boxNameCell(boxNameEl(box)), next);
  // 넘김 줄에는 검색을 두지 않는다 — 찾기는 머리 줄의 찾기 줄이다 (2026-10-07, 2026-09-30 "박스에는 검색기능 없애." 를 바꿨다)
  // 오른쪽 끝 — 돌보미집 아이콘 단추, 정렬. 돌보미집은 모달로 연다
  pager.append(daycareOpenButton(v), boxSortEl(box));
  bodyEl.appendChild(pager);

  const grid = el("div", boxHeld ? "box-grid holding" : "box-grid");
  // 든 개체를 이 칸에 놓는다 — 빈 칸이면 옮기고 개체 칸이면 맞바꾼다. 제자리면 그냥 내려놓는다
  const dropHold = (toSlot: number): void => {
    const h = hold.box;
    if (!h) return;
    endHold();
    if (h.boxId === box.id && h.slot === toSlot) {
      redrawBody();
      return;
    }
    void boxCommand("box.move", h.boxId, { slot: h.slot, toBoxId: box.id, toSlot }, () => unsorted(h.boxId, box.id));
  };
  box.slots.forEach((pet, slot) => {
    // 확인 전 부화 개체 — 부화 결과 창이 덮고 있어 누를 수 없다. 모습만 빈 칸이다
    if (pet && unseen.has(pet.id)) {
      grid.appendChild(el("div", "cell tall blank"));
      return;
    }
    // 칸 옮기기 — 빈 칸이면 옮기고 개체 칸이면 맞바꾼다. 놓을 칸은 옅은 바탕으로 보인다(테두리 강조는 쓰지 않는다)
    const onDrop = (): void => {
      const from = hold.drag;
      if (!from || !("boxId" in from) || (from.boxId === box.id && from.slot === slot)) return;
      void boxCommand("box.move", from.boxId, { slot: from.slot, toBoxId: box.id, toSlot: slot }, () => unsorted(from.boxId, box.id));
    };
    if (!pet) {
      const blank = el("div", "cell tall blank");
      blank.dataset.hold = "";
      blank.addEventListener("click", () => {
        if (hold.box) dropHold(slot);
      });
      dropZone(blank, onDrop);
      grid.appendChild(blank);
      return;
    }
    // 좌클릭은 개체 상세, 우클릭은 포켓몬 메뉴. 든 개체가 있으면 좌클릭이 이 칸과 맞바꾼다(우클릭은 아무것도 하지 않는다)
    const cell = boxSlot(pet, () => {
      if (hold.box) dropHold(slot);
      else openPet(pet.id);
    });
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!hold.box) askPetMenu(pet.id);
    });
    cell.dataset.hold = "";
    if (pet.id === ui.detailPet) cell.classList.add("selected"); // 옆 기기 창에 떠 있는 개체
    if (pet.id === boxUi.find.pet) cell.classList.add("found"); // 박스 찾기의 지금 결과 — 옅은 바탕만
    if (boxHeld && boxHeld.boxId === box.id && boxHeld.slot === slot) cell.classList.add("dragging"); // 든 개체의 원래 칸 — 빈 칸처럼 흐리다
    cell.title = `${pet.name} · 끌어서 옮기기`;
    cell.addEventListener("pointerdown", (e) => {
      if (!hold.box) startDrag(e, cell, { boxId: box.id, slot });
    });
    cell.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다
    dropZone(cell, onDrop);
    grid.appendChild(cell);
  });
  bodyEl.appendChild(grid);
  if (boxHeld?.ghost) drawHoldGhost(grid, boxHeld.petId);
}

// 박스 이름 — 누르면 입력칸이 된다. Enter·바깥 클릭으로 저장, Esc 로 취소. 비우면 기본 이름(박스 N)
function boxNameEl(box: BoxView): HTMLElement {
  if (!boxUi.renaming) {
    const name = buttonEl("label box-name", box.name);
    name.title = "눌러서 이름 바꾸기";
    name.addEventListener("click", () => {
      boxUi.renaming = true;
      boxUi.sortOpen = false;
      boxUi.menuOpen = false;
      redrawBody();
    });
    return name;
  }
  const input = document.createElement("input");
  input.className = "search box-name-input";
  input.value = box.name;
  if (ui.view) input.maxLength = ui.view.limits.boxNameMax; // 넘김 줄의 이름 칸 폭(.box-name-cell)도 이 글자 수(12)에 맞춘다
  input.setAttribute("aria-label", "박스 이름");
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    boxUi.renaming = false;
    const name = input.value;
    if (document.activeElement === input) input.blur(); // 포커스가 남아 있으면 다시 그리기가 미뤄져(typingSearch) 입력칸이 그대로 남는다
    if (save && name.trim() !== box.name) void boxCommand("box.rename", box.id, { name });
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

// 정렬 — 지금 보는 박스만 한 번 정렬한다. 목록은 바깥을 누르면 닫힌다
function boxSortEl(box: BoxView): HTMLElement {
  const wrap = el("div", "box-sort");
  const current = BOX_SORTS.find((s) => s.by === boxSortedBy.get(box.id));
  const toggle = buttonEl("sort-toggle", `${current?.label ?? "정렬"} ▾`);
  toggle.setAttribute("aria-expanded", String(boxUi.sortOpen));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    boxUi.sortOpen = !boxUi.sortOpen;
    boxUi.menuOpen = false;
    redrawBody();
  });
  wrap.appendChild(toggle);
  if (boxUi.sortOpen) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const s of BOX_SORTS) {
      const item = buttonEl(s.by === current?.by ? "sort-item on" : "sort-item", s.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(s.by === current?.by));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        boxUi.sortOpen = false;
        void boxCommand("box.sort", box.id, { by: s.by }, () => boxSortedBy.set(box.id, s.by));
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

// 칸을 옮겨 순서가 흐트러진 박스는 정렬 표시를 지운다
function unsorted(...boxIds: string[]): void {
  for (const id of boxIds) boxSortedBy.delete(id);
}

// 박스 명령 — 대화상자 밖에서 보낸다. 실패하면 박스 줄 아래에 이유를 한 줄 보인다. 성공하면 onOk 를 먼저 부르고 다시 그린다
async function boxCommand(cmd: string, target: string, extra: Record<string, unknown>, onOk?: () => void): Promise<void> {
  if (ui.busy) return;
  ui.busy = true;
  let reply: ManageReply;
  try {
    reply = await requestCommand(cmd, target, extra);
    if (reply.ok) onOk?.();
    await refreshView();
  } finally {
    ui.busy = false;
  }
  boxUi.note = reply.ok ? "" : failTextOf(reply.reason, "command").text;
  redrawBody();
}
