// 랜덤 배틀 상대 고르기 모달 — 서버가 보인 3개 가운데 하나를 골라 `배틀 시작`, `새로고침`으로 다른 3개
// 새로고침은 판마다 1번이고 이미 보인 상대를 뺀다. 쓰고 나면 단추를 흐린다(2026-10-14 사용자 "리롤은 1번만"). 모달을 다시 열면 서버가 같은 3개를 준다
// 단추는 `새로고침` · 새로고침 아이콘 · 남은 횟수(2026-10-14 사용자 "새로고침 () 1 이런식으로"). Figma 01 `Reroll Button` 2025:1298
// 규칙 docs/specs/adventure.md "상대 고르기": 왼쪽 내 배틀 파티 | VS | 오른쪽 상대 3파티. 파티마다 전장 배치대로 2열 3줄이다(2026-10-17·18 사용자 결정)
//   내 파티 `1 2 / 3 4 / 5 6`(앞 열 2·4·6 이 오른쪽), 상대 `2 1 / 4 3 / 6 5`(앞 열이 왼쪽) — 배틀 창 카드와 같은 배치
//   내 칸은 누르면 들고(옅은 바탕), 다른 칸을 누르면 모험 탭 끌어 놓기와 같은 battle.move 로 옮기거나 맞바꾼다. 같은 칸을 다시 누르면 내려놓는다
//   상대 묶음은 늘 3개이고 모달 높이는 같다. 후보가 모자란 묶음은 같은 크기의 실패 묶음(고르지 못함). 고른 묶음은 옅은 바탕(강조 테두리 없음)
//   쿨타임이 남으면 시작 단추 자리에 `m:ss 남음`
// Figma 99 `Draft / 배틀 모달` — `Draft / Battle Formation`·`Draft / VS Divider · Vertical`·`Draft / Battle Pick Body · 배치`. 칸은 02 `Battle Pick Cell` 1771:87936
// 서버 호출은 메인이 한다(api.randomBattle → src/online/battle-net.ts). 판을 받으면 메인이 보상을 넣고 배틀 창을 연다
import { failTextOf } from "../../shared/fail-text.js";
import type { BattleOfferView, BattlePickSlotView, BattleReply } from "../../shared/model/battle-net.js";
import { buttonEl, el } from "../ui/dom.js";
import { refreshIconEl } from "../ui/line-icons.js";
import type { BattleSlotView } from "../../shared/model/snapshot.js";
import { api } from "./api.js";
import { battleRecordBarEl, loadBattleRecord } from "./battle-record.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { settingsHeadEl } from "./widgets.js";

const FAILED_ROW = "상대를 불러오지 못했어요";

interface PickState {
  offer: BattleOfferView | null;
  selected: number | null; // 고른 줄(1~3)
  busy: boolean;
  error: string; // 실패 문구 — 바닥 줄의 정한 자리에만 보인다(레이아웃이 움직이지 않게)
  coolUntil: number; // 쿨타임이 끝나는 시각(ms, 이 PC 시계)
  held: number | null; // 든 내 배틀 파티 칸(0~5)
}
const st: PickState = { offer: null, selected: null, busy: false, error: "", coolUntil: 0, held: null };
let coolButton: HTMLButtonElement | null = null; // 쿨타임 글자를 보이는 시작 단추 — 타이머가 글자만 고친다

// 2열 3줄 배치 — 칸 순서(0~5)를 줄마다 [왼쪽, 오른쪽] 으로. 짝수 칸이 뒤 열, 홀수 칸이 앞 열이다(src/battle/engine.ts startPos)
const MINE_ORDER = [0, 1, 2, 3, 4, 5]; // 앞 열이 오른쪽(상대 쪽)
const FOE_ORDER = [1, 0, 3, 2, 5, 4]; // 앞 열이 왼쪽(내 쪽)

const errorOf = (r: BattleReply | null): string => (!r ? "서버에 연결하지 못했어요." : r.code ? failTextOf(r.code, "battle", "ko", r.detail).text : "");

// 모달을 열 때 — 상대 3개를 받는다
export function openBattleOpponent(show: () => void): void {
  st.offer = null;
  st.selected = null;
  st.error = "";
  st.held = null;
  show();
  void fetchOffer(false);
  void loadBattleRecord(); // 파티 목록 위 `내 전적` 줄 (battle-record.ts)
}

