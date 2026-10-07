// 설정창의 검색 칸 — 찾기 줄(검색 칸 공통 부품)·글자마다 넘기는 입력 칸, 다시 그린 뒤 초점 되돌리기, 이름·번호 일치 (P10h)
// 찾기 줄은 입력을 멈추고 1초 뒤 검색한다. Enter 는 바로 검색한다. `검색` 단추는 없다
// (2026-10-07 사용자 "구글검색도 검색버튼이 없으니 없애고, 검색버튼말고 1초 디바운스로". 그 전에는 Enter·`검색` 단추로만 걸렀다)
//   한글 조합을 확정하는 Enter(isComposing)는 검색을 예약만 한다 — 확정 직후 그 값으로 한 번 거른다
//   1초가 지났는데 조합 중이면 칸에서 초점을 빼 조합을 확정한 뒤 검색하고 초점을 되돌린다 — 조합 중에 칸을 갈아 끼우면 글자가 씹힌다
// 입력 중인 글자는 초안(searchDraft)으로 들고 있다 — 검색 전에 다른 일로 다시 그려도 사라지지 않는다.
// 검색 칸에 입력하는 동안 들어온 다시 그리기는 미뤘다가 칸을 떠날 때 그린다 — 칸을 갈아 끼우면 한글 조합이 끊긴다
// (2026-09-29 사용자 "어래곤 검색했는데 … 어곤 이렇게 래 씹힌다")
import type { DexEntry } from "../../shared/model/detail.js";
import { buttonEl, el } from "../ui/dom.js";
import { chevronDownIconEl, chevronUpIconEl, closeIconEl } from "../ui/line-icons.js";
import { redrawHeldDialog } from "./dialog.js";
import { redrawHeldBody } from "./shell.js";

// 입력을 멈추고 검색하기까지 (2026-10-07 사용자 "1초 디바운스로")
const SEARCH_DEBOUNCE_MS = 1000;

// 다시 그린 뒤 되돌릴 검색 칸 — 입력 중에 화면을 새로 그려도 포커스와 커서가 남게
let searchFocus: { key: string; caret: number } | null = null;
const searchDraft = new Map<string, string>();
let searchSubmitting = false; // 검색을 누른 그 다시 그리기는 미루지 않는다

// 지금 이 영역의 검색 칸(또는 박스 이름 칸)에 입력하고 있는가 — 창이 앞에 있을 때만. 뒤에 있으면(배너 바로가기 등) 미루지 않는다
export function typingSearch(root: HTMLElement): boolean {
  if (searchSubmitting || !document.hasFocus()) return false;
  const a = document.activeElement;
  // 검색 칸과 박스 이름 입력칸 — 둘 다 한글을 친다. 계정·교환 입력칸(liveInput)은 다시 그려도 커서를 되돌린다
  return a instanceof HTMLInputElement && (a.dataset.search != null || a.classList.contains("box-name-input")) && root.contains(a);
}

// 검색 칸을 떠났다 — 미룬 다시 그리기를 한다. 누른 단추의 click 이 먼저 돌게 한 틱 미룬다
function releaseHeld(): void {
  setTimeout(() => {
    redrawHeldBody();
    redrawHeldDialog();
  }, 0);
}

// 검색어 초안을 버린다 — 칸 밖의 닫기(박스 찾기 줄의 ✕)가 칸을 비울 때 쓴다
export function forgetSearchDraft(key: string): void {
  searchDraft.delete(key);
}

// 찾기 줄의 이전·다음 — 박스 찾기만 쓴다. count 는 `n/m`(찾지 않는 중이면 빈 글자)
export interface FindNav {
  count: string;
  none: boolean; // 결과가 없다 — ^ v 를 흐리게
  onPrev: () => void;
  onNext: () => void;
}

export interface FindBarOpts {
  key: string; // 입력칸 id(`search-<key>`)와 초안의 열쇠
  value: string; // 지금 검색어
  placeholder: string;
  // 검색 — how 는 무엇이 검색했는가. enter 는 Enter, auto 는 입력을 멈추고 1초. 박스는 같은 말의 Enter 를 다음 결과로 쓴다
  onSearch: (q: string, how: "enter" | "auto") => void;
  // ✕ — 없으면 검색어를 지운다(onSearch("")). 박스는 찾기를 닫는다
  onClose?: () => void;
  closeLabel?: string; // ✕ 의 이름 — 기본 `검색어 지우기`
  nav?: FindNav; // n/m · 구분선 · ^ v (Figma `Find Bar` 의 `Show Nav`)
  className?: string; // 쓰는 곳의 자리·폭 (박스 `box-find`)
}

function findButton(cls: string, label: string, icon: SVGSVGElement, run: () => void): HTMLButtonElement {
  const b = buttonEl(`find-btn ${cls}`);
  b.setAttribute("aria-label", label);
  b.title = label;
  b.appendChild(icon);
  b.addEventListener("click", run);
  return b;
}

