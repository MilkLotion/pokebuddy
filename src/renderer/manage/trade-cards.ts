// 설정창 교환의 카드 그리기 — 개체 한 줄·상태 글자·카드 머리, 보낼 포켓몬 고르기, 제안·확정 화면, 완료 화면 (P10n 나누기)
// Figma 05 Screens 섹션 `930:18244`(교환) — Offer `1036:22673`·Blocked `1036:22381`·Done `1036:22089`. 상태는 trade-state.ts
import { wrapPage } from "./grid-view.js";
import { alertEl, lvNature } from "./widgets.js";
import { portraitOf } from "./art-cache.js";
import type { PetView } from "../../shared/model/snapshot.js";
import type { TradeCardView, TradeScreen } from "../../shared/model/trade.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { josa } from "../../shared/josa.js";
import { buttonEl, el } from "../ui/dom.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { actionButtonEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { tradeSend, tradeUi } from "./trade-state.js";

// 카드 안의 개체 한 줄 — 초상, 이름, 레벨·성격, 타입 배지 (Figma `Trade / Offer` 의 카드)
function tradePetLine(card: TradeCardView | null, empty: string): HTMLElement {
  const line = el("div", "trade-pet");
  if (!card) {
    line.appendChild(el("div", "trade-portrait"));
    if (empty) line.appendChild(el("div", "trade-empty", empty));
    return line;
  }
  const info = el("div", "trade-info");
  const name = el("strong", undefined, card.name);
  if (card.shiny) name.appendChild(shinyIcon(10));
  info.append(name, el("div", "trade-meta", lvNature(card.level, card.nature)));
  const tags = el("div", "tags");
  card.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, card.typeIds[i])));
  info.appendChild(tags);
  line.append(portraitOf(card.species, card.shiny, "trade-portrait"), info);
  return line;
}

// 상태 점과 글자 — 분류는 점으로 보인다(색 테두리 강조 대신)
export function tradeState(text: string, tone: "ok" | "wait" | "bad" | "idle"): HTMLElement {
  const box = el("span", `trade-state ${tone}`);
  box.append(el("i"), document.createTextNode(text));
  return box;
}

export function tradeCardHead(title: string, right?: HTMLElement): HTMLElement {
  const row = el("div", "trade-card-head");
  row.appendChild(el("strong", undefined, title));
  if (right) row.appendChild(right);
  return row;
}

