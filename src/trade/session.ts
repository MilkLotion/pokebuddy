// 친구 교환 흐름 — 서버 호출(src/trade/net.ts)과 로컬 거래(trade.lock·unlock·apply)를 잇는다.
// 설계는 worklog/records/trade/record.md "전체 구조", "로컬 저장과 복구", "실시간 알림"
//
// Electron 을 모른다. 거래 실행과 저장 읽기를 받아서 쓴다. 화면은 onView 로 받은 보기만 그린다.
//   확정    로컬 잠금(trade.lock) → 서버 확정(set_ready). 서버가 거절하면 잠금을 푼다
//   완료    서버가 done 이면 친구 제안으로 trade.apply → ack_applied. 반영은 pending 이 있을 때만 된다
//   닫힘    cancelled·expired 면 trade.unlock
//   복구    앱을 켜면 pending 의 채널을 다시 읽는다. 연결 실패면 걸어 둔 채 5분마다 다시 본다
//   로그인  익명 계정은 만들기·참가·제안을 먼저 거절한다(login-required). 판정을 넘기지 않으면 서버 오류(TRADE_LOGIN_REQUIRED)로 같은 거절이 된다
//   제안    올리기 직전 클라우드 저장을 올린다(beforeOffer). 서버 저장에 그 개체가 아직 없으면 save-wait 로 거절한다
//           (worklog-mac/records/cloud-authority/design-p2.md 4절 원장, 13절 서버 계약)
import { offerable, pendingOf, refOf, snapshot, validateReceived, type ReceiveFailure, type TradePet } from "./core.js";
import { tokenOf, type ChannelView, type TradeNet } from "./net.js";
import type { TradeCode } from "../shared/names/online-codes.js";
import type { TxResult } from "../shared/command";
import type { SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export type TradePhase = "idle" | "hosting" | "trading" | "done" | "closed";

export interface TradeViewModel {
  phase: TradePhase;
  link: string | null; // 내가 만든 링크 (hosting)
  channel: ChannelView | null;
  myPetId: string | null; // 내가 올린 개체
  friendPet: TradePet | null; // 검사를 통과한 친구 제안
  friendBlocked: ReceiveFailure | null; // 친구 제안이 검사에 걸린 이유
  received: { petId: string } | null; // 완료 뒤 받은 개체
  error: { code: TradeCode | "LOCAL"; detail?: string } | null;
  busy: boolean;
  refreshedBy: RefreshReason | null; // 마지막 새로 고침을 부른 것 — 실시간 신호가 도착했는지 확인할 때 본다
  refreshedAt: number | null;
}

export type RefreshReason = "signal" | "poll" | "direct" | "recover";

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
  beforeApply?: () => boolean | void; // 개발용 시험 장치 — 서버 완료 뒤 로컬 반영 직전에 부른다. true 면 반영하지 않고 멈춘다(앱을 끝내 재시작 복구를 재현한다)
  now?: () => number;
  // 서버에 반영을 알렸다(ack_applied) — 앱은 이 뒤에 저장을 한 번 더 바로 올린다.
  // 서버는 반영 시각보다 늦게 올라온 저장이 있어야 이 교환을 저장된 것으로 본다 (design-p1.md 1절 trade_unsynced)
  onSettled?: () => void;
  // 새 교환(만들기·참가)을 막아야 하는가 — 로그인 계정의 클라우드 저장이 서버와 맞춰지지 않았다.
  // 나중에 서버 저장을 받으면 그 사이의 교환 결과가 덮인다 (worklog-mac/records/cloud-authority 검수 1)
  hold?: () => boolean | Promise<boolean>;
  // 지금 세션이 익명 계정인가 — 참이면 만들기·참가·제안을 서버에 보내지 않고 login-required 로 거절한다.
  // 넘기지 않으면 서버가 거절한다(TRADE_LOGIN_REQUIRED → 같은 login-required)
  isAnonymous?: () => boolean | Promise<boolean>;
  // 제안 직전 — 앱은 클라우드 저장을 바로 올린다(cloud.flush). 서버는 서버 저장에 있는 개체만 제안으로 받는다.
  // 실패해도 제안은 보낸다. 서버 저장에 없으면 서버가 TRADE_PET_NOT_SYNCED 로 거절한다
  beforeOffer?: () => Promise<void>;
  // 세션이 없을 때 새 익명 계정을 만들어도 되는가 — 거짓이면 있는 세션만 쓴다(검수 H1). 넘기지 않으면 참.
  //   앱은 저장 계정을 잃었거나(D29) 저장 주인이 있는데 세션이 없을 때 거짓을 준다. 익명 발급은 앱(src/main/online.ts)이 맡는다
  mayIssue?: () => boolean | Promise<boolean>;
}

