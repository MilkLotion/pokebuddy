// 온라인 기능이 함께 쓰는 Supabase 클라이언트 — 교환·계정·클라우드 저장이 같은 세션을 본다.
// 설계는 worklog/records/trade/record.md "로그인·클라우드 저장 구현 계획" P-03
//
// Electron 을 모른다. 세션 저장소를 받아서 쓴다 — 메인은 safeStorage 파일을, 자체 검사는 메모리를 넘긴다
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 세션을 두는 곳 — supabase-js 의 저장소 모양과 같다
export interface SessionStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface OnlineClientOptions {
  url: string;
  key: string; // publishable 키
  storage: SessionStorage;
}

const FETCH_TIMEOUT_MS = 15_000;

export function createOnlineClient({ url, key, storage }: OnlineClientOptions): SupabaseClient {
  return createClient(url, key, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
    // 요청마다 제한 시간을 둔다 — 서버가 답하지 않으면 명령 통로(mailbox)가 그동안 막힌다(2026-09-27 검수)
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }) },
  });
}

// 메모리 세션 저장소 — 자체 검사와 암호화를 쓸 수 없을 때
export function memoryStorage(): SessionStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
