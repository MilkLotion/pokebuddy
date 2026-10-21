// 배틀 기록 — 배틀 고르기 모달의 `내 전적` 줄, 배틀 기록 모달, 배틀 상세 모달
// 규칙 docs/specs/adventure.md "배틀 기록" 의 "앱에서 보이기"(2026-10-10 사용자 확정 "이렇게 진행").
// Figma 05 `15 모험` `Adventure / Battle Pick · 전적` 1870:12835·`Adventure / Battle Record` 1959:103319·`Adventure / Battle Detail` 1959:103338,
//   부품 01 `Battle Result Chip` 1870:12804, 02 `Battle Record Summary` 1870:12805·`Battle Record Bar` 1870:12831·`Battle Record Row` 1870:12830
// 값은 서버 battle_record_view(메인 api.randomBattle({ action: "record" }) → src/online/battle-net.ts). 지난 판 다시 보기는 없다
// 배틀 상세 — 줄을 누르면 그 판의 양쪽 파티 DPS 표(서버 battle_detail 의 판 요약). 2026-10-12 사용자 "상대파티 보기 (해당 배틀때)도 추가", Figma 05 `Adventure / Battle Detail` 1959:103338
// 불러오기 전과 실패 때도 줄·카드 자리는 그대로 두고 글자만 바꾼다(레이아웃이 움직이지 않게)
import { ANONYMOUS_NAME, recordBarText, recordRowText, summaryRateText, tallyText } from "../../shared/battle-record-text.js";
import type { BattleDetailView, BattleRecordData, BattleRecordRow, BattleTally } from "../../shared/model/battle-net.js";
import { buttonEl, el } from "../ui/dom.js";
import { dpsTableEl } from "../ui/dps-table.js";
import { api } from "./api.js";
import { portraitOf } from "./art-cache.js";
import { dialogEl, dismissDialog, drawDialog, openSubDialog } from "./dialog.js";
import { ui } from "./state.js";
import { settingsHeadEl } from "./widgets.js";

const ROWS = 8;
const LOADING = "불러오는 중…";
const FAILED = "기록을 불러오지 못했어요";

let data: BattleRecordData | null = null;
let failed = false;
let loading = false;

// 지금 가진 기록 — 배틀 고르기 모달이 마지막 건 판 시각으로 쿨타임을 셈한다. 읽기 전·실패면 null
export const battleRecordData = (): BattleRecordData | null => data;

// 서버에서 다시 읽는다 — 배틀 고르기 모달을 열 때와 배틀 기록 모달을 열 때
// (상대 고르기 모달도 연다 — 지금 앱은 그 모달을 쓰지 않는다)
export async function loadBattleRecord(): Promise<void> {
  if (loading) return;
  loading = true;
  const r = await api.randomBattle({ action: "record" }).catch(() => null);
  loading = false;
  if (r?.ok && r.record) {
    data = r.record;
    failed = false;
  } else failed = true;
  const k = ui.dialog?.kind;
  if (k === "battle-start" || k === "battle-opponent" || k === "battle-record") drawDialog();
}

// 배틀 고르기 모달(과 상대 고르기 모달)의 맨 위 줄 — `내 전적 12승 8패 1무 · 승률 57%` 와 `기록 보기 ›`
export function battleRecordBarEl(): HTMLElement {
  const bar = el("div", "br-bar");
  bar.appendChild(el("span", "br-label", "내 전적"));
  bar.appendChild(el("span", "br-value", data ? recordBarText(data.mine) : failed ? FAILED : LOADING));
  const go = buttonEl("br-go", "기록 보기 ›");
  go.addEventListener("click", () => openSubDialog({ kind: "battle-record" })); // 하위 모달 — 물러나면 연 모달(배틀 고르기)로
  bar.appendChild(go);
  return bar;
}

