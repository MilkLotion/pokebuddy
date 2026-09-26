// 친구 교환 흐름 — 서버 호출(src/trade/net.ts)과 로컬 거래(trade.lock·unlock·apply)를 잇는다.
// 설계는 docs/work/trade/record.md "전체 구조", "로컬 저장과 복구", "실시간 알림"
//
// Electron 을 모른다. 거래 실행과 저장 읽기를 받아서 쓴다. 화면은 onView 로 받은 보기만 그린다.
//   확정    로컬 잠금(trade.lock) → 서버 확정(set_ready). 서버가 거절하면 잠금을 푼다
//   완료    서버가 done 이면 친구 제안으로 trade.apply → ack_applied. 반영은 pending 이 있을 때만 된다
//   닫힘    cancelled·expired 면 trade.unlock
//   복구    앱을 켜면 pending 의 채널을 다시 읽는다. 연결 실패면 걸어 둔 채 5분마다 다시 본다
import { offerable, pendingOf, snapshot, validateReceived, type ReceiveFailure, type TradePet } from "./core.js";
import { tokenOf, type ChannelView, type TradeErrorCode, type TradeNet } from "./net.js";
import type { TxResult } from "../tx/executor";
import type { SaveV3 } from "../shared/save-v3";

export type TradePhase = "idle" | "hosting" | "trading" | "done" | "closed";

export interface TradeViewModel {
  phase: TradePhase;
  link: string | null; // 내가 만든 링크 (hosting)
  channel: ChannelView | null;
  myPetId: string | null; // 내가 올린 개체
  friendPet: TradePet | null; // 검사를 통과한 친구 제안
  friendBlocked: ReceiveFailure | null; // 친구 제안이 검사에 걸린 이유
  received: { petId: string } | null; // 완료 뒤 받은 개체
  error: { code: TradeErrorCode | "LOCAL"; detail?: string } | null;
  busy: boolean;
}

export interface TradeSessionOptions {
  net: TradeNet;
  run: (id: string, name: string, args: Record<string, unknown>) => TxResult; // 로컬 거래 실행. id 는 요청 식별자
  read: () => SaveV3 | null;
  protocol: number;
  dataVersion: string;
  linkOf: (token: string) => string;
  onView: (view: TradeViewModel) => void;
  newId?: () => string; // 거래 요청 ID
  retryMs?: number; // 연결 실패 뒤 다시 보는 간격
  pollMs?: number; // 신호가 끊겼을 때 다시 읽는 간격
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface TradeSession {
  view: () => TradeViewModel;
  start: () => Promise<void>; // 로그인 확보와 복구
  create: () => Promise<void>;
  join: (link: string) => Promise<void>;
  offer: (petId: string) => Promise<void>;
  ready: () => Promise<void>;
  unready: () => Promise<void>;
  leave: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => void;
}

const EMPTY: TradeViewModel = {
  phase: "idle", link: null, channel: null, myPetId: null, friendPet: null, friendBlocked: null, received: null, error: null, busy: false,
};

export function createTradeSession(o: TradeSessionOptions): TradeSession {
  let state: TradeViewModel = { ...EMPTY };
  let channelId: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let pollTimer: unknown = null;
  let retryTimer: unknown = null;
  let seq = 0;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const newId = o.newId ?? (() => `trade-${Date.now()}-${++seq}`);

  const emit = (patch: Partial<TradeViewModel>): void => {
    state = { ...state, ...patch };
    o.onView(state);
  };
  const fail = (code: TradeErrorCode | "LOCAL", detail?: string): void =>
    emit({ error: { code, ...(detail ? { detail } : {}) }, busy: false });
  const tx = (name: string, args: Record<string, unknown>): TxResult => o.run(newId(), name, args);

  const stopWatching = (): void => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (pollTimer) clearTimer(pollTimer);
    pollTimer = null;
  };

  const watch = async (id: string): Promise<void> => {
    stopWatching();
    unsubscribe = await o.net.subscribe(id, () => void refresh());
    const poll = (): void => {
      pollTimer = setTimer(() => {
        void refresh().finally(() => {
          if (channelId === id && state.phase !== "done" && state.phase !== "closed") poll();
        });
      }, o.pollMs ?? 30_000);
    };
    poll();
  };

  // 서버가 끝났다고 알린 채널을 로컬에 맞춘다
  const settle = async (view: ChannelView): Promise<void> => {
    if (view.status === "done") {
      const res = tx("trade.apply", { channelId: view.id, received: view.friend_offer });
      if (!res.ok) return fail("LOCAL", String(res.reason));
      const result = res.result as { applied: boolean; petId?: string };
      const ack = await o.net.ackApplied(view.id);
      stopWatching();
      emit({ phase: "done", channel: view, received: result.petId ? { petId: result.petId } : state.received, busy: false, error: ack.ok ? null : state.error });
      return;
    }
    if (view.status === "cancelled" || view.status === "expired") {
      tx("trade.unlock", { channelId: view.id });
      stopWatching();
      emit({ phase: "closed", channel: view, busy: false });
    }
  };

