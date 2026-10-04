// 설정창의 교환 — 친구 교환 모달(만들기·링크로 참가·고르기·확정·완료·오류)과 박스 머리 단추의 진행 중 점 (P10n)
// Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 모달 6화면 — Base `1036:23257`·Link Created `1036:22965`·Offer `1036:22673`·Blocked `1036:22381`·Done `1036:22089`·Error `1036:21797`.
// 값은 메인이 만든 TradeScreen(src/view/trade-screen.ts). 조작은 명령 trade.* 로 보내고, 결과와 실시간 변경은 같은 값으로 온다.
// 교환 흐름은 메인이 들고 있다. 여기서는 받은 값을 그리기만 한다.
// 그리는 곳은 교환 모달이다 — 박스 머리 메뉴의 `교환` 이 연다(2026-09-30·10-02 사용자 결정).
// 모달을 닫아도 교환은 이어진다. 진행 중이면 머리의 햄버거 단추에 점을 둔다
import type { AccountScreen } from "../../shared/model/account.js";
import { api } from "./api.js";
import { wrapPage } from "./grid-view.js";
import { liveInputEl } from "./search.js";
import { alertEl, dialogCloseEl, lvNature } from "./widgets.js";
import { portraitOf } from "./art-cache.js";
import { refreshView } from "./live.js";
import type { PetView } from "../../shared/model/snapshot.js";
import type { ManageReply } from "../../shared/ipc/manage.js";
import type { TradeCardView, TradeScreen } from "../../shared/model/trade.js";
import type { TradeCloseReason } from "../../shared/names/online-codes.js";
import type { Reason } from "../../shared/names/reasons.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { josa } from "../../shared/josa.js";
import { buttonEl, el } from "../ui/dom.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { bodyEl, redrawBody } from "./shell.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";
import { failTextOf } from "../../shared/fail-text.js";

// manage.ts 에서 빌려 쓰는 것 — 다른 구역도 쓰므로 옮기지 않고 받는다 (P10 안내 4절)
export interface TradeHooks {
  account(): AccountScreen | null; // 계정 화면 값 — 익명·로그인 전이면 만들기·참가 대신 로그인 안내
}
let hooks: TradeHooks | null = null;
export function setTradeHooks(next: TradeHooks): void {
  hooks = next;
}
function hooksOf(): TradeHooks {
  if (!hooks) throw new Error("trade.ts 의 고리가 걸리지 않았다 — setTradeHooks 를 먼저 부른다");
  return hooks;
}

let trade: TradeScreen | null = null;
let tradeLoading = false;
let tradeInput = ""; // 링크로 참가 칸에 붙여 넣은 글자
let tradeCopied = false; // 링크 복사 직후 — 단추 글자를 바꾼다

// 닫힌 이유 — 친구가 나갔거나 링크가 만료됐다. 열쇠는 서버의 닫힘 이유 한 벌(shared/names/online-codes.ts)이다
const TRADE_CLOSED: Record<TradeCloseReason, [string, string]> = {
  guest_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  host_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  expired: ["링크가 만료됐어요", "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요"],
};
// 서버가 모르는 글자를 보낼 수 있다 — 표에 있는 이유만 글을 돌려준다
const tradeClosedText = (reason: string | null): [string, string] | null =>
  reason !== null && Object.hasOwn(TRADE_CLOSED, reason) ? TRADE_CLOSED[reason as TradeCloseReason] : null;
const TRADE_LOCAL: Record<string, string> = {
  single: "단일 포켓몬은 교환할 수 없어요",
  locked: "확정한 포켓몬은 바꿀 수 없어요",
  "no-pet": "그 포켓몬을 찾을 수 없어요",
} satisfies Partial<Record<Reason, string>>;

export async function loadTrade(): Promise<void> {
  if (tradeLoading) return;
  tradeLoading = true;
  try {
    const reply = await api.command({ cmd: "trade.status" });
    trade = tradeOf(reply);
  } finally {
    tradeLoading = false;
  }
  syncTradeDot();
  redrawTrade();
}

