// 설정창의 도감 탭 — 지방·검색·등록 상태로 거른 격자, 칸을 누르면 도감 기기 창 (P10q)
// 탭의 상태(읽은 목록·고른 칸·검색어·쪽·보는 방식·지방)는 여기에 있다. 기기 창 여닫기는 dex-link.ts
import type { DexEntry } from "../../shared/model/detail.js";
import type { Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { api } from "./api.js";
import { portraitOf } from "./art-cache.js";
import { openDexPick, resendDex } from "./dex-link.js";
import { DEX_PAGE, dexNoText, gridPager, inDexRegion, loadView, pageOf, regionEl, saveView, scrollListAfterSwitch, switchView, viewToggle, type ViewMode } from "./grid-view.js";
import { findBarEl, matchesDex, normQuery } from "./search.js";
import { bodyEl, redrawBody } from "./shell.js";
import { ui } from "./state.js";
import { chipsEl, pageHeadEl } from "./widgets.js";

export interface DexTabHooks {
  onPicked(): void; // 칸을 눌렀다 — 도감 튜토리얼의 목표 행동
}
let hooks: DexTabHooks | null = null;
export function setDexTabHooks(next: DexTabHooks): void {
  hooks = next;
}
function hooksOf(): DexTabHooks {
  if (!hooks) throw new Error("dex-tab.ts 의 고리가 걸리지 않았다 — setDexTabHooks 를 먼저 부른다");
  return hooks;
}

const DEX_TABS = [
  { id: "all", label: "전체" },
  { id: "obtained", label: "획득" },
  { id: "unlocked", label: "해금" },
  { id: "locked", label: "미해금" },
];
let dexRows: DexEntry[] | null = null;
// 도감에서 고른 칸 — 상세는 관리 창 옆 도감 기기 창이 보인다 (src/main/dex-window.ts)
let dexPick: string | null = null;
// 검색어 — 탭을 옮겨도 남는다 (docs/specs/game.md "검색과 선택을 유지한다")
let dexQuery = "";
let dexPageNo = 0;
let dexView: ViewMode = loadView("dex");
let dexFilter = "all";
// 도감 지방 — 최초 등장 지방 기준의 전국도감 번호 구간 (Figma 05 `Dex / Base` `381:6028` 의 "지방: 전체 ▾").
// 리전폼 항목(알로라 라이츄 등)과 특수 폼 항목(다투곰(붉은 달) 등)은 번호가 아니라 항목의 지방(region)으로 나눈다(스펙) — inDexRegion
let dexRegion = "all";
let dexRegionOpen = false;

// 탭에 들어왔다 — 목록을 아직 안 읽었으면 읽는다
export function enterDex(): void {
  if (!dexRows) void loadDex();
}
// 탭을 떠난다 — 고른 칸이 있으면 기기 창을 닫는다 (2026-09-30 사용자 결정 "그냥 해당 탭을 나가면 상세 닫게해.")
export function leaveDex(): void {
  if (!dexPick) return;
  dexPick = null;
  openDexPick(null);
}
// 기기 창이 닫혔다 — 고른 칸을 비운다
export function clearDexPick(): void {
  dexPick = null;
  markDexPick();
}
// 도감을 바꾸는 명령 뒤 — 다음에 들어올 때 다시 읽는다 (command.ts touchesDex)
export function forgetDexRows(): void {
  dexRows = null;
}
// 지방 목록 — 바깥을 누르면 닫는다(설정창의 바깥 누르기 리스너)
export const isDexRegionOpen = (): boolean => dexRegionOpen;
export function closeDexRegion(): void {
  dexRegionOpen = false;
}

// 도감 칸 — 박스 칸처럼 초상 → 이름 → 번호. 획득은 왼쪽 위 몬스터볼, 이로치 획득은 그 옆 이로치 아이콘
// (Figma 04 템플릿 `Dex Layout` `378:1524`, 2026-10-02 사용자 결정 "초록점말고 몬스터볼아이콘으로 … 안2로")
function dexCell(row: DexEntry): HTMLElement {
  const cell = buttonEl(row.state === "locked" ? "dex-cell dex-box locked" : "dex-cell dex-box");
  cell.dataset.slug = row.slug;
  cell.setAttribute("aria-pressed", String(row.slug === dexPick));
  cell.addEventListener("click", () => pickDex(row.slug));
  // 미해금 종은 그림을 검은 실루엣으로 보인다 — CSS .dex-cell.locked .art (2026-09-27 사용자 결정 "모든 미해금에 다 하자")
  cell.append(portraitOf(row.slug, false, "dot", "", true), el("div", "who", row.state === "locked" ? "???" : row.name), el("div", "no", `#${dexNoText(row.dex, row.form, 4, row.tag)}`));
  if (row.state === "obtained") {
    const got = el("span", "got");
    got.title = "획득";
    got.setAttribute("role", "img");
    got.setAttribute("aria-label", got.title);
    cell.appendChild(got);
    if (row.shiny) cell.appendChild(shinyIcon(10, "이로치 획득"));
  }
  return cell;
}

// 고른 칸 표시만 바꾼다 — 격자를 다시 그리면 스크롤이 튄다 (worklog/records/play-bugs/play-bugs.md)
function markDexPick(): void {
  for (const cell of bodyEl.querySelectorAll<HTMLElement>(".dex-cell")) cell.setAttribute("aria-pressed", String(cell.dataset.slug === dexPick));
}

// 칸을 누르면 도감 기기 창에 그 종을 띄운다. 같은 칸을 다시 누르면 닫는다
function pickDex(slug: string): void {
  hooksOf().onPicked(); // 칸을 눌러 본 것이 튜토리얼 목표 행동이다
  dexPick = dexPick === slug ? null : slug;
  openDexPick(dexPick);
  markDexPick();
}

// 지금 격자에 보이는 목록 — 지방, 검색어, 등록 상태 칩을 함께 적용한다. 기기 창의 이전·다음도 이 순서를 따른다
function dexShown(): DexEntry[] {
  if (!dexRows) return [];
  const q = normQuery(dexQuery);
  return dexRows.filter((r) => inDexRegion(dexRegion, r.dex, r.region) && (dexFilter === "all" || r.state === dexFilter) && (!q || matchesDex(r, q)));
}

const dexRegionEl = (): HTMLElement =>
  regionEl(dexRegion, dexRegionOpen, (open) => (dexRegionOpen = open), (id) => {
    dexRegion = id;
    dexPageNo = 0;
  });

export function stepDex(delta: -1 | 1): void {
  const rows = dexShown();
  if (!rows.length) return;
  const at = rows.findIndex((r) => r.slug === dexPick);
  const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + delta))];
  if (!next || next.slug === dexPick) return;
  dexPick = next.slug;
  openDexPick(dexPick);
  // 쪽 방식 — 다음 종이 다른 쪽이면 그 쪽으로 넘긴다. 스크롤 방식 — 그 칸이 보이게 스크롤한다
  const page = Math.floor(rows.indexOf(next) / DEX_PAGE);
  if (dexView === "grid" && page !== dexPageNo && ui.tab === "dex") {
    dexPageNo = page;
    redrawBody();
  }
  markDexPick();
  if (dexView === "list") bodyEl.querySelector<HTMLElement>(`.dex-cell[data-slug="${CSS.escape(next.slug)}"]`)?.scrollIntoView({ block: "nearest" });
}

