// 설정창의 모달 — 하나만 뜬다. 어느 모달인지는 ui.dialog 하나가 가진다
// - 닫는 규칙(docs/specs/ui-components.md C-13 "닫기 규칙"): ✕·Esc·가림막은 모두 한 단계 물러나기(dismissDialog)다.
//   다른 모달 안에서 연 모달(하위 모달)은 openSubDialog 로 열고, 물러나면 부모 모달로 돌아간다. 부모는 여기 스택이 기억한다
// - 모달 종류마다 registerDialog 로 폭(shape)·헤더 열림 표시·그리기·들어올 때 할 일을 등록한다
// - 여닫기, 가림막, 다시 그릴 때의 스크롤 되돌리기, 바닥 단추 줄의 실패 글자, 입력 중 미루기
// - 아직 나뉘지 않은 쪽(검색·돌보미집 겹침·설정의 화면 표시·튜토리얼·경고 배너)은 설정창이 setDialogHooks 로 걸어 준다
import { buttonEl, el, needEl } from "../ui/dom.js";
import { closeIconEl } from "../ui/line-icons.js";
import type { Dialog } from "./dialog-types.js";
import { ui } from "./state.js";

export const scrimEl = needEl("scrim", HTMLElement, "manage");
export const dialogEl = needEl("dialog", HTMLElement, "manage");

type DialogKind = Dialog["kind"];
type DialogOf<K extends DialogKind> = Extract<Dialog, { kind: K }>;

export interface DialogModule<K extends DialogKind> {
  kind: K;
  shape: string; // 모달마다 폭이 다르다. 고르기는 격자가 들어가서 넓고, 목록은 길어서 안에서 스크롤한다
  headerButton?: string; // 이 모달이 떠 있는 동안 열림 표시를 달 헤더 아이콘의 id
  draw(d: DialogOf<K>): void;
  enter?(d: DialogOf<K>, prev: Dialog | null): void; // 들어올 때 — 지난 모달(prev)과 견줘 상태를 처음으로 돌린다
  leave?(): void; // 이 모달을 떠날 때(닫기·다른 모달로) — 모달 안의 덧창 같은 상태를 지운다
}
const modules = new Map<DialogKind, DialogModule<DialogKind>>();
export function registerDialog<K extends DialogKind>(m: DialogModule<K>): void {
  if (modules.has(m.kind)) throw new Error(`모달 ${m.kind} 를 두 번 등록했다`);
  modules.set(m.kind, m as unknown as DialogModule<DialogKind>);
}
function moduleOf(kind: DialogKind): DialogModule<DialogKind> {
  const m = modules.get(kind);
  if (!m) throw new Error(`등록하지 않은 모달 ${kind}`);
  return m;
}

export interface DialogHooks {
  isTyping(root: HTMLElement): boolean; // 그 영역의 검색 칸에 입력 중인가 — 그러면 다시 그리기를 미룬다
  drawUnder(): void; // 겹친 모달의 뒤(돌보미집 위의 부화 결과)
  alertEl(text: string): HTMLElement; // 단추 줄이 없는 모달의 실패 줄
  afterDraw(): void; // 다 그린 뒤 — 검색 칸 초점 되돌리기, 화면 표시, 튜토리얼
  afterEmpty(): void; // 모달이 없어졌다 — 화면 표시
  onScrimChanged(): void; // 가림막이 켜지거나 꺼졌다 — 코치마크를 감추거나 다시 그린다
  openAny(next: Dialog): void; // 제목 줄의 돌아가기 — 개체 상세(pet)도 여는 routes.ts openDialogOrPet
}
let hooks: DialogHooks | null = null;
export function setDialogHooks(next: DialogHooks): void {
  hooks = next;
}
function hooksOf(): DialogHooks {
  if (!hooks) throw new Error("dialog.ts 의 고리가 걸리지 않았다 — setDialogHooks 를 먼저 부른다");
  return hooks;
}

// 가림막 — 켜고 끌 때 메인에도 알린다. OS 가 그리는 창 단추 자리는 CSS 가 덮지 못한다
let dimmed = false;
export const isDimmed = (): boolean => dimmed;
export function setScrim(on: boolean): void {
  scrimEl.classList.toggle("open", on);
  markHeaderOpen(); // 닫는 길(closeDialog·개체 상세로 넘어가기)은 drawDialog 를 거치지 않는다 — 헤더 아이콘의 열림 표시도 여기서 맞춘다
  if (on === dimmed) return;
  dimmed = on;
  hooksOf().onScrimChanged(); // 모달이 열리면 코치마크를 감추고, 닫히면 다시 그린다. 창 단추 자리 어둡게 하기도 여기서 맞춘다
}

