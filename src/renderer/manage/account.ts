// 설정창의 계정과 클라우드 저장 — 사용자 모달의 계정 탭(로그인·가입·로그인 뒤·확인 창)과 헤더 저장 표시 (P10m)
// Figma 05 Screens `633:19206`(로그인)·`633:19302`(가입)·`633:19425`(로그인 뒤)·`633:19631`(삭제 확인)·`633:19744`(막힘). 헤더 저장 표시는 C-27.
// 값은 메인이 준다(src/main/services/online.ts). 입력한 글자는 여기 들고 있다 — 1초 시계로 다시 그려도 사라지지 않게
// 두 PC 규칙(P1): 저장은 자동으로만 올린다. 저장 단추·로그인 때 고르기·밀려남 배너는 없다.
//   다른 PC 확인(confirm)·넘겨받기 막힘(blocked)·다른 PC 에서 시작(superseded)은 앱이 네이티브 창으로 묻는다 — 여기서는 상태 글자만
import type { AccountAction, AccountReply, AccountScreen, CloudStatusView, UsernameCheck } from "../../shared/model/account.js";
import { api } from "./api.js";
import { liveInputEl } from "./search.js";
import { alertEl, dialogCloseEl } from "./widgets.js";
import { buttonEl, el, needEl } from "../ui/dom.js";
import { redrawBody } from "./shell.js";
import { actionButtonEl, actionsRowEl, drawDialog, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";
import { failTextOf } from "../../shared/fail-text.js";
import { ACCOUNT_RULES, USERNAME_PATTERN } from "../../shared/account-rules.js";

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

let acct: AccountScreen | null = null;
// 지금 계정 화면 값 — 교환 모달의 로그인 안내가 읽는다(manage.ts 의 setTradeHooks)
export function currentAccount(): AccountScreen | null {
  return acct;
}
let acctLoading = false;
let acctBusy = false;
let acctGithub = false; // 브라우저에서 GitHub 로그인을 기다리는 중
const acctForm = { mode: "sign-in" as "sign-in" | "sign-up", username: "", password: "", password2: "", displayName: "", error: "", check: "" as "" | UsernameCheck };
let acctRename: string | null = null; // 이름 바꾸는 중이면 입력한 이름
let acctConfirm: "delete" | "sign-out" | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;

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
function saveLine(c: AccountScreen["cloud"]): string {
  const text = cloudText(c)?.text ?? "";
  const err = c.error && c.status !== "online" && CLOUD_SAID[c.status] !== c.error ? acctErrorText(c.error, c.errorDetail) : "";
  return err ? (text ? `${text} · ${err}` : err) : text;
}

// 헤더 저장 표시 — 로그인·익명 계정이면 보인다. 저장 계정을 잃었으면(D29) 저장 꺼짐. 누르면 사용자 모달의 계정 탭을 연다
function drawSaveIndicator(): void {
  if (acct?.lost) {
    saveIndicatorEl.hidden = false;
    saveIndicatorEl.dataset.state = "warn";
    saveIndicatorEl.replaceChildren(el("i"), document.createTextNode("저장 꺼짐"));
    return;
  }
  const c = acct?.signedIn || acct?.anonymous ? acct.cloud : null;
  const shown = c ? cloudText(c) : null;
  saveIndicatorEl.hidden = !shown;
  if (!shown) return;
  saveIndicatorEl.dataset.state = shown.dot;
  saveIndicatorEl.replaceChildren(el("i"), document.createTextNode(shown.text));
}
saveIndicatorEl.addEventListener("click", () => openAnyDialog({ kind: "user", tab: "account" }));

export async function loadAccount(): Promise<void> {
  if (acctLoading) return;
  acctLoading = true;
  try {
    const reply = await api.account({ action: "status" });
    acct = reply?.screen ?? { ...ACCOUNT_OFF };
  } catch (e) {
    console.error("계정 상태를 읽지 못했다", e);
    acct = { ...ACCOUNT_OFF };
  } finally {
    acctLoading = false;
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
function redrawAccount(): void {
  if (ui.dialog?.kind === "user" && ui.dialog.tab === "account") drawDialog();
}

async function acctSend(req: AccountAction): Promise<AccountReply | null> {
  acctBusy = true;
  redrawAccount();
  let reply: AccountReply | null = null;
  try {
    reply = await api.account(req);
  } catch (e) {
    console.error("계정 요청을 보내지 못했다", e);
  } finally {
    acctBusy = false;
  }
  if (reply) acct = reply.screen;
  acctForm.error = reply ? acctErrorText(reply.code) : acctErrorText("NETWORK");
  drawSaveIndicator();
  redrawAccount();
  redrawBody();
  return reply;
}

// 입력칸 — liveInput 의 포커스 복원을 쓴다. 다시 그려도 커서가 그대로다
function acctInput(key: string, value: string, placeholder: string, type: "text" | "password", onChange: (v: string) => void): HTMLInputElement {
  const input = liveInputEl(key, value, placeholder, onChange);
  input.type = type;
  input.classList.add("acct-input");
  input.autocomplete = "off";
  input.disabled = acctBusy || !!acct?.blocked;
  return input;
}

function acctField(label: string, input: HTMLElement, note?: { text: string; tone: "ok" | "bad" | "idle" | "warn" }): HTMLElement {
  const box = el("label", "acct-field");
  box.append(el("span", "acct-label", label), input);
  if (note?.text) {
    const line = el("span", `acct-note ${note.tone}`);
    line.append(el("i"), document.createTextNode(note.text));
    box.appendChild(line);
  }
  return box;
}

function acctNotice(title: string, desc: string, tone: "warn" | "bad"): HTMLElement {
  const box = alertEl(tone, title, desc);
  box.classList.add("acct-notice");
  return box;
}

function usernameNote(): { text: string; tone: "ok" | "bad" | "idle" } | undefined {
  if (acctForm.check === "available") return { text: "사용할 수 있는 아이디", tone: "ok" };
  if (acctForm.check === "taken") return { text: "이미 쓰는 아이디", tone: "bad" };
  if (acctForm.check === "invalid") return { text: `영문 소문자로 시작, 소문자·숫자·_ ${ACCOUNT_RULES.usernameMin}~${ACCOUNT_RULES.usernameMax}자`, tone: "bad" };
  return undefined;
}

// 아이디 입력을 멈추고 0.5초 뒤 중복을 묻는다. 규칙 밖이면 묻지 않는다
function scheduleUsernameCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  const name = acctForm.username.trim().toLowerCase();
  if (!name) {
    acctForm.check = "";
    return;
  }
  if (!USERNAME_PATTERN.test(name)) {
    acctForm.check = "invalid";
    return;
  }
  checkTimer = setTimeout(() => {
    checkTimer = null;
    void api.account({ action: "check-username", username: name }).then((r) => {
      if (acctForm.username.trim().toLowerCase() !== name) return; // 그사이 바뀌었다
      acctForm.check = r?.check ?? "NETWORK";
      redrawAccount();
    });
  }, 500);
}

// 로그인 전 — 익명 저장 줄(또는 분실 안내), 로그인 권유 한 줄, GitHub·로그인 폼 (design-p2.md 5절)
function drawSignIn(scroll: HTMLElement): void {
  const a = acct;
  const blocked = !!a?.blocked;
  if (blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 분실(D29) — 창은 메인이 띄운다. 여기서는 짧은 상태만
  if (a?.lost) scroll.appendChild(acctNotice("저장 정보를 찾지 못했어요", a.lost === "member" ? "다시 로그인하면 계정 저장으로 이어서 해요" : "로그인하면 다시 계정에 저장해요", "warn"));
  else if (a) {
    const line = saveLine(a.cloud);
    if (a.anonymous || line) scroll.appendChild(acctRow(a.anonymous ? "익명으로 저장 중" : "저장", line));
  }
  if (!blocked && !a?.lost) scroll.appendChild(el("div", "acct-lead", "로그인하면 다른 PC 에서도 이어서 하고 교환할 수 있어요"));
  if (acctGithub) {
    // 기다리는 동안 다른 단추는 막히고 취소만 된다(R3-08)
    const wait = el("div", "acct-inline acct-github-wait");
    wait.append(el("span", "acct-lead", "브라우저에서 GitHub 로그인을 마쳐 주세요"), actionButtonEl("취소", false, false, () => void api.account({ action: "github-cancel" })));
    scroll.appendChild(wait);
  } else {
    const gh = buttonEl("act acct-github", "GitHub로 계속");
    gh.disabled = blocked || acctBusy;
    gh.addEventListener("click", () => {
      acctGithub = true;
      void acctSend({ action: "github" }).finally(() => { acctGithub = false; redrawAccount(); });
    });
    scroll.appendChild(gh);
  }
  const or = el("div", "acct-or");
  or.append(el("span"), document.createTextNode("또는"), el("span"));
  scroll.appendChild(or);
  scroll.appendChild(acctField("아이디", acctInput("acct-user", acctForm.username, "아이디", "text", (v) => { acctForm.username = v; })));
  const pass = acctInput("acct-pass", acctForm.password, "비밀번호", "password", (v) => { acctForm.password = v; });
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void signIn();
  });
  scroll.appendChild(acctField("비밀번호", pass, acctForm.error ? { text: acctForm.error, tone: "bad" } : undefined));
}

function drawSignUp(scroll: HTMLElement): void {
  const back = el("div", "acct-lead");
  const link = buttonEl("acct-back", "‹ 로그인");
  link.addEventListener("click", () => {
    acctForm.mode = "sign-in";
    acctForm.error = "";
    redrawAccount();
  });
  back.appendChild(link);
  scroll.appendChild(back);
  const grid = el("div", "acct-grid");
  const user = acctInput("acct-new-user", acctForm.username, "아이디", "text", (v) => {
    acctForm.username = v;
    const before = acctForm.check;
    scheduleUsernameCheck();
    if (acctForm.check !== before) redrawAccount();
  });
  grid.append(
    acctField("아이디", user, usernameNote()),
    acctField("이름", acctInput("acct-new-name", acctForm.displayName, "이름", "text", (v) => { acctForm.displayName = v; }), { text: `화면에 보이는 이름 · 1~${ACCOUNT_RULES.nameMax}자`, tone: "idle" }),
    acctField("비밀번호", acctInput("acct-new-pass", acctForm.password, "비밀번호", "password", (v) => { acctForm.password = v; }), { text: `${ACCOUNT_RULES.passwordMin}자 이상`, tone: "idle" }),
    acctField("비밀번호 확인", acctInput("acct-new-pass2", acctForm.password2, "비밀번호 확인", "password", (v) => { acctForm.password2 = v; })),
  );
  scroll.appendChild(grid);
  const warn = el("div", "acct-note warn");
  warn.append(el("i"), document.createTextNode("비밀번호를 잊으면 찾을 수 없어요"));
  scroll.appendChild(warn);
  if (acctForm.error) {
    const err = el("div", "acct-note bad");
    err.append(el("i"), document.createTextNode(acctForm.error));
    scroll.appendChild(err);
  }
}

// 계정 탭 한 줄 — 단추가 없으면 글자만 둔다(저장 줄)
function acctRow(title: string, hint: string, control?: HTMLElement): HTMLElement {
  const row = el("div", "setting acct-row");
  const body = el("div", "body");
  body.append(el("div", "label", title), el("div", "hint", hint));
  row.appendChild(body);
  if (control) row.appendChild(control);
  return row;
}

function drawSignedIn(scroll: HTMLElement): void {
  const a = acct!;
  if (acct?.blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 이름
  const who = a.method === "github" ? `GitHub · ${a.displayName ?? ""}` : `아이디 ${a.username ?? ""}`;
  if (acctRename != null) {
    const input = acctInput("acct-rename", acctRename, "이름", "text", (v) => { acctRename = v; });
    input.disabled = acctBusy;
    const ctl = el("div", "acct-inline");
    ctl.append(
      input,
      actionButtonEl("취소", false, acctBusy, () => { acctRename = null; redrawAccount(); }),
      actionButtonEl("저장", true, acctBusy, () => {
        void acctSend({ action: "rename", displayName: acctRename ?? "" }).then((r) => {
          if (r?.ok) {
            acctRename = null;
            redrawAccount();
          }
        });
      }),
    );
    scroll.appendChild(acctRow(a.displayName ?? "", acctForm.error || who, ctl));
  } else {
    scroll.appendChild(acctRow(a.displayName ?? "", who, actionButtonEl("이름 바꾸기", false, acctBusy, () => { acctRename = a.displayName ?? ""; acctForm.error = ""; redrawAccount(); })));
  }
  // 저장 — 자동으로만 올린다. 상태 글자와, 상태가 말하지 않는 오류만
  scroll.appendChild(acctRow("저장", saveLine(a.cloud)));
  // 로그아웃·삭제 — 둘 다 확인 창을 거친다. 이 PC 는 처음부터 새로 시작한다(D12)
  scroll.appendChild(acctRow("로그아웃", "이 PC 는 처음부터 새로 시작해요", actionButtonEl("로그아웃", false, acctBusy || a.blocked, () => { acctConfirm = "sign-out"; acctForm.error = ""; redrawAccount(); })));
  scroll.appendChild(acctRow("계정 삭제", "되돌릴 수 없어요", actionButtonEl("계정 삭제", false, acctBusy || a.blocked, () => { acctConfirm = "delete"; acctForm.error = ""; redrawAccount(); })));
}

// 사용자 모달 위의 작은 확인 창 — 로그아웃·계정 삭제
export function accountOverlayEl(): HTMLElement | null {
  const a = acct;
  if (!a) return null;
  const box = el("div", "acct-overlay");
  const card = el("div", "acct-confirm");
  const head = el("div", "acct-confirm-head");
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  const shut = (): void => { acctConfirm = null; redrawAccount(); };
  x.addEventListener("click", shut);
  // 성공하면 앱이 다시 켜진다. 실패하면 창을 두고 이유를 보인다
  const run = (action: "delete" | "sign-out"): void => {
    void acctSend({ action }).then((r) => {
      if (r?.ok) acctConfirm = null;
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
  if (acctConfirm === "delete") {
    head.append(el("h3", undefined, "계정을 삭제할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "계정과 저장을 지우고 이 PC 는 처음부터 새로 시작해요. 되돌릴 수 없어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, acctBusy, shut), actionButtonEl("삭제", true, acctBusy, () => run("delete"))));
  } else if (acctConfirm === "sign-out") {
    head.append(el("h3", undefined, "로그아웃할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "로그아웃하면 이 PC 는 처음부터 새로 시작해요. 계정 저장은 그대로라 다시 로그인하면 이어서 할 수 있어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, acctBusy, shut), actionButtonEl("로그아웃하고 새로 시작", true, acctBusy, () => run("sign-out"))));
  } else return null;
  box.appendChild(card);
  return box;
}

async function signIn(): Promise<void> {
  if (!acctForm.username.trim() || !acctForm.password) {
    acctForm.error = failTextOf("AUTH_INVALID_LOGIN", "account").text;
    redrawAccount();
    return;
  }
  const r = await acctSend({ action: "sign-in", username: acctForm.username, password: acctForm.password });
  if (r?.ok) Object.assign(acctForm, { password: "", password2: "", error: "" });
}

async function signUp(): Promise<void> {
  if (acctForm.password !== acctForm.password2) {
    acctForm.error = "비밀번호가 서로 달라요";
    redrawAccount();
    return;
  }
  const r = await acctSend({ action: "sign-up", username: acctForm.username, displayName: acctForm.displayName, password: acctForm.password });
  if (r?.ok) Object.assign(acctForm, { mode: "sign-in", password: "", password2: "", displayName: "", error: "", check: "" });
}

export function drawAccount(scroll: HTMLElement): void {
  if (!acct) {
    scroll.appendChild(el("div", "empty-note", "계정 상태를 읽는 중이에요."));
    void loadAccount();
    return;
  }
  if (!acct.available) {
    scroll.appendChild(el("div", "empty-note", "계정을 쓸 수 없어요."));
    return;
  }
  if (acct.signedIn) drawSignedIn(scroll);
  else if (acctForm.mode === "sign-up") drawSignUp(scroll);
  else drawSignIn(scroll);
}

// 계정 탭 바닥 단추 — 로그인 화면은 가입·로그인, 가입 화면은 가입, 로그인 뒤는 없음. 닫기 단추는 없다(✕·바깥 클릭·Esc).
// 버전·업데이트는 설정 모달 바닥에만 둔다 — 왼쪽 빈 자리(spacer)로 단추를 오른쪽에 붙인다
export function accountActionsEl(): HTMLElement | null {
  const a = acct;
  if (!a?.available || a.signedIn) return null;
  const off = acctBusy || a.blocked;
  const left = el("span", "spacer");
  if (acctForm.mode === "sign-up") return actionsRowEl(left, actionButtonEl("가입", true, off, () => void signUp()));
  return actionsRowEl(left, actionButtonEl("가입", false, off, () => { acctForm.mode = "sign-up"; acctForm.error = ""; redrawAccount(); }), actionButtonEl("로그인", true, off, () => void signIn()));
}

api.onAccount((screen) => {
  acct = screen;
  drawSaveIndicator();
  redrawAccount();
  hooksOf().redrawTrade(); // 익명·로그인이 바뀌면 교환 모달의 로그인 안내도 바뀐다
});
void loadAccount();
setInterval(drawSaveIndicator, 30_000); // "3분 전" 글자만 바꾼다