export function drawDex(v: Snapshot): void {
  bodyEl.appendChild(pageHeadEl("도감", `획득 ${v.dex.obtained} · 해금 ${v.dex.unlocked} · 이로치 ${v.dex.shiny}`));
  // 지방·이름·번호 검색 — 등록 상태 칩과 함께 적용한다
  const bar = el("div", "search-row");
  bar.appendChild(dexRegionEl());
  bar.appendChild(
    findBarEl({
      key: "dex",
      value: dexQuery,
      placeholder: "이름 또는 번호 검색",
      onSearch: (q) => {
        if (q === dexQuery) return; // 같은 말 — 다시 그리지 않는다
        dexQuery = q;
        dexPageNo = 0;
        redrawBody();
      },
    }),
  );
  bar.appendChild(
    viewToggle(dexView, (mode) => {
      dexPageNo = switchView("dex", dexView, mode, dexPageNo);
      dexView = mode;
      saveView("dex", mode);
      redrawBody();
    }),
  );
  bodyEl.appendChild(bar);
  // 넘김·필터 줄 — 박스 넘김 줄처럼 넘김은 왼쪽, 등록 상태 칩은 오른쪽 (2026-09-30 사용자 "grid-pager 는 좌측, filters 는 우측에")
  const toolbar = el("div", "dex-toolbar");
  const filters = chipsEl(DEX_TABS, dexFilter, (id) => {
    dexFilter = id;
    dexPageNo = 0;
    redrawBody();
  });
  toolbar.appendChild(filters);
  bodyEl.appendChild(toolbar);
  if (!dexRows) {
    bodyEl.appendChild(el("div", "empty-note", "도감을 읽는 중입니다."));
    return;
  }
  const q = normQuery(dexQuery);
  const rows = dexShown();
  if (!rows.length) {
    bodyEl.appendChild(el("div", "empty-note", q ? "검색 결과 없음" : "해당하는 종이 없습니다."));
    return;
  }
  // 스크롤 방식 — 작업 전 화면 그대로 칸 격자를 전부 그린다(2026-09-25 사용자 요청). 화면 밖 칸은 CSS content-visibility 로
  // 그리기를 미루고, 초상은 보이는 칸만 받는다
  if (dexView === "list") {
    const all = el("div", "dex-grid dex-box-grid");
    for (const row of rows) all.appendChild(dexCell(row));
    bodyEl.appendChild(all);
    scrollListAfterSwitch("dex", all);
    return;
  }
  // 격자 — 한 쪽씩. 2026-09-29 사용자 결정 "페이지 넘김 추가"로 전부 그리기(2026-09-25)를 바꿨다
  const shown = pageOf(rows, dexPageNo, DEX_PAGE);
  dexPageNo = shown.page;
  toolbar.insertBefore(
    gridPager(shown.page, shown.pages, (page) => {
      dexPageNo = page;
      redrawBody();
    }),
    filters,
  );
  const grid = el("div", "dex-grid dex-box-grid");
  for (const row of shown.items) grid.appendChild(dexCell(row));
  bodyEl.appendChild(grid);
}

export async function loadDex(): Promise<void> {
  dexRows = await api.dex();
  resendDex(dexPick); // 부화·해금으로 바뀐 항목을 기기 창에 다시 보낸다
  if (ui.tab === "dex") redrawBody();
}
