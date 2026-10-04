// 설정창 격자의 쪽·보는 방식·지방 — 도감과 상점 포켓몬 격자가 같이 쓴다 (P10i)
// 탭의 상태(지금 쪽·보는 방식·고른 지방)는 각 탭이 들고, 여기는 계산·저장·그리기만 한다. 방식을 바꾼 직후 스크롤할 항목만 여기에 둔다
import { buttonEl, el } from "../ui/dom.js";
import { bodyEl, redrawBody } from "./shell.js";

// 도감·상점 포켓몬 격자의 쪽 — 한 쪽에 GRID_PAGE 칸. 지방·검색·분류가 바뀌면 첫 쪽으로 (2026-09-29 사용자 결정 "페이지 넘김 추가")
// 5열 × 3줄 — 기본 창 높이(682)에서 스크롤 없이 들어간다
export const GRID_PAGE = 15;
// 도감은 박스처럼 한 쪽 30칸(6열 × 5줄) — Figma 04 템플릿 `Dex Layout` `378:1524` (2026-09-30 사용자 결정 "도감페이지도 박스처럼")
export const DEX_PAGE = 30;
const pageSizeOf = (where: "dex" | "shop"): number => (where === "dex" ? DEX_PAGE : GRID_PAGE);

// 보는 방식 — 쪽(grid)과 스크롤(list). 도감과 상점 포켓몬 탭이 따로 기억한다 (2026-09-29 사용자 결정)
//   grid  한 쪽 15칸 격자와 ◀ ▶ 넘김
//   list  오늘 작업 전(9662a46) 화면 그대로 — 도감은 칸 격자 전부, 상점은 상품 줄 카드 전부를 세로 스크롤로
//         (2026-09-29 사용자 결정 "리스트형태는 작업하기 이전의 그 스크롤되는거로")
// 게임 저장이 아니라 이 컴퓨터의 화면 선호다 — 관리 창의 localStorage 에 둔다. 앱 데이터 폴더(userData)에 남아 다시 켜도 유지된다.
// 저장 위치와 기본값(격자)은 제안이다 (worklog view-mode 기록)
export type ViewMode = "grid" | "list";
const VIEW_KEY = { dex: "pokebuddy.view.dex", shop: "pokebuddy.view.shop" } as const;
export function loadView(where: keyof typeof VIEW_KEY): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY[where]) === "list" ? "list" : "grid";
  } catch {
    return "grid"; // 읽지 못하면 기본값
  }
}
export function saveView(where: keyof typeof VIEW_KEY, mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY[where], mode);
  } catch {
    // 저장하지 못해도 이번 실행에는 고른 방식을 쓴다
  }
}

// 스크롤 방식은 쪽 넘김 없이 전부 보인다. 쪽 방식만 한 쪽 GRID_PAGE 칸이다.
// 방식을 바꾼 직후 스크롤할 항목 — 쪽 방식에서 보던 첫 항목 (drawDex·drawShop 이 스크롤 방식을 그린 뒤 한 번 쓴다)
let listScrollTo: { where: "dex" | "shop"; index: number } | null = null;

const DEX_REGIONS: readonly { id: string; label: string; from: number; to: number }[] = [
  { id: "all", label: "전체", from: 1, to: Number.MAX_SAFE_INTEGER },
  { id: "kanto", label: "관동", from: 1, to: 151 },
  { id: "johto", label: "성도", from: 152, to: 251 },
  { id: "hoenn", label: "호연", from: 252, to: 386 },
  { id: "sinnoh", label: "신오", from: 387, to: 493 },
  { id: "unova", label: "하나", from: 494, to: 649 },
  { id: "kalos", label: "칼로스", from: 650, to: 721 },
  { id: "alola", label: "알로라", from: 722, to: 809 },
  { id: "galar", label: "가라르", from: 810, to: 898 },
  { id: "hisui", label: "히스이", from: 899, to: 905 }, // 최초 등장 지방 기준 (docs/specs/game.md "전체 도감과 지방") — 레전드 아르세우스에서 처음 나온 종
  { id: "paldea", label: "팔데아", from: 906, to: 1025 },
];
// 지방 하나에 드는 항목인가 — 리전폼은 자기 지방, 나머지는 번호 구간
export function inDexRegion(regionId: string, dex: number, formRegion?: string): boolean {
  const region = DEX_REGIONS.find((r) => r.id === regionId) ?? DEX_REGIONS[0];
  if (!region || region.id === "all") return true;
  if (formRegion) return formRegion === region.id;
  return dex >= region.from && dex <= region.to;
}

// 도감 표시 번호 — `#0026`, 리전폼이면 `#0026-1` (src/dex/regional.ts dexLabel 과 같은 모양)
export const dexNoText = (dex: number, form: number | undefined, pad: number): string => `${String(dex).padStart(pad, "0")}${form ? `-${form}` : ""}`;

