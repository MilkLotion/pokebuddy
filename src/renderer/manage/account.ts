// 설정창의 계정과 클라우드 저장 — 계정 요청 보내기·저장 줄·확인 창과 헤더 저장 표시 (P10m). 계정 탭의 폼(로그인·가입·로그인 뒤)은 account-forms.ts
// Figma 05 Screens `633:19206`(로그인)·`633:19302`(가입)·`633:19425`(로그인 뒤)·`633:19631`(삭제 확인)·`633:19744`(막힘). 헤더 저장 표시는 C-27.
// 값은 메인이 준다(src/main/services/online.ts). 입력한 글자는 account-state.ts 가 들고 있다 — 1초 시계로 다시 그려도 사라지지 않게
// 두 PC 규칙(P1): 저장은 자동으로만 올린다. 저장 단추·로그인 때 고르기·밀려남 배너는 없다.
//   다른 PC 확인(confirm)·넘겨받기 막힘(blocked)·다른 PC 에서 시작(superseded)은 앱이 네이티브 창으로 묻는다 — 여기서는 상태 글자만
import type { AccountAction, AccountReply, AccountScreen, CloudStatusView } from "../../shared/model/account.js";
import { api } from "./api.js";
import { dialogCloseEl } from "./widgets.js";
import { el, needEl } from "../ui/dom.js";
import { redrawBody } from "./shell.js";
import { actionButtonEl, actionsRowEl, drawDialog, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";
import { failTextOf } from "../../shared/fail-text.js";
import { accountUi, acctForm } from "./account-state.js";

// manage.ts 에서 받는 것 — 교환 모달은 다른 2단 파일(trade.ts)이라 바로 가져오지 않는다 (P10 안내 4절)
export interface AccountHooks {
  redrawTrade(): void; // 익명·로그인이 바뀌면 교환 모달의 로그인 안내도 다시 그린다
}
let hooks: AccountHooks | null = null;
export function setAccountHooks(next: AccountHooks): void {
  hooks = next;
}
function hooksOf(): AccountHooks {
  if (!hooks) throw new Error("account.ts 의 고리가 걸리지 않았다 — setAccountHooks 를 먼저 부른다");
  return hooks;
}

// 지금 계정 화면 값 — 교환 모달의 로그인 안내가 읽는다(manage.ts 의 setTradeHooks)
export function currentAccount(): AccountScreen | null {
  return accountUi.screen;
}

const saveIndicatorEl = needEl("save-indicator", HTMLElement, "manage");

const acctErrorText = (code: string | null, detail?: string | null): string => (!code || code === "AUTH_CANCELLED" ? "" : failTextOf(code, "account", "ko", detail ?? undefined).text);

// 마지막 저장 시각 — "3분 전"처럼 짧게
export function shortAgoText(at: number | null): string {
  if (!at) return "";
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  return hour < 24 ? `${hour}시간 전` : `${Math.floor(hour / 24)}일 전`;
}

// 저장 상태 글자 — 헤더 저장 표시와 계정 탭 저장 줄이 같이 쓴다. online 은 마지막 저장 시각을 붙인다
//   dot: ok 초록 · idle 회색 · warn 강조(사용자 손이 필요하거나 게임이 멈춘 상태)
const CLOUD_TEXT: Record<Exclude<CloudStatusView, "off" | "online">, { text: string; dot: "idle" | "warn" }> = {
  connecting: { text: "연결 중", dot: "idle" },
  offline: { text: "오프라인", dot: "idle" },
  "update-required": { text: "업데이트 필요", dot: "warn" },
  confirm: { text: "확인 대기", dot: "warn" },
  blocked: { text: "넘겨받지 못함", dot: "warn" },
  superseded: { text: "다른 PC 에서 시작", dot: "warn" },
  held: { text: "이용 정지", dot: "warn" }, // 이용 정지(P4c) — 앱은 정지 창을 띄우고 끝난다
};
// 상태 글자가 이미 말하는 오류 — 계정 탭에서 오류 글자를 겹쳐 붙이지 않는다
const CLOUD_SAID: Partial<Record<CloudStatusView, string>> = { "update-required": "CLOUD_UPDATE_REQUIRED", held: "CLOUD_ACCOUNT_HELD" };

function cloudText(c: AccountScreen["cloud"]): { text: string; dot: "ok" | "idle" | "warn" } | null {
  if (c.status === "off") return null;
  if (c.status === "online") return { text: c.lastSavedAt ? `저장됨 · ${shortAgoText(c.lastSavedAt)}` : "저장됨", dot: "ok" };
  return CLOUD_TEXT[c.status];
}

// 저장 줄 글자 — 상태 글자와, 상태가 말하지 않는 오류. 로그인 뒤·익명 계정 탭이 같이 쓴다
export function saveLine(c: AccountScreen["cloud"]): string {
  const text = cloudText(c)?.text ?? "";
  const err = c.error && c.status !== "online" && CLOUD_SAID[c.status] !== c.error ? acctErrorText(c.error, c.errorDetail) : "";
  return err ? (text ? `${text} · ${err}` : err) : text;
}

// 헤더 저장 표시 — 로그인·익명 계정이면 보인다. 저장 계정을 잃었으면(D29) 저장 꺼짐. 누르면 사용자 모달의 계정 탭을 연다
//   업데이트 필요면 설정 모달을 연다 — 버전·업데이트는 설정 모달 바닥에 있다 (2026-10-07 사용자 결정)
function drawSaveIndicator(): void {
  if (accountUi.screen?.lost) {
    saveIndicatorEl.hidden = false;
    saveIndicatorEl.dataset.state = "warn";
    saveIndicatorEl.replaceChildren(el("i"), document.createTextNode("저장 꺼짐"));
    return;
  }
  const c = accountUi.screen?.signedIn || accountUi.screen?.anonymous ? accountUi.screen.cloud : null;
  const shown = c ? cloudText(c) : null;
  saveIndicatorEl.hidden = !shown;
  if (!shown) return;
  saveIndicatorEl.dataset.state = shown.dot;
  saveIndicatorEl.replaceChildren(el("i"), document.createTextNode(shown.text));
}
saveIndicatorEl.addEventListener("click", () => {
  const updateRequired = !accountUi.screen?.lost && accountUi.screen?.cloud.status === "update-required";
  openAnyDialog(updateRequired ? { kind: "settings", tab: "general" } : { kind: "user", tab: "account" });
});

export async function loadAccount(): Promise<void> {
  if (accountUi.loading) return;
  accountUi.loading = true;
  try {
    const reply = await api.account({ action: "status" });
    accountUi.screen = reply?.screen ?? { ...ACCOUNT_OFF };
  } catch (e) {
    console.error("계정 상태를 읽지 못했다", e);
    accountUi.screen = { ...ACCOUNT_OFF };
  } finally {
    accountUi.loading = false;
  }
  drawSaveIndicator();
  redrawAccount();
  hooksOf().redrawTrade();
}

const ACCOUNT_OFF: AccountScreen = {
  available: false, signedIn: false, method: null, username: null, displayName: null, blocked: false,
  cloud: { status: "off", lastSavedAt: null, busy: false, error: null, other: null },
};

// 계정 탭이 열려 있으면 다시 그린다
export function redrawAccount(): void {
  if (ui.dialog?.kind === "user" && ui.dialog.tab === "account") drawDialog();
}

export async function acctSend(req: AccountAction): Promise<AccountReply | null> {
  accountUi.busy = true;
  redrawAccount();
  let reply: AccountReply | null = null;
  try {
    reply = await api.account(req);
  } catch (e) {
    console.error("계정 요청을 보내지 못했다", e);
  } finally {
    accountUi.busy = false;
  }
  if (reply) accountUi.screen = reply.screen;
  acctForm.error = reply ? acctErrorText(reply.code) : acctErrorText("NETWORK");
  drawSaveIndicator();
  redrawAccount();
  redrawBody();
  return reply;
}

// 사용자 모달 위의 작은 확인 창 — 로그아웃·계정 삭제
export function accountOverlayEl(): HTMLElement | null {
  const a = accountUi.screen;
  if (!a) return null;
  const box = el("div", "acct-overlay");
  const card = el("div", "acct-confirm");
  const head = el("div", "acct-confirm-head");
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  const shut = (): void => { accountUi.confirm = null; redrawAccount(); };
  x.addEventListener("click", shut);
  // 성공하면 앱이 다시 켜진다. 실패하면 창을 두고 이유를 보인다
  const run = (action: "delete" | "sign-out"): void => {
    void acctSend({ action }).then((r) => {
      if (r?.ok) accountUi.confirm = null;
      redrawAccount();
    });
  };
  // 서버에 올리지 못한 진행이 있을 수 있다 — 막지는 않고 알린다(검수 M3)
  const unsyncedNote = (): HTMLElement | null => {
    if (!a.unsynced) return null;
    const line = el("div", "acct-note warn");
    line.append(el("i"), document.createTextNode("올리지 못한 진행은 이 PC 백업에만 남아요"));
    return line;
  };
  const failed = (): HTMLElement | null => {
    if (!acctForm.error) return null;
    const line = el("div", "acct-note bad");
    line.append(el("i"), document.createTextNode(acctForm.error));
    return line;
  };
  if (accountUi.confirm === "delete") {
    head.append(el("h3", undefined, "계정을 삭제할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "계정과 저장을 지우고 이 PC 는 처음부터 새로 시작해요. 되돌릴 수 없어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, accountUi.busy, shut), actionButtonEl("삭제", true, accountUi.busy, () => run("delete"))));
  } else if (accountUi.confirm === "sign-out") {
    head.append(el("h3", undefined, "로그아웃할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "로그아웃하면 이 PC 는 처음부터 새로 시작해요. 계정 저장은 그대로라 다시 로그인하면 이어서 할 수 있어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, accountUi.busy, shut), actionButtonEl("로그아웃하고 새로 시작", true, accountUi.busy, () => run("sign-out"))));
  } else return null;
  box.appendChild(card);
  return box;
}

api.onAccount((screen) => {
  accountUi.screen = screen;
  drawSaveIndicator();
  redrawAccount();
  hooksOf().redrawTrade(); // 익명·로그인이 바뀌면 교환 모달의 로그인 안내도 바뀐다
});
void loadAccount();
setInterval(drawSaveIndicator, 30_000); // "3분 전" 글자만 바꾼다
