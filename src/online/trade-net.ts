// 친구 교환의 서버 호출 — Supabase 공개 함수(RPC)와 실시간 신호. 설계는 worklog/records/trade/record.md "서버 설계"
//
// Electron 을 모른다. 세션 저장소를 받아서 쓴다 — 메인은 safeStorage 파일을, 자체 검사는 메모리를 넘긴다.
// 서버 오류는 raise exception 의 메시지(TRADE_…)를 코드로 옮긴다. 닫힌 이유는 details 로 온다.
// 서버에 닿지 못하면 NETWORK 다. 앱은 연결 실패 안내를 보인다.
// 규약 2 (worklog-mac/records/cloud-authority/design-p2.md 13절): 만들기·참가·제안·확정은 로그인 계정만 한다(TRADE_LOGIN_REQUIRED).
//   제안은 개체 지문(ref)을 함께 보낸다. 서버 저장에 없는 개체는 TRADE_PET_NOT_SYNCED, 이미 교환으로 보낸 개체는 TRADE_PET_TRADED
//   다른 활성 교환에 올라가 있는 개체는 TRADE_PET_BUSY (design-p2.md 17절 D31, 계정 무관)
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOnlineClient, type OnlineClientOptions, type SessionStorage } from "./client.js";
import { createSessionGate, type SessionGate } from "./session.js";
import { tradeCodeOf } from "./codes.js";
import { callRpc } from "./server-call.js";
import type { TradeCode } from "../shared/names/online-codes.js";
import type { PetRef } from "../trade/exchange.js";

export type { SessionStorage };

// 교환 호출의 실패 코드 — 목록은 src/shared/names/online-codes.ts. CLOUD_ACCOUNT_HELD 는 이용 정지(P4c). 앱은 멈춘다

export type NetResult<T> = { ok: true; data: T } | { ok: false; code: TradeCode; detail?: string };

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
  // issue 가 거짓이면 익명 계정을 만들지 않는다 — 세션이 없으면 TRADE_LOGIN_REQUIRED (검수 H1)
  ensureSession: (issue?: boolean) => Promise<NetResult<{ userId: string; anonymous: boolean }>>;
  createChannel: (protocol: number, dataVersion: string) => Promise<NetResult<CreatedChannel>>;
  joinChannel: (token: string, protocol: number, dataVersion: string) => Promise<NetResult<string>>;
  setOffer: (channelId: string, pet: unknown, ref: PetRef) => Promise<NetResult<number>>;
  setReady: (channelId: string, rev: number | null) => Promise<NetResult<ChannelStatus>>;
  cancelChannel: (channelId: string) => Promise<NetResult<ChannelStatus>>;
  getChannel: (channelId: string) => Promise<NetResult<ChannelView>>;
  ackApplied: (channelId: string) => Promise<NetResult<null>>;
  subscribe: (channelId: string, onChange: () => void) => Promise<() => void>;
}

// supabase-js 오류 → 코드는 src/online/codes.ts tradeCodeOf 다

export function createTradeNet(opts: TradeNetOptions): TradeNet {
  const client = "client" in opts ? opts.client : createOnlineClient(opts);
  const gate = opts.gate ?? createSessionGate(client);

  const rpc = <T>(fn: string, args: Record<string, unknown>): Promise<NetResult<T>> => callRpc<T, TradeCode>(client, fn, args, tradeCodeOf);

  // 로그인하지 않았으면 익명 계정을 만든다. 익명 계정은 채널을 읽고 닫을 수만 있다 — 만들기·참가·제안·확정은 로그인이 필요하다(P2, design-p2.md 1절)
  // 익명 발급·동시 호출 나눠 쓰기는 세션 관문이 맡는다 — 계정·클라우드 저장과 발급 경로를 하나로 (검수 F2)
  // 인증 요청 한도(AUTH_RATE_LIMITED)는 링크 한도(TRADE_RATE_LIMITED)와 뜻이 달라 UNKNOWN 으로 보낸다
  //   issue 거짓 — 저장 계정을 잃었거나(D29) 저장 주인이 있는데 세션이 없다. 새 익명 계정은 그 저장을 올릴 수 없고
  //   다음 부팅을 분실로 보지 못하게 한다(검수 H1). 있는 세션만 쓴다 — 망 오류로 모르면 NETWORK
  const ensureSession: TradeNet["ensureSession"] = async (issue = true) => {
    if (!issue) {
      const p = await gate.probe();
      if (p.state === "present") return { ok: true, data: { userId: p.user.id, anonymous: p.user.is_anonymous === true } };
      if (p.state === "none") return { ok: false, code: "TRADE_LOGIN_REQUIRED" };
      return { ok: false, code: p.code === "NETWORK" ? "NETWORK" : "UNKNOWN" };
    }
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
    setOffer: (channelId, pet, ref) => rpc<number>("set_offer", { p_channel: channelId, p_pet: pet, p_ref: ref }),
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
