// 설정창의 틀 — 헤더 숫자, 탭 줄, 본문 다시 그리기, 탭 옮기기
// - 탭은 registerTab 으로 등록한 순서대로 탭 줄에 선다. 탭마다 그리기·들어올 때·나갈 때 할 일을 준다
// - 본문을 그리기 전에 기기 창을 맞춘다(registerBodySync, 등록 순서). 그린 뒤 할 일은 registerAfterDraw(등록 순서)
// - 탭을 옮길 때 탭과 무관한 정리는 설정창이 setShellHooks 로 걸어 준다
import type { Snapshot } from "../../shared/model/snapshot.js";
import { numberText } from "../../shared/count-text.js";
import { buttonEl, el, needEl } from "../ui/dom.js";
import type { TabId } from "./dialog-types.js";
import { ui } from "./state.js";

const pointsEl = needEl("points", HTMLElement, "manage");
const tabsEl = needEl("tabs", HTMLElement, "manage");
export const bodyEl = needEl("body", HTMLElement, "manage");
const achDotEl = needEl("achievements-dot", HTMLElement, "manage");

export interface TabModule {
  id: TabId;
  label: string;
  icon: string; // 16px 선 그림의 svg 속 — 고정 그림이라 사용자 값이 들어가지 않는다
  draw(view: Snapshot): void;
  enter?(): void; // 이 탭으로 왔다 — 탭 값을 바꾼 뒤
  leave?(): void; // 이 탭을 떠난다 — 탭 값을 바꾸기 전
}
const tabs: TabModule[] = [];
export function registerTab(tab: TabModule): void {
  if (tabs.some((t) => t.id === tab.id)) throw new Error(`탭 ${tab.id} 를 두 번 등록했다`);
  tabs.push(tab);
}
const bodySyncs: (() => void)[] = [];
export function registerBodySync(sync: () => void): void {
  bodySyncs.push(sync);
}
const afterDraws: (() => void)[] = [];
export function registerAfterDraw(fn: () => void): void {
  afterDraws.push(fn);
}

export interface ShellHooks {
  isTyping(root: HTMLElement): boolean; // 그 영역의 검색 칸에 입력 중인가 — 그러면 다시 그리기를 미룬다
  beforeTabChange(): void; // 탭을 옮기기 전 — 탭과 무관한 정리(개체 상세·든 개체·이름 고치기)
  afterTabChange(): void; // 탭 값을 바꾼 뒤 — 탭과 무관한 정리(가방 결과 줄)
}
let hooks: ShellHooks | null = null;
export function setShellHooks(next: ShellHooks): void {
  hooks = next;
}
function hooksOf(): ShellHooks {
  if (!hooks) throw new Error("shell.ts 의 고리가 걸리지 않았다 — setShellHooks 를 먼저 부른다");
  return hooks;
}

function drawTabs(): void {
  tabsEl.replaceChildren();
  for (const t of tabs) {
    const b = buttonEl("");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" style="color: var(--muted)">${t.icon}</svg>`; // 고정 그림 — 사용자 값이 들어가지 않는다
    b.appendChild(el("span", undefined, t.label));
    b.setAttribute("aria-selected", String(t.id === ui.tab));
    b.addEventListener("click", () => {
      setTab(t.id);
      redrawBody();
    });
    tabsEl.appendChild(b);
  }
}

// 탭 줄의 그 탭 단추 — 튜토리얼이 가리킨다
export const tabButtonOf = (id: TabId): HTMLElement | null => (tabsEl.children[tabs.findIndex((t) => t.id === id)] as HTMLElement | undefined) ?? null;

// 탭 옮기기 — 탭을 바꾸는 곳은 모두 여기를 거친다. 그리기는 부르는 쪽이 한다
// - 나가는 탭의 상세 기기 창을 닫는다: 파티·박스는 개체 상세, 도감은 도감 기기 창 (2026-09-30 사용자 결정 "그냥 해당 탭을 나가면 상세 닫게해.")
// - 같은 탭이면 아무것도 닫지 않는다. 다시 그 탭에 와도 상세를 다시 열지 않는다
export function setTab(next: TabId): void {
  if (next === ui.tab) return;
  const h = hooksOf();
  h.beforeTabChange();
  tabs.find((t) => t.id === ui.tab)?.leave?.();
  ui.tab = next;
  h.afterTabChange();
  tabs.find((t) => t.id === next)?.enter?.();
}

let bodyHeld = false; // 입력 중이라 미룬 본문 다시 그리기
// 검색 칸을 떠났다 — 미룬 본문 다시 그리기를 한다
export function redrawHeldBody(): void {
  if (!bodyHeld) return;
  bodyHeld = false;
  redrawBody();
}

export function redrawBody(): void {
  if (hooksOf().isTyping(bodyEl)) {
    bodyHeld = true; // 검색 칸을 떠나면 그린다 (redrawHeldBody)
    return;
  }
  bodyHeld = false;
  const kept = focusPath();
  drawBody();
  restoreFocusPath(kept);
}

function drawBody(): void {
  drawTabs();
  bodyEl.replaceChildren();
  if (!ui.view) {
    bodyEl.appendChild(el("div", "empty-note", "저장이 없습니다. 첫 포켓몬을 먼저 고르세요."));
    return;
  }
  pointsEl.textContent = numberText(ui.view.points);
  achDotEl.hidden = ui.view.achievements.unclaimed === 0;
  for (const sync of bodySyncs) sync(); // 기기 창 — 고른 것이 사라졌으면 닫는다
  const tab = tabs.find((t) => t.id === ui.tab);
  if (!tab) throw new Error(`등록하지 않은 탭 ${ui.tab}`);
  tab.draw(ui.view);
  for (const fn of afterDraws) fn();
}

// 전체 다시 그리기 뒤 포커스를 같은 자리로 — 탭 줄·본문 안에서 자식 번호 길과 모양(태그·클래스)이 같은 요소
// 다시 그리면 요소가 새로 생겨 키보드 포커스가 사라진다 (2026-09-29 검수 C2)
interface FocusPath {
  root: HTMLElement;
  path: number[];
  sign: string;
}
const signOf = (e: Element): string => `${e.tagName}.${e.className}`;
function focusPath(): FocusPath | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === document.body || a.dataset.search != null) return null; // 검색 칸은 searchFocus 가 맡는다
  const root = [tabsEl, bodyEl].find((r) => r.contains(a) && r !== a);
  if (!root) return null;
  const path: number[] = [];
  for (let n: Element = a; n !== root; n = n.parentElement as Element) path.unshift([...(n.parentElement?.children ?? [])].indexOf(n));
  return { root, path, sign: signOf(a) };
}
function restoreFocusPath(kept: FocusPath | null): void {
  if (!kept || (document.activeElement && document.activeElement !== document.body)) return;
  let n: Element | undefined = kept.root;
  for (const i of kept.path) n = n?.children[i];
  if (n instanceof HTMLElement && signOf(n) === kept.sign) n.focus({ preventScroll: true });
}
