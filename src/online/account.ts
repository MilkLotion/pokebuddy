// 계정 — 아이디+비밀번호 가입·로그인, 로그아웃, 이름 바꾸기. 설계는 worklog/records/trade/trade.md "계정과 로그인"
//
// Electron 을 모른다. 공유 클라이언트(src/online/client.ts)를 받는다. GitHub 로그인은 src/online/github.ts 다.
//   아이디는 메일이 갈 수 없는 내부 주소 <아이디>@id.pokebuddy.invalid 로 바꿔 Supabase 비밀번호 로그인을 쓴다
//   익명 계정은 바꾸지 않는다. 로그인하면 정식 계정으로 세션을 바꾼다. 로그아웃하면 다음 교환 때 새 익명 계정을 만든다
//   익명 저장 이관(P2) — switchHooks 를 받으면 세션 교체 직전 before(익명이면 티켓), 직후 after(이관)를 exclusive 안에서 부른다.
//     이관 결과는 AccountResult.handoff 와 onUserChanged 두 번째 인자로 돌려준다 (design-p2.md 2절)
//   걸린 교환이 있으면 세션을 바꾸지 않는다(blocked) — 교환 채널은 사용자 ID 에 묶여 있다
//   익명 세션 확보와 세션 교체는 세션 관문(src/online/session.ts)을 거친다 — 가입·로그인·로그아웃·삭제는 gate.exclusive 안에서
//   이름 규칙과 예약 아이디는 서버 트리거(supabase/migrations/20260927100100_username.sql)도 다시 본다
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SessionGate } from "./session.js";
import { finishSwitch, prepareSwitch, type HandoffReport, type PendingHandoff, type SwitchHooks } from "./handoff.js";
import type { AccountCode } from "../shared/names/online-codes.js";
import { ACCOUNT_RULES, USERNAME_PATTERN } from "../shared/account-rules.js";
import type { UsernameCheck } from "../shared/model/account.js";
import { authCodeOf } from "./codes.js";
import { callRpc, isUnreachable, messageOf, readFunctionError } from "./server-call.js";

const ID_DOMAIN = "id.pokebuddy.invalid";

export type AccountMethod = "password" | "github";

// 화면에 넘기는 계정 보기 — 토큰·내부 주소·사용자 ID 는 넣지 않는다
export interface AccountView {
  signedIn: boolean;
  anonymous: boolean; // 익명 세션이 있다 — signedIn 은 거짓
  method: AccountMethod | null;
  username: string | null; // 아이디 계정만
  displayName: string | null;
}

// 계정 호출의 실패 코드는 AccountCode — 목록은 src/shared/names/online-codes.ts

// handoff — switchHooks 를 받은 가입·로그인에서만. 세션을 바꾼 뒤의 익명 저장 이관 결과
export type AccountResult = { ok: true; view: AccountView; handoff?: HandoffReport } | { ok: false; code: AccountCode; detail?: string };

// 아이디 규칙 — 영문 소문자·숫자·밑줄, 4~16자, 영문으로 시작. 대문자는 소문자로 바꾼다. 맞지 않으면 null
export function normalizeUsername(input: string): string | null {
  const name = input.trim().toLowerCase();
  return USERNAME_PATTERN.test(name) ? name : null;
}

// 이름 규칙 — 앞뒤 공백을 지우고 1~12자, 줄바꿈·제어 문자 없음. 한글 가능. 맞지 않으면 null
export function normalizeDisplayName(input: string): string | null {
  const name = input.trim();
  const length = [...name].length;
  // 제어 문자 범위 — C0·DEL·C1
  return length >= 1 && length <= ACCOUNT_RULES.nameMax && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : null;
}

export const internalEmail = (username: string): string => `${username}@${ID_DOMAIN}`;

// 사용자 → 화면 보기. 익명이면 로그인하지 않은 것으로 본다(anonymous 만 참)
export function viewOf(user: User | null | undefined): AccountView {
  if (!user || user.is_anonymous) return { signedIn: false, anonymous: !!user, method: null, username: null, displayName: null };
  const email = (user.email ?? "").toLowerCase();
  const password = email.endsWith(`@${ID_DOMAIN}`);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    signedIn: true,
    anonymous: false,
    method: password ? "password" : "github",
    username: password ? email.slice(0, -(ID_DOMAIN.length + 1)) : null,
    // GitHub 계정은 가입 때 이름을 받지 않는다 — GitHub 프로필 이름을 처음 값으로 쓴다
    displayName: text(meta.display_name) ?? text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name),
  };
}

// supabase-js 인증 오류 → 코드는 ./codes.ts authCodeOf 다

