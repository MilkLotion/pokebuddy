// 세션 관문 — 공유 Supabase 클라이언트의 세션을 한 곳에서 확보·교체한다. 설계는 worklog-mac/records/cloud-authority/design-p1.md 4절
//
// Electron 을 모른다. 공유 클라이언트(src/online/client.ts)를 받는다.
//   익명 계정 발급(signInAnonymously)은 코드베이스에서 이 파일 한 곳 — 교환·계정이 따로 발급해 계정이 엇갈리지 않게 (검수 F2)
//   ensure: 세션이 없을 때만 익명 계정을 만든다. 진행 중인 확인을 나눠 쓴다(단일 비행). 세션 교체(exclusive)가 돌고 있으면 끝날 때까지 기다린다
//   exclusive: 가입·로그인·GitHub 교환·로그아웃·삭제를 차례로 돌린다. 먼저 시작한 ensure 가 끝난 뒤에 시작한다
//   교착 방지 — exclusive 안에서는 gate.ensure 대신 넘겨받은 scope.ensure 를 쓴다(잠금을 기다리지 않는다).
//   exclusive 안에서 사용자 변경 알림(onUserChanged 등)을 부르지 않는다 — 알림을 받은 쪽이 gate.ensure 를 부르면 서로 기다린다
//   토큰 갱신이 망 오류로 실패하면 getSession 은 세션 없음을 돌려주지만 저장소의 세션은 그대로다(auth-js __loadSession).
//     그때 ensure 는 익명 계정을 만들지 않고 NETWORK, probe 는 unknown — 로그인 세션을 익명으로 덮거나 분실(D29)로 잘못 보지 않게
import { isAuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
import { authCodeOf } from "./account.js";
import type { SessionCode } from "../shared/names/online-codes.js";

export type SessionErrorCode = SessionCode; // 목록은 src/shared/names/online-codes.ts

export type SessionResult = { ok: true; user: User } | { ok: false; code: SessionErrorCode; detail?: string };

// 부팅 판단용 세션 확인 (design-p2.md 2절)
//   present  세션이 있다(익명·로그인)
//   none     세션이 없다 — 저장소가 비었거나 갱신 토큰이 거절돼 지워졌다
//   unknown  망 오류로 확인하지 못했다 — 저장소의 세션은 남아 있다. 분실로 보지 않는다
export type SessionProbe = { state: "present"; user: User } | { state: "none" } | { state: "unknown"; code: SessionErrorCode };

// exclusive 안에서만 쓰는 도구 — 잠금을 이미 쥐고 있으므로 기다리지 않는다
export interface SessionScope {
  ensure: () => Promise<SessionResult>;
}

export interface SessionGate {
  // 지금 세션의 사용자 — 없거나 읽지 못하면 null. 만들지 않는다
  current: () => Promise<User | null>;
  // 세션이 있는지 없는지 모르는지 — 만들지 않는다
  probe: () => Promise<SessionProbe>;
  // 세션을 확보한다 — 없으면 익명 계정을 만든다
  ensure: () => Promise<SessionResult>;
  // 세션을 바꾸는 작업을 차례로 돌린다
  exclusive: <T>(fn: (scope: SessionScope) => Promise<T>) => Promise<T>;
}

// 인증 오류 → 세션 코드. 계정 쪽 분류(authCodeOf)를 쓰고, 세 코드 밖은 UNKNOWN 으로 모은다
export function sessionCodeOf(error: { message?: string; code?: string; status?: number } | null | undefined): { code: SessionErrorCode; detail?: string } {
  const c = authCodeOf(error);
  if (c.code === "NETWORK" || c.code === "AUTH_RATE_LIMITED") return { code: c.code };
  const detail = c.detail ?? (c.code === "UNKNOWN" ? undefined : c.code);
  return { code: "UNKNOWN", ...(detail ? { detail } : {}) };
}

export function createSessionGate(client: SupabaseClient): SessionGate {
  let lock: Promise<void> = Promise.resolve(); // exclusive 차례 — 마지막으로 줄 선 작업이 끝나면 풀린다
  let ensuring: Promise<SessionResult> | null = null; // 잠금 밖 ensure 의 진행 중 확인
  let inner: Promise<SessionResult> | null = null; // 잠금 안 ensure 의 진행 중 확인

  const current: SessionGate["current"] = async () => {
    try {
      const { data } = await client.auth.getSession();
      return data.session?.user ?? null;
    } catch (e) {
      console.error("세션을 읽지 못했다", e);
      return null;
    }
  };

  // 망 오류로 갱신하지 못했다 — 저장소에 세션이 남아 있다
  const retryable = (error: unknown): boolean =>
    !!error && (isAuthRetryableFetchError(error) || sessionCodeOf(error as { message?: string }).code === "NETWORK");

  const probe: SessionGate["probe"] = async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (data.session?.user) return { state: "present", user: data.session.user };
      if (retryable(error)) return { state: "unknown", code: "NETWORK" };
      return { state: "none" };
    } catch (e) {
      return { state: "unknown", ...sessionCodeOf({ message: e instanceof Error ? e.message : String(e) }) };
    }
  };

  // 세션이 없을 때만 익명 계정을 만든다
  const ensureNow = async (): Promise<SessionResult> => {
    try {
      const { data, error } = await client.auth.getSession();
      const user = data.session?.user ?? null;
      if (user) return { ok: true, user };
      if (retryable(error)) return { ok: false, code: "NETWORK" };
      const res = await client.auth.signInAnonymously();
      if (res.error) return { ok: false, ...sessionCodeOf(res.error) };
      if (!res.data.user) return { ok: false, code: "UNKNOWN", detail: "no-user" };
      return { ok: true, user: res.data.user };
    } catch (e) {
      return { ok: false, ...sessionCodeOf({ message: e instanceof Error ? e.message : String(e) }) };
    }
  };

  // 부르는 순간의 잠금을 기다린 뒤 확인한다 — 그 뒤에 줄 선 exclusive 는 이 확인이 끝나기를 기다린다
  const ensure: SessionGate["ensure"] = () => {
    if (ensuring) return ensuring;
    const p: Promise<SessionResult> = lock.then(ensureNow).finally(() => {
      if (ensuring === p) ensuring = null;
    });
    ensuring = p;
    return p;
  };

  const scope: SessionScope = {
    ensure: () => {
      inner ??= ensureNow().finally(() => { inner = null; });
      return inner;
    },
  };

  const exclusive: SessionGate["exclusive"] = (fn) => {
    const prev = lock;
    const before = ensuring; // 이미 시작한 ensure — 앞선 잠금만 기다리므로 여기서 기다려도 교착하지 않는다
    ensuring = null; // 이 뒤의 ensure 는 교체가 끝난 세션을 보도록 새로 줄 선다
    let release: () => void = () => undefined;
    lock = new Promise<void>((r) => { release = r; });
    return (async () => {
      try {
        await prev;
        if (before) await before;
        return await fn(scope);
      } finally {
        release();
      }
    })();
  };

  return { current, probe, ensure, exclusive };
}