// 다시 그린 대화상자의 스크롤 — 같은 대화상자·같은 탭이면 스크롤 위치를 되돌린다.
// 버튼을 누르거나 1초 새로 그리기 때 대화상자를 통째로 다시 만들어 맨 위로 튀던 것을 막는다 (2026-09-27 사용자 "설정에서 스크롤 내리고, 버튼 누르면 스크롤이 올라가짐")
let dialogScrollKey = "";
const dialogKeyOf = (d: Dialog): string => `${d.kind}:${"tab" in d ? String(d.tab) : ""}`;
// 다음 그리기는 맨 위부터 — 같은 모달 안에서 목록을 바꿨다(업적 분류 등)
export function resetDialogScroll(): void {
  dialogScrollKey = "";
}

// 헤더 아이콘의 열림 표시 — 그 아이콘이 여는 모달이 떠 있는 동안 진한 배경 (docs/specs/ui-components.md C-02, Figma `Header Icon Button` `State=Open`)
// 하위 모달이 떠 있어도 부모 모달의 아이콘은 켜 둔다(설정 → 패치노트·가이드북, 우편함 → 편지)
function markHeaderOpen(): void {
  const shown = ui.dialog ? [ui.dialog.kind, ...parents.map((p) => p.kind)] : [];
  for (const m of modules.values()) if (m.headerButton) document.getElementById(m.headerButton)?.classList.toggle("open", shown.includes(m.kind));
}

// 이번 그리기에서 대화상자 안의 상자가 오류를 이미 보였나 — 그러면 바닥 줄에 또 보이지 않는다
let noticeInline = false;

let dialogHeld = false; // 입력 중이라 미룬 대화상자 다시 그리기
// 검색 칸을 떠났다 — 미룬 대화상자 다시 그리기를 한다
export function redrawHeldDialog(): void {
  if (!dialogHeld) return;
  dialogHeld = false;
  drawDialog();
}

export function drawDialog(): void {
  const h = hooksOf();
  markHeaderOpen();
  noticeInline = false;
  if (ui.dialog && h.isTyping(dialogEl)) {
    dialogHeld = true;
    return;
  }
  dialogHeld = false;
  if (!ui.dialog) {
    setScrim(false);
    dialogScrollKey = "";
    h.afterEmpty();
    return;
  }
  setScrim(true);
  const key = dialogKeyOf(ui.dialog);
  const keep = key === dialogScrollKey ? (dialogEl.querySelector<HTMLElement>(".scroll")?.scrollTop ?? 0) : 0;
  dialogScrollKey = key;
  const m = moduleOf(ui.dialog.kind);
  dialogEl.className = m.shape;
  dialogEl.replaceChildren();
  h.drawUnder();
  m.draw(ui.dialog);

  // 실패는 바닥 단추 줄의 빈자리에 빨간 점과 글자로 — 대화상자 끝에 줄을 끼우지 않는다 (2026-09-30 사용자 결정, Figma 05 `Dialog · 실패 (바닥 단추 줄 빈자리)` `1126:24745`).
  // 단추 줄이 없는 대화상자만 예전처럼 경고 줄을 둔다
  if (ui.notice && !noticeInline) {
    // 바닥 줄만 — 연결 줄 단추 묶음(.actions)은 뺀다. 교체·고르기 모달의 바닥 줄(.swap-acts)도 바닥 줄이다 — 빠지면 실패가 새 줄로 붙어 모달이 흔들린다
    // (2026-10-10 조작 점검 공통 원인 1, worklog/records/interaction-audit)
    const rows = dialogEl.querySelectorAll<HTMLElement>(":scope > .actions, :scope > .swap-acts");
    const row = rows[rows.length - 1];
    if (row) {
      const err = el("div", "footer-error");
      err.append(el("i"), el("span", undefined, ui.notice));
      err.title = ui.notice;
      // 남는 폭에만 선다 — spacer 가 있으면 그 안(보조 단추 뒤, Figma `Dialog` `footer › spacer › error-notice`), 없으면 줄 끝. 단추 자리는 그대로
      const spacer = row.querySelector(":scope > .spacer");
      (spacer ?? row).appendChild(err);
    } else dialogEl.appendChild(h.alertEl(ui.notice));
  }
  const scroll = dialogEl.querySelector<HTMLElement>(".scroll");
  if (scroll && keep) scroll.scrollTop = keep;
  h.afterDraw();
}

// 하위 모달의 부모들 — 바깥 것부터. 하위 모달에서 물러나면 마지막 것으로 돌아간다
let parents: Dialog[] = [];

