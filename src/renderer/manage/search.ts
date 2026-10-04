// 설정창의 검색 칸 — 검색 칸·글자마다 넘기는 입력 칸, 다시 그린 뒤 초점 되돌리기, 이름·번호 일치 (P10h)
// 검색 칸은 입력 중에 결과를 바꾸지 않는다. Enter 나 `검색` 단추를 누를 때 그 값으로 한 번 거른다 (2026-09-29 사용자 결정)
//   한글 조합을 확정하는 Enter(isComposing)는 검색하지 않는다 — 조합 확정에만 쓴다
//   지우기(×)로 칸을 비우면 바로 전체로 돌린다 — 빈 칸은 걸러 볼 것이 없다
// 입력 중인 글자는 초안(searchDraft)으로 들고 있다 — 검색 전에 다른 일로 다시 그려도 사라지지 않는다.
// 검색 칸에 입력하는 동안 들어온 다시 그리기는 미뤘다가 칸을 떠날 때 그린다 — 칸을 갈아 끼우면 한글 조합이 끊긴다
// (2026-09-29 사용자 "어래곤 검색했는데 … 어곤 이렇게 래 씹힌다")
import type { DexEntry } from "../../shared/model/detail.js";
import { buttonEl, el } from "../ui/dom.js";
import { redrawHeldDialog } from "./dialog.js";
import { redrawHeldBody } from "./shell.js";

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

export function searchBoxEl(key: string, value: string, placeholder: string, onSearch: (q: string) => void): HTMLElement {
  const box = el("span", "search-field");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search";
  input.id = `search-${key}`;
  input.dataset.search = key;
  input.placeholder = placeholder;
  input.value = searchDraft.get(key) ?? value;
  input.setAttribute("aria-label", placeholder);
  const go = buttonEl("search-go", "검색");
  go.setAttribute("aria-label", `${placeholder} 실행`);
  const submit = (): void => {
    if (!input.isConnected) return;
    searchDraft.delete(key);
    // 다시 그리면 옛 칸이 빠지며 blur 가 먼저 온다(Chromium) — 기억은 그린 뒤에 넣고 되돌린다
    const saved = document.activeElement === input ? { key, caret: input.selectionStart ?? input.value.length } : null;
    searchSubmitting = true;
    try {
      onSearch(input.value);
    } finally {
      searchSubmitting = false;
    }
    searchFocus = saved;
    restoreSearchFocus();
  };
  input.addEventListener("input", () => searchDraft.set(key, input.value));
  // 조합 중 Enter 는 검색을 예약만 한다 — 칸을 갈아 끼우면 조합이 끊긴다. 확정(compositionend) 직후 그 값으로 한 번 거른다.
  // 그래서 사용자는 Enter 를 한 번만 누른다 (2026-09-29 검수 반영)
  let pending = false;
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) pending = true; // 229 — 조합 중 키 (IME)
    else submit();
  });
  input.addEventListener("compositionend", () => {
    if (!pending) return;
    pending = false;
    setTimeout(submit, 0); // 확정한 글자가 값에 들어간 뒤
  });
  // type="search" 의 지우기(×) — 빈 칸이 되면 search 이벤트가 온다. Enter 도 이 이벤트를 내지만 위에서 이미 처리했다
  input.addEventListener("search", () => {
    if (input.value === "") submit();
  });
  go.addEventListener("click", submit);
  input.addEventListener("blur", () => {
    if (searchFocus?.key === key) searchFocus = null;
    releaseHeld();
  });
  box.append(input, go);
  return box;
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