// 격자 넘김 줄 — 박스 넘김 줄(.pager)과 같은 ◀ ▶. 가운데에 `쪽 / 전체`
export function gridPager(page: number, pages: number, go: (page: number) => void): HTMLElement {
  const pager = el("div", "pager grid-pager");
  const prev = buttonEl("", "◀");
  prev.setAttribute("aria-label", "이전 쪽");
  prev.disabled = page <= 0;
  prev.addEventListener("click", () => go(page - 1));
  const next = buttonEl("", "▶");
  next.setAttribute("aria-label", "다음 쪽");
  next.disabled = page >= pages - 1;
  next.addEventListener("click", () => go(page + 1));
  pager.append(prev, el("span", "used", `${page + 1} / ${pages}`), next);
  return pager;
}

// 한 쪽 — 쪽 번호를 범위 안으로 맞춘 뒤 그 쪽의 칸과 쪽 수를 돌려준다
export function pageOf<T>(rows: T[], page: number, size: number = GRID_PAGE): { page: number; pages: number; items: T[] } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.max(0, Math.min(pages - 1, page));
  return { page: at, pages, items: rows.slice(at * size, (at + 1) * size) };
}

// 보는 방식 토글 — 검색 줄 오른쪽 끝의 아이콘 두 개. 고른 쪽은 톤 배경(색 테두리로 강조하지 않는다). 높이는 검색 칸과 같다
// 바꾸면 지금 쪽의 첫 항목이 들어 있는 쪽으로 간다
// 아이콘은 모양(격자·목록)이 아니라 넘기는 방식이다 — ‹ › 는 쪽 넘김, 위아래 꺾쇠는 스크롤 (2026-09-30 사용자 결정 "< > 로 옮기냐 스크롤하냐",
// Figma `Icon / Page` `1009:1237` · `Icon / Scroll` `1009:1239`). 두 방식 모두 같은 칸 격자다
const VIEW_ICON: Record<ViewMode, string> = {
  grid: '<path d="M6.5 4 2.5 8l4 4M9.5 4l4 4-4 4" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
  list: '<path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
};
export function viewToggle(current: ViewMode, pick: (mode: ViewMode) => void): HTMLElement {
  const box = el("span", "view-toggle");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "보는 방식");
  for (const [mode, label] of [["grid", "쪽으로 보기"], ["list", "스크롤로 보기"]] as const) {
    const b = buttonEl("view-opt");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${VIEW_ICON[mode]}</svg>`; // 고정 그림 — 사용자 값이 들어가지 않는다
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(mode === current));
    b.dataset.view = mode;
    b.addEventListener("click", () => {
      if (mode !== current) pick(mode);
    });
    box.appendChild(b);
  }
  return box;
}

// 방식을 바꿀 때 — 지금 보던 첫 항목을 잇는다
//   쪽 → 스크롤  쪽의 첫 항목으로 스크롤한다
//   스크롤 → 쪽  본문 맨 위에 보이던 항목이 든 쪽으로 간다
// 돌려주는 값은 쪽 방식의 새 쪽 번호(스크롤로 갈 때는 지금 쪽 그대로)
export function switchView(where: "dex" | "shop", from: ViewMode, to: ViewMode, page: number): number {
  if (from === "grid" && to === "list") {
    listScrollTo = { where, index: page * pageSizeOf(where) };
    return page;
  }
  const top = bodyEl.getBoundingClientRect().top;
  const rows = [...bodyEl.querySelectorAll<HTMLElement>(".dex-grid .dex-cell")]; // 도감 칸과 상점 칸(.dex-cell.shop-cell) 모두
  const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > top + 1);
  return Math.floor(Math.max(0, first) / pageSizeOf(where));
}

// 스크롤 방식을 그린 뒤 — 방식을 바꾼 직후면 그 항목으로 스크롤한다
export function scrollListAfterSwitch(where: "dex" | "shop", list: HTMLElement): void {
  if (listScrollTo?.where !== where) return;
  const row = list.children[listScrollTo.index] as HTMLElement | undefined;
  listScrollTo = null;
  row?.scrollIntoView({ block: "start" });
  // 화면 밖 칸은 어림 높이로 먼저 잡혔다가(content-visibility) 그려지며 줄어든다 — 다음 프레임에 한 번 더 맞춘다
  requestAnimationFrame(() => row?.scrollIntoView({ block: "start" }));
}

// 지방 고르기 — 박스 정렬과 같은 모양의 목록. 바깥을 누르면 닫힌다. 도감과 상점 포켓몬 격자가 함께 쓴다
export function regionEl(value: string, open: boolean, setOpen: (open: boolean) => void, pick: (id: string) => void): HTMLElement {
  const wrap = el("div", "box-sort left");
  const current = DEX_REGIONS.find((r) => r.id === value) ?? DEX_REGIONS[0];
  const toggle = buttonEl("sort-toggle", `지방: ${current?.label ?? "전체"} ▾`);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
    redrawBody();
  });
  wrap.appendChild(toggle);
  if (open) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const r of DEX_REGIONS) {
      const item = buttonEl(r.id === value ? "sort-item on" : "sort-item", r.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(r.id === value));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(r.id);
        setOpen(false);
        redrawBody();
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

// 넘김 줄의 쪽 번호 — 끝을 넘으면 반대쪽 끝으로 돈다
export const wrapPage = (page: number, count: number): number => (count <= 0 ? 0 : ((page % count) + count) % count);