export interface AccountOptions {
  client: SupabaseClient;
  // 세션 관문 — 교환·클라우드 저장과 같은 것을 쓴다. 익명 세션 확보와 세션 교체를 여기서만 한다
  gate: SessionGate;
  // 세션을 바꿀 수 없는가 — 걸린 교환(열린 채널·반영하지 않은 교환)이 있으면 true
  blocked: () => boolean;
  // 로그인·로그아웃으로 사용자가 바뀌었다 — 앱은 교환 세션을 새로 만들고 클라우드 저장을 시작·멈춘다
  //   handoff — switchHooks 를 받은 가입·로그인에서만. 앱은 cloud.applyHandoff 뒤 cloud.start 를 부른다
  onUserChanged?: (view: AccountView, handoff?: HandoffReport) => void | Promise<void>;
  // 세션 교체 앞뒤 훅 — 익명 저장 이관(handoff.ts handoffHooks). 없으면 이관하지 않는다(P1 동작)
  switchHooks?: SwitchHooks;
}

export interface Account {
  view: () => Promise<AccountView>;
  checkUsername: (input: string) => Promise<UsernameCheck>;
  signUp: (username: string, displayName: string, password: string) => Promise<AccountResult>;
  signIn: (username: string, password: string) => Promise<AccountResult>;
  signOut: () => Promise<AccountResult>;
  rename: (displayName: string) => Promise<AccountResult>;
  deleteAccount: () => Promise<AccountResult>; // 서버 함수 delete-account 가 지운다. 지운 뒤 이 PC 도 로그아웃한다
  userId: () => Promise<string | null>; // 지금 세션의 계정 ID — 익명 포함. 세션이 없으면 null
}

