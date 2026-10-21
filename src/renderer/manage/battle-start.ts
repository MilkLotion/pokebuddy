// 배틀 고르기 모달 — 모험 탭의 `배틀 시작` 이 연다. 내 전적 줄, 랜덤 배틀·친선 배틀 두 줄
// (2026-10-10 사용자 "배틀시작을 누르면 랜덤배틀 친선배틀 고르는 모달이 나오게", Figma 03 `Battle Mode Body` 2086:109325, 05 `Adventure / 배틀 고르기` 2086:109327·`· 쿨타임` 2086:109687·`· 실패` 2086:110047)
//   내 전적    맨 위 줄. `기록 보기 ›` 는 배틀 기록을 하위 모달로 연다(battle-record.ts)
//   랜덤 배틀  누르면 상대를 고르지 않고 바로 한 판 — 메인이 준비 중 배틀 창을 띄우고, 판을 받으면 이 모달을 닫는다
//             (2026-10-22 사용자 "상대방 고르지 않고 랜덤으로", 시안 확정 "랜덤배틀은 이렇게 하면 될거같아". 상대 고르기 모달 battle-opponent.ts 는 지우지 않고 쓰지 않는다)
//             쿨타임이면 줄을 흐리고 설명 자리에 `m:ss 뒤에 할 수 있어요`. 실패하면 같은 설명 자리에 오류 글자(빨강) — 줄을 끼우지 않는다
//             배틀 파티가 비었거나 출전 불가가 있으면 흐리고 까닭 한 줄
//   친선 배틀  친선 배틀 모달(friendly-battle.ts). 준비 화면이 출전 불가를 보이므로 막지 않는다
//   배틀 문    첫 프리셋 6칸이 덜 열렸으면 두 줄 모두 흐리고 같은 까닭. 다른 까닭보다 앞선다(2026-10-10, Figma 05 `Adventure / 배틀 고르기 · 칸이 덜 열림`)
// 고르기 모달이라 ✕ 로 닫는다. 바닥 단추 줄은 없다
import { failTextOf } from "../../shared/fail-text.js";
import { RANDOM_BATTLE_COOLDOWN_MS, type BattleReply } from "../../shared/model/battle-net.js";
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import { battleRecordBarEl, battleRecordData, loadBattleRecord } from "./battle-record.js";
import { closeDialog, dialogEl, dialogHead, drawDialog, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";

// 배틀 문 까닭 — 친선 배틀 만남 화면의 바닥 줄도 쓴다
export const gateText = (preset: string): string => `${preset}의 파티 칸 6칸을 모두 열어야 해요`;

const RANDOM_DESC = "랜덤 상대와 바로 싸워요 · 보상 · 5분에 한 번";

interface RandomState {
  busy: boolean; // 판을 기다리는 중 — 두 번 누르지 않게
  error: string; // 실패 글자 — 랜덤 배틀 줄 설명 자리에만 보인다
  coolUntil: number; // 서버가 알려 준 쿨타임 끝(ms, 이 PC 시계). 기록의 마지막 건 판 시각으로 셈한 값과 큰 쪽을 쓴다
}
const st: RandomState = { busy: false, error: "", coolUntil: 0 };
let coolDesc: HTMLElement | null = null; // 쿨타임 글자 — 타이머가 글자만 고친다

const errorOf = (r: BattleReply | null): string => (!r ? "서버에 연결하지 못했어요. 다시 눌러 보세요" : r.code ? failTextOf(r.code, "battle", "ko", r.detail).text : "");

// 쿨타임 끝 시각 — 서버가 준 값과, 기록의 마지막 건 판 + 5분 가운데 늦은 쪽
function coolUntil(): number {
  const last = battleRecordData()?.recent.find((r) => r.mine);
  const fromRecord = last ? Date.parse(last.at) + RANDOM_BATTLE_COOLDOWN_MS : 0;
  return Math.max(st.coolUntil, Number.isFinite(fromRecord) ? fromRecord : 0);
}

function coolText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} 뒤에 할 수 있어요`;
}

// 모달에 들어올 때 — 지난 실패 글자를 지우고 전적(쿨타임 셈에도 쓴다)을 다시 읽는다
export function enterBattleStart(): void {
  st.error = "";
  st.busy = false;
  void loadBattleRecord();
}

async function startRandom(): Promise<void> {
  if (st.busy) return;
  st.busy = true;
  st.error = "";
  redraw();
  const r = await api.randomBattle({ action: "random" }).catch(() => null);
  st.busy = false;
  if (r?.ok || r?.code === "LOCAL") {
    // 판을 받았다 — 배틀 창은 메인이 연다. 보상을 넣지 못했으면(LOCAL) 판은 보이고 포인트만 빠진다
    st.coolUntil = Date.now() + RANDOM_BATTLE_COOLDOWN_MS;
    closeDialog();
    void loadBattleRecord();
    return;
  }
  if (r?.code === "BATTLE_COOLDOWN" && r.remainMs) st.coolUntil = Date.now() + r.remainMs;
  else st.error = errorOf(r);
  redraw();
}

const redraw = (): void => {
  if (ui.dialog?.kind === "battle-start") drawDialog();
};

function modeRow(title: string, desc: string, off: boolean, go: () => void, descClass?: string): HTMLElement {
  const row = buttonEl("battle-mode");
  const d = el("span", descClass, desc);
  row.append(el("strong", undefined, title), d);
  row.disabled = off;
  row.addEventListener("click", go);
  return row;
}

export function drawBattleStart(): void {
  const v = ui.view;
  if (!v) {
    closeDialog();
    return;
  }
  const blocked = v.battle.slots.some((s) => s.blocked);
  const empty = !v.battle.slots.some((s) => s.pet);
  const gate = v.battle.gate;
  const why = gate != null ? gateText(gate) : blocked ? "출전 불가 포켓몬이 있어요" : empty ? "배틀 파티가 비었어요" : null;
  const remain = coolUntil() - Date.now();
  const cooling = why == null && remain > 0;
  const desc = why ?? (cooling ? coolText(remain) : st.error || RANDOM_DESC);
  const random = modeRow("랜덤 배틀", desc, gate != null || !v.battle.canStart || cooling, () => void startRandom(), why == null && !cooling && st.error ? "error" : undefined);
  coolDesc = cooling ? (random.querySelector("span") as HTMLElement | null) : null;
  const list = el("div", "battle-modes");
  list.append(random, modeRow("친선 배틀", gate != null ? gateText(gate) : "링크로 친구를 불러 한 판 · 보상 없음", gate != null, () => openAnyDialog({ kind: "friendly" })));
  // 부제는 배틀 능력치 기준 — 탭 팁 첫 줄과 같은 말 (2026-10-11 사용자 "b+c 같이", Figma 05 `Adventure / 배틀 고르기`). 숫자는 src/battle/rules.ts BATTLE_RULES 와 맞춘다
  dialogEl.append(...dialogHead("배틀 시작", "모두 50레벨 · 6V · 노력치·도구 없이 싸워요", { close: true }), battleRecordBarEl(), list);
}

// 쿨타임 글자를 1초마다 바꾼다 — 설명 글자만 고치고, 쿨타임이 끝나는 때에만 모달을 다시 그린다(실행 규칙 R1)
setInterval(() => {
  if (!coolDesc?.isConnected || ui.dialog?.kind !== "battle-start") return;
  const remain = coolUntil() - Date.now();
  if (remain > 0) coolDesc.textContent = coolText(remain);
  else redraw();
}, 1000);