function summaryEl(label: string, t: BattleTally | null): HTMLElement {
  const card = el("div", "br-summary");
  card.append(el("div", "br-label", label), el("div", "br-value", t ? tallyText(t) : failed ? FAILED : LOADING), el("div", "br-label", t ? summaryRateText(t) : ""));
  return card;
}

// 최근 배틀 한 줄 — 판 요약이 있는 줄은 눌러 배틀 상세를 연다(하위 모달 — 물러나면 배틀 기록으로)
function rowEl(r: BattleRecordRow, open = true): HTMLElement {
  const v = recordRowText(r);
  const id = r.id;
  const go = open && !!id && r.detail === true;
  const row = go ? buttonEl("br-row go") : el("div", "br-row");
  if (go && id) row.addEventListener("click", () => openSubDialog({ kind: "battle-detail", id }));
  row.append(
    el("span", `br-chip ${r.result}`, v.result),
    el("span", "br-kind", v.kind),
    el("span", "br-when", v.when),
    el("span", "br-length", v.length),
    el("span", "br-point", v.point),
  );
  return row;
}

// ── 배틀 상세 ── 판 하나를 서버에서 읽는다. 불러오기 전과 실패 때도 표 자리는 그대로 두고 글자만 바꾼다
let detail: { id: string; view: BattleDetailView | null; failed: boolean } | null = null;

export async function loadBattleDetail(id: string): Promise<void> {
  if (detail?.id === id && detail.view) return;
  detail = { id, view: null, failed: false };
  const r = await api.randomBattle({ action: "detail", id }).catch(() => null);
  if (detail?.id !== id) return;
  detail = { id, view: r?.ok ? (r.battle ?? null) : null, failed: !r?.ok || !r.battle };
  if (ui.dialog?.kind === "battle-detail") drawDialog();
}

export function drawBattleDetail(id: string): void {
  const top = settingsHeadEl("배틀 상세", { onClose: dismissDialog });
  const view = detail?.id === id ? detail.view : null;
  // 기록 줄 — 받은 값이 없으면 배틀 기록의 같은 줄
  const row = view?.row ?? data?.recent.find((r) => r.id === id) ?? null;
  const head = row ? rowEl(row, false) : el("div", "br-row");
  const body = el("div", "bd-tables");
  if (view?.sides) {
    const pic = (r: { species: string; shiny: boolean }): HTMLElement => portraitOf(r.species, r.shiny, "dot");
    const other = `상대 · ${view.row.name ?? ANONYMOUS_NAME}`;
    body.append(dpsTableEl("나", view.sides[0], pic), dpsTableEl(other, view.sides[1], pic));
  } else body.appendChild(el("div", "br-empty", view ? "이 판은 DPS 기록이 없어요" : detail?.id === id && detail.failed ? FAILED : LOADING));
  dialogEl.append(top, head, body);
}

export function drawBattleRecord(): void {
  // 닫기·✕ — 상대 고르기에서 왔으면 그 모달로 돌아간다(고른 줄·쿨타임은 그대로)
  const leave = dismissDialog; // ✕·닫기는 Esc·가림막과 같다 — 상대 고르기에서 열었으면 상대 고르기로, 배너에서 열었으면 닫는다
  const top = settingsHeadEl("배틀 기록", { onClose: leave });
  const summary = el("div", "br-summaries");
  summary.append(summaryEl("내가 건 배틀", data?.mine ?? null), summaryEl("받은 배틀 · 내 배틀 파티가 막은 판", data?.def ?? null));
  const list = el("div", "br-list");
  const recent = data?.recent.slice(0, ROWS) ?? [];
  for (const r of recent) list.appendChild(rowEl(r));
  if (data && !recent.length) list.appendChild(el("div", "br-empty", "아직 배틀이 없어요"));
  dialogEl.append(top, summary, el("div", "br-list-title", "최근 배틀"), list); // 바닥 `닫기` 는 두지 않는다 — ✕·Esc·가림막으로 물러난다(C-13 5번)
}