export const leftText = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 보낼 포켓몬 고르기 — 박스처럼 `◀ ▶` 로 파티 → 박스 1 → 박스 2 … 를 넘긴다 (2026-10-01 사용자 결정 "파티+박스 를 < > 로 옮기면서").
// 파티는 파티 칸 수(6칸)만, 박스는 30칸. 칸은 정사각 64, 칸 영역은 5줄 높이로 고정해 넘겨도 창 높이가 그대로다. 단일 포켓몬 칸은 흐리게 막는다
// 제목과 넘김을 한 줄에 둔다 — 기본 창 높이(682)에서 스크롤이 없다 (2026-10-02 사용자 결정 B안, Figma 03 `Trade Dialog` `State=Offer`)
function tradePicker(t: TradeScreen): HTMLElement {
  const box = el("div", "trade-pick");
  const singles = new Set(t.singles);
  const cell = (pet: PetView): HTMLElement => {
    const b = buttonEl("cell trade-cell");
    b.append(portraitOf(pet.look, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", `Lv.${pet.level}`));
    if (pet.shiny) b.appendChild(shinyIcon(10));
    const single = singles.has(pet.id);
    b.disabled = single || t.myReady || t.busy;
    if (single) {
      b.classList.add("off");
      b.title = "단일 포켓몬은 교환할 수 없어요";
    }
    b.setAttribute("aria-pressed", String(pet.id === t.myPetId));
    b.addEventListener("click", () => void tradeSend("trade.offer", pet.id));
    return b;
  };
  const boxes = ui.view?.boxes ?? [];
  if (tradeUi.page > boxes.length) tradeUi.page = 0;
  const shown = tradeUi.page === 0 ? null : boxes[tradeUi.page - 1];
  // 파티 판은 칸 순서대로 — 빈 칸·잠긴 칸은 빈 칸으로 그린다
  const slots: (PetView | null)[] = shown ? shown.slots : (ui.view?.party.slots ?? []).map((s) => s.pet ?? null);
  const pager = el("div", "pager trade-pager");
  const pages = boxes.length + 1; // 파티 판 + 박스. 끝에서 한 번 더 넘기면 반대쪽 끝으로 돈다
  const prev = buttonEl("", "◀");
  prev.setAttribute("aria-label", "앞 판");
  prev.addEventListener("click", () => {
    tradeUi.page = wrapPage(tradeUi.page - 1, pages);
    drawDialog();
  });
  const next = buttonEl("", "▶");
  next.setAttribute("aria-label", "다음 판");
  next.addEventListener("click", () => {
    tradeUi.page = wrapPage(tradeUi.page + 1, pages);
    drawDialog();
  });
  const used = slots.filter((p) => p != null).length;
  pager.append(prev, el("span", "label", shown ? shown.name : "파티"), next, el("span", "used", `${used} / ${slots.length}`));
  const head = el("div", "trade-pick-head");
  head.append(el("strong", undefined, "보낼 포켓몬"), pager);
  box.appendChild(head);
  const grid = el("div", "trade-grid");
  for (const pet of slots) grid.appendChild(pet ? cell(pet) : el("div", "cell blank trade-cell"));
  box.appendChild(grid);
  return box;
}

// 세로 카드 — 제목, 초상, 이름, 레벨·타입 배지 (Figma 02 `Trade Offer Card` `1345:50196`)
// - 상태 글자는 두지 않는다. 확정함은 톤 바탕, 받을 수 없음은 빨간 톤 바탕 (2026-10-02 사용자 결정 "라벨 없애고 ui스타일로")
// - 색만으로 가르지 않게 상태를 aria-label·title 로 둔다
type TradeSideState = "idle" | "ready" | "blocked";
function tradeSide(title: string, card: TradeCardView | null, state: TradeSideState, stateText: string, empty: string): HTMLElement {
  const box = el("div", `trade-card trade-side ${state}`);
  box.setAttribute("aria-label", `${title} · ${stateText}`);
  box.title = stateText;
  box.appendChild(el("strong", "trade-side-title", title));
  const pet = el("div", "trade-side-pet");
  if (!card) {
    pet.appendChild(el("div", "trade-portrait"));
    pet.appendChild(el("div", "trade-empty", empty));
  } else {
    const name = el("strong", "trade-side-name", card.name);
    if (card.shiny) name.appendChild(shinyIcon(10));
    const meta = el("div", "trade-side-meta");
    meta.appendChild(el("span", "trade-meta", lvNature(card.level, card.nature)));
    card.types.forEach((type, i) => meta.appendChild(typeBadgeEl(type, card.typeIds[i])));
    pet.append(portraitOf(card.species, card.shiny, "trade-portrait"), name, meta);
  }
  box.appendChild(pet);
  return box;
}

// 두 카드 사이의 교환 표시 — 위아래 화살표. 두 사람이 모두 확정하면 주색 바탕 (Figma 02 `Trade Swap Mark` `1347:49286`)
function tradeSwapMark(on: boolean): HTMLElement {
  const mark = el("div", on ? "trade-swap on" : "trade-swap");
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M5 13 V3", "M2 6 L5 3 L8 6", "M11 3 V13", "M8 10 L11 13 L14 10"]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  mark.appendChild(svg);
  return mark;
}

// 두 사람이 제안하고 확정하는 화면 — Offer·Blocked. 왼쪽은 보낼 포켓몬, 오른쪽은 두 카드, 바닥은 안내 한 줄과 단추
// 막힘·오류는 바닥 줄의 글자만 바꾼다 — 떠도 모달 높이가 그대로다
export function drawTradeOffer(t: TradeScreen, out: HTMLElement, fail: [string, string] | null): void {
  const body = el("div", "trade-body");
  const cards = el("div", "trade-sides");
  const friendTitle = t.friendName ? `${t.friendName}의 포켓몬` : "친구 포켓몬";
  const friendState: [TradeSideState, string] = t.friendBlocked ? ["blocked", "받을 수 없음"] : t.friendReady ? ["ready", "확정함"] : ["idle", t.friend ? "확정 전" : "고르는 중"];
  cards.append(
    tradeSide("내 포켓몬", t.mine, t.myReady ? "ready" : "idle", t.myReady ? "확정함" : "확정 전", "왼쪽에서 골라요"),
    tradeSide(friendTitle, t.friend, friendState[0], friendState[1], "고르는 중"),
    tradeSwapMark(t.myReady && t.friendReady),
  );
  body.append(tradePicker(t), cards);
  out.appendChild(body);

  const bar = el("div", "trade-bar");
  let bad: [string, string] | null = fail;
  if (!bad && t.friendBlocked) {
    const name = t.friend?.name ?? "이 포켓몬";
    bad = t.friendBlocked === "single" ? [`${name}${josa(name, "은/는")} 단일 포켓몬이라 받을 수 없어요`, "친구가 다른 포켓몬을 올려야 확정할 수 있어요"] : [`${name}의 정보가 올바르지 않아요`, "친구가 다른 포켓몬을 올려야 확정할 수 있어요"];
  }
  if (bad) {
    const notice = el("div", "trade-notice");
    notice.title = bad[1] ? `${bad[0]} — ${bad[1]}` : bad[0];
    notice.append(el("i"), el("span", undefined, bad[0]));
    bar.appendChild(notice);
  } else bar.appendChild(el("div", "trade-desc", "한쪽이 포켓몬을 바꾸면 양쪽 확정이 풀려요"));
  const canReady = !!t.mine && !!t.friend && !t.friendBlocked && !t.busy;
  bar.append(
    actionButtonEl("나가기", false, t.busy, () => void tradeSend("trade.leave")),
    t.myReady ? actionButtonEl("확정 취소", false, t.busy, () => void tradeSend("trade.unready")) : actionButtonEl("확정", true, !canReady, () => void tradeSend("trade.ready")),
  );
  out.appendChild(bar);
}

// 교환 완료 — Done
export function drawTradeDone(t: TradeScreen, out: HTMLElement): void {
  out.appendChild(alertEl("ok", "교환 완료"));
  const r = t.received;
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("받은 포켓몬"));
  if (r) {
    const big = tradePetLine(r.card, "");
    big.classList.add("big");
    card.appendChild(big);
    const place = el("div", "trade-place");
    place.appendChild(el("strong", undefined, r.party != null ? `파티 ${r.party + 1}번 칸에 들어갔어요` : `${r.box ?? "박스"}에 들어갔어요`));
    if (r.sent) place.appendChild(el("div", "trade-desc", `보낸 포켓몬 ${r.sent.name} Lv.${r.sent.level}${josa(String(r.sent.level), "이/가")} 있던 자리`));
    if (r.party != null) place.appendChild(el("div", "trade-desc", r.hidden ? "숨김 상태는 그 칸 그대로" : "꺼낸 상태는 그 칸 그대로"));
    card.appendChild(place);
  }
  const acts = el("div", "trade-acts end");
  acts.appendChild(actionButtonEl("확인", true, t.busy, () => void tradeSend("trade.leave")));
  card.appendChild(acts);
  out.appendChild(card);
}