// reroll false 는 열기(남은 3개가 있으면 그대로), true 는 새로고침
async function fetchOffer(reroll: boolean): Promise<void> {
  if (st.busy) return;
  st.busy = true;
  st.selected = null;
  redraw();
  const r = await api.randomBattle(reroll ? { action: "offer", reroll: true } : { action: "offer" }).catch(() => null);
  st.busy = false;
  if (r?.ok && r.offer) {
    st.offer = r.offer;
    st.error = "";
    st.coolUntil = Date.now() + r.offer.cooldownMs;
  } else {
    st.error = errorOf(r);
    if (r?.remainMs) st.coolUntil = Date.now() + r.remainMs;
    if (r?.code === "BATTLE_REROLL_USED" && st.offer) st.offer = { ...st.offer, rerollLeft: 0 };
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

// 칸 — 초상과 타입 배지 1~2개. 이름은 title 과 읽어 주는 이름에만. 친선 배틀의 양쪽 줄도 쓴다 (friendly-battle.ts)
function cellEl(cell: HTMLElement, look: string, shiny: boolean, typeIds: readonly string[], name: string): HTMLElement {
  cell.appendChild(portraitOf(look, shiny, "dot"));
  const types = el("div", "bo-types");
  for (const t of typeIds) {
    const icon = iconOf(`type:${t}`, "type-icon"); // 흰 아이콘은 그림 캐시에서 — 모양은 공통 styles/type-badge.css `.type-icon`
    icon.dataset.type = t;
    types.appendChild(icon);
  }
  cell.appendChild(types);
  cell.title = name;
  cell.setAttribute("aria-label", name);
  return cell;
}

export function pickCell(slot: BattlePickSlotView | null): HTMLElement {
  const cell = el("div", "po-cell bo-cell");
  if (!slot) {
    cell.classList.add("blank");
    return cell;
  }
  return cellEl(cell, slot.species, false, slot.types, slot.name);
}

// 2열 3줄 — cells 는 칸 순서(0~5), order 는 줄마다 왼쪽·오른쪽에 둘 칸
function gridEl(cells: HTMLElement[], order: readonly number[]): HTMLElement {
  const grid = el("div", "bo-grid");
  for (const i of order) grid.appendChild(cells[i] ?? el("div", "po-cell bo-cell blank"));
  return grid;
}

// 내 칸 — 누르면 들고, 든 채로 다른 칸을 누르면 옮기거나 맞바꾼다(battle.move). 빈 칸은 놓을 자리로만 쓴다
function myCell(slot: BattleSlotView): HTMLElement {
  const on = st.held === slot.index;
  const b = buttonEl(on ? "po-cell bo-cell held" : "po-cell bo-cell");
  if (slot.pet) cellEl(b, slot.pet.look, slot.pet.shiny, slot.pet.typeIds, slot.pet.name);
  else b.classList.add("blank");
  if (slot.blocked) b.classList.add("blocked");
  b.setAttribute("aria-pressed", String(on));
  b.disabled = st.held == null && !slot.pet;
  b.addEventListener("click", () => {
    const from = st.held;
    if (from == null) st.held = slot.index;
    else {
      st.held = null;
      if (from !== slot.index) void sendCommand("battle.move", "", { slotIndex: from, toSlot: slot.index }, { busyOn: b, keepOpen: true });
    }
    redraw();
  });
  return b;
}

function mineEl(): HTMLElement {
  const box = el("div", "bo-party mine");
  box.appendChild(el("div", "po-name", "내 파티"));
  box.appendChild(gridEl((ui.view?.battle.slots ?? []).map(myCell), MINE_ORDER));
  return box;
}

function foeEl(row: BattleOfferView["rows"][number] | null, slot: number): HTMLElement {
  const party = row?.party ?? null;
  const name = el("div", "po-name", `${slot}번 파티`);
  if (!party) {
    // 실패 묶음 — 같은 크기, 칸 자리는 회색 상자 하나에 글자. 고르지 못한다
    const box = el("div", "bo-party failed");
    box.append(name, el("div", "bo-failed", st.busy && !st.offer ? "" : FAILED_ROW));
    return box;
  }
  const on = st.selected === slot;
  const b = buttonEl(on ? "bo-party on" : "bo-party");
  b.setAttribute("aria-pressed", String(on));
  b.append(name, gridEl(party.map(pickCell), FOE_ORDER));
  b.addEventListener("click", () => {
    st.selected = slot;
    redraw();
  });
  return b;
}

export function drawBattleOpponent(): void {
  const top = settingsHeadEl("랜덤 배틀", { onClose: closeDialog });
  // 내 파티 | VS | 상대 3파티 — VS 는 친선 배틀 만남 화면의 표시를 세운 모양(2026-10-18 사용자 "divider 에 vs 같은거 넣어보자")
  const vs = el("div", "fb-vs vertical");
  vs.append(el("i"), el("span", undefined, "VS"), el("i"));
  const foes = el("div", "bo-foes");
  for (let i = 1; i <= 3; i++) foes.appendChild(foeEl(st.offer?.rows[i - 1] ?? null, i));
  const list = el("div", "bo-field");
  list.append(mineEl(), vs, foes);
  const remain = st.coolUntil - Date.now();
  const startLabel = remain > 0 ? remainText(remain) : "배틀 시작";
  const go = actionButtonEl(startLabel, true, st.busy || remain > 0 || st.selected == null || !st.offer, () => void start());
  go.classList.add("bo-start");
  coolButton = remain > 0 ? go : null;
  const left = st.offer?.rerollLeft ?? 1;
  const again = actionButtonEl("새로고침", false, st.busy || left === 0, () => void fetchOffer(true));
  again.classList.add("bo-refresh");
  again.append(refreshIconEl(), el("span", "bo-refresh-left", String(left)));
  again.setAttribute("aria-label", `새로고침 ${left}번 남음`);
  const cancel = actionButtonEl("취소", false, false, closeDialog);
  const row = actionsRowEl(again, el("div", "bo-error", st.error), cancel, go);
  dialogEl.append(top, battleRecordBarEl(), list, row);
}

// 쿨타임 글자를 1초마다 바꾼다 — 시작 단추 글자만 고치고, 쿨타임이 끝나는 때에만 모달을 다시 그린다(실행 규칙 R1)
setInterval(() => {
  if (!coolButton?.isConnected || ui.dialog?.kind !== "battle-opponent") return;
  const remain = st.coolUntil - Date.now();
  if (remain > 0) coolButton.textContent = remainText(remain);
  else redraw();
}, 1000);