// 교환 모달이 떠 있으면 다시 그린다. 본문(박스 탭)은 건드리지 않는다
export function redrawTrade(): void {
  if (ui.dialog?.kind === "trade") drawDialog();
}

// 진행 중 — 링크를 만들었거나, 친구와 고르는 중이거나, 완료 화면의 `확인` 을 아직 누르지 않았다
// 박스 탭이 머리 단추의 점을 그릴 때 묻는다 — 교환 상태는 이 파일 안에 있다
export const tradeInProgress = (): boolean => tradeActive(trade);
const tradeActive = (t: TradeScreen | null): boolean => !!t?.available && (t.phase === "hosting" || t.phase === "trading" || t.phase === "done");

// 박스 머리 햄버거 단추의 교환 진행 중 점 — 본문을 다시 그리지 않고 점만 켜고 끈다. 교환은 그 메뉴의 `교환` 이 연다 (box-order.ts boxMenuEl)
function syncTradeDot(): void {
  const dot = bodyEl.querySelector<HTMLElement>(".box-menu-toggle .dot");
  if (dot) dot.hidden = !tradeActive(trade);
}

// 결과의 screen 을 꺼낸다. 교환 세션이 없을 때(trade-off·sandbox)만 쓸 수 없다고 보인다.
// 그 밖의 실패(시간 초과·준비 전)는 지금 화면에 오류 배너만 더한다
const TRADE_UNAVAILABLE = new Set(["trade-off", "sandbox"]);
function tradeOf(reply: ManageReply): TradeScreen {
  const screen = reply.screen;
  if (screen && typeof screen === "object" && typeof screen.phase === "string") return screen;
  if (TRADE_UNAVAILABLE.has(reply.reason)) return { ...(trade ?? TRADE_OFF), available: false };
  return { ...(trade ?? { ...TRADE_OFF, available: true }), busy: false, error: { code: reply.reason } };
}

const TRADE_OFF: TradeScreen = {
  available: false, phase: "idle", link: null, expiresAt: null, busy: false, error: null, closedReason: null,
  friendJoined: false, friendName: null, mine: null, myPetId: null, myReady: false, friend: null, friendReady: false,
  friendBlocked: null, singles: [], received: null,
};

async function tradeSend(cmd: string, target?: string, args?: Record<string, unknown>): Promise<ManageReply> {
  const before = trade?.received?.petId ?? null;
  if (trade) {
    trade = { ...trade, busy: true };
    redrawTrade();
  }
  let reply: ManageReply;
  try {
    reply = await api.command({ cmd, ...(target ? { target } : {}), ...(args ? { args } : {}) });
  } catch (e) {
    console.error("교환 명령을 보내지 못했다", e);
    reply = { ok: false, reason: "error" };
  }
  trade = tradeOf(reply);
  // 거절(진행 중인 교환 등)은 보기에 남지 않는다 — 배너로 보인다
  if (!reply.ok && !trade.error && trade.available) trade = { ...trade, error: { code: reply.reason, ...(typeof reply.detail === "string" ? { detail: reply.detail } : {}) } };
  if (trade.received && trade.received.petId !== before) {
    ui.view = await api.snapshot(); // 교환이 끝났다 — 바뀐 개체를 다시 받는다
    redrawBody();
  }
  syncTradeDot();
  redrawTrade();
  return reply;
}

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
function tradeState(text: string, tone: "ok" | "wait" | "bad" | "idle"): HTMLElement {
  const box = el("span", `trade-state ${tone}`);
  box.append(el("i"), document.createTextNode(text));
  return box;
}

function tradeCardHead(title: string, right?: HTMLElement): HTMLElement {
  const row = el("div", "trade-card-head");
  row.appendChild(el("strong", undefined, title));
  if (right) row.appendChild(right);
  return row;
}

