// 친구 교환의 서버 호출 — Supabase 공개 함수(RPC)와 실시간 신호. 설계는 docs/work/trade/record.md "서버 설계"
//
// Electron 을 모른다. 세션 저장소를 받아서 쓴다 — 메인은 safeStorage 파일을, 자체 검사는 메모리를 넘긴다.
// 서버 오류는 raise exception 의 메시지(TRADE_…)를 코드로 옮긴다. 닫힌 이유는 details 로 온다.
// 서버에 닿지 못하면 NETWORK 다. 앱은 연결 실패 안내를 보인다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TradeErrorCode =
  | "TRADE_AUTH_REQUIRED" | "TRADE_BAD_ARGS" | "TRADE_VERSION_MISMATCH" | "TRADE_RATE_LIMITED" | "TRADE_ALREADY_ACTIVE"
  | "TRADE_LINK_INVALID" | "TRADE_LINK_EXPIRED" | "TRADE_LINK_USED" | "TRADE_OWN_LINK" | "TRADE_NOT_FOUND"
  | "TRADE_CLOSED" | "TRADE_OFFER_INVALID" | "TRADE_OFFER_MISSING" | "TRADE_OFFER_CHANGED" | "TRADE_ALREADY_DONE"
  | "TRADE_NOT_DONE" | "NETWORK" | "UNKNOWN";

export type NetResult<T> = { ok: true; data: T } | { ok: false; code: TradeErrorCode; detail?: string };

export type ChannelStatus = "open" | "joined" | "done" | "cancelled" | "expired";

// get_channel 이 돌려주는 채널 보기 — 토큰 해시와 사용자 ID 는 없다
export interface ChannelView {
  id: string;
  role: "host" | "guest";
  status: ChannelStatus;
  offer_rev: number;
  my_offer: unknown;
  friend_offer: unknown;
  my_ready: boolean;
  friend_ready: boolean;
  friend_joined: boolean;
  friend_name: string | null;
  expires_at: string;
  done_at: string | null;
  closed_reason: string | null;
}

export interface CreatedChannel {
  channelId: string;
  token: string;
  expiresAt: string;
}

// 세션을 두는 곳 — supabase-js 의 저장소 모양과 같다
export interface SessionStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface TradeNetOptions {
  url: string;
  key: string; // publishable 키
  storage: SessionStorage;
}

export interface TradeNet {
  client: SupabaseClient;
  ensureSession: () => Promise<NetResult<{ userId: string; anonymous: boolean }>>;
  createChannel: (protocol: number, dataVersion: string) => Promise<NetResult<CreatedChannel>>;
  joinChannel: (token: string, protocol: number, dataVersion: string) => Promise<NetResult<string>>;
  setOffer: (channelId: string, pet: unknown) => Promise<NetResult<number>>;
  setReady: (channelId: string, rev: number | null) => Promise<NetResult<ChannelStatus>>;
  cancelChannel: (channelId: string) => Promise<NetResult<ChannelStatus>>;
  getChannel: (channelId: string) => Promise<NetResult<ChannelView>>;
  ackApplied: (channelId: string) => Promise<NetResult<null>>;
  subscribe: (channelId: string, onChange: () => void) => Promise<() => void>;
}

const CODE = /^(TRADE_[A-Z_]+)$/;

// supabase-js 오류를 코드로. 서버 코드가 아니면 연결 문제로 본다
export function codeOf(error: { message?: string; details?: string | null; code?: string } | null | undefined): { code: TradeErrorCode; detail?: string } {
  const message = (error?.message ?? "").trim();
  const m = CODE.exec(message);
  if (m) return { code: m[1] as TradeErrorCode, ...(error?.details ? { detail: error.details } : {}) };
  if (/fetch|network|Failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i.test(message) || error?.code === "") return { code: "NETWORK" };
  return { code: "UNKNOWN", ...(message ? { detail: message } : {}) };
}

const FETCH_TIMEOUT_MS = 15_000;