// 찾기 줄 — 검색 칸 공통 부품. 한 틀 안에 입력칸·(n/m | ^ v)·✕ (Figma 02 `Find Bar` `1590:60744`, 2026-10-07 사용자 "이 검색을 공통코드로")
// 박스 찾기·도감·상점 포켓몬이 같이 쓴다. 다르게 동작해야 하면 따로 만들지 말고 여기에 선택지를 더한다
export function findBarEl(opts: FindBarOpts): HTMLElement {
  const { key } = opts;
  const bar = el("div", opts.className ? `find-bar ${opts.className}` : "find-bar");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search";
  input.id = `search-${key}`;
  input.dataset.search = key;
  input.placeholder = opts.placeholder;
  input.value = searchDraft.get(key) ?? opts.value;
  input.setAttribute("aria-label", opts.placeholder);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let pending = false; // 조합 중 Enter — 확정 직후 한 번 거른다
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  // 검색·지우기를 돌린다 — 입력 중 미루기를 건너뛰고 바로 다시 그린 뒤 초점을 되돌린다
  const run = (job: () => void, refocus: boolean): void => {
    // 다시 그리면 옛 칸이 빠지며 blur 가 먼저 온다(Chromium) — 기억은 그린 뒤에 넣고 되돌린다
    const saved = refocus ? { key, caret: input.selectionStart ?? input.value.length } : null;
    searchSubmitting = true;
    try {
      job();
    } finally {
      searchSubmitting = false;
    }
    searchFocus = saved;
    restoreSearchFocus();
  };
  const submit = (how: "enter" | "auto", refocus = document.activeElement === input): void => {
    stop();
    if (!input.isConnected) return;
    // 친 글자 그대로 남긴다 — 검색어는 쓰는 곳이 다듬어(소문자·공백) 들고 있어 다시 그리면 바뀔 수 있다
    searchDraft.set(key, input.value);
    run(() => opts.onSearch(input.value, how), refocus);
  };
  // 1초 뒤 — 조합 중이면 초점을 빼 확정한 뒤 검색한다(확정한 글자가 값에 들어간 뒤)
  const auto = (): void => {
    timer = undefined;
    if (!input.isConnected) return;
    if (!composing) return submit("auto");
    const focused = document.activeElement === input;
    input.blur();
    setTimeout(() => submit("auto", focused), 0);
  };
  input.addEventListener("input", () => {
    searchDraft.set(key, input.value);
    stop();
    timer = setTimeout(auto, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener("compositionstart", () => (composing = true));
  input.addEventListener("compositionend", () => {
    composing = false;
    if (!pending) return;
    pending = false;
    setTimeout(() => submit("enter"), 0); // 확정한 글자가 값에 들어간 뒤
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) pending = true; // 229 — 조합 중 키 (IME)
    else submit("enter");
  });
  input.addEventListener("blur", () => {
    if (searchFocus?.key === key) searchFocus = null;
    releaseHeld();
  });
  bar.appendChild(input);

  if (opts.nav) {
    const { nav } = opts;
    // n/m — 입력칸 안 오른쪽. 폭은 고정이라 글자 수가 달라도 단추가 움직이지 않는다
    const prev = findButton("find-prev", "이전 결과", chevronUpIconEl(), nav.onPrev);
    const next = findButton("find-next", "다음 결과", chevronDownIconEl(), nav.onNext);
    prev.disabled = nav.none;
    next.disabled = nav.none;
    bar.append(el("span", "find-count", nav.count), el("span", "find-divider"), prev, next);
  }
  const close = findButton("find-close", opts.closeLabel ?? "검색어 지우기", closeIconEl(), () => {
    stop();
    searchDraft.delete(key);
    input.value = "";
    run(() => (opts.onClose ? opts.onClose() : opts.onSearch("", "enter")), false);
  });
  bar.appendChild(close);
  return bar;
}

// 글자를 칠 때마다 값을 넘기는 입력 칸 — 계정·교환 링크. 다시 그리기는 하지 않는다. 포커스 복원은 searchFocus 를 쓴다
export function liveInputEl(key: string, value: string, placeholder: string, onChange: (q: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search";
  input.id = `search-${key}`;
  input.placeholder = placeholder;
  input.value = value;
  input.setAttribute("aria-label", placeholder);
  // 다시 그리면 옛 칸이 빠지며 blur 가 먼저 온다(Chromium). 그래서 그린 뒤에 기억을 다시 넣고 되돌린다
  const apply = (): void => {
    const saved = { key, caret: input.selectionStart ?? input.value.length };
    onChange(input.value);
    searchFocus = saved;
    restoreSearchFocus();
  };
  input.addEventListener("input", (e) => {
    if (!(e as InputEvent).isComposing) apply();
  });
  input.addEventListener("compositionend", apply);
  // 사용자가 다른 곳을 누르면 포커스 기억을 지운다
  input.addEventListener("blur", () => {
    if (searchFocus?.key === key) searchFocus = null;
  });
  return input;
}

export function restoreSearchFocus(): void {
  if (!searchFocus) return;
  const input = document.getElementById(`search-${searchFocus.key}`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  input.setSelectionRange(searchFocus.caret, searchFocus.caret);
}

export const normQuery = (q: string): string => q.trim().toLowerCase();

// 이름은 부분 일치, 숫자만 넣으면 도감 번호 앞자리 일치("025" 와 "25" 가 같다). `26-1` 처럼 하이픈이 있으면 표시 번호와 정확히 비교한다
export function matchesName(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}
export function matchesDex(row: DexEntry, q: string): boolean {
  if (/^\d+$/.test(q)) return String(row.dex).startsWith(String(Number(q)));
  const m = /^(\d+)-(\d+)$/.exec(q);
  if (m) return row.dex === Number(m[1]) && row.form === Number(m[2]);
  // 미해금 종은 이름이 숨겨져 있다 — 이름으로 찾으면 무엇인지 드러나므로 번호로만 찾는다
  return row.state !== "locked" && matchesName(row.name, q);
}
