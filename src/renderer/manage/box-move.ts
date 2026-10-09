// 설정창의 옮기기와 끌어 놓기 — 포켓몬 메뉴의 `옮기기` 로 든 개체, 커서를 따라오는 칸, 포인터로 끌어 놓기 (P10 13-1)
// 든 개체는 커서를 따라간다(교체 화면에서는 원래 칸만 흐리다). 다른 개체 칸을 누르면 맞바꾸고, 빈 칸을 누르면 거기 놓는다. ◀·▶ 를 누르면 든 채로 박스를 넘긴다.
// 그 밖의 곳을 누르거나 Esc 를 누르면 취소한다 (2026-10-01 사용자 결정 "실제 게임처럼 마우스에 들리고 …"). 끌어 놓기는 그대로 따로 있다.
// 명령은 끌어 놓기와 같은 box.move 다
// 든 것·끄는 것의 상태는 box-state.ts(파티 탭·교체 화면도 읽는다). 놓을 곳의 처리는 부르는 쪽이 dropZone 으로 준다
import type { PetView } from "../../shared/model/snapshot.js";
import { boxUi, hold, type DragFrom } from "./box-state.js";
import { closeDialog } from "./dialog.js";
import { redrawBody, setTab } from "./shell.js";
import { petInView, ui } from "./state.js";

// 설정창이 거는 고리 — 박스 칸 그리기를 이 파일이 가져오지 않게
export interface BoxMoveHooks {
  ghostCell(pet: PetView): HTMLElement; // 커서를 따라오는 칸 — 박스 칸과 같은 모습(박스 탭의 boxSlot)
}
let hooks: BoxMoveHooks | null = null;
export function setBoxMoveHooks(next: BoxMoveHooks): void {
  hooks = next;
}
function hooksOf(): BoxMoveHooks {
  if (!hooks) throw new Error("box-move.ts 의 고리가 걸리지 않았다 — setBoxMoveHooks 를 먼저 부른다");
  return hooks;
}

// 커서를 따라가는 칸(holdGhost)과 마지막 커서 자리(holdAt) — 옮기기로 든 동안 (든 개체는 box-state.ts hold.box)
let holdGhost: HTMLElement | null = null;
let holdAt: { x: number; y: number } | null = null;

export function startHold(petId: string): void {
  const v = ui.view;
  if (!v) return;
  for (let b = 0; b < v.boxes.length; b += 1) {
    const box = v.boxes[b];
    const slot = box ? box.slots.findIndex((p) => p?.id === petId) : -1;
    if (!box || slot < 0) continue;
    if (ui.dialog) closeDialog();
    endHold();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // 입력 중인 칸이 있으면 다시 그리기가 미뤄진다 (typingSearch)
    setTab("box");
    ui.detailPet = null;
    boxUi.page = b;
    boxUi.sortOpen = false;
    boxUi.menuOpen = false;
    boxUi.renaming = false;
    boxUi.note = "";
    hold.box = { petId, boxId: box.id, slot, ghost: true };
    redrawBody();
    return;
  }
}

// 든 것을 내려놓는다 — 다시 그리지는 않는다
export function endHold(): void {
  hold.box = null;
  holdAt = null;
  holdGhost?.remove();
  holdGhost = null;
}

function cancelHold(): void {
  if (!hold.box) return;
  endHold();
  redrawBody();
}

// 커서를 따라가는 칸 — 끌기의 반투명 사본과 같은 모습. 커서 자리를 아직 모르면(메뉴 창에서 막 넘어왔다) 원래 칸 옆에 둔다.
// 포켓몬 메뉴의 `옮기기` 로 든 때만 띄운다 (hold.box.ghost)
export function drawHoldGhost(grid: HTMLElement, petId: string): void {
  const pet = petInView(petId);
  const any = grid.querySelector<HTMLElement>(".cell");
  if (!pet || !any) return;
  if (!holdGhost) {
    holdGhost = hooksOf().ghostCell(pet);
    holdGhost.classList.add("drag-ghost");
    document.body.appendChild(holdGhost);
  }
  const rect = any.getBoundingClientRect();
  holdGhost.style.width = `${rect.width}px`;
  holdGhost.style.height = `${rect.height}px`;
  if (!holdAt) {
    const from = grid.querySelector<HTMLElement>(".cell.dragging")?.getBoundingClientRect() ?? rect;
    holdAt = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  }
  placeHoldGhost();
}

function placeHoldGhost(): void {
  if (!holdGhost || !holdAt) return;
  holdGhost.style.left = `${holdAt.x - holdGhost.offsetWidth / 2 + 12}px`;
  holdGhost.style.top = `${holdAt.y - holdGhost.offsetHeight / 2 + 12}px`;
}

window.addEventListener("pointermove", (e) => {
  if (!hold.box?.ghost) return;
  holdAt = { x: e.clientX, y: e.clientY };
  placeHoldGhost();
});
// 칸과 ◀·▶ 밖을 누르면 취소한다 — 칸과 ◀·▶ 는 제 처리기가 먼저 돈다
document.addEventListener("click", (e) => {
  if (!hold.box) return;
  if (e.target instanceof Element && e.target.closest("[data-hold]")) return;
  cancelHold();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && hold.box) cancelHold();
});

// 끌어 놓을 수 있는 곳 — 끄는 중에 커서 아래에 오면 옅은 바탕(.drop-on)
// 끌기는 브라우저의 끌어 놓기(OS 끌기)를 쓰지 않고 포인터 이벤트로 한다. 동반자의 무대 창이 화면 전체를 덮고 있어
// OS 끌기 신호가 관리 창에 닿지 않았다 (2026-09-27 사용자 "박스에서 드래그드랍이 아예 안되네")
const dropTargets = new WeakMap<Element, () => void>();
export function dropZone(target: HTMLElement, onDrop: () => void): void {
  target.dataset.drop = "";
  dropTargets.set(target, onDrop);
}

const DRAG_START_PX = 5; // 이만큼 움직여야 끌기로 본다 — 그보다 작으면 누르기(개체 상세)

export function startDrag(down: PointerEvent, cell: HTMLElement, from: DragFrom): void {
  if (down.button !== 0) return;
  const x0 = down.clientX;
  const y0 = down.clientY;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;
  const place = (e: PointerEvent): void => {
    if (!ghost) return;
    ghost.style.left = `${e.clientX - ghost.offsetWidth / 2 + 12}px`;
    ghost.style.top = `${e.clientY - ghost.offsetHeight / 2 + 12}px`;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]") ?? null;
    const next = hit && hit !== cell ? hit : null;
    if (next === over) return;
    over?.classList.remove("drop-on");
    next?.classList.add("drop-on");
    over = next;
  };
  const move = (e: PointerEvent): void => {
    if (!ghost) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_START_PX) return;
      hold.drag = from;
      boxUi.sortOpen = false;
      boxUi.menuOpen = false;
      const rect = cell.getBoundingClientRect();
      ghost = cell.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      ghost.removeAttribute("title");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      cell.classList.add("dragging");
    }
    place(e);
  };
  const end = (drop: boolean): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    if (!ghost) return;
    ghost.remove();
    cell.classList.remove("dragging");
    over?.classList.remove("drop-on");
    const target = over;
    // 끈 뒤 손을 뗀 곳에서 이어 오는 click(상세 열기)을 한 번 막는다
    const swallow = (c: Event): void => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    // 놓을 곳의 처리기는 hold.drag 를 읽는다 — 부른 뒤에 지운다
    if (drop && target) dropTargets.get(target)?.();
    hold.drag = null;
  };
  const up = (): void => end(true);
  const cancel = (): void => end(false);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}