export function createTradeNet({ url, key, storage }: TradeNetOptions): TradeNet {
  const client = createClient(url, key, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    // 요청마다 제한 시간을 둔다 — 서버가 답하지 않으면 명령 통로(mailbox)가 그동안 막힌다(2026-09-27 검수)
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }) },
  });

  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<NetResult<T>> => {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) return { ok: false, ...codeOf(error) };
      return { ok: true, data: data as T };
    } catch (e) {
      return { ok: false, ...codeOf({ message: e instanceof Error ? e.message : String(e) }) };
    }
  };

  // 로그인하지 않았으면 익명 계정을 만든다. 교환에는 로그인이 필요 없다(2026-09-26 사용자 결정)
  // 동시에 불려도 익명 계정을 두 개 만들지 않게 진행 중인 확인을 나눠 쓴다
  let ensuring: ReturnType<TradeNet["ensureSession"]> | null = null;
  const ensureSession: TradeNet["ensureSession"] = () => {
    ensuring ??= ensureOnce().finally(() => { ensuring = null; });
    return ensuring;
  };
  const ensureOnce: TradeNet["ensureSession"] = async () => {
    try {
      const { data } = await client.auth.getSession();
      let user = data.session?.user ?? null;
      if (!user) {
        const res = await client.auth.signInAnonymously();
        if (res.error) return { ok: false, ...codeOf(res.error) };
        user = res.data.user;
      }
      if (!user) return { ok: false, code: "UNKNOWN" };
      return { ok: true, data: { userId: user.id, anonymous: user.is_anonymous === true } };
    } catch (e) {
      return { ok: false, ...codeOf({ message: e instanceof Error ? e.message : String(e) }) };
    }
  };

  const createChannel: TradeNet["createChannel"] = async (protocol, dataVersion) => {
    const res = await rpc<{ channel_id: string; token: string; expires_at: string }[]>("create_channel", { p_protocol: protocol, p_data_version: dataVersion });
    if (!res.ok) return res;
    const row = res.data[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, data: { channelId: row.channel_id, token: row.token, expiresAt: row.expires_at } };
  };

  // 실시간 신호는 신호만 온다. 받으면 get_channel 로 다시 읽는다
  const subscribe: TradeNet["subscribe"] = async (channelId, onChange) => {
    await client.realtime.setAuth();
    const ch = client
      .channel(`trade:${channelId}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => onChange())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onChange(); // 구독을 시작하거나 다시 연결했을 때 한 번 읽는다
      });
    return () => {
      void client.removeChannel(ch);
    };
  };

  return {
    client,
    ensureSession,
    createChannel,
    joinChannel: (token, protocol, dataVersion) => rpc<string>("join_channel", { p_token: token, p_protocol: protocol, p_data_version: dataVersion }),
    setOffer: (channelId, pet) => rpc<number>("set_offer", { p_channel: channelId, p_pet: pet }),
    setReady: (channelId, rev) => rpc<ChannelStatus>("set_ready", { p_channel: channelId, p_rev: rev }),
    cancelChannel: (channelId) => rpc<ChannelStatus>("cancel_channel", { p_channel: channelId }),
    getChannel: (channelId) => rpc<ChannelView>("get_channel", { p_channel: channelId }),
    ackApplied: async (channelId) => {
      const res = await rpc<unknown>("ack_applied", { p_channel: channelId });
      return res.ok ? { ok: true, data: null } : res;
    },
    subscribe,
  };
}

// 링크에서 토큰을 꺼낸다 — https …/trade#<토큰>, pokebuddy://trade/<토큰>, 토큰만 붙여 넣은 것
export function tokenOf(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hash = text.indexOf("#");
  const deep = /^pokebuddy:\/\/trade\/([A-Za-z0-9_-]+)/.exec(text);
  const raw = deep ? deep[1] : hash >= 0 ? text.slice(hash + 1) : text;
  return raw && /^[A-Za-z0-9_-]{16,64}$/.test(raw) ? raw : null;
}