// 조작 결과 — 거절 이유를 돌려준다. 보기의 error 는 서버·로컬 실패만 담는다
//   busy        다른 조작이 진행 중
//   no-channel  채널이 없다
//   not-ready   확정할 수 없다 (내 제안·검사를 통과한 친구 제안이 없다)
//   in-trade    진행 중인 교환이 있다 — 나가기 뒤에 새로 만든다
//   stopped     세션이 멈췄다
//   cloud-wait  로그인 계정의 클라우드 저장이 연결되어 올릴 수 있는 상태가 아니다 — 새 교환을 시작하지 않는다
//   login-required  익명 계정이다 — 교환은 로그인해야 한다 (클라이언트 판정 또는 서버 TRADE_LOGIN_REQUIRED)
//   save-wait   올린 개체가 아직 서버 저장에 없다 — 저장이 끝나면 다시 올린다 (서버 TRADE_PET_NOT_SYNCED)
export type TradeRefusal = ReasonOf<"busy" | "no-channel" | "not-ready" | "in-trade" | "stopped" | "cloud-wait" | "login-required" | "save-wait">;
export type TradeActionResult = { ok: true } | { ok: false; reason: TradeCode | "LOCAL" | TradeRefusal; detail?: string };

export interface TradeSession {
  view: () => TradeViewModel;
  start: () => Promise<void>; // 로그인 확보와 복구
  create: () => Promise<TradeActionResult>;
  join: (link: string) => Promise<TradeActionResult>;
  offer: (petId: string) => Promise<TradeActionResult>;
  ready: () => Promise<TradeActionResult>;
  unready: () => Promise<TradeActionResult>;
  leave: () => Promise<TradeActionResult>;
  refresh: (reason?: RefreshReason) => Promise<void>;
  stop: () => void;
}

const EMPTY: TradeViewModel = {
  phase: "idle", link: null, channel: null, myPetId: null, friendPet: null, friendBlocked: null, received: null, error: null, busy: false,
  refreshedBy: null, refreshedAt: null,
};

const OK: TradeActionResult = { ok: true };

// 서버 오류 가운데 사용자가 할 일이 정해진 것 — 보기 오류가 아니라 거절 이유로 돌려준다
//   TRADE_PET_TRADED·TRADE_PET_BUSY(다른 활성 교환에 올라가 있음, D31)는 보기 오류로 둔다. 제안 전이라 로컬 잠금은 없다
const REFUSAL_OF: Partial<Record<TradeCode, TradeRefusal>> = {
  TRADE_LOGIN_REQUIRED: "login-required",
  TRADE_PET_NOT_SYNCED: "save-wait",
};

