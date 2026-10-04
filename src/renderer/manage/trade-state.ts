// 설정창 교환의 상태와 서버 길 — 교환 보기·읽는 중·입력 칸·넘김(tradeUi), trade.status 읽기, trade.* 보내기, 실시간 변경 받기, 박스 머리 진행 중 점 (P10n 나누기)
// 그리기는 trade-cards.ts(카드·고르기·제안·완료)와 trade.ts(모달 틀·링크·참가·로그인 안내)
import { api } from "./api.js";
import { refreshView } from "./live.js";
import type { ManageReply } from "../../shared/ipc/manage.js";
import type { TradeScreen } from "../../shared/model/trade.js";
import type { TradeCloseReason } from "../../shared/names/online-codes.js";
import type { Reason } from "../../shared/names/reasons.js";
import { bodyEl, redrawBody } from "./shell.js";
import { drawDialog } from "./dialog.js";
import { ui } from "./state.js";

// 교환 모달의 상태 — 카드 그리기·모달 틀이 같이 읽고 쓴다. 다른 파일의 let 은 고칠 수 없어(ESM) 객체 하나로 둔다 (box-state.ts 와 같은 방식)
export interface TradeUi {
  screen: TradeScreen | null; // 메인이 보낸 교환 보기 (src/view/trade-screen.ts)
  loading: boolean; // trade.status 를 읽는 중
  input: string; // 링크로 참가 칸에 붙여 넣은 글자
  copied: boolean; // 링크 복사 직후 — 단추 글자를 바꾼다
  page: number; // 보낼 포켓몬 넘김 — 0 은 파티, 1 부터 박스 1, 박스 2 …
}
export const tradeUi: TradeUi = { screen: null, loading: false, input: "", copied: false, page: 0 };

// 닫힌 이유 — 친구가 나갔거나 링크가 만료됐다. 열쇠는 서버의 닫힘 이유 한 벌(shared/names/online-codes.ts)이다
const TRADE_CLOSED: Record<TradeCloseReason, [string, string]> = {
  guest_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  host_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  expired: ["링크가 만료됐어요", "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요"],
};
// 서버가 모르는 글자를 보낼 수 있다 — 표에 있는 이유만 글을 돌려준다
export const tradeClosedText = (reason: string | null): [string, string] | null =>
  reason !== null && Object.hasOwn(TRADE_CLOSED, reason) ? TRADE_CLOSED[reason as TradeCloseReason] : null;
export const TRADE_LOCAL: Record<string, string> = {
  single: "단일 포켓몬은 교환할 수 없어요",
  locked: "확정한 포켓몬은 바꿀 수 없어요",
  "no-pet": "그 포켓몬을 찾을 수 없어요",
} satisfies Partial<Record<Reason, string>>;

export async function loadTrade(): Promise<void> {
  if (tradeUi.loading) return;
  tradeUi.loading = true;
  try {
    const reply = await api.command({ cmd: "trade.status" });
    tradeUi.screen = tradeOf(reply);
  } finally {
    tradeUi.loading = false;
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
export const tradeInProgress = (): boolean => tradeActive(tradeUi.screen);
const tradeActive = (t: TradeScreen | null): boolean => !!t?.available && (t.phase === "hosting" || t.phase === "trading" || t.phase === "done");

// 박스 머리 햄버거 단추의 교환 진행 중 점 — 본문을 다시 그리지 않고 점만 켜고 끈다. 교환은 그 메뉴의 `교환` 이 연다 (box-order.ts boxMenuEl)
function syncTradeDot(): void {
  const dot = bodyEl.querySelector<HTMLElement>(".box-menu-toggle .dot");
  if (dot) dot.hidden = !tradeActive(tradeUi.screen);
}

// 결과의 screen 을 꺼낸다. 교환 세션이 없을 때(trade-off·sandbox)만 쓸 수 없다고 보인다.
// 그 밖의 실패(시간 초과·준비 전)는 지금 화면에 오류 배너만 더한다
const TRADE_UNAVAILABLE = new Set(["trade-off", "sandbox"]);
function tradeOf(reply: ManageReply): TradeScreen {
  const screen = reply.screen;
  if (screen && typeof screen === "object" && typeof screen.phase === "string") return screen;
  if (TRADE_UNAVAILABLE.has(reply.reason)) return { ...(tradeUi.screen ?? TRADE_OFF), available: false };
  return { ...(tradeUi.screen ?? { ...TRADE_OFF, available: true }), busy: false, error: { code: reply.reason } };
}

const TRADE_OFF: TradeScreen = {
  available: false, phase: "idle", link: null, expiresAt: null, busy: false, error: null, closedReason: null,
  friendJoined: false, friendName: null, mine: null, myPetId: null, myReady: false, friend: null, friendReady: false,
  friendBlocked: null, singles: [], received: null,
};

export async function tradeSend(cmd: string, target?: string, args?: Record<string, unknown>): Promise<ManageReply> {
  const before = tradeUi.screen?.received?.petId ?? null;
  if (tradeUi.screen) {
    tradeUi.screen = { ...tradeUi.screen, busy: true };
    redrawTrade();
  }
  let reply: ManageReply;
  try {
    reply = await api.command({ cmd, ...(target ? { target } : {}), ...(args ? { args } : {}) });
  } catch (e) {
    console.error("교환 명령을 보내지 못했다", e);
    reply = { ok: false, reason: "error" };
  }
  tradeUi.screen = tradeOf(reply);
  // 거절(진행 중인 교환 등)은 보기에 남지 않는다 — 배너로 보인다
  if (!reply.ok && !tradeUi.screen.error && tradeUi.screen.available) tradeUi.screen = { ...tradeUi.screen, error: { code: reply.reason, ...(typeof reply.detail === "string" ? { detail: reply.detail } : {}) } };
  if (tradeUi.screen.received && tradeUi.screen.received.petId !== before) {
    ui.view = await api.snapshot(); // 교환이 끝났다 — 바뀐 개체를 다시 받는다
    redrawBody();
  }
  syncTradeDot();
  redrawTrade();
  return reply;
}

api.onTrade((screen) => {
  const got = screen.received?.petId !== tradeUi.screen?.received?.petId && screen.received != null;
  tradeUi.screen = screen;
  syncTradeDot();
  // 교환이 끝나 개체가 바뀌었다 — 스냅샷도 다시 받는다. 받지 않으면 보낸 개체가 파티·박스에 남아 보인다(2026-09-27 화면 E2E 에서 발견)
  if (got) void refreshView().then(redrawTrade);
  else redrawTrade();
});
