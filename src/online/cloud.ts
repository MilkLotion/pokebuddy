// 클라우드 저장 — 로그인한 계정에 save.json 사본을 올리고 받는다. 두 PC 규칙 상태기계
// 설계는 worklog-mac/records/cloud-authority/design-p1.md 2절(전이표), 10절(결정), 11절(서버 계약)
//
// Electron 을 모른다. 공유 클라이언트와 파일 입출력(동기화 정보·저장 읽기·바꾸기)을 받는다.
//   한 계정은 한 번에 한 PC 만 활성이다 — claim_device 로 활성이 되고 60초마다 touch_device 로 살아 있음을 알린다
//   서버 저장이 정본이다. 맞출 때 서버 rev 가 더 새것이면 받는다(로컬은 백업). 고르기 창은 없다
//   올리기: 주기 저장(tick)은 2분에 한 번, 사건(event)은 약 1초 모아 바로. 멱등 키(pendingOp)는 재시도에 다시 쓴다
//   밀려남(superseded): 로그아웃하지 않는다(D19). cloud.json 에 표시하고 다음 실행은 서버 저장을 받는다
//   게임을 멈춰야 하는 상태(superseded·confirm·blocked)는 onHalt 로 앱에 알린다
//
// P2 익명 계정 저장 (design-p2.md 2절·13절)
//   익명 계정도 같은 상태기계를 쓴다 — start(uid, mode, "anonymous"). 서버 행은 개체가 있는 첫 올리기에서 생긴다(base_rev 0)
//   로컬 개체가 0 이면 올리지 않는다(스타터 고르기 전). 서버의 CLOUD_EMPTY_SAVE 는 무시한다
//   CLOUD_PET_TRADED_OUT: 보내는 사이 로컬이 바뀌었으면 지금 저장으로 다시 올린다. 아니면 서버 저장을 다시 올려 보고
//     받아지면 그 저장으로 바꾼다(로컬 백업). 그 저장도 거부되면 덮지 않고 올리기를 막는다(held). 로컬이 바뀌면 한 번 다시 올린다
//   CLOUD_LOGIN_REQUIRED(계정이 지워졌다): 멈추고 onLost(ownerKind) — 게임은 계속, 창은 앱 몫(D29)
//   익명 저장 이관: 실패한 티켓은 cloud.json.handoff 에 남기고 정식 계정 start 때 claim 전에 다시 옮긴다
import { randomUUID } from "node:crypto";
import { adoptAnonymous } from "./handoff.js";
import { cloudCodeOf as codeOf } from "./codes.js";
import type { CloudCode, CloudErrorCode } from "../shared/names/online-codes.js";
import { callRpc, isUnreachable, messageOf, readFunctionError, withTimeout } from "./server-call.js";
import { ONLINE_TIMING } from "./timing.js";
import {
  freshCloudState, hasPets, normalizeCloudState,
  type ClaimRow, type Cloud, type CloudMode, type CloudOptions, type CloudStatus, type CloudSyncState, type CloudView, type OtherDevice, type OwnerKind, type TouchRow,
} from "./cloud-state.js";


