// 계정 — 아이디+비밀번호 가입·로그인, 로그아웃, 이름 바꾸기. 설계는 docs/work/trade/record.md "계정과 로그인"
//
// Electron 을 모른다. 공유 클라이언트(src/online/client.ts)를 받는다. GitHub 로그인은 src/online/github.ts 다.
//   아이디는 메일이 갈 수 없는 내부 주소 <아이디>@id.pokebuddy.invalid 로 바꿔 Supabase 비밀번호 로그인을 쓴다
//   익명 계정은 바꾸지 않는다. 로그인하면 정식 계정으로 세션을 바꾼다. 로그아웃하면 다음 교환 때 새 익명 계정을 만든다
//   걸린 교환이 있으면 세션을 바꾸지 않는다(blocked) — 교환 채널은 사용자 ID 에 묶여 있다
//   이름 규칙과 예약 아이디는 서버 트리거(supabase/migrations/20260927100100_username.sql)도 다시 본다
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const ID_DOMAIN = "id.pokebuddy.invalid";
const USERNAME = /^[a-z][a-z0-9_]{3,15}$/;
export const PASSWORD_MIN = 8;
export const NAME_MAX = 12;

export type AccountMethod = "password" | "github";

// 화면에 넘기는 계정 보기 — 토큰·내부 주소·사용자 ID 는 넣지 않는다
export interface AccountView {
  signedIn: boolean;
  method: AccountMethod | null;
  username: string | null; // 아이디 계정만
  displayName: string | null;
}

export type AccountErrorCode =
  | "AUTH_USERNAME_INVALID" | "AUTH_USERNAME_TAKEN" | "AUTH_NAME_INVALID" | "AUTH_PASSWORD_WEAK"
  | "AUTH_INVALID_LOGIN" | "AUTH_TRADE_ACTIVE" | "AUTH_RATE_LIMITED" | "NETWORK" | "UNKNOWN";

export type AccountResult = { ok: true; view: AccountView } | { ok: false; code: AccountErrorCode; detail?: string };
export type UsernameCheck = "available" | "taken" | "invalid" | "NETWORK";

// 아이디 규칙 — 영문 소문자·숫자·밑줄, 4~16자, 영문으로 시작. 대문자는 소문자로 바꾼다. 맞지 않으면 null
export function normalizeUsername(input: string): string | null {
  const name = input.trim().toLowerCase();
  return USERNAME.test(name) ? name : null;
}

// 이름 규칙 — 앞뒤 공백을 지우고 1~12자, 줄바꿈·제어 문자 없음. 한글 가능. 맞지 않으면 null
export function normalizeDisplayName(input: string): string | null {
  const name = input.trim();
  const length = [...name].length;
  // 제어 문자 범위 — C0·DEL·C1
  return length >= 1 && length <= NAME_MAX && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : null;
}

export const internalEmail = (username: string): string => `${username}@${ID_DOMAIN}`;

// 사용자 → 화면 보기. 익명이면 로그인하지 않은 것으로 본다
export function viewOf(user: User | null | undefined): AccountView {
  if (!user || user.is_anonymous) return { signedIn: false, method: null, username: null, displayName: null };
  const email = (user.email ?? "").toLowerCase();
  const password = email.endsWith(`@${ID_DOMAIN}`);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    signedIn: true,
    method: password ? "password" : "github",
    username: password ? email.slice(0, -(ID_DOMAIN.length + 1)) : null,
    // GitHub 계정은 가입 때 이름을 받지 않는다 — GitHub 프로필 이름을 처음 값으로 쓴다
    displayName: text(meta.display_name) ?? text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name),
  };
}

// supabase-js 인증 오류 → 코드
export function authCodeOf(error: { message?: string; code?: string; status?: number } | null | undefined): { code: AccountErrorCode; detail?: string } {
  const message = (error?.message ?? "").trim();
  const code = error?.code ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return { code: "AUTH_INVALID_LOGIN" };
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(message)) return { code: "AUTH_USERNAME_TAKEN" };
  if (code === "weak_password" || /password should be/i.test(message)) return { code: "AUTH_PASSWORD_WEAK" };
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) return { code: "AUTH_RATE_LIMITED" };
  const own = /(AUTH_[A-Z_]+)/.exec(message);
  if (own) return { code: own[1] === "AUTH_USERNAME_RESERVED" ? "AUTH_USERNAME_TAKEN" : (own[1] as AccountErrorCode) };
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i.test(message)) return { code: "NETWORK" };
  return { code: "UNKNOWN", ...(message ? { detail: message } : {}) };
}

export interface AccountOptions {
  client: SupabaseClient;
  // 세션을 바꿀 수 없는가 — 걸린 교환(열린 채널·반영하지 않은 교환)이 있으면 true
  blocked: () => boolean;
  // 로그인·로그아웃으로 사용자가 바뀌었다 — 앱은 교환 세션을 새로 만들고 클라우드 저장을 시작·멈춘다
  onUserChanged?: (view: AccountView) => void | Promise<void>;
}

