// 설정창의 모달 — 하나만 뜬다. 어느 모달인지는 ui.dialog 하나가 가진다
// - 모달 종류마다 registerDialog 로 폭(shape)·헤더 열림 표시·그리기·들어올 때 할 일을 등록한다
// - 여닫기, 가림막, 다시 그릴 때의 스크롤 되돌리기, 바닥 단추 줄의 실패 글자, 입력 중 미루기
// - 아직 나뉘지 않은 쪽(검색·돌보미집 겹침·설정의 화면 표시·튜토리얼·경고 배너)은 설정창이 setDialogHooks 로 걸어 준다
import { buttonEl, el, needEl } from "../ui/dom.js";
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
  openAny(next: Dialog): void; // 제목 줄의 돌아가기 — 개체 상세(pet)도 여는 설정창의 open
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
function markHeaderOpen(): void {
  for (const m of modules.values()) if (m.headerButton) document.getElementById(m.headerButton)?.classList.toggle("open", ui.dialog?.kind === m.kind);
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
    const rows = dialogEl.querySelectorAll<HTMLElement>(":scope > .actions"); // 바닥 줄만 — 연결 줄 단추 묶음(.actions)은 뺀다
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

// 모달을 연다 — 다른 모달로 갈 때는 지난 실패 문구를 지운다. 구매 창의 부족 안내처럼 그 화면이 다시 만드는 것은 남는다
// 개체 상세(`pet`)는 모달이 아니다 — 설정창의 open 이 먼저 가른다
export function openDialog(next: Dialog): void {
  moduleOf(next.kind).enter?.(next, ui.dialog);
  ui.dialog = next;
  ui.notice = "";
  drawDialog();
}

export function closeDialog(): void {
  ui.dialog = null;
  ui.notice = "";
  setScrim(false);
  hooksOf().afterEmpty();
}

// 모달 닫기 — 돌보미집 위에 겹친 부화 결과는 닫으면 돌보미집으로 돌아간다(✕·Esc·바깥 누르기 모두)
export function dismissDialog(): void {
  if (ui.dialog?.kind === "hatched" && ui.dialog.over) openDialog({ kind: ui.dialog.over });
  else closeDialog();
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

// 제목 줄 — `back` 을 주면 돌아가기를 앞에 둔다. 모달을 겹치지 않고 안에서 화면을 바꾼다.
// 돌아갈 곳이 개체 상세(pet)일 수 있어 설정창의 open 고리로 연다
export function dialogHead(title: string, sub: string, back?: { label: string; to: Dialog }): HTMLElement[] {
  const row = el("div", "title-row");
  if (back) {
    const b = buttonEl("back", `‹ ${back.label}`);
    b.addEventListener("click", () => openAnyDialog(back.to));
    row.appendChild(b);
  }
  row.appendChild(el("h2", undefined, title));
  return sub ? [row, el("div", "sub", sub)] : [row];
}

export const closeButton = (label = "닫기"): HTMLButtonElement => actionButtonEl(label, false, false, closeDialog);

// 개체 상세(pet)일 수도 있는 곳으로 간다 — 대화상자 안의 `취소`·돌아가기가 연 곳으로 되돌아갈 때. 모달만 열 때는 openDialog
export function openAnyDialog(next: Dialog): void {
  hooksOf().openAny(next);
}