const leftText = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 링크 만들기·참가 두 카드와 규칙 — Base·Link Created·Error
function drawTradeStart(t: TradeScreen, out: HTMLElement): void {
  const row = el("div", "trade-row");
  row.dataset.tut = "trade"; // 교환 튜토리얼이 밝히는 곳 — 링크 만들기·링크로 참가

  const host = el("div", "trade-card");
  if (t.phase === "hosting" && t.link) {
    host.appendChild(tradeCardHead("공유 채널", tradeState("친구 기다리는 중", "wait")));
    const left = el("div", "trade-desc");
    const time = el("strong", "trade-left", t.expiresAt ? leftText(t.expiresAt - Date.now()) : "");
    time.dataset.expires = String(t.expiresAt ?? "");
    left.append(document.createTextNode("참가 전 남은 시간 "), time);
    const acts = el("div", "trade-acts");
    const link = el("input", "trade-input trade-link");
    link.readOnly = true;
    link.value = `…#${t.link.slice(t.link.lastIndexOf("#") + 1, t.link.lastIndexOf("#") + 7)}`; // 앞 6자만 — 전체는 title 과 복사로 (Figma `Trade / Link Created` "…#Qm7xK2")
    link.title = t.link;
    link.setAttribute("aria-label", "내 교환 링크");
    const copy = actionButtonEl(tradeCopied ? "복사됨" : "링크 복사", true, false, () => {
      api.copyText(t.link ?? "");
      tradeCopied = true;
      redrawTrade();
      setTimeout(() => {
        tradeCopied = false;
        redrawTrade();
      }, 1500);
    });
    acts.append(link, copy, actionButtonEl("취소", false, t.busy, () => void tradeSend("trade.leave")));
    host.append(left, acts);
  } else {
    host.appendChild(tradeCardHead("공유 채널 만들기"));
    const acts = el("div", "trade-acts");
    acts.appendChild(actionButtonEl("링크 만들기", true, t.busy, () => void tradeSend("trade.create")));
    host.appendChild(acts);
  }

  const join = el("div", "trade-card");
  join.appendChild(tradeCardHead("링크로 참가"));
  const acts = el("div", "trade-acts");
  const input = liveInputEl("trade-link", tradeInput, "교환 링크 붙여넣기", (q) => {
    tradeInput = q;
  });
  input.type = "text";
  input.classList.add("trade-input");
  const go = actionButtonEl("참가", false, t.busy || t.phase === "hosting", () => {
    const link = tradeInput.trim();
    if (!link) return;
    void tradeSend("trade.join", undefined, { link }).then((reply) => {
      if (reply.ok) {
        tradeInput = "";
        redrawTrade();
      }
    });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go.click();
  });
  acts.append(input, go);
  join.appendChild(acts);

  row.append(host, join);
  out.appendChild(row);

  const rules = el("div", "trade-card");
  rules.appendChild(tradeCardHead("교환 규칙"));
  for (const line of ["한 번에 한 마리씩 맞바꿔요", "받은 포켓몬은 보낸 포켓몬이 있던 자리로 가요", "단일 포켓몬은 교환할 수 없어요"]) rules.appendChild(el("div", "trade-desc", line));
  out.appendChild(rules);
}