export function createTradeSession(o: TradeSessionOptions): TradeSession {
  let state: TradeViewModel = { ...EMPTY };
  let channelId: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let pollTimer: unknown = null;
  let retryTimer: unknown = null;
  let stopped = false;
  let seq = 0;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const newId = o.newId ?? (() => `trade-${Date.now()}-${++seq}`);
  const now = o.now ?? Date.now;

  const emit = (patch: Partial<TradeViewModel>): void => {
    state = { ...state, ...patch };
    o.onView(state);
  };
  const fail = (code: TradeCode | "LOCAL", detail?: string): TradeActionResult => {
    emit({ error: { code, ...(detail ? { detail } : {}) }, busy: false });
    return { ok: false, reason: code, ...(detail ? { detail } : {}) };
  };
  const refuse = (reason: TradeRefusal): TradeActionResult => ({ ok: false, reason });
  // 조작 도중의 거절 — begin 이 켠 busy 를 끈다
  const release = (reason: TradeRefusal): TradeActionResult => { emit({ busy: false }); return refuse(reason); };
  // 서버 실패 — 거절 이유로 옮길 수 있으면 옮기고, 아니면 보기 오류로 둔다
  const failNet = (code: TradeCode, detail?: string): TradeActionResult => {
    const reason = REFUSAL_OF[code];
    return reason ? release(reason) : fail(code, detail);
  };
  const anonymous = async (): Promise<boolean> => {
    try {
      return (await o.isAnonymous?.()) === true;
    } catch (e) {
      console.error("교환 전 계정 확인에 실패해 서버 판정에 맡긴다", e);
      return false;
    }
  };
  const tx = (name: string, args: Record<string, unknown>): TxResult => o.run(newId(), name, args);
  const session = async (): ReturnType<TradeNet["ensureSession"]> => {
    let issue = true;
    try {
      issue = (await o.mayIssue?.()) !== false;
    } catch (e) {
      console.error("익명 발급 여부를 읽지 못해 있는 세션만 쓴다", e);
      issue = false;
    }
    return o.net.ensureSession(issue);
  };
  const closedPhase = (): boolean => state.phase === "done" || state.phase === "closed";

  const stopWatching = (): void => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (pollTimer) clearTimer(pollTimer);
    pollTimer = null;
  };

  const watch = async (id: string): Promise<void> => {
    stopWatching();
    if (stopped) return;
    const poll = (): void => {
      pollTimer = setTimer(() => {
        void refresh("poll").finally(() => {
          if (!stopped && channelId === id && !closedPhase()) poll();
        });
      }, o.pollMs ?? 30_000);
    };
    poll();
    // 실시간 구독이 실패해도 주기 새로 고침으로 이어 간다
    try {
      const off = await o.net.subscribe(id, () => void refresh("signal"));
      if (stopped || channelId !== id) off();
      else unsubscribe = off;
    } catch (e) {
      console.error("교환 실시간 구독에 실패해 주기 새로 고침만 쓴다", e);
    }
  };

  // 서버가 끝났다고 알린 채널을 로컬에 맞춘다
  const settle = async (view: ChannelView): Promise<void> => {
    if (view.status === "done") {
      if ((o.read() ? pendingOf(o.read()!) : null)?.channelId === view.id && o.beforeApply?.() === true) return;
      const res = tx("trade.apply", { channelId: view.id, received: view.friend_offer });
      if (!res.ok) { fail("LOCAL", String(res.reason)); return; }
      const result = res.result as { applied: boolean; petId?: string };
      const ack = await o.net.ackApplied(view.id);
      if (ack.ok) o.onSettled?.();
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
  // 다시 도는 새로 고침은 마지막으로 부른 이유를 적는다
  let running: Promise<void> | null = null;
  let next: RefreshReason | null = null;
  const refresh = async (why: RefreshReason = "direct"): Promise<void> => {
    if (stopped) return;
    next = why;
    if (running) return running;
    running = (async () => {
      while (next && !stopped) {
        const reason = next;
        next = null;
        await refreshOnce(reason);
      }
    })().finally(() => { running = null; });
    return running;
  };

  const refreshOnce = async (reason: RefreshReason): Promise<void> => {
    const id = channelId;
    if (!id) return;
    const res = await o.net.getChannel(id);
    if (id !== channelId || stopped) return;
    if (!res.ok) { fail(res.code, res.detail); return; }
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
    emit({ channel: view, friendPet, friendBlocked, phase: view.status === "open" ? "hosting" : view.status === "joined" ? "trading" : state.phase, error: null, refreshedBy: reason, refreshedAt: now() });
    await settle(view);
  };

  const scheduleRetry = (): void => {
    if (stopped) return;
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => { retryTimer = null; void start(); }, o.retryMs ?? 5 * 60_000);
  };

  // 시작 — 로그인 확보와 복구. 도는 동안 busy 로 두어 새 채널 만들기·참가와 겹치지 않게 한다
  const start: TradeSession["start"] = async () => {
    if (stopped) return;
    if (state.busy) { scheduleRetry(); return; } // 조작 중 — 다음 재시도에 본다
    emit({ busy: true });
    const s = await session();
    if (stopped) return;
    const save = o.read();
    const pending = save ? pendingOf(save) : null;
    if (!s.ok) {
      // 세션이 없고 만들지 않는다 — 복구할 교환이 없으면 기다릴 것이 없다. 계정이 바뀌면 앱이 세션을 새로 만든다
      if (s.code === "TRADE_LOGIN_REQUIRED" && !pending) { emit({ busy: false }); return; }
      fail(s.code, s.detail);
      scheduleRetry();
      return;
    }
    if (!pending) { emit({ busy: false }); return; }
    // 반영하지 않은 교환을 이어 간다
    const res = await o.net.getChannel(pending.channelId);
    if (stopped) return;
    if (!res.ok) {
      if (res.code === "TRADE_NOT_FOUND") {
        tx("trade.unlock", { channelId: pending.channelId }); // 채널 없음 — 풀어 준다(설계의 30일 정리 뒤 위험)
        emit({ busy: false });
        return;
      }
      fail(res.code, res.detail);
      scheduleRetry();
      return;
    }
    channelId = pending.channelId;
    emit({ phase: res.data.status === "done" ? "done" : "trading", channel: res.data, myPetId: pending.petId, error: null, busy: false, refreshedBy: "recover", refreshedAt: now() });
    if (res.data.status === "joined") await watch(pending.channelId);
    await settle(res.data);
  };

  const begin = (): TradeActionResult | null => {
    if (stopped) return refuse("stopped");
    if (state.busy) return refuse("busy");
    emit({ busy: true, error: null });
    return null;
  };

  const create: TradeSession["create"] = async () => {
    if (channelId && !closedPhase()) return refuse("in-trade");
    if (await o.hold?.()) return refuse("cloud-wait");
    const no = begin();
    if (no) return no;
    const s = await session();
    if (!s.ok) return failNet(s.code, s.detail);
    if (await anonymous()) return release("login-required");
    const res = await o.net.createChannel(o.protocol, o.dataVersion);
    if (!res.ok) return failNet(res.code, res.detail);
    stopWatching();
    channelId = res.data.channelId;
    emit({ ...EMPTY, phase: "hosting", link: o.linkOf(res.data.token), busy: false });
    await watch(res.data.channelId);
    return OK;
  };

  const join: TradeSession["join"] = async (link) => {
    if (channelId && !closedPhase()) return refuse("in-trade");
    if (await o.hold?.()) return refuse("cloud-wait");
    const no = begin();
    if (no) return no;
    const token = tokenOf(link);
    if (!token) return fail("TRADE_LINK_INVALID");
    const s = await session();
    if (!s.ok) return failNet(s.code, s.detail);
    if (await anonymous()) return release("login-required");
    const res = await o.net.joinChannel(token, o.protocol, o.dataVersion);
    if (!res.ok) return failNet(res.code, res.detail);
    stopWatching();
    channelId = res.data;
    emit({ ...EMPTY, phase: "trading", busy: false });
    await watch(res.data);
    return OK;
  };

  const offer: TradeSession["offer"] = async (petId) => {
    if (!channelId || closedPhase()) return refuse("no-channel");
    const no = begin();
    if (no) return no;
    const first = o.read();
    if (!first) return fail("LOCAL", "no-save");
    const check = offerable(first, petId);
    if (!check.ok) return fail("LOCAL", check.reason);
    if (await anonymous()) return release("login-required");
    // 서버 저장을 먼저 맞춘다. 실패해도 보낸다 — 서버 저장에 없으면 서버가 save-wait 로 돌려준다
    try {
      await o.beforeOffer?.();
    } catch (e) {
      console.error("제안 전 클라우드 저장 올리기에 실패했다", e);
    }
    if (stopped) return release("stopped");
    // 올리는 동안 바뀌었을 수 있다 — 다시 읽어 보낸다
    const save = o.read();
    if (!save) return fail("LOCAL", "no-save");
    const ok = offerable(save, petId);
    if (!ok.ok) return fail("LOCAL", ok.reason);
    const res = await o.net.setOffer(channelId, snapshot(ok.pet), refOf(ok.pet));
    if (!res.ok) return failNet(res.code, res.detail);
    emit({ myPetId: petId, busy: false });
    await refresh();
    return OK;
  };

  const ready: TradeSession["ready"] = async () => {
    const view = state.channel;
    if (!channelId || closedPhase() || !view) return refuse("no-channel");
    if (!state.myPetId || !state.friendPet) return refuse("not-ready");
    const no = begin();
    if (no) return no;
    const locked = tx("trade.lock", { channelId, petId: state.myPetId, offerRev: view.offer_rev });
    if (!locked.ok) return fail("LOCAL", String(locked.reason));
    const res = await o.net.setReady(channelId, view.offer_rev);
    if (!res.ok) {
      if (res.code !== "TRADE_ALREADY_DONE") tx("trade.unlock", { channelId });
      if (res.code === "TRADE_OFFER_CHANGED") {
        emit({ busy: false });
        await refresh();
        return { ok: false, reason: res.code };
      }
      return failNet(res.code, res.detail);
    }
    emit({ busy: false });
    await refresh();
    return OK;
  };

  const unready: TradeSession["unready"] = async () => {
    if (!channelId || closedPhase()) return refuse("no-channel");
    const no = begin();
    if (no) return no;
    const res = await o.net.setReady(channelId, null);
    if (!res.ok) return fail(res.code, res.detail);
    tx("trade.unlock", { channelId });
    emit({ busy: false });
    await refresh();
    return OK;
  };

  const leave: TradeSession["leave"] = async () => {
    const id = channelId;
    if (!id || closedPhase()) {
      if (state.busy) return refuse("busy");
      stopWatching();
      channelId = null;
      emit({ ...EMPTY });
      return OK;
    }
    const no = begin();
    if (no) return no;
    const res = await o.net.cancelChannel(id);
    if (!res.ok && res.code === "TRADE_ALREADY_DONE") { // 완료가 먼저였다 — 반영한다
      emit({ busy: false });
      await refresh();
      return { ok: false, reason: res.code };
    }
    tx("trade.unlock", { channelId: id });
    stopWatching();
    channelId = null;
    emit({ ...EMPTY, ...(res.ok ? {} : { error: { code: res.code } }) });
    return res.ok ? OK : { ok: false, reason: res.code };
  };

  const stop = (): void => {
    stopped = true;
    stopWatching();
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
  };

  return { view: () => state, start, create, join, offer, ready, unready, leave, refresh, stop };
}
