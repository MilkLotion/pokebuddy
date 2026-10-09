// 포켓몬 고르기 판 — 배틀 파티 교체·파티 교체·친구 교환이 같이 쓴다. 오른쪽만 모달마다 다르다
// (2026-10-09 사용자 "교환에서 우측만 다르지 이 box-panel 은 같은거 써야하는거 알지?", Figma 03 `Pet Box Panel`)
//   쪽       첫 쪽은 `파티 프리셋` — 한 줄이 프리셋 하나(이름 작게 + 칸 6개, 칸은 그림과 이름). 다음 쪽부터 박스 1, 2 … (6×5).
//            쪽을 넘겨도 판 크기는 같다 (사용자 "프리셋5개있는거를 박스처럼", "프리셋이름(작게) [프로필]×6")
//   머리     `◀ 이름 ▶` 오른쪽에 찾기 줄(박스 탭과 같은 search.ts findBarEl). 이름 칸은 8글자 폭 (사용자 "검색은 < 박스1 > 옆에", "박스 이름입력을 8칸으로")
//   찾기     박스 탭 찾기(box-find.ts)와 같다 — 1초 뒤나 Enter 로 찾고, 결과가 있는 쪽으로 넘겨 그 칸만 옅은 바탕. ^ v 는 쪽을 넘나든다.
//            박스 탭과 달리 프리셋의 개체도 찾는다
//   칸       누르기·끌기·놓기는 쓰는 곳이 정한다(cell·drop). 부화 결과를 아직 확인하지 않은 개체는 빈 칸으로 그린다
import type { PetView, PresetView, Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { lockIconEl, plusIconEl } from "../ui/line-icons.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { portraitOf } from "./art-cache.js";
import type { DragFrom } from "./box-state.js";
import { dropZone, startDrag } from "./box-move.js";
import { hiddenHatchIds } from "./daycare.js";
import { drawDialog } from "./dialog.js";
import { wrapPage } from "./grid-view.js";
import { findBarEl, forgetSearchDraft, matchesName, normQuery } from "./search.js";

export type PanelPage = { kind: "presets"; name: string; presets: PresetView[] } | { kind: "box"; name: string; boxId: string; slots: (PetView | null)[] };

// 판 안의 자리 — 프리셋 쪽이면 프리셋 번호와 칸, 박스 쪽이면 박스와 칸
export type PanelAt = { kind: "preset"; preset: number; slot: number } | { kind: "box"; boxId: string; slot: number };

export interface PanelCell {
  disabled?: boolean; // 누르지도 끌지도 못한다
  off?: boolean; // 흐리게 — 이미 오른쪽에 든 개체 등
  title?: string;
  pressed?: boolean; // 고른 개체 — 교환에 내놓은 개체 등. 톤 바탕
  pick?: () => void; // 누르면
  drag?: DragFrom; // 끌 수 있으면 끄는 곳의 이름
}

export interface PetBoxPanel {
  key: string; // 쪽·찾기 상태와 찾기 칸 글자를 기억하는 열쇠 — 모달마다 다르다
  view: Snapshot;
  cell: (pet: PetView, at: PanelAt) => PanelCell;
  drop?: (at: PanelAt, pet: PetView | null) => (() => void) | null; // 끈 것을 이 칸에 놓을 때 — null 이면 놓을 수 없는 칸
  blank?: (at: PanelAt) => (() => void) | null; // 빈 칸을 누를 때 — null 이면 누를 수 없는 칸(파티 교체의 고른 칸 개체 보관 등)
  dropAnywhere?: () => (() => void) | null; // 판 어디에 놓아도 되는 끌기(배틀 파티 칸 → 판 = 빼기)
}

interface PanelState {
  page: number;
  find: { query: string; pet: string | null };
}
const states = new Map<string, PanelState>();
const stateOf = (key: string): PanelState => {
  let s = states.get(key);
  if (!s) states.set(key, (s = { page: 0, find: { query: "", pet: null } }));
  return s;
};

// 모달을 새로 열 때 — 첫 쪽, 찾기 없음
export function resetPanel(key: string): void {
  states.delete(key);
  forgetSearchDraft(key);
}

// 모달을 열 때 한 개체를 찾아 둔다 — 그 쪽으로 넘기고 그 칸만 옅은 바탕 (포켓몬 메뉴의 `교체`)
export function focusPanel(key: string, page: number, petId: string): void {
  const st = stateOf(key);
  st.page = page;
  st.find = { query: "", pet: petId };
}

// 쪽 — 파티 프리셋 다음에 박스 순서
export function panelPages(v: Snapshot): PanelPage[] {
  return [{ kind: "presets", name: "파티 프리셋", presets: v.party.presets }, ...v.boxes.map((b): PanelPage => ({ kind: "box", name: b.name, boxId: b.id, slots: b.slots }))];
}

interface Hit {
  page: number;
  pet: string;
}

// 이름 — 지금 종 이름. 공유 sid 계열은 고를 수 있는 종 이름도 맞춘다 (box-find.ts 와 같다)
const namesOf = (pet: PetView): string[] => [pet.name, ...(pet.forms ?? []).map((f) => f.name)];

function hitsOf(pages: PanelPage[], unseen: ReadonlySet<string>, q: string): Hit[] {
  if (!q) return [];
  const out: Hit[] = [];
  const add = (page: number, pet: PetView | undefined | null): void => {
    if (pet && !unseen.has(pet.id) && namesOf(pet).some((n) => matchesName(n, q))) out.push({ page, pet: pet.id });
  };
  pages.forEach((p, page) => {
    if (p.kind === "presets") for (const preset of p.presets) for (const s of preset.slots) add(page, s.pet);
    else for (const pet of p.slots) add(page, pet);
  });
  return out;
}

function step(st: PanelState, hits: Hit[], delta: 1 | -1): void {
  const n = hits.length;
  if (!n) return;
  const at = hits.findIndex((h) => h.pet === st.find.pet);
  const next = hits[at < 0 ? (delta > 0 ? 0 : n - 1) : (at + delta + n) % n];
  if (!next) return;
  st.find.pet = next.pet;
  st.page = next.page;
}

function findEl(p: PetBoxPanel, st: PanelState, pages: PanelPage[], unseen: ReadonlySet<string>): HTMLElement {
  const hits = hitsOf(pages, unseen, st.find.query);
  const at = hits.findIndex((h) => h.pet === st.find.pet);
  const clear = (): void => {
    st.find = { query: "", pet: null };
    forgetSearchDraft(p.key);
  };
  const bar = findBarEl({
    key: p.key,
    value: st.find.query,
    placeholder: "이름 검색",
    className: "pp-find",
    onSearch: (q, how) => {
      const query = normQuery(q);
      if (!query) clear();
      else if (query === st.find.query) {
        if (how === "auto") return;
        step(st, hits, 1);
      } else {
        st.find = { query, pet: null };
        step(st, hitsOf(pages, unseen, query), 1);
      }
      drawDialog();
    },
    onClose: () => {
      clear();
      drawDialog();
    },
    closeLabel: "검색 닫기",
    nav: {
      count: st.find.query ? `${at + 1}/${hits.length}` : "",
      none: hits.length === 0,
      onPrev: () => {
        step(st, hits, -1);
        drawDialog();
      },
      onNext: () => {
        step(st, hits, 1);
        drawDialog();
      },
    },
  });
  return bar;
}

// 개체 칸 — 박스 쪽은 그림·이름·레벨, 프리셋 쪽은 그림·이름
function petCell(p: PetBoxPanel, pet: PetView, at: PanelAt, found: boolean, withLevel: boolean): HTMLElement {
  const c = p.cell(pet, at);
  const b = buttonEl(withLevel ? "cell pp-cell" : "cell pp-cell short");
  b.dataset.pet = pet.id;
  b.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name));
  if (withLevel) b.appendChild(el("div", "note", `Lv.${pet.level}`));
  if (pet.shiny) b.appendChild(shinyIcon(10));
  b.disabled = c.disabled === true;
  if (c.off) b.classList.add("off");
  if (found) b.classList.add("found");
  b.setAttribute("aria-pressed", String(c.pressed === true));
  b.title = c.title ?? `${pet.name} Lv.${pet.level}`;
  if (c.pick) b.addEventListener("click", c.pick);
  const drag = c.drag;
  if (drag && !b.disabled) b.addEventListener("pointerdown", (e) => startDrag(e, b, drag));
  b.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다 — 막지 않으면 포인터 끌기가 끊긴다
  const drop = p.drop?.(at, pet);
  if (drop) dropZone(b, drop);
  return b;
}