// 보낼 포켓몬 넘김 — 0 은 파티, 1 부터 박스 1, 박스 2 …
let tradePage = 0;

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
  if (tradePage > boxes.length) tradePage = 0;
  const shown = tradePage === 0 ? null : boxes[tradePage - 1];
  // 파티 판은 칸 순서대로 — 빈 칸·잠긴 칸은 빈 칸으로 그린다
  const slots: (PetView | null)[] = shown ? shown.slots : (ui.view?.party.slots ?? []).map((s) => s.pet ?? null);
  const pager = el("div", "pager trade-pager");
  const pages = boxes.length + 1; // 파티 판 + 박스. 끝에서 한 번 더 넘기면 반대쪽 끝으로 돈다
  const prev = buttonEl("", "◀");
  prev.setAttribute("aria-label", "앞 판");
  prev.addEventListener("click", () => {
    tradePage = wrapPage(tradePage - 1, pages);
    drawDialog();
  });
  const next = buttonEl("", "▶");
  next.setAttribute("aria-label", "다음 판");
  next.addEventListener("click", () => {
    tradePage = wrapPage(tradePage + 1, pages);
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
function drawTradeOffer(t: TradeScreen, out: HTMLElement, fail: [string, string] | null): void {
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
function drawTradeDone(t: TradeScreen, out: HTMLElement): void {
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

// 교환 모달 — 머리 "친구 교환" 과 오른쪽 위 ✕, 스크롤 본문. ✕·Esc·바깥 누르기로 닫는다(모달 공통)
export function drawTradeDialog(): void {
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "친구 교환"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const out = el("div", "scroll");
  dialogEl.append(top, out);
  const t = trade;
  if (!t) {
    out.appendChild(el("div", "empty-note", "교환 상태를 읽는 중이에요."));
    void loadTrade();
    return;
  }
  if (!t.available) {
    out.appendChild(el("div", "empty-note", "교환을 쓸 수 없어요."));
    return;
  }
  // 오류·닫힘 배너 — 같은 자리에 제목과 문구만 바뀐다. 제안·확정 화면은 배너 대신 바닥 줄에 한 줄로 보인다
  const err = t.error;
  const fail: [string, string] | null = !err
    ? null
    : err.code === "LOCAL"
      ? [TRADE_LOCAL[err.detail ?? ""] ?? "교환을 진행하지 못했어요", err.detail === "locked" ? "" : "다른 포켓몬을 골라 주세요"]
      : ((f) => [f.text, f.detail ?? ""] as [string, string])(failTextOf(err.code, "trade"));
  if (fail && t.phase !== "trading") out.appendChild(alertEl("bad", fail[0], fail[1]));
  else if (!fail && t.phase === "closed") {
    const text = tradeClosedText(t.closedReason) ?? ["교환이 닫혔어요", "새 링크로 다시 시작해 주세요"];
    out.appendChild(alertEl("bad", text[0], text[1]));
  }
  if (t.phase === "trading") drawTradeOffer(t, out, fail);
  else if (t.phase === "done") drawTradeDone(t, out);
  else if (hooksOf().account()?.available && !hooksOf().account()?.signedIn) drawTradeLogin(out);
  else drawTradeStart(t, out);
}

// 로그인 전(익명·분실) — 만들기·참가 대신 로그인 안내. 진행 중인 교환은 끝까지 보인다 (design-p2.md 5절)
function drawTradeLogin(out: HTMLElement): void {
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("교환은 로그인해야 할 수 있어요"));
  const acts = el("div", "trade-acts");
  acts.appendChild(actionButtonEl("로그인", true, false, () => openAnyDialog({ kind: "user", tab: "account" })));
  card.appendChild(acts);
  out.appendChild(card);
}

// 참가 전 남은 시간 — 글자만 1초마다 바꾼다. 본문을 다시 그리지 않는다
setInterval(() => {
  for (const node of document.querySelectorAll<HTMLElement>(".trade-left")) {
    const at = Number(node.dataset.expires);
    if (at) node.textContent = leftText(at - Date.now());
  }
}, 1000);

api.onTrade((screen) => {
  const got = screen.received?.petId !== trade?.received?.petId && screen.received != null;
  trade = screen;
  syncTradeDot();
  // 교환이 끝나 개체가 바뀌었다 — 스냅샷도 다시 받는다. 받지 않으면 보낸 개체가 파티·박스에 남아 보인다(2026-09-27 화면 E2E 에서 발견)
  if (got) void refreshView().then(redrawTrade);
  else redrawTrade();
});
