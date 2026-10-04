// 설정창의 1초 시계 — 시계가 울릴 때마다 스냅샷을 다시 읽는다 (2026-09-29 사용자 지시 — 앱 전역 타이머가 1초마다 갱신)
//   시간으로만 바뀌는 값(LIVE_KEYS)만 달라졌다   표시만 고친다(applyLive). 탭 포커스·title 툴팁·글자 선택이 남는다
//   그 밖의 모양이 바뀌었다                       전체를 다시 그린다. 포커스는 같은 자리 요소로 되돌린다(shell.ts 초점 경로)
// 전체 다시 그리기는 끊기는 조작 중에는 미루고 다음 시계에 한다 — 끌기·박스 이름 입력·누르는 중·한글 조합 중·글자 입력 칸 포커스.
// 표시 고치기는 입력 요소를 건드리지 않으므로 그동안에도 한다.
// ui.view 는 화면에 그린 모양의 값이다 — 처리기(단추)는 이것을 읽는다. 미루는 동안에는 새 값의 시간 표시만 먼저 보인다
// 모양 비교와 시간 필드 목록은 ui/live-draw.ts · shared/live-keys.ts
import type { PetView, Snapshot } from "../../shared/model/snapshot.js";
import { clampPercent } from "../ui/fill-bar.js";
import { structureOf } from "../ui/live-draw.js";
import { api } from "./api.js";
import { drawDialog } from "./dialog.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";

// 설정창이 거는 고리 — 탭의 상태를 이 파일이 읽지 않게
export interface LiveHooks {
  isHolding(): boolean; // 탭이 아는 끊기는 조작 중인가 — 끌기·박스 이름 입력
  afterLive(): void; // 시간 값만 새것으로 바꾼 뒤 — 기기 창도 새 시간 값을 받는다(기기 창이 표시만 고친다)
}
let hooks: LiveHooks | null = null;
export function setLiveHooks(next: LiveHooks): void {
  hooks = next;
}
function hooksOf(): LiveHooks {
  if (!hooks) throw new Error("live.ts 의 고리가 걸리지 않았다 — setLiveHooks 를 먼저 부른다");
  return hooks;
}

let drawnStructure = ""; // 마지막으로 그린 모양
let clockBusy = false;
let pointerDown = false;
let composing = false;
document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener("pointerup", () => (pointerDown = false), true);
document.addEventListener("pointercancel", () => (pointerDown = false), true);
window.addEventListener("blur", () => (pointerDown = false));
document.addEventListener("compositionstart", () => (composing = true), true);
document.addEventListener("compositionend", () => (composing = false), true);

// 글자를 치는 칸에 포커스가 있는가 — 슬라이더·체크 칸은 누르는 중에만 막는다(pointerDown). 창이 뒤에 있으면 입력 중으로 보지 않는다
const TEXT_TYPES = new Set(["text", "search", "password", "email", "number", "url", "tel"]);
const typingText = (): boolean => {
  if (!document.hasFocus()) return false;
  const a = document.activeElement;
  return (a instanceof HTMLInputElement && TEXT_TYPES.has(a.type)) || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable);
};
const holdFullDraw = (): boolean => hooksOf().isHolding() || pointerDown || composing || typingText();

// 시간 표시만 고친다 — 개체 막대(data-live-pet)와 알 글자(data-live-egg)
function applyLive(v: Snapshot | null = ui.view): void {
  if (!v) return;
  const pets = new Map<string, PetView>();
  for (const s of v.party.slots) if (s.pet) pets.set(s.pet.id, s.pet);
  for (const b of v.boxes) for (const p of b.slots) if (p) pets.set(p.id, p);
  for (const box of document.querySelectorAll<HTMLElement>("[data-live-pet]")) {
    const pet = pets.get(box.dataset.livePet ?? "");
    const field = box.dataset.liveField;
    if (!pet || (field !== "affinity" && field !== "fullness")) continue;
    const value = pet[field];
    const shown = box.querySelector<HTMLElement>(".row span:last-child");
    if (shown && shown.textContent !== `${value}/100`) shown.textContent = `${value}/100`;
    const fill = box.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${clampPercent(value)}%`;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-live-buff]")) {
    const [petId, kind] = (node.dataset.liveBuff ?? "").split("|");
    const buff = pets.get(petId ?? "")?.buffs.find((b) => b.kind === kind);
    if (buff && node.textContent !== buff.text) node.textContent = buff.text;
  }
  const eggs = new Map(v.eggs.list.map((e) => [e.id, e]));
  for (const node of document.querySelectorAll<HTMLElement>("[data-live-egg]")) {
    const egg = eggs.get(node.dataset.liveEgg ?? "");
    if (egg && node.textContent !== egg.noteText) node.textContent = egg.noteText;
  }
}

export async function clockTick(): Promise<void> {
  if (clockBusy) return;
  clockBusy = true;
  try {
    const next = await api.snapshot();
    const structure = structureOf(next);
    if (structure === drawnStructure) {
      ui.view = next; // 모양이 같다 — 시간 값만 새것으로
      applyLive();
      hooksOf().afterLive();
      return;
    }
    if (holdFullDraw()) {
      applyLive(next); // 모양은 다음 시계에 — 시간 표시만 먼저
      return;
    }
    ui.view = next;
    drawnStructure = structure;
    redrawBody();
    drawDialog();
  } finally {
    clockBusy = false;
  }
}

// 스냅샷을 새로 읽어 전체를 다시 그린다 — 명령의 답 뒤, 첫 화면, 바로가기
export async function refreshView(): Promise<void> {
  ui.view = await api.snapshot();
  drawnStructure = structureOf(ui.view);
  redrawBody();
}