export function createAccount({ client, gate, blocked, onUserChanged, switchHooks }: AccountOptions): Account {
  const user = gate.current;
  // 서버에서 최신 사용자를 읽는다 — 다른 PC 에서 바꾼 이름이 보이게. 닿지 못하면 세션에 든 값을 쓴다
  const view: Account["view"] = async () => {
    const local = await user();
    if (!local || local.is_anonymous) return viewOf(local);
    try {
      const { data, error } = await client.auth.getUser();
      return viewOf(!error && data.user ? data.user : local);
    } catch {
      return viewOf(local);
    }
  };
  const fail = (code: AccountCode, detail?: string): AccountResult => ({ ok: false, code, ...(detail ? { detail } : {}) });
  const catchAll = (e: unknown): AccountResult => ({ ok: false, ...authCodeOf({ message: messageOf(e) }) });
  const changed = async (handoff?: HandoffReport): Promise<AccountResult> => {
    const v = await view();
    await onUserChanged?.(v, handoff);
    return { ok: true, view: v, ...(handoff ? { handoff } : {}) };
  };

  // 세션 교체 앞 — exclusive 안에서. 훅이 없으면 아무것도 하지 않는다. 실패하면 로그인을 멈춘다
  type Prep = { ok: true; handoff: PendingHandoff | null } | { ok: false; result: AccountResult };
  const before = async (): Promise<Prep> => {
    const r = await prepareSwitch(switchHooks, () => gate.current());
    return r.ok ? r : { ok: false, result: fail(r.code, r.detail) };
  };
  // 세션 교체 뒤 — exclusive 안에서. 훅이 없으면 undefined
  const after = (handoff: PendingHandoff | null, next: User | null): Promise<HandoffReport | undefined> => finishSwitch(switchHooks, handoff, next);

  // 중복검사 함수는 로그인한 세션(익명 포함)만 부른다 — 세션이 없으면 관문이 익명 계정을 먼저 만든다
  // ensure — 잠금 밖에서는 gate.ensure, exclusive 안에서는 scope.ensure (교착 방지)
  // 서버 실패는 다른 공개 함수와 같이 분류한다(callRpc + authCodeOf). 연결 실패만 NETWORK, 그 밖의 서버 실패는 그 코드로 돌려준다
  //   (예전에는 모든 서버 실패를 NETWORK 로 모았다 — 94-same-feature-diffs.md 5-3)
  const checkWith = async (input: string, ensure: () => Promise<{ ok: boolean }>): Promise<UsernameCheck | { code: AccountCode; detail?: string }> => {
    const name = normalizeUsername(input);
    if (!name) return "invalid";
    if (!(await ensure()).ok) return "NETWORK";
    const res = await callRpc<boolean, AccountCode>(client, "is_username_available", { username: name }, authCodeOf);
    if (res.ok) return res.data === true ? "available" : "taken";
    if (res.code === "AUTH_USERNAME_INVALID") return "invalid";
    if (res.code === "NETWORK") return "NETWORK";
    return { code: res.code, ...(res.detail ? { detail: res.detail } : {}) };
  };
  const checkUsername: Account["checkUsername"] = async (input) => {
    const check = await checkWith(input, gate.ensure);
    return typeof check === "string" ? check : "UNKNOWN";
  };

  const signUp: Account["signUp"] = async (username, displayName, password) => {
    const name = normalizeUsername(username);
    if (!name) return fail("AUTH_USERNAME_INVALID");
    const shown = normalizeDisplayName(displayName);
    if (!shown) return fail("AUTH_NAME_INVALID");
    if (password.length < ACCOUNT_RULES.passwordMin) return fail("AUTH_PASSWORD_WEAK");
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    // 세션 교체만 잠금 안에서 — 사용자 변경 알림(changed)은 잠금을 푼 뒤에 부른다
    const done = await gate.exclusive(async (scope): Promise<AccountResult | { handoff: HandoffReport | undefined }> => {
      // 익명 티켓은 중복검사(scope.ensure)보다 먼저 — 세션이 없으면 ensure 가 새 익명을 만들지만 그 계정에는 옮길 저장이 없다
      const prep = await before();
      if (!prep.ok) return prep.result;
      // 예약 아이디는 서버 트리거가 막지만 그 오류는 "Database error" 로만 온다 — 먼저 물어 이미 쓰는 아이디로 보인다
      const check = await checkWith(name, scope.ensure);
      if (check === "taken") return fail("AUTH_USERNAME_TAKEN");
      if (check === "NETWORK") return fail("NETWORK");
      if (typeof check !== "string") return fail(check.code, check.detail);
      try {
        const { data, error } = await client.auth.signUp({ email: internalEmail(name), password, options: { data: { display_name: shown } } });
        if (error) {
          const code = authCodeOf(error);
          // 동시에 가입하면 진 쪽은 DB 고유 제약 오류("Database error …")로 온다 — 다시 물어 이미 쓰는 아이디로 보인다(2026-09-27 자체 검사)
          if (code.code === "UNKNOWN" && (await checkWith(name, scope.ensure)) === "taken") return fail("AUTH_USERNAME_TAKEN");
          return { ok: false, ...code };
        }
        // 이메일 확인을 끈 프로젝트는 가입하면 바로 세션이 온다. 오지 않으면 설정 문제다
        if (!data.session) return fail("UNKNOWN", "no-session");
        return { handoff: await after(prep.handoff, data.user ?? data.session.user) };
      } catch (e) {
        return catchAll(e);
      }
    });
    return "ok" in done ? done : changed(done.handoff);
  };

  const signIn: Account["signIn"] = async (username, password) => {
    const name = normalizeUsername(username);
    if (!name || !password) return fail("AUTH_INVALID_LOGIN"); // 어느 쪽이 틀렸는지 나누지 않는다
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    const done = await gate.exclusive(async (): Promise<AccountResult | { handoff: HandoffReport | undefined }> => {
      const prep = await before();
      if (!prep.ok) return prep.result;
      try {
        const { data, error } = await client.auth.signInWithPassword({ email: internalEmail(name), password });
        if (error) return { ok: false, ...authCodeOf(error) };
        return { handoff: await after(prep.handoff, data.user) };
      } catch (e) {
        return catchAll(e);
      }
    });
    return "ok" in done ? done : changed(done.handoff);
  };

  // 이 PC 의 세션만 지운다 — JS 의 기본 범위는 모든 세션(global)이다
  const signOut: Account["signOut"] = async () => {
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    const done = await gate.exclusive(async (): Promise<AccountResult | null> => {
      try {
        const { error } = await client.auth.signOut({ scope: "local" });
        return error ? { ok: false, ...authCodeOf(error) } : null;
      } catch (e) {
        return catchAll(e);
      }
    });
    return done ?? changed();
  };

  const rename: Account["rename"] = async (displayName) => {
    const shown = normalizeDisplayName(displayName);
    if (!shown) return fail("AUTH_NAME_INVALID");
    if (!(await view()).signedIn) return fail("AUTH_INVALID_LOGIN");
    try {
      const { error } = await client.auth.updateUser({ data: { display_name: shown } });
      if (error) return { ok: false, ...authCodeOf(error) };
      return { ok: true, view: await view() };
    } catch (e) {
      return catchAll(e);
    }
  };

  const deleteAccount: Account["deleteAccount"] = async () => {
    if (!(await view()).signedIn) return fail("AUTH_INVALID_LOGIN");
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    const done = await gate.exclusive(async (): Promise<AccountResult | null> => {
      try {
        const { error } = await client.functions.invoke("delete-account", { method: "POST" });
        if (error) {
          // 함수가 돌려준 오류 코드 — FunctionsHttpError 의 응답 본문에 있다
          const f = await readFunctionError(error);
          if (f.bodyCode === "AUTH_TRADE_ACTIVE") return fail("AUTH_TRADE_ACTIVE");
          // 함수에 닿지 못했다(502·503·504·전송 실패) — 저장 올리기와 같이 연결 실패로 본다. 함수가 준 AUTH_* 코드는 그대로 쓴다
          if (isUnreachable(f) && !f.bodyCode?.startsWith("AUTH_")) return fail("NETWORK");
          return { ok: false, ...authCodeOf({ message: f.bodyCode ?? error.message }) };
        }
        // 사용자가 지워져 세션은 쓸 수 없다 — 이 PC 의 세션만 지운다
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        return null;
      } catch (e) {
        return catchAll(e);
      }
    });
    return done ?? changed();
  };

  const userId: Account["userId"] = async () => (await user())?.id ?? null;

  return { view, checkUsername, signUp, signIn, signOut, rename, deleteAccount, userId };
}