export function createCloud(o: CloudOptions): Cloud {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const heartbeatMs = o.heartbeatMs ?? ONLINE_TIMING.heartbeatMs;
  const throttleMs = o.throttleMs ?? ONLINE_TIMING.uploadThrottleMs;
  const eventDelayMs = o.eventDelayMs ?? ONLINE_TIMING.eventDelayMs;
  const retryMs = o.retryMs ?? ONLINE_TIMING.retryMs;

  let state: CloudSyncState = normalizeCloudState(o.io.loadState()) ?? freshCloudState(randomUUID());
  let status: CloudStatus = "off";
  let busy = false;
  let error: CloudErrorCode | null = null;
  let errorDetail: string | null = null; // error 가 UNKNOWN 일 때 서버가 준 원래 코드
  let held: CloudErrorCode | null = null; // 올리기를 막은 이유 — CLOUD_OWNER_OTHER · CLOUD_BAD_SAVE · CLOUD_PET_TRADED_OUT
  let heldSeq = 0; // CLOUD_PET_TRADED_OUT 로 막을 때의 seq — 로컬 저장이 바뀌면 한 번 다시 올린다
  let other: OtherDevice | null = null;
  let userId: string | null = null;
  let kind: OwnerKind = "member"; // 지금 돌리는 계정의 종류
  let tradedOut = false; // CLOUD_PET_TRADED_OUT 로 서버 저장을 받았다 — 또 거부되면 올리기를 막는다
  let mode: CloudMode = "boot"; // 다음 claim 의 방식 — 첫 연결이 실패하면 late(F3)
  let force = false; // 사용자가 연결 끊긴 PC 넘겨받기를 승인했다
  // 이번 실행에서 활성 기기가 된 적이 있다. 그 뒤 다시 연결할 때는 넘겨받지(claim) 않고 아직 활성인지만 본다(R3-02)
  let claimedOnce = false;
  // 넘겨받은 뒤 서버 저장 받기(맞추기)를 끝냈다. 받기가 실패해 오프라인이 되면 다시 연결할 때 맞추기를 다시 한다 — 로컬을 먼저 올리지 않게
  let reconciled = true;
  let claiming = false; // claim_device 응답을 기다린다 — 그사이 온 밀려남 신호는 기록만 한다
  let kickedDuring: OtherDevice | null = null; // claim 중에 받은 밀려남 신호의 상대 PC
  let releasedFlag = false; // announceRelease 뒤 아직 active 로 되돌리지 않았다
  let releaseSeq = 0; // announceRelease 횟수 — 그 전에 보낸 하트비트의 응답이 released 표시를 지우지 않게
  let asleep = false; // 잠금·절전 중 — 하트비트·자동 올리기를 멈춘다
  let generation = 0; // stop·밀려남 뒤에 늦게 끝난 요청이 상태를 되살리지 않게
  let uploading: Promise<boolean> | null = null; // 올리기는 한 번에 하나 — 같은 base_rev 로 겹쳐 올리지 않게(R3-03)
  let uploadTimer: unknown = null;
  let uploadDue = 0;
  let beatTimer: unknown = null;
  let retryTimer: unknown = null;
  let lastUploadAt = 0; // 주기 저장 스로틀 기준
  let seq = 0; // 저장이 바뀐 횟수 — 올리는 동안 또 바뀌었는지 본다
  let unsubscribe: (() => void) | null = null;

  const persist = (): void => o.io.saveState(state);
  const view = (): CloudView => ({ status, lastSavedAt: state.lastSavedAt, busy, error: held ?? error, errorDetail: held ? null : errorDetail, other });
  const emit = (): void => o.onView(view());
  // err 를 넘기지 않으면 오류와 그 detail 을 그대로 둔다. 새 오류면 detail 도 새로 받는다
  const set = (next: CloudStatus, err: CloudErrorCode | null = error, detail: string | null = err === error ? errorDetail : null): void => {
    status = next;
    error = err;
    errorDetail = detail;
    emit();
  };
  const clearUpload = (): void => {
    if (uploadTimer) clearTimer(uploadTimer);
    uploadTimer = null;
  };
  const clearBeat = (): void => {
    if (beatTimer) clearTimer(beatTimer);
    beatTimer = null;
  };
  const clearRetry = (): void => {
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
  };
  const clearTimers = (): void => {
    clearUpload();
    clearBeat();
    clearRetry();
  };
  const unwatch = (): void => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  };
  const rpc = <T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: CloudCode; detail?: string }> =>
    callRpc<T, CloudCode>(o.client, fn, args, codeOf);
  // 올리기 — Edge Function upload-save 를 거친다(서버 검증 P4a, worklog/records/cloud-authority/record.md "P4 서버 검증").
  // 답은 RPC 와 같은 모양으로 바꾼다. 오류 본문 { error: "CLOUD_…" } 의 코드를 쓴다.
  // 502·503·504·전송 실패는 NETWORK(오프라인, 같은 키로 다시 시도). 그 밖(토큰 무효 AUTH_TOKEN·SERVER_ERROR)은 UNKNOWN — 계정 분실로도 오프라인으로도 보지 않는다
  const sendSave = async (a: { device: string; baseRev: number; save: Record<string, unknown>; op: string }): Promise<{ ok: true; data: number } | { ok: false; code: CloudCode; detail?: string }> => {
    try {
      const { data, error: e } = await o.client.functions.invoke("upload-save", {
        body: { device: a.device, baseRev: a.baseRev, save: a.save, saveV: typeof a.save.v === "number" ? a.save.v : 3, appVersion: o.appVersion, op: a.op },
      });
      if (e) {
        if ((e as { context?: unknown }).context instanceof Response) {
          const f = await readFunctionError(e);
          if (f.bodyCode?.startsWith("CLOUD_")) return { ok: false, ...codeOf({ message: f.bodyCode }) };
          return { ok: false, code: isUnreachable(f) ? "NETWORK" : "UNKNOWN" };
        }
        const name = (e as { name?: unknown }).name;
        return name === "FunctionsFetchError" || name === "FunctionsRelayError" ? { ok: false, code: "NETWORK" } : { ok: false, ...codeOf(e) };
      }
      const rev = (data as { rev?: unknown } | null)?.rev;
      return typeof rev === "number" ? { ok: true, data: rev } : { ok: false, code: "UNKNOWN" };
    } catch (e) {
      return { ok: false, ...codeOf({ message: messageOf(e) }) };
    }
  };
  const otherOf = (label: string | null | undefined, seen: string | null | undefined): OtherDevice | null =>
    label || seen ? { label: label ?? null, seen: seen ? Date.parse(seen) || null : null } : null;

  // ── 멈춤 상태 ──

  // 밀려났다 — 로그아웃하지 않는다(D19). 다음 실행은 서버 저장을 받는다
  const supersede = (who: OtherDevice | null): void => {
    if (status === "off" || status === "superseded") return;
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    state = { ...state, superseded: true, pendingOp: null };
    persist();
    other = who;
    set("superseded", null);
    o.onHalt("superseded", { other: who, code: null });
  };

  // 서버가 이 버전을 받지 않는다 — 타이머를 멈추고 dirty 는 남긴다. 게임은 계속
  //   다시 연결 간격마다 다시 확인한다 — 서버의 최소 버전이 내려가면 풀린다
  const updateRequired = (): void => {
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    set("update-required", "CLOUD_UPDATE_REQUIRED");
    scheduleRetry();
  };

  const block = (code: CloudErrorCode): void => {
    clearTimers();
    busy = false;
    set("blocked", code);
    o.onHalt("blocked", { other, code });
  };

  const goOffline = (code: CloudErrorCode, detail: string | null = null): void => {
    if (state.accountHeld) {
      accountHeld(); // 정지된 계정 — 서버에 닿지 못해도 풀렸는지 모르므로 멈춘다
      return;
    }
    clearUpload();
    clearBeat();
    busy = false;
    set("offline", code, detail);
    scheduleRetry();
  };

  // 계정이 서버에서 사라졌다(이관 뒤 옛 익명 토큰·정리·삭제) — 멈추고 앱에 알린다. 게임은 계속(D29)
  const lose = (): void => {
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    set("off", "CLOUD_LOGIN_REQUIRED");
    o.onLost?.(kind);
  };

  // 이용 정지(P4c, D35) — 타이머를 멈추고 적어 둔 뒤 앱에 알린다. 앱은 게임을 멈추고 정지 창을 띄운 뒤 끝낸다
  //   거부 모드의 CLOUD_SAVE_REJECTED 도 같다 — 서버가 거부하면서 계정을 정지했다
  const accountHeld = (): void => {
    if (status === "held") return;
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    // 맞춘 rev 를 잊는다 — 풀린 뒤 첫 맞추기가 서버 저장(마지막 정상 저장)을 받는다. 거부된 로컬 진행을 다시 올리지 않게(검수 P4c H1)
    state = { ...state, accountHeld: true, pendingOp: null, syncedRev: -1 };
    persist();
    set("held", "CLOUD_ACCOUNT_HELD");
    o.onHalt("held", { other: null, code: "CLOUD_ACCOUNT_HELD" });
  };

  // 공통 실패 처리 — 처리했으면 true
  const failed = (code: string): boolean => {
    if (code === "CLOUD_ACCOUNT_HELD" || code === "CLOUD_SAVE_REJECTED") accountHeld();
    else if (code === "NETWORK") goOffline(code);
    else if (code === "CLOUD_UPDATE_REQUIRED") updateRequired();
    else if (code === "CLOUD_NOT_ACTIVE") supersede(null);
    else if (code === "CLOUD_TRADE_ACTIVE" || code === "CLOUD_TRADE_UNSYNCED") block(code);
    else if (code === "CLOUD_LOGIN_REQUIRED") lose();
    else return false;
    return true;
  };

  // ── 밀려남 신호 ──

  // 구독이 끝난 뒤에 돌아온다 — 활성 기기가 되기(claim) 전에 들어야 그 사이 다른 PC 가 넘겨받은 신호를 놓치지 않는다
  const watchKicked = async (uid: string): Promise<void> => {
    if (unsubscribe) return;
    try {
      await o.client.realtime.setAuth();
      const ch = o.client
        .channel(`account:${uid}`, { config: { private: true } })
        .on("broadcast", { event: "kicked" }, (msg: { payload?: { device?: unknown; label?: unknown } }) => {
          const p = msg.payload;
          if (!p?.device || p.device === state.deviceId) return;
          const who = { label: typeof p.label === "string" ? p.label : null, seen: null };
          // 넘겨받는 중이다 — 두 PC 가 같이 켜졌으면 이 신호가 이 PC 의 claim 보다 먼저 보낸 것일 수 있다.
          // 기록만 하고 claim 뒤에 아직 활성인지 보고 판정한다
          if (claiming) kickedDuring = who;
          else supersede(who);
        });
      unsubscribe = () => void o.client.removeChannel(ch);
      await new Promise<void>((resolve) => {
        const done = setTimer(resolve, ONLINE_TIMING.subscribeWaitMs); // 구독이 늦으면 기다리지 않는다 — 하트비트·올리기 실패로도 안다
        ch.subscribe((s: string) => {
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
            clearTimer(done);
            resolve();
          }
        });
      });
    } catch (e) {
      console.error("계정 신호 구독에 실패했다 — 하트비트·올리기 실패(CLOUD_NOT_ACTIVE)로 밀려남을 안다", e);
    }
  };

  // ── 올리기 ──

  const canUpload = (): boolean => status === "online" && !held;

  // 진행 중인 올리기가 있으면 끝나기를 기다린다. 그사이 또 바뀌었으면 한 번 더 올린다
  const upload = (): Promise<boolean> => {
    if (uploading) return uploading.then((ok) => (state.dirty && canUpload() ? upload() : ok));
    const run = uploadOnce().finally(() => { uploading = null; });
    uploading = run;
    return run;
  };

  const uploadOnce = async (): Promise<boolean> => {
    if (!canUpload()) return false;
    const save = o.io.readSave();
    if (!save || !hasPets(save)) return false; // 스타터 고르기 전 — dirty 는 남긴다
    // 시드를 아직 못 받았으면 올리기 전에 다시 받는다 — 첫 응답을 잃었을 때 계속 보통 난수로 알을 열지 않게(검수 P4b H2)
    if (state.userId && state.seedOwner !== state.userId) await fetchSeed();
    const gen = generation;
    const mark = seq;
    // 결과를 모르는 올리기가 있으면 그 키로 다시 보낸다 — 서버가 이미 썼으면 그때의 rev 를 돌려준다
    const reused = state.pendingOp != null;
    const op = state.pendingOp ?? randomUUID();
    if (!reused) {
      state = { ...state, pendingOp: op };
      persist();
    }
    busy = true;
    emit();
    const res = await sendSave({ device: state.deviceId, baseRev: state.syncedRev, save, op });
    if (gen !== generation) return false;
    busy = false;
    lastUploadAt = now();
    if (res.ok) {
      // 다시 쓴 키면 서버에 든 것이 지금 저장인지 모른다 — 새 키로 한 번 더 올린다
      state = { ...state, syncedRev: Number(res.data), pendingOp: null, dirty: reused || seq !== mark, lastSavedAt: now() };
      persist();
      tradedOut = false;
      set("online", null);
      if (state.dirty) schedule(eventDelayMs);
      return true;
    }
    if (res.code === "NETWORK") {
      goOffline(res.code); // 키는 남긴다 — 다시 연결되면 같은 키로 보낸다
      return false;
    }
    state = { ...state, pendingOp: null };
    persist();
    if (res.code === "CLOUD_REV_CONFLICT") {
      void resync(); // 서버가 더 새것이다 — 서버 저장을 받는다
      return false;
    }
    if (res.code === "CLOUD_EMPTY_SAVE") {
      set(status, null); // 개체 없는 저장 — 무시한다. 개체가 생기면 다시 올린다
      return false;
    }
    if (res.code === "CLOUD_PET_TRADED_OUT") {
      if (seq !== mark) {
        // 보내는 사이 로컬 저장이 바뀌었다(교환 반영 등) — 거부된 것은 옛 사본이다. 받지 않고 지금 저장으로 다시 올린다(검수 M1)
        set(status, null);
        schedule(eventDelayMs);
        return false;
      }
      if (tradedOut) {
        holdTradedOut(); // 서버 저장으로 맞춘 뒤에도 거부 — 더 올리지 않는다
        return false;
      }
      tradedOut = true;
      await settleTradedOut(gen, mark); // 교환으로 내보낸 개체가 남았다 — 서버 저장을 받을지 본다
      return false;
    }
    if (!failed(res.code)) set(status, res.code, res.detail ?? null);
    return false;
  };

  // 교환으로 내보낸 개체 때문에 올리기를 막는다. 로컬 저장이 바뀌면 noteSaved 가 한 번 다시 올린다
  const holdTradedOut = (): void => {
    held = "CLOUD_PET_TRADED_OUT";
    heldSeq = seq;
    set(status, null);
  };

  // CLOUD_PET_TRADED_OUT 첫 거부 — 서버 저장을 받되, 덮기 전에 그 저장이 지금 서버에서 받아지는지 먼저 본다(검수 M1)
  //   서버 저장을 그대로 다시 올려 본다(내용 같음, rev 만 오른다). 받아지면 로컬을 그 저장으로 바꾼다(로컬 백업)
  //   그 저장도 거부되면 로컬을 덮지 않고 막는다(held) — 옛 서버 저장으로 받은 포켓몬을 잃지 않게
  //   그사이 로컬이 바뀌었으면 덮지 않고 지금 저장으로 다시 올린다
  const settleTradedOut = async (gen: number, mark: number): Promise<void> => {
    const uid = userId;
    const g = await download();
    if (gen !== generation) return;
    if (g === "failed" || !uid) {
      tradedOut = false; // 판단하지 못했다 — 다시 연결한 뒤 올리기가 거부되면 처음부터 다시 본다
      return;
    }
    if (!g.save) {
      holdTradedOut(); // 받을 서버 저장이 없다
      return;
    }
    const probe = await sendSave({ device: state.deviceId, baseRev: g.rev, save: g.save, op: randomUUID() });
    if (gen !== generation) return;
    if (probe.ok) {
      if (seq !== mark) {
        // 로컬이 또 바뀌었다 — 덮지 않는다. 서버 rev 만 맞추고 지금 저장을 올린다
        tradedOut = false;
        state = { ...state, syncedRev: Number(probe.data), dirty: true };
        persist();
        set("online", null);
        schedule(eventDelayMs);
        return;
      }
      // 서버가 받은 저장으로 맞췄다 — 뒤에 또 거부되면 새 문제로 보고 처음부터 다시 판단한다
      tradedOut = false;
      adopt(uid, g.save, Number(probe.data));
      set("online", null);
      return;
    }
    if (probe.code === "CLOUD_PET_TRADED_OUT") {
      holdTradedOut();
      return;
    }
    tradedOut = false;
    if (!failed(probe.code)) set(status, probe.code, probe.detail ?? null);
  };

  // 올리기 타이머 — 더 이른 예약이 있으면 그것을 둔다
  const schedule = (delay: number): void => {
    if (!canUpload() || asleep) return;
    const due = now() + delay;
    if (uploadTimer && uploadDue <= due) return;
    clearUpload();
    uploadDue = due;
    uploadTimer = setTimer(() => {
      uploadTimer = null;
      if (state.dirty) void upload();
    }, delay);
  };

  // ── 받기 ──

  // 서버 저장을 받는다. 활성 기기가 아니면 밀려난 것이다. save 가 null 이면 아직 올린 적이 없다
  const download = async (): Promise<{ save: Record<string, unknown> | null; rev: number } | "failed"> => {
    const res = await rpc<{ save: Record<string, unknown> | null; rev: number | string }[]>("download_save", { p_device: state.deviceId });
    if (!res.ok) {
      if (!failed(res.code)) set(status, res.code, res.detail ?? null);
      return "failed";
    }
    const row = res.data[0];
    return { save: row?.save ?? null, rev: Number(row?.rev ?? 0) };
  };

  // 받은 저장으로 바꾼다. 읽지 못하면 올리기를 막는다 — 옛 사본으로 서버 저장을 덮지 않게
  const adopt = (uid: string, save: Record<string, unknown>, rev: number): boolean => {
    if (!o.io.replaceSave(save)) {
      held = "CLOUD_BAD_SAVE";
      state = { ...state, userId: uid };
      persist();
      return false;
    }
    held = null;
    state = { ...state, userId: uid, owner: uid, ownerKind: kind, syncedRev: rev, dirty: false, pendingOp: null, superseded: false };
    persist();
    return true;
  };

  // 활성인데 rev 가 어긋났다 — 서버 저장을 받는다
  const resync = async (): Promise<void> => {
    const gen = generation;
    const uid = userId;
    const g = await download();
    if (gen !== generation || g === "failed" || !uid) return;
    if (g.save) adopt(uid, g.save, g.rev);
    else {
      state = { ...state, syncedRev: g.rev, dirty: true };
      persist();
    }
    set("online", null);
    if (state.dirty) schedule(eventDelayMs);
  };

  // ── 하트비트 ──

  const touch = async (presence: "active" | "asleep" | "released") => {
    const mark = releaseSeq;
    const r = await rpc<TouchRow[]>("touch_device", { p_device: state.deviceId, p_app_version: o.appVersion, p_presence: presence });
    // released 를 알린 뒤 계속 돌아 active 로 되돌렸다. 알리기 전에 보낸 하트비트의 응답이면 표시를 그대로 둔다
    if (r.ok && presence === "active" && r.data[0]?.active && mark === releaseSeq) releasedFlag = false;
    return r;
  };

  const startBeat = (): void => {
    clearBeat();
    if (status !== "online" || asleep) return;
    beatTimer = setTimer(() => { beatTimer = null; void beat(); }, heartbeatMs);
  };

  const beat = async (): Promise<void> => {
    if (status !== "online" || asleep) return;
    const gen = generation;
    const r = await touch("active");
    if (gen !== generation || status !== "online") return;
    if (!r.ok) {
      if (!failed(r.code)) startBeat(); // 알 수 없는 실패는 다음 하트비트에서 다시 본다
      return;
    }
    if (!r.data[0]?.active) supersede(null);
    else startBeat();
  };

  const goOnline = (): void => {
    clearRetry();
    set("online", null);
    if (asleep) void touch("asleep"); // 연결하는 사이 잠들었다 — 잠듦으로 알린다
    else startBeat();
    void fetchSeed();
  };

  // 계정 시드 받기(P4b) — 지금 계정의 시드가 없으면 한 번. 실패하면 다음에 온라인이 될 때 다시
  const fetchSeed = async (): Promise<void> => {
    const uid = state.userId;
    if (!uid || state.seedOwner === uid) return;
    const gen = generation;
    const r = await rpc<string>("account_seed", {});
    if (gen !== generation || state.userId !== uid || !r.ok || typeof r.data !== "string" || !r.data) return;
    state = { ...state, seed: r.data, seedOwner: uid };
    persist();
  };

  // ── 연결 ──

  const scheduleRetry = (): void => {
    clearRetry();
    if (asleep) return; // 깨어날 때 다시 시도한다
    retryTimer = setTimer(() => { retryTimer = null; void reconnect(); }, retryMs);
  };

  const reconnect = async (): Promise<void> => {
    if (!userId || (status !== "offline" && status !== "update-required")) return;
    if (!claimedOnce) {
      await claim(userId);
      return;
    }
    // 이미 활성이 된 적이 있다 — 넘겨받지 않고 아직 활성인지만 본다
    const gen = generation;
    const r = await touch("active");
    if (gen !== generation) return;
    if (!r.ok) {
      if (!failed(r.code)) goOffline(r.code, r.detail ?? null);
      return;
    }
    if (!r.data[0]?.active) {
      supersede(null);
      return;
    }
    if (!reconciled) {
      // 넘겨받은 뒤 서버 저장을 받지 못했다 — 로컬을 올리기 전에 다시 맞춘다. 받을 저장이 없으면 맞추기가 첫 저장으로 넘어간다
      await reconcile(userId, Number(r.data[0]?.rev ?? 0), true, gen);
      return;
    }
    goOnline();
    if (state.dirty) await upload(); // 오프라인 진행을 바로 올린다(저장 버튼 대기 없음)
  };

  // 남은 이관 티켓을 옮긴다 — 정식 계정 claim 전에. 계속해도 되면 true
  const settleHandoff = async (uid: string, gen: number): Promise<boolean> => {
    const h = state.handoff;
    if (!h || kind !== "member") return true;
    if (h.expiresAt <= now()) {
      // 서버도 CLOUD_HANDOFF_INVALID — 익명 저장은 옮기지 못한다. 주인은 익명 그대로(맞추기가 판단)
      state = { ...state, handoff: null };
      persist();
      return true;
    }
    const r = await adoptAnonymous(o.client, h.ticket);
    if (gen !== generation) return false;
    if (r.ok) {
      applyHandoff({ kind: "adopted", anon: h.anon, outcome: r.outcome, rev: r.rev }, uid);
      o.onHandoff?.(r.outcome);
      return true;
    }
    if (r.code === "CLOUD_HANDOFF_INVALID") {
      state = { ...state, handoff: null };
      persist();
      return true;
    }
    if (r.code === "CLOUD_LOGIN_REQUIRED") {
      lose();
      return false;
    }
    if (r.code === "CLOUD_ACCOUNT_HELD") {
      accountHeld(); // 검수 P4c M2
      return false;
    }
    // 망 오류·익명 계정의 열린 교환 — 티켓을 두고 다시 연결할 때 다시 시도한다
    if (r.code === "NETWORK" || r.code === "UNKNOWN") mode = "late";
    goOffline(r.code, r.detail ?? null);
    return false;
  };

  const claim = async (uid: string): Promise<void> => {
    const gen = generation;
    if (status !== "offline" && status !== "update-required") set("connecting", null); // 다시 확인하는 동안 표시를 바꾸지 않는다
    if (!(await settleHandoff(uid, gen))) return;
    await watchKicked(uid);
    if (gen !== generation) return;
    claiming = true;
    kickedDuring = null;
    const r = await rpc<ClaimRow[]>("claim_device", {
      p_device: state.deviceId, p_label: o.deviceLabel, p_app_version: o.appVersion, p_mode: mode, p_force: force,
    }).finally(() => { claiming = false; });
    const kicked = kickedDuring;
    kickedDuring = null;
    if (gen !== generation) return;
    if (!r.ok) {
      if (r.code === "NETWORK" || r.code === "UNKNOWN") {
        mode = "late"; // 첫 연결이 실패했다 — 닿을 때 활성 PC 가 온라인이면 이 PC 가 물러난다(F3, D20)
        goOffline(r.code, r.detail ?? null);
      } else if (!failed(r.code)) {
        clearTimers();
        set("off", r.code, r.detail ?? null);
      }
      return;
    }
    const row = r.data[0];
    if (!row) {
      goOffline("UNKNOWN");
      return;
    }
    if (state.accountHeld) {
      state = { ...state, accountHeld: false }; // claim 이 계정 확인(정지 확인)을 통과했다 — 정지가 풀렸다. 양보·확인이어도 같다(검수 P4c L4)
      persist();
    }
    other = otherOf(row.other_label, row.other_seen);
    if (row.outcome === "yield") {
      supersede(other);
      return;
    }
    if (row.outcome === "confirm") {
      clearTimers();
      set("confirm", null);
      o.onHalt("confirm", { other, code: null });
      return;
    }
    if (kicked) {
      // claim 중에 밀려남 신호를 받았다 — 지금도 활성인지 본다. 활성이 아니면 나중에 넘겨받은 PC 가 있다
      const t = await touch("active");
      if (gen !== generation) return;
      if (t.ok && !t.data[0]?.active) {
        supersede(kicked);
        return;
      }
      // 활성이면 이 PC 의 claim 전에 보낸 신호다 — 무시한다. 확인하지 못했으면 다음 하트비트·올리기가 판정한다
    }
    claimedOnce = true;
    await reconcile(uid, Number(row.rev ?? 0), row.has_save === true, gen);
  };

  // 넘겨받은 뒤 서버와 맞춘다 — 전이표 "맞추기"
  const reconcile = async (uid: string, rev: number, hasSave: boolean, gen: number): Promise<void> => {
    reconciled = false;
    const foreign = state.owner != null && state.owner !== uid;
    if (state.userId !== uid) {
      // 이 PC 에서 새로 로그인했다. 같은 계정 저장이면 맞춘 rev 를 이어 쓰고, 아니면 처음부터
      const same = state.owner === uid;
      state = { ...state, userId: uid, dirty: true, syncedRev: same ? state.syncedRev : 0, pendingOp: same ? state.pendingOp : null };
      persist();
    }
    if (hasSave && (state.superseded || foreign || rev !== state.syncedRev)) {
      // 서버 저장이 정본이다 — 로컬에 올리지 않은 진행이 있어도 바꾼다(G1, 로컬은 백업)
      const g = await download();
      if (gen !== generation || g === "failed") return; // reconciled 는 거짓으로 남는다 — 다시 연결할 때 다시 맞춘다
      if (g.save) {
        reconciled = true;
        adopt(uid, g.save, g.rev);
        goOnline();
        return;
      }
      rev = g.rev; // 그사이 비었다 — 아래 첫 저장으로
    }
    reconciled = true;
    if (!hasSave || state.syncedRev !== rev) {
      if (foreign) {
        // 다른 계정의 저장을 이 계정 첫 저장으로 올리지 않는다(10절 Q1). 새로 시작은 P2
        held = "CLOUD_OWNER_OTHER";
        goOnline();
        return;
      }
      state = { ...state, syncedRev: rev, dirty: true }; // 이 PC 저장을 이 계정 첫 저장으로(D11)
    }
    held = null;
    state = { ...state, owner: uid, ownerKind: kind, superseded: false };
    persist();
    goOnline();
    if (state.dirty) await upload();
  };

  // ── 공개 API ──

  const start: Cloud["start"] = async (uid, m, k = "member") => {
    stop(false);
    generation += 1;
    userId = uid;
    kind = k;
    tradedOut = false;
    mode = m;
    force = false;
    claimedOnce = false;
    reconciled = true;
    releasedFlag = false;
    asleep = false;
    lastUploadAt = 0;
    await claim(uid);
  };

  const noteSaved: Cloud["noteSaved"] = (kind) => {
    if (status === "off" || status === "superseded") return;
    seq += 1;
    if (held === "CLOUD_PET_TRADED_OUT" && seq !== heldSeq) {
      held = null; // 로컬 저장이 바뀌었다(교환 복구 등) — 한 번 다시 올린다. 또 거부되면 다시 막는다
      emit();
    }
    if (!state.dirty) {
      state = { ...state, dirty: true };
      persist();
      emit();
    }
    if (status === "online") schedule(kind === "event" ? eventDelayMs : Math.max(eventDelayMs, lastUploadAt + throttleMs - now()));
  };

  const confirm: Cloud["confirm"] = async (go) => {
    if (status !== "confirm" && status !== "blocked") return;
    if (!go || !userId) {
      stop(false); // 취소 — 앱이 종료한다(D22)
      return;
    }
    if (status === "confirm") force = true;
    await claim(userId);
  };

  const flush: Cloud["flush"] = async () => {
    clearUpload();
    if (uploading) await uploading;
    if (canUpload() && state.dirty) await upload();
  };

  const sleep: Cloud["sleep"] = async () => {
    if (asleep) return;
    asleep = true;
    clearUpload();
    clearBeat();
    clearRetry();
    if (status !== "online") return;
    await flush();
    if (status !== "online") return;
    const gen = generation;
    const r = await touch("asleep");
    if (gen !== generation) return;
    if (r.ok && !r.data[0]?.active) supersede(null);
  };

  const wake: Cloud["wake"] = async () => {
    if (!asleep) return;
    asleep = false;
    if (status === "offline" || status === "update-required") {
      clearRetry();
      await reconnect();
      return;
    }
    if (status !== "online") return;
    const gen = generation;
    const r = await touch("active");
    if (gen !== generation) return;
    if (!r.ok) {
      if (!failed(r.code)) startBeat();
      return;
    }
    if (!r.data[0]?.active) {
      supersede(null);
      return;
    }
    startBeat();
    if (state.dirty) schedule(eventDelayMs);
  };

  const release: Cloud["release"] = async (timeoutMs = ONLINE_TIMING.releaseWaitMs) => {
    const work = async (): Promise<void> => {
      if (status !== "online") return;
      clearBeat();
      await flush();
      if (status === "online") await touch("released");
    };
    await withTimeout(work(), timeoutMs, { setTimer, clearTimer });
    if (status === "superseded") {
      clearTimers();
      unwatch();
      return;
    }
    stop(false);
  };

  const announceRelease: Cloud["announceRelease"] = async (timeoutMs = ONLINE_TIMING.releaseWaitMs) => {
    const work = async (): Promise<void> => {
      if (status !== "online" || asleep) return;
      releasedFlag = true;
      releaseSeq += 1;
      clearBeat(); // 알리는 동안 새 하트비트를 보내지 않는다 — released 뒤에 active 가 도착하지 않게
      await flush();
      if (status !== "online") return;
      const gen = generation;
      const r = await touch("released");
      if (gen !== generation) return;
      if (r.ok && !r.data[0]?.active) {
        supersede(null);
        return;
      }
      startBeat(); // 하트비트를 처음부터 다시 센다 — 끄기가 취소되면 다음 하트비트가 active 로 되돌린다
    };
    await withTimeout(work(), timeoutMs, { setTimer, clearTimer });
  };

  const unsaved: Cloud["unsaved"] = () => (state.dirty && status === "online" && !held ? "dirty" : "none");

  const stop: Cloud["stop"] = (forget = false) => {
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    held = null;
    other = null;
    asleep = false;
    if (forget) {
      userId = null;
      state = { ...state, userId: null, dirty: false }; // owner·syncedRev·pendingOp 는 남긴다 — 같은 계정으로 다시 로그인하면 이어 쓴다
      persist();
    }
    if (status !== "off") set("off", null);
  };

  const owner: Cloud["owner"] = () => (state.owner ? { id: state.owner, kind: state.ownerKind } : null);

  const rebind: Cloud["rebind"] = (from, to, k = "member") => {
    if (status !== "off" || state.owner !== from || from === to) return false;
    // 올리지 않은 진행을 새 계정 첫 저장으로 올린다. 그 계정에 저장이 있으면 맞추기가 서버 저장을 받는다(D7)
    state = { ...state, owner: to, ownerKind: k, syncedRev: 0, pendingOp: null, dirty: true, superseded: false };
    persist();
    return true;
  };

  const applyHandoff: Cloud["applyHandoff"] = (report, to) => {
    if (report.kind === "none") return;
    if (report.kind === "pending") {
      state = { ...state, handoff: report.code === "CLOUD_HANDOFF_INVALID" ? null : report.handoff };
      persist();
      return;
    }
    if (state.handoff?.anon === report.anon) {
      state = { ...state, handoff: null };
      persist();
    }
    if (report.outcome === "empty" && state.owner === report.anon) {
      state = { ...state, owner: to, ownerKind: "member", syncedRev: 0, pendingOp: null, dirty: true, superseded: false };
      persist();
    }
  };

  const reset: Cloud["reset"] = () => {
    stop(false);
    userId = null;
    error = null;
    errorDetail = null;
    state = freshCloudState(state.deviceId);
    persist();
    emit();
  };

  return {
    view, start, noteSaved, confirm, sleep, wake, release, announceRelease, released: () => releasedFlag, unsaved, flush, stop,
    owner, synced: () => state.syncedRev, pendingHandoff: () => state.handoff, rebind, applyHandoff, reset,
    seed: () => (state.seed && state.owner && state.seedOwner === state.owner ? state.seed : null),
    held: () => state.accountHeld,
  };
}