export interface Account {
  view: () => Promise<AccountView>;
  checkUsername: (input: string) => Promise<UsernameCheck>;
  signUp: (username: string, displayName: string, password: string) => Promise<AccountResult>;
  signIn: (username: string, password: string) => Promise<AccountResult>;
  signOut: () => Promise<AccountResult>;
  rename: (displayName: string) => Promise<AccountResult>;
  deleteAccount: () => Promise<AccountResult>; // 서버 함수 delete-account 가 지운다. 지운 뒤 이 PC 도 로그아웃한다
  userId: () => Promise<string | null>; // 로그인한 정식 계정의 ID — 익명이면 null
}

export function createAccount({ client, blocked, onUserChanged }: AccountOptions): Account {
  const user = async (): Promise<User | null> => {
    try {
      const { data } = await client.auth.getSession();
      return data.session?.user ?? null;
    } catch (e) {
      console.error("계정 세션을 읽지 못했다", e);
      return null;
    }
  };
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
  const fail = (code: AccountErrorCode, detail?: string): AccountResult => ({ ok: false, code, ...(detail ? { detail } : {}) });
  const catchAll = (e: unknown): AccountResult => ({ ok: false, ...authCodeOf({ message: e instanceof Error ? e.message : String(e) }) });
  const changed = async (): Promise<AccountResult> => {
    const v = await view();
    await onUserChanged?.(v);
    return { ok: true, view: v };
  };

  // 중복검사 함수는 로그인한 세션(익명 포함)만 부른다 — 세션이 없으면 익명 계정을 먼저 만든다
  const ensureSession = async (): Promise<boolean> => {
    if (await user()) return true;
    try {
      const { error } = await client.auth.signInAnonymously();
      return !error;
    } catch (e) {
      console.error("익명 세션을 만들지 못했다", e);
      return false;
    }
  };

  const checkUsername: Account["checkUsername"] = async (input) => {
    const name = normalizeUsername(input);
    if (!name) return "invalid";
    if (!(await ensureSession())) return "NETWORK";
    try {
      const { data, error } = await client.rpc("is_username_available", { username: name });
      if (error) return authCodeOf(error).code === "AUTH_USERNAME_INVALID" ? "invalid" : "NETWORK";
      return data === true ? "available" : "taken";
    } catch {
      return "NETWORK";
    }
  };

  const signUp: Account["signUp"] = async (username, displayName, password) => {
    const name = normalizeUsername(username);
    if (!name) return fail("AUTH_USERNAME_INVALID");
    const shown = normalizeDisplayName(displayName);
    if (!shown) return fail("AUTH_NAME_INVALID");
    if (password.length < PASSWORD_MIN) return fail("AUTH_PASSWORD_WEAK");
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    // 예약 아이디는 서버 트리거가 막지만 그 오류는 "Database error" 로만 온다 — 먼저 물어 이미 쓰는 아이디로 보인다
    const check = await checkUsername(name);
    if (check === "taken") return fail("AUTH_USERNAME_TAKEN");
    if (check === "NETWORK") return fail("NETWORK");
    try {
      const { data, error } = await client.auth.signUp({ email: internalEmail(name), password, options: { data: { display_name: shown } } });
      if (error) {
        const code = authCodeOf(error);
        // 동시에 가입하면 진 쪽은 DB 고유 제약 오류("Database error …")로 온다 — 다시 물어 이미 쓰는 아이디로 보인다(2026-09-27 자체 검사)
        if (code.code === "UNKNOWN" && (await checkUsername(name)) === "taken") return fail("AUTH_USERNAME_TAKEN");
        return { ok: false, ...code };
      }
      // 이메일 확인을 끈 프로젝트는 가입하면 바로 세션이 온다. 오지 않으면 설정 문제다
      if (!data.session) return fail("UNKNOWN", "no-session");
      return changed();
    } catch (e) {
      return catchAll(e);
    }
  };

  const signIn: Account["signIn"] = async (username, password) => {
    const name = normalizeUsername(username);
    if (!name || !password) return fail("AUTH_INVALID_LOGIN"); // 어느 쪽이 틀렸는지 나누지 않는다
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    try {
      const { error } = await client.auth.signInWithPassword({ email: internalEmail(name), password });
      if (error) return { ok: false, ...authCodeOf(error) };
      return changed();
    } catch (e) {
      return catchAll(e);
    }
  };

  // 이 PC 의 세션만 지운다 — JS 의 기본 범위는 모든 세션(global)이다
  const signOut: Account["signOut"] = async () => {
    if (blocked()) return fail("AUTH_TRADE_ACTIVE");
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return { ok: false, ...authCodeOf(error) };
      return changed();
    } catch (e) {
      return catchAll(e);
    }
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
    try {
      const { error } = await client.functions.invoke("delete-account", { method: "POST" });
      if (error) {
        // 함수가 돌려준 오류 코드 — FunctionsHttpError 의 응답 본문에 있다
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null;
        if (body?.error === "AUTH_TRADE_ACTIVE") return fail("AUTH_TRADE_ACTIVE");
        return { ok: false, ...authCodeOf({ message: body?.error ?? error.message }) };
      }
      // 사용자가 지워져 세션은 쓸 수 없다 — 이 PC 의 세션만 지운다
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      return changed();
    } catch (e) {
      return catchAll(e);
    }
  };

  const userId: Account["userId"] = async () => {
    const u = await user();
    return u && !u.is_anonymous ? u.id : null;
  };

  return { view, checkUsername, signUp, signIn, signOut, rename, deleteAccount, userId };
}
