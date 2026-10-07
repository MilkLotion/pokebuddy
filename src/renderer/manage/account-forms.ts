// 설정창의 계정 탭 폼 — 로그인 전·가입·로그인 뒤 화면과 계정 탭 바닥 단추 (P10m 나눔)
// 상태는 account-state.ts, 요청 보내기·저장 줄·헤더 저장 표시·확인 창은 account.ts 에 있다
import { api } from "./api.js";
import { liveInputEl } from "./search.js";
import { alertEl } from "./widgets.js";
import { buttonEl, el } from "../ui/dom.js";
import { actionButtonEl, actionsRowEl } from "./dialog.js";
import { setBusy, whenSlow } from "./command.js";
import { failTextOf } from "../../shared/fail-text.js";
import { ACCOUNT_RULES, USERNAME_PATTERN } from "../../shared/account-rules.js";
import { accountUi, acctForm } from "./account-state.js";
import { acctSend, loadAccount, redrawAccount, saveLine } from "./account.js";

let checkTimer: ReturnType<typeof setTimeout> | null = null;

// 입력칸 — liveInput 의 포커스 복원을 쓴다. 다시 그려도 커서가 그대로다
function acctInput(key: string, value: string, placeholder: string, type: "text" | "password", onChange: (v: string) => void): HTMLInputElement {
  const input = liveInputEl(key, value, placeholder, onChange);
  input.type = type;
  input.classList.add("acct-input");
  input.autocomplete = "off";
  input.disabled = accountUi.busy || !!accountUi.screen?.blocked;
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
  const a = accountUi.screen;
  const blocked = !!a?.blocked;
  if (blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 분실(D29) — 창은 메인이 띄운다. 여기서는 짧은 상태만
  if (a?.lost) scroll.appendChild(acctNotice("저장 정보를 찾지 못했어요", a.lost === "member" ? "다시 로그인하면 계정 저장으로 이어서 해요" : "로그인하면 다시 계정에 저장해요", "warn"));
  else if (a) {
    const line = saveLine(a.cloud);
    if (a.anonymous || line) scroll.appendChild(acctRow(a.anonymous ? "익명으로 저장 중" : "저장", line));
  }
  if (!blocked && !a?.lost) scroll.appendChild(el("div", "acct-lead", "로그인하면 다른 PC 에서도 이어서 하고 교환할 수 있어요"));
  if (accountUi.github) {
    // 기다리는 동안 다른 단추는 막히고 취소만 된다(R3-08)
    const wait = el("div", "acct-inline acct-github-wait");
    wait.append(el("span", "acct-lead", "브라우저에서 GitHub 로그인을 마쳐 주세요"), actionButtonEl("취소", false, false, () => void api.account({ action: "github-cancel" })));
    scroll.appendChild(wait);
  } else {
    const gh = buttonEl("act acct-github", "GitHub로 계속");
    gh.disabled = blocked || accountUi.busy;
    gh.addEventListener("click", () => {
      accountUi.github = true;
      void acctSend({ action: "github" }).finally(() => { accountUi.github = false; redrawAccount(); });
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

// [저장하기] — 온라인일 때만 누른다. 답이 늦으면 공통 처리 중(점 셋, 폭 그대로). 처리 중엔 흐리지 않게 잠그지 않는다(is-busy 가 입력을 막는다)
function saveNowButton(online: boolean): HTMLButtonElement {
  const b = actionButtonEl("저장하기", false, !online || (accountUi.busy && accountUi.saving !== "slow"), () => void saveNow());
  if (accountUi.saving === "slow") setBusy(b, true);
  return b;
}

async function saveNow(): Promise<void> {
  if (accountUi.busy) return;
  accountUi.saving = "wait";
  const settle = whenSlow(() => {
    accountUi.saving = "slow";
    redrawAccount();
  });
  await acctSend({ action: "save-now" });
  settle();
  accountUi.saving = "no";
  redrawAccount();
}

function drawSignedIn(scroll: HTMLElement): void {
  const a = accountUi.screen!;
  if (accountUi.screen?.blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 이름
  const who = a.method === "github" ? `GitHub · ${a.displayName ?? ""}` : `아이디 ${a.username ?? ""}`;
  if (accountUi.rename != null) {
    const input = acctInput("acct-rename", accountUi.rename, "이름", "text", (v) => { accountUi.rename = v; });
    input.disabled = accountUi.busy;
    const ctl = el("div", "acct-inline");
    ctl.append(
      input,
      actionButtonEl("취소", false, accountUi.busy, () => { accountUi.rename = null; redrawAccount(); }),
      actionButtonEl("저장", true, accountUi.busy, () => {
        void acctSend({ action: "rename", displayName: accountUi.rename ?? "" }).then((r) => {
          if (r?.ok) {
            accountUi.rename = null;
            redrawAccount();
          }
        });
      }),
    );
    scroll.appendChild(acctRow(a.displayName ?? "", acctForm.error || who, ctl));
  } else {
    scroll.appendChild(acctRow(a.displayName ?? "", who, actionButtonEl("이름 바꾸기", false, accountUi.busy, () => { accountUi.rename = a.displayName ?? ""; acctForm.error = ""; redrawAccount(); })));
  }
  // 저장 — 자동으로 올리고, [저장하기] 로 지금 한 번 올린다. 결과는 같은 줄 글자로만(성공 시각·오류)
  scroll.appendChild(acctRow("저장", saveLine(a.cloud), saveNowButton(a.cloud.status === "online")));
  // 로그아웃·삭제 — 구분선 아래 탭 바닥. 둘 다 확인 창을 거친다. 이 PC 는 처음부터 새로 시작한다(D12)
  scroll.appendChild(el("div", "acct-push"));
  scroll.appendChild(el("hr", "acct-divider"));
  scroll.appendChild(acctRow("로그아웃", "이 PC 는 처음부터 새로 시작해요", actionButtonEl("로그아웃", false, accountUi.busy || a.blocked, () => { accountUi.confirm = "sign-out"; acctForm.error = ""; redrawAccount(); })));
  scroll.appendChild(acctRow("계정 삭제", "되돌릴 수 없어요", actionButtonEl("계정 삭제", false, accountUi.busy || a.blocked, () => { accountUi.confirm = "delete"; acctForm.error = ""; redrawAccount(); })));
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
  if (!accountUi.screen) {
    scroll.appendChild(el("div", "empty-note", "계정 상태를 읽는 중이에요."));
    void loadAccount();
    return;
  }
  if (!accountUi.screen.available) {
    scroll.appendChild(el("div", "empty-note", "계정을 쓸 수 없어요."));
    return;
  }
  if (accountUi.screen.signedIn) drawSignedIn(scroll);
  else if (acctForm.mode === "sign-up") drawSignUp(scroll);
  else drawSignIn(scroll);
}

// 계정 탭 바닥 단추 — 로그인 화면은 가입·로그인, 가입 화면은 가입, 로그인 뒤는 없음. 닫기 단추는 없다(✕·바깥 클릭·Esc).
// 버전·업데이트는 설정 모달 바닥에만 둔다 — 왼쪽 빈 자리(spacer)로 단추를 오른쪽에 붙인다
export function accountActionsEl(): HTMLElement | null {
  const a = accountUi.screen;
  if (!a?.available || a.signedIn) return null;
  const off = accountUi.busy || a.blocked;
  const left = el("span", "spacer");
  if (acctForm.mode === "sign-up") return actionsRowEl(left, actionButtonEl("가입", true, off, () => void signUp()));
  return actionsRowEl(left, actionButtonEl("가입", false, off, () => { acctForm.mode = "sign-up"; acctForm.error = ""; redrawAccount(); }), actionButtonEl("로그인", true, off, () => void signIn()));
}
