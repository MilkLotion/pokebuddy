// 배틀 기록 — 상대 고르기 모달의 `내 전적` 줄과 배틀 기록 모달
// 규칙 docs/specs/adventure.md "배틀 기록" 의 "앱에서 보이기"(2026-10-10 사용자 확정 "이렇게 진행").
// Figma 05 `15 모험` `Adventure / Battle Pick · 전적` 1870:12835·`Adventure / Battle Record` 1870:13392,
//   부품 01 `Battle Result Chip` 1870:12804, 02 `Battle Record Summary` 1870:12805·`Battle Record Bar` 1870:12831·`Battle Record Row` 1870:12830
// 값은 서버 battle_record_view(메인 api.randomBattle({ action: "record" }) → src/online/battle-net.ts). 지난 판 다시 보기·상대 파티 보기는 없다
// 불러오기 전과 실패 때도 줄·카드 자리는 그대로 두고 글자만 바꾼다(레이아웃이 움직이지 않게)
import { recordBarText, recordRowText, summaryRateText, tallyText } from "../../shared/battle-record-text.js";
import type { BattleRecordData, BattleTally } from "../../shared/model/battle-net.js";
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import { dialogEl, dismissDialog, drawDialog, openSubDialog } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

const ROWS = 8;
const LOADING = "불러오는 중…";
const FAILED = "기록을 불러오지 못했어요";

let data: BattleRecordData | null = null;
let failed = false;
let loading = false;

// 서버에서 다시 읽는다 — 상대 고르기 모달을 열 때와 배틀 기록 모달을 열 때
export async function loadBattleRecord(): Promise<void> {
  if (loading) return;
  loading = true;
  const r = await api.randomBattle({ action: "record" }).catch(() => null);
  loading = false;
  if (r?.ok && r.record) {
    data = r.record;
    failed = false;
  } else failed = true;
  if (ui.dialog?.kind === "battle-opponent" || ui.dialog?.kind === "battle-record") drawDialog();
}

// 상대 고르기 모달의 파티 목록 위 줄 — `내 전적 12승 8패 1무 · 승률 57%` 와 `기록 보기 ›`
export function battleRecordBarEl(): HTMLElement {
  const bar = el("div", "br-bar");
  bar.appendChild(el("span", "br-label", "내 전적"));
  bar.appendChild(el("span", "br-value", data ? recordBarText(data.mine) : failed ? FAILED : LOADING));
  const go = buttonEl("br-go", "기록 보기 ›");
  go.addEventListener("click", () => openSubDialog({ kind: "battle-record" })); // 상대 고르기의 하위 모달 — 물러나면 상대 고르기로
  bar.appendChild(go);
  return bar;
}

function summaryEl(label: string, t: BattleTally | null): HTMLElement {
  const card = el("div", "br-summary");
  card.append(el("div", "br-label", label), el("div", "br-value", t ? tallyText(t) : failed ? FAILED : LOADING), el("div", "br-label", t ? summaryRateText(t) : ""));
  return card;
}

function rowEl(r: BattleRecordData["recent"][number]): HTMLElement {
  const v = recordRowText(r);
  const row = el("div", "br-row");
  row.append(
    el("span", `br-chip ${r.result}`, v.result),
    el("span", "br-kind", v.kind),
    el("span", "br-when", v.when),
    el("span", "br-length", v.length),
    el("span", "br-point", v.point),
  );
  return row;
}

export function drawBattleRecord(): void {
  // 닫기·✕ — 상대 고르기에서 왔으면 그 모달로 돌아간다(고른 줄·쿨타임은 그대로)
  const leave = dismissDialog; // ✕·닫기는 Esc·가림막과 같다 — 상대 고르기에서 열었으면 상대 고르기로, 배너에서 열었으면 닫는다
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "배틀 기록"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", leave);
  top.append(titles, x);
  const summary = el("div", "br-summaries");
  summary.append(summaryEl("내가 건 배틀", data?.mine ?? null), summaryEl("받은 배틀 · 내 배틀 파티가 막은 판", data?.def ?? null));
  const list = el("div", "br-list");
  const recent = data?.recent.slice(0, ROWS) ?? [];
  for (const r of recent) list.appendChild(rowEl(r));
  if (data && !recent.length) list.appendChild(el("div", "br-empty", "아직 배틀이 없어요"));
  dialogEl.append(top, summary, el("div", "br-list-title", "최근 배틀"), list); // 바닥 `닫기` 는 두지 않는다 — ✕·Esc·가림막으로 물러난다(C-13 5번)
}
