// 친구 교환의 서버 호출 — Supabase 공개 함수(RPC)와 실시간 신호. 설계는 worklog/records/trade/record.md "서버 설계"
//
// Electron 을 모른다. 세션 저장소를 받아서 쓴다 — 메인은 safeStorage 파일을, 자체 검사는 메모리를 넘긴다.
// 서버 오류는 raise exception 의 메시지(TRADE_…)를 코드로 옮긴다. 닫힌 이유는 details 로 온다.
// 서버에 닿지 못하면 NETWORK 다. 앱은 연결 실패 안내를 보인다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOnlineClient, type OnlineClientOptions, type SessionStorage } from "../online/client.js";
import { createSessionGate, type SessionGate } from "../online/session.js";

export type { SessionStorage };

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

// 클라이언트를 받거나(앱 — 계정·클라우드 저장과 같은 세션) 만든다(자체 검사)
// gate — 앱은 계정·클라우드 저장과 같은 세션 관문을 넘긴다. 없으면 이 클라이언트로 새로 만든다(자체 검사)
export type TradeNetOptions = ({ client: SupabaseClient } | OnlineClientOptions) & { gate?: SessionGate };

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

export function createTradeNet(opts: TradeNetOptions): TradeNet {
  const client = "client" in opts ? opts.client : createOnlineClient(opts);
  const gate = opts.gate ?? createSessionGate(client);

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
  // 익명 발급·동시 호출 나눠 쓰기는 세션 관문이 맡는다 — 계정·클라우드 저장과 발급 경로를 하나로 (검수 F2)
  // 인증 요청 한도(AUTH_RATE_LIMITED)는 링크 한도(TRADE_RATE_LIMITED)와 뜻이 달라 UNKNOWN 으로 보낸다
  const ensureSession: TradeNet["ensureSession"] = async () => {
    const res = await gate.ensure();
    if (res.ok) return { ok: true, data: { userId: res.user.id, anonymous: res.user.is_anonymous === true } };
    if (res.code === "NETWORK") return { ok: false, code: "NETWORK" };
    const detail = res.code === "AUTH_RATE_LIMITED" ? res.code : res.detail;
    return { ok: false, code: "UNKNOWN", ...(detail ? { detail } : {}) };
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