  // 새로 고침은 한 번에 하나만 돈다. 도는 중에 부르면 끝난 뒤 한 번 더 돈다
  // — 실시간 신호로 시작한 새로 고침이 오래된 상태를 늦게 반영하면 방금 건 잠금을 풀 수 있다(2026-09-27 통합 검사에서 발견)
  let running: Promise<void> | null = null;
  let again = false;
  const refresh = async (): Promise<void> => {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await refreshOnce(); } while (again);
    })().finally(() => { running = null; });
    return running;
  };

  const refreshOnce = async (): Promise<void> => {
    const id = channelId;
    if (!id) return;
    const res = await o.net.getChannel(id);
    if (id !== channelId) return;
    if (!res.ok) return fail(res.code, res.detail);
    const view = res.data;
    // 친구가 제안을 바꿔 판 번호가 달라졌으면 내 확정은 풀렸다. 로컬 잠금도 푼다
    // 판 번호가 같으면 풀지 않는다 — 확정하기 전에 읽은 오래된 보기일 수 있다
    const pending = (() => { const s = o.read(); return s ? pendingOf(s) : null; })();
    if (view.status === "joined" && pending?.channelId === id && !view.my_ready && pending.offerRev !== view.offer_rev) tx("trade.unlock", { channelId: id });
    let friendPet: TradePet | null = null;
    let friendBlocked: ReceiveFailure | null = null;
    if (view.friend_offer != null) {
      const check = validateReceived(view.friend_offer);
      if (check.ok) friendPet = check.pet;
      else friendBlocked = check.reason;
    }
    emit({ channel: view, friendPet, friendBlocked, phase: view.status === "open" ? "hosting" : view.status === "joined" ? "trading" : state.phase, error: null });
    await settle(view);
  };

  const start: TradeSession["start"] = async () => {
    const s = await o.net.ensureSession();
    if (!s.ok) return scheduleRetry(s.code, s.detail);
    const save = o.read();
    const pending = save ? pendingOf(save) : null;
    if (!pending) return;
    // 반영하지 않은 교환을 이어 간다
    const res = await o.net.getChannel(pending.channelId);
    if (!res.ok) {
      if (res.code === "TRADE_NOT_FOUND") {
        tx("trade.unlock", { channelId: pending.channelId }); // 채널 없음 — 풀어 준다(설계의 30일 정리 뒤 위험)
        return;
      }
      return scheduleRetry(res.code, res.detail);
    }
    channelId = pending.channelId;
    emit({ phase: res.data.status === "done" ? "done" : "trading", channel: res.data, myPetId: pending.petId });
    if (res.data.status === "joined") await watch(pending.channelId);
    await settle(res.data);
  };

  const scheduleRetry = (code: TradeErrorCode, detail?: string): void => {
    fail(code, detail);
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => { retryTimer = null; void start(); }, o.retryMs ?? 5 * 60_000);
  };

  const begin = (): boolean => {
    if (state.busy) return false;
    emit({ busy: true, error: null });
    return true;
  };

  const create: TradeSession["create"] = async () => {
    if (!begin()) return;
    const s = await o.net.ensureSession();
    if (!s.ok) return fail(s.code, s.detail);
    const res = await o.net.createChannel(o.protocol, o.dataVersion);
    if (!res.ok) return fail(res.code, res.detail);
    channelId = res.data.channelId;
    emit({ ...EMPTY, phase: "hosting", link: o.linkOf(res.data.token), busy: false });
    await watch(res.data.channelId);
  };

  const join: TradeSession["join"] = async (link) => {
    const token = tokenOf(link);
    if (!token) return fail("TRADE_LINK_INVALID");
    if (!begin()) return;
    const s = await o.net.ensureSession();
    if (!s.ok) return fail(s.code, s.detail);
    const res = await o.net.joinChannel(token, o.protocol, o.dataVersion);
    if (!res.ok) return fail(res.code, res.detail);
    stopWatching();
    channelId = res.data;
    emit({ ...EMPTY, phase: "trading", busy: false });
    await watch(res.data);
  };

  const offer: TradeSession["offer"] = async (petId) => {
    if (!channelId || !begin()) return;
    const save = o.read();
    if (!save) return fail("LOCAL", "no-save");
    const ok = offerable(save, petId);
    if (!ok.ok) return fail("LOCAL", ok.reason);
    const res = await o.net.setOffer(channelId, snapshot(ok.pet));
    if (!res.ok) return fail(res.code, res.detail);
    emit({ myPetId: petId, busy: false });
    await refresh();
  };

  const ready: TradeSession["ready"] = async () => {
    const view = state.channel;
    if (!channelId || !view || !state.myPetId || !state.friendPet || !begin()) return;
    const locked = tx("trade.lock", { channelId, petId: state.myPetId, offerRev: view.offer_rev });
    if (!locked.ok) return fail("LOCAL", String(locked.reason));
    const res = await o.net.setReady(channelId, view.offer_rev);
    if (!res.ok) {
      if (res.code !== "TRADE_ALREADY_DONE") tx("trade.unlock", { channelId });
      if (res.code === "TRADE_OFFER_CHANGED") { emit({ busy: false }); return refresh(); }
      return fail(res.code, res.detail);
    }
    emit({ busy: false });
    await refresh();
  };

  const unready: TradeSession["unready"] = async () => {
    if (!channelId || !begin()) return;
    const res = await o.net.setReady(channelId, null);
    if (!res.ok) return fail(res.code, res.detail);
    tx("trade.unlock", { channelId });
    emit({ busy: false });
    await refresh();
  };

  const leave: TradeSession["leave"] = async () => {
    const id = channelId;
    if (!id) { emit({ ...EMPTY }); return; }
    if (!begin()) return;
    const res = await o.net.cancelChannel(id);
    if (!res.ok && res.code === "TRADE_ALREADY_DONE") { emit({ busy: false }); return refresh(); } // 완료가 먼저였다 — 반영한다
    tx("trade.unlock", { channelId: id });
    stopWatching();
    channelId = null;
    emit({ ...EMPTY, ...(res.ok ? {} : { error: { code: res.code } }) });
  };

  const stop = (): void => {
    stopWatching();
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
  };

  return { view: () => state, start, create, join, offer, ready, unready, leave, refresh, stop };
}