// 떠나는 모달의 정리 고리를 부른다 — 같은 모달 안에서 값만 바뀌면(탭·고른 항목) 떠나는 것이 아니다
function leaveCurrent(next: Dialog | null): void {
  const cur = ui.dialog;
  if (cur && cur.kind !== next?.kind) moduleOf(cur.kind).leave?.();
}

// 모달을 연다 — 다른 모달로 갈 때는 지난 실패 문구를 지운다. 구매 창의 부족 안내처럼 그 화면이 다시 만드는 것은 남는다
// 다른 모달로 바꾸면 부모 스택을 비운다. 같은 모달 안에서 값만 바꾸면(패치노트의 버전 고르기 등) 부모를 그대로 둔다
// 개체 상세(`pet`)는 모달이 아니다 — routes.ts openDialogOrPet 이 먼저 가른다
export function openDialog(next: Dialog): void {
  if (ui.dialog?.kind !== next.kind) parents = [];
  leaveCurrent(next);
  moduleOf(next.kind).enter?.(next, ui.dialog);
  ui.dialog = next;
  ui.notice = "";
  drawDialog();
}

// 하위 모달을 연다 — 지금 모달을 부모로 기억한다. 물러나면(✕·Esc·가림막·확인 창의 취소) 부모로 돌아간다
export function openSubDialog(next: Dialog): void {
  const stack = ui.dialog ? [...parents, ui.dialog] : [];
  openDialog(next);
  parents = stack;
  markHeaderOpen();
}

export function closeDialog(): void {
  leaveCurrent(null);
  parents = [];
  ui.dialog = null;
  ui.notice = "";
  setScrim(false);
  hooksOf().afterEmpty();
}

// 기기 창이 다른 개체로 넘어갔다 — 앞 개체에 묶인 모달(진화·모습·메가·기술 바꾸기·팔기 등)은 닫는다.
// 기기 창은 가림막이 덮지 못해, 모달은 A 를 다루는데 기기 창은 B 를 보이던 일을 막는다(2026-10-10 조작 점검 공통 원인 8).
// 지난 실패 문구도 지운다 — 앞 개체의 실패가 다음 개체의 자리 줄에 남지 않게
export function leavePet(nextPetId: string): void {
  ui.notice = "";
  const d = ui.dialog;
  if (d && d.kind !== "hatched" && "petId" in d && d.petId && d.petId !== nextPetId) closeDialog();
}

// 그리는 중에 대상이 사라져 닫는다 — 방금 실패한 문구는 남겨 기기 창 자리 줄에 보이게 한다
// (실패 뒤 후보가 사라져 모달이 말없이 닫히던 것, 2026-10-10 조작 점검 공통 원인 2)
export function closeDialogKeepNotice(): void {
  const notice = ui.notice;
  closeDialog();
  ui.notice = notice;
}

// 한 단계 물러나기 — ✕·Esc·가림막 누르기·확인 창의 취소. 하위 모달이면 부모로, 아니면 닫는다
export function dismissDialog(): void {
  const back = parents[parents.length - 1];
  if (!back) {
    closeDialog();
    return;
  }
  const rest = parents.slice(0, -1);
  openDialog(back);
  parents = rest;
  markHeaderOpen();
}

export function actionButtonEl(label: string, primary: boolean, disabled: boolean, run: () => void): HTMLButtonElement {
  const b = buttonEl(primary ? "act primary" : "act", label);
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
}

export function actionsRowEl(...items: HTMLElement[]): HTMLElement {
  const box = el("div", "actions");
  box.append(...items);
  return box;
}

// 제목 줄 — 제목과 부제. close 면 오른쪽 위에 ✕ 를 둔다(한 단계 물러나기, C-13 닫기 규칙 4번).
// 확인 창·결과 창은 ✕ 를 두지 않는다 — `취소`·`확인` 이 물러나기다. `‹ 돌아가기` 는 두지 않는다(2026-10-10)
export function dialogHead(title: string, sub: string, opts?: { close?: boolean }): HTMLElement[] {
  const row = el("div", "title-row");
  row.appendChild(el("h2", undefined, title));
  const lines = sub ? [row, el("div", "sub", sub)] : [row];
  if (!opts?.close) return lines;
  const head = el("div", "dialog-head");
  const titles = el("div", "titles");
  titles.append(...lines);
  const x = buttonEl("dialog-close");
  x.appendChild(closeIconEl());
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", dismissDialog);
  head.append(titles, x);
  return [head];
}

// 개체 상세(pet)일 수도 있는 곳으로 간다 — 대화상자 안의 `취소`·돌아가기가 연 곳으로 되돌아갈 때. 모달만 열 때는 openDialog
export function openAnyDialog(next: Dialog): void {
  hooksOf().openAny(next);
}
