// 서버 호출 한 벌 — Supabase 공개 함수(RPC)를 부르고 실패를 코드로 바꾼다. Edge Function 의 오류 본문을 읽는다.
// 코드로 바꾸는 규칙(분류기)은 호출 길마다 다르다 — ./codes.ts. 여기는 뼈대만 둔다
//
// Electron 을 모른다. 공유 클라이언트(./client.ts)를 받는다
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerResult<T, C extends string = string> = { ok: true; data: T } | { ok: false; code: C; detail?: string };

// supabase-js 가 돌려주거나 던지는 오류에서 보는 필드
export type ServerError = { message?: string; details?: string | null; code?: string; status?: number } | null | undefined;

// 오류 → 코드. 서버 코드가 아니면 망 오류(NETWORK)인지 본다
export type Classify<C extends string = string> = (error: ServerError) => { code: C; detail?: string };

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const NETWORK = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i;

// 서버에 닿지 못한 오류의 글인가 — 요청 제한(client.ts 의 AbortSignal.timeout)이 던지는 글도 여기에 걸린다
export const isNetworkMessage = (message: string): boolean => NETWORK.test(message);

// 공개 함수 하나를 부른다. 던지지 않는다 — 실패는 분류기가 준 코드다
export async function callRpc<T, C extends string>(client: SupabaseClient, fn: string, args: Record<string, unknown> | undefined, classify: Classify<C>): Promise<ServerResult<T, C>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return { ok: false, ...classify(error) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, ...classify({ message: messageOf(e) }) };
  }
}

// Edge Function 호출 오류에서 읽은 것
export interface FunctionFailure {
  bodyCode: string | null; // 응답 본문 { error: "<코드>" } 의 글자. 본문이 없거나 글자가 아니면 null
  status: number | null; // 응답이 있으면 그 상태 코드
  transport: boolean; // 함수에 닿지 못했다 (FunctionsFetchError · FunctionsRelayError)
  message: string;
}

// client.functions.invoke 가 돌려준 error 를 읽는다. 응답 본문은 사본으로 읽는다
export async function readFunctionError(error: unknown): Promise<FunctionFailure> {
  const e = error as { context?: unknown; name?: unknown; message?: unknown } | null;
  const context = e?.context as { json?: unknown; clone?: unknown; status?: unknown } | null | undefined;
  let bodyCode: string | null = null;
  let status: number | null = null;
  if (context && typeof context.json === "function") {
    const source = typeof context.clone === "function" ? (context.clone as () => { json: () => Promise<unknown> })() : (context as { json: () => Promise<unknown> });
    const body = (await source.json().catch(() => null)) as { error?: unknown } | null;
    bodyCode = typeof body?.error === "string" ? body.error : null;
    status = typeof context.status === "number" ? context.status : null;
  }
  return { bodyCode, status, transport: e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError", message: typeof e?.message === "string" ? e.message : "" };
}

// 함수에 닿지 못했다 — 전송 실패이거나 앞단이 502·503·504 를 돌려줬다. 연결 실패(NETWORK)로 본다.
// 저장 올리기와 계정 삭제가 같은 판정을 쓴다 (worklog/records/code-structure/design/94-same-feature-diffs.md 4-5)
export const isUnreachable = (f: FunctionFailure): boolean => f.transport || f.status === 502 || f.status === 503 || f.status === 504;

export interface TimerApi {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}
const REAL_TIMER: TimerApi = { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

// 일이 끝나거나 시간이 다 되면 돌아온다. 일은 멈추지 않는다 — 기다리기만 그친다
export async function withTimeout(work: Promise<unknown>, ms: number, timers: TimerApi = REAL_TIMER): Promise<void> {
  let timer: unknown = null;
  await Promise.race([work, new Promise<void>((r) => { timer = timers.setTimer(r, ms); })]);
  if (timer) timers.clearTimer(timer);
}