function blankCell(p: PetBoxPanel, at: PanelAt, locked: boolean, preset: boolean): HTMLElement {
  const cls = preset ? `pp-blank ${locked ? "locked" : "blank"}` : "cell blank pp-cell";
  // 누를 수 있는 빈 칸은 단추로 — 가리키면 다른 칸과 같은 옅은 바탕(.pickable)
  const pick = locked ? null : (p.blank?.(at) ?? null);
  const cell = pick ? buttonEl(`${cls} pickable`) : el("div", cls);
  if (pick) {
    cell.addEventListener("click", pick);
    cell.setAttribute("aria-label", "이 빈 칸에 보관");
  }
  if (preset) {
    const icon = el("span", "blank-icon");
    icon.appendChild(locked ? lockIconEl() : plusIconEl());
    cell.appendChild(icon);
    cell.title = locked ? "잠긴 칸" : "빈 칸";
  }
  const drop = locked ? null : p.drop?.(at, null);
  if (drop) dropZone(cell, drop);
  return cell;
}

export function petBoxPanelEl(p: PetBoxPanel): HTMLElement {
  const st = stateOf(p.key);
  const pages = panelPages(p.view);
  st.page = Math.max(0, Math.min(pages.length - 1, st.page));
  const page = pages[st.page];
  const unseen = hiddenHatchIds(p.view);
  const panel = el("div", "pet-box-panel");
  // 머리 — ◀ 이름 ▶ · 찾기 줄
  const head = el("div", "pp-head");
  const pager = el("div", "pager pp-pager");
  const go = (to: number): void => {
    st.page = wrapPage(to, pages.length);
    drawDialog();
  };
  const prev = buttonEl("", "◀");
  prev.setAttribute("aria-label", "앞 쪽");
  prev.addEventListener("click", () => go(st.page - 1));
  const next = buttonEl("", "▶");
  next.setAttribute("aria-label", "다음 쪽");
  next.addEventListener("click", () => go(st.page + 1));
  pager.append(prev, el("span", "label", page?.name ?? ""), next);
  head.append(pager, findEl(p, st, pages, unseen));
  panel.appendChild(head);
  const found = st.find.pet;
  if (page?.kind === "presets") {
    const lines = el("div", "pp-lines");
    for (const preset of page.presets) {
      const line = el("div", "pp-line");
      line.appendChild(el("div", "pp-line-name", preset.name));
      const cells = el("div", "pp-line-cells");
      for (const s of preset.slots) {
        const at: PanelAt = { kind: "preset", preset: preset.index, slot: s.index };
        const pet = s.state === "pokemon" ? s.pet : undefined;
        cells.appendChild(pet && !unseen.has(pet.id) ? petCell(p, pet, at, pet.id === found, false) : blankCell(p, at, s.state === "locked", true));
      }
      line.appendChild(cells);
      lines.appendChild(line);
    }
    panel.appendChild(lines);
  } else if (page) {
    const grid = el("div", "pp-grid");
    page.slots.forEach((pet, slot) => {
      const at: PanelAt = { kind: "box", boxId: page.boxId, slot };
      grid.appendChild(pet && !unseen.has(pet.id) ? petCell(p, pet, at, pet.id === found, true) : blankCell(p, at, false, false));
    });
    panel.appendChild(grid);
  }
  const anywhere = p.dropAnywhere?.();
  if (anywhere) dropZone(panel, anywhere);
  return panel;
}
