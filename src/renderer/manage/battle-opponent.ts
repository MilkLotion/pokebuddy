// 랜덤 배틀 상대 고르기 모달 — 서버가 보인 3개 가운데 하나를 골라 `배틀 시작`, `새로고침`으로 다른 3개
// 규칙 docs/specs/adventure.md "상대 고르기": 줄은 늘 3개이고 모달 높이는 같다. 후보가 모자란 줄은 같은 크기의 실패 줄(고르지 못함)
// 줄 이름은 `N번 파티`, 칸은 초상과 타입 배지. 고른 줄은 옅은 바탕(강조 테두리 없음). 쿨타임이 남으면 시작 단추 자리에 `m:ss 남음`
// 프리셋 전체보기 모달(preset-overview.ts)의 줄·칸 모양을 쓴다. Figma 05 `15 모험` `Adventure / Battle Pick` 5장(1771:88661 등), 줄은 02 `Battle Pick Row` 1771:88109, 칸은 02 `Battle Pick Cell` 1771:87936, 본문은 03 `Battle Pick Panel` 1771:88660
// 서버 호출은 메인이 한다(api.randomBattle → src/online/battle-net.ts). 판을 받으면 메인이 보상을 넣고 배틀 창을 연다
import { failTextOf } from "../../shared/fail-text.js";
import type { BattleOfferView, BattlePickSlotView, BattleReply } from "../../shared/model/battle-net.js";
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

const FAILED_ROW = "상대를 불러오지 못했어요";

interface PickState {
  offer: BattleOfferView | null;
  selected: number | null; // 고른 줄(1~3)
  busy: boolean;
  error: string; // 실패 문구 — 바닥 줄의 정한 자리에만 보인다(레이아웃이 움직이지 않게)
  coolUntil: number; // 쿨타임이 끝나는 시각(ms, 이 PC 시계)
}
const st: PickState = { offer: null, selected: null, busy: false, error: "", coolUntil: 0 };

const errorOf = (r: BattleReply | null): string => (!r ? "서버에 연결하지 못했어요." : r.code ? failTextOf(r.code, "battle", "ko", r.detail).text : "");

// 모달을 열 때 — 상대 3개를 받는다
export function openBattleOpponent(show: () => void): void {
  st.offer = null;
  st.selected = null;
  st.error = "";
  show();
  void refresh();
}

async function refresh(): Promise<void> {
  if (st.busy) return;
  st.busy = true;
  st.selected = null;
  redraw();
  const r = await api.randomBattle({ action: "offer" }).catch(() => null);
  st.busy = false;
  if (r?.ok && r.offer) {
    st.offer = r.offer;
    st.error = "";
    st.coolUntil = Date.now() + r.offer.cooldownMs;
  } else {
    st.error = errorOf(r);
    if (r?.remainMs) st.coolUntil = Date.now() + r.remainMs;
  }
  redraw();
}

async function start(): Promise<void> {
  if (st.busy || !st.offer || st.selected == null) return;
  st.busy = true;
  redraw();
  const r = await api.randomBattle({ action: "start", offerId: st.offer.offerId, pick: st.selected }).catch(() => null);
  st.busy = false;
  if (r?.ok || r?.code === "LOCAL") {
    closeDialog(); // 배틀 창은 메인이 연다. 보상을 넣지 못했으면(LOCAL) 판은 보이고 포인트만 빠진다
    return;
  }
  st.error = errorOf(r);
  if (r?.code === "BATTLE_COOLDOWN" && r.remainMs) st.coolUntil = Date.now() + r.remainMs;
  if (r?.code === "BATTLE_OFFER_GONE") st.offer = null;
  redraw();
}

const redraw = (): void => {
  if (ui.dialog?.kind === "battle-opponent") drawDialog();
};

function remainText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} 남음`;
}

// 칸 — 초상과 타입 배지 1~2개. 이름은 title 과 읽어 주는 이름에만
function pickCell(slot: BattlePickSlotView | null): HTMLElement {
  const cell = el("div", "po-cell bo-cell");
  if (!slot) {
    cell.classList.add("blank");
    return cell;
  }
  cell.appendChild(portraitOf(slot.species, false, "dot"));
  const types = el("div", "bo-types");
  for (const t of slot.types) {
    const icon = iconOf(`type:${t}`, "bo-type"); // 흰 아이콘 — 바탕색은 styles/type-badge.css 의 [data-type] 색
    icon.dataset.type = t;
    types.appendChild(icon);
  }
  cell.appendChild(types);
  cell.title = slot.name;
  cell.setAttribute("aria-label", slot.name);
  return cell;
}

function pickRow(row: BattleOfferView["rows"][number] | null, slot: number): HTMLElement {
  const party = row?.party ?? null;
  if (!party) {
    // 실패 줄 — 같은 크기, 칸 자리는 회색 상자 하나에 글자. 고르지 못한다
    const box = el("div", "preset-row bo-row failed");
    const head = el("div", "po-head");
    head.appendChild(el("span", "po-name", `${slot}번 파티`));
    box.append(head, el("div", "bo-failed", st.busy && !st.offer ? "" : FAILED_ROW));
    return box;
  }
  const on = st.selected === slot;
  const b = buttonEl(on ? "preset-row bo-row on" : "preset-row bo-row");
  b.setAttribute("aria-pressed", String(on));
  const head = el("div", "po-head");
  head.appendChild(el("span", "po-name", `${slot}번 파티`));
  const cells = el("div", "po-cells");
  for (const s of party) cells.appendChild(pickCell(s));
  b.append(head, cells);
  b.addEventListener("click", () => {
    st.selected = slot;
    redraw();
  });
  return b;
}

export function drawBattleOpponent(): void {
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "랜덤 배틀"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const list = el("div", "preset-list bo-list");
  for (let i = 1; i <= 3; i++) list.appendChild(pickRow(st.offer?.rows[i - 1] ?? null, i));
  const remain = st.coolUntil - Date.now();
  const startLabel = remain > 0 ? remainText(remain) : "배틀 시작";
  const go = actionButtonEl(startLabel, true, st.busy || remain > 0 || st.selected == null || !st.offer, () => void start());
  go.classList.add("bo-start");
  const again = actionButtonEl("새로고침", false, st.busy, () => void refresh());
  again.classList.add("bo-refresh");
  const cancel = actionButtonEl("취소", false, false, closeDialog);
  const row = actionsRowEl(again, el("div", "bo-error", st.error), cancel, go);
  dialogEl.append(top, list, row);
}

// 쿨타임 글자를 1초마다 바꾼다 — 모달이 열려 있고 쿨타임이 남았을 때만
setInterval(() => {
  if (ui.dialog?.kind === "battle-opponent" && st.coolUntil > Date.now() - 1000) redraw();
}, 1000);
