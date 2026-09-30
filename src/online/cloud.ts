// 클라우드 저장 — 로그인한 계정에 save.json 사본을 올리고 받는다. 두 PC 규칙 상태기계
// 설계는 worklog-mac/records/cloud-authority/design-p1.md 2절(전이표), 10절(결정), 11절(서버 계약)
//
// Electron 을 모른다. 공유 클라이언트와 파일 입출력(동기화 정보·저장 읽기·바꾸기)을 받는다.
//   한 계정은 한 번에 한 PC 만 활성이다 — claim_device 로 활성이 되고 60초마다 touch_device 로 살아 있음을 알린다
//   서버 저장이 정본이다. 맞출 때 서버 rev 가 더 새것이면 받는다(로컬은 백업). 고르기 창은 없다
//   올리기: 주기 저장(tick)은 2분에 한 번, 사건(event)은 약 1초 모아 바로. 멱등 키(pendingOp)는 재시도에 다시 쓴다
//   밀려남(superseded): 로그아웃하지 않는다(D19). cloud.json 에 표시하고 다음 실행은 서버 저장을 받는다
//   게임을 멈춰야 하는 상태(superseded·confirm·blocked)는 onHalt 로 앱에 알린다
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// cloud.json — save.json 과 같은 폴더. save.json 에는 필드를 더하지 않는다
export interface CloudSyncState {
  deviceId: string; // 설치마다 한 번 만드는 무작위 ID
  userId: string | null; // 이 저장을 올리는 계정. 로그아웃하면 null
  owner: string | null; // 로컬 저장이 속한 계정. 로그아웃해도 유지. 서버와 맞춘 계정으로 바뀐다
  syncedRev: number; // 마지막으로 서버와 맞춘 rev
  dirty: boolean; // 마지막 올리기 뒤 저장이 바뀌었다
  lastSavedAt: number | null; // 마지막으로 올린 시각
  superseded: boolean; // 다른 PC 에 밀려났다 — 다음 실행은 rev 와 무관하게 서버 저장을 받는다
  pendingOp: string | null; // 보냈지만 결과를 모르는 올리기의 멱등 키 — 다시 보낼 때 같은 키
}

//   off              로그인하지 않았거나 멈췄다
//   connecting       활성 기기로 만드는 중
//   online           하트비트·자동 저장이 돈다
//   offline          서버에 닿지 못한다 — 재시도한다. 진행은 다시 연결되면 자동으로 올린다
//   confirm          연결 끊긴 다른 PC 를 넘겨받을지 사용자 확인을 기다린다(G2) — 게임 멈춤
//   blocked          교환이 걸려 넘겨받지 못한다 — 게임 멈춤
//   update-required  서버가 이 앱 버전을 받지 않는다 — 게임은 계속, 올리기만 멈춤(10절 Q6)
//   superseded       다른 PC 에 밀려났다 — 끝 상태, 앱은 안내 뒤 종료
export type CloudStatus = "off" | "connecting" | "online" | "offline" | "confirm" | "blocked" | "update-required" | "superseded";

// boot: 앱을 켤 때·로그인할 때. late: 오프라인으로 켠 뒤 처음 서버에 닿을 때(F3)
export type CloudMode = "boot" | "late";
// tick: 주기 저장(2분 스로틀). event: 교환·부화 등 사건(약 1초 모아 바로)
export type SaveKind = "tick" | "event";
export type HaltReason = "superseded" | "confirm" | "blocked";

// 넘겨받거나 확인·양보할 상대 PC
export interface OtherDevice {
  label: string | null; // 안내 문구용 PC 이름
  seen: number | null; // 상대가 마지막으로 서버에 닿은 시각(ms)
}

export interface HaltInfo {
  other: OtherDevice | null; // 밀려남 신호·양보·확인이면 상대 PC. 모르면 null
  code: string | null; // blocked 일 때 CLOUD_TRADE_ACTIVE · CLOUD_TRADE_UNSYNCED
}

export interface CloudView {
  status: CloudStatus;
  lastSavedAt: number | null;
  busy: boolean;
  // 마지막 실패 코드 또는 올리기를 막은 이유
  //   CLOUD_OWNER_OTHER  로컬 저장이 다른 계정 것이고 이 계정 서버 저장이 없다 — 올리지 않는다(10절 Q1)
  //   CLOUD_BAD_SAVE     받은 서버 저장을 읽지 못했다 — 올리지 않는다
  error: string | null;
  other: OtherDevice | null; // confirm·blocked·superseded 일 때 상대 PC
}

export interface CloudIo {
  loadState: () => unknown; // cloud.json 내용 — 없거나 읽지 못하면 null. 옛 형식도 받는다(readCloudState)
  saveState: (state: CloudSyncState) => void;
  readSave: () => Record<string, unknown> | null; // 지금 로컬 저장(JSON 객체)
  // 받은 저장으로 로컬 저장을 바꾼다. 바꾸기 전 로컬 저장을 백업한다. 검사에 실패하면 false
  replaceSave: (save: Record<string, unknown>) => boolean;
}

export interface CloudOptions {
  client: SupabaseClient;
  io: CloudIo;
  appVersion: string;
  deviceLabel: string; // 안내 문구용 PC 이름
  onView: (view: CloudView) => void;
  onHalt: (reason: HaltReason, info: HaltInfo) => void; // 게임을 멈춰야 한다 — 앱이 안내·확인 창을 띄운다
  heartbeatMs?: number; // 하트비트 간격 (기본 60초)
  throttleMs?: number; // 주기 저장 올리기 최소 간격 (기본 2분)
  eventDelayMs?: number; // 사건 저장을 모으는 시간 (기본 1초)
  retryMs?: number; // 오프라인일 때 다시 연결을 시도하는 간격 (기본 60초)
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Cloud {
  view: () => CloudView;
  start: (userId: string, mode: CloudMode) => Promise<void>; // 로그인했거나 로그인한 채 켰다
  noteSaved: (kind: SaveKind) => void; // 로컬 저장을 썼다
  confirm: (go: boolean) => Promise<void>; // confirm·blocked 답 — go 면 다시 넘겨받기(confirm 은 force), 아니면 멈춤(앱 종료)
  sleep: () => Promise<void>; // 잠금·절전 직전 — 올리고 잠듦을 알린 뒤 하트비트를 멈춘다
  wake: () => Promise<void>; // 잠금 해제·깨어남 — 아직 활성인지 보고 하트비트를 다시 돌린다
  release: (timeoutMs?: number) => Promise<void>; // 정상 종료 — 올리고 released 를 알린 뒤 멈춘다(최대 timeoutMs)
  // 세션 종료(OS 끄기·로그오프·업데이트 설치) 직전 — 올리고 released 를 알리되 멈추지 않는다(최대 timeoutMs).
  // 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다
  announceRelease: (timeoutMs?: number) => Promise<void>;
  released: () => boolean; // announceRelease 로 released 를 알린 뒤 아직 active 로 되돌리지 않았다
  unsaved: () => "none" | "dirty"; // 끄기·로그아웃 전 확인용 — 온라인이고 올리지 않은 진행이 있다
  flush: () => Promise<void>; // 온라인이고 바뀌었으면 지금 한 번 올린다
  stop: (forget?: boolean) => void; // 멈춤. forget 이면 로그아웃 — userId 만 지우고 owner 는 남긴다
}

const NETWORK = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i;
const codeOf = (error: { message?: string } | null | undefined): string => {
  const message = (error?.message ?? "").trim();
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1]) return m[1];
  return NETWORK.test(message) ? "NETWORK" : "UNKNOWN";
};

// cloud.json 읽기 — 옛 형식(owner·superseded·pendingOp 없음, offlineDirty 있음)도 받는다
//   옛 파일의 owner 는 올리던 계정(userId)으로 본다. 로그아웃 상태였으면 null(10절 Q1 의 작은 구멍 허용)
export function readCloudState(raw: unknown): CloudSyncState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.deviceId !== "string" || typeof s.syncedRev !== "number" || typeof s.dirty !== "boolean") return null;
  const userId = typeof s.userId === "string" ? s.userId : null;
  return {
    deviceId: s.deviceId,
    userId,
    owner: "owner" in s ? (typeof s.owner === "string" ? s.owner : null) : userId,
    syncedRev: s.syncedRev,
    dirty: s.dirty,
    lastSavedAt: typeof s.lastSavedAt === "number" ? s.lastSavedAt : null,
    superseded: s.superseded === true,
    pendingOp: typeof s.pendingOp === "string" ? s.pendingOp : null,
  };
}

interface ClaimRow {
  outcome: "claimed" | "yield" | "confirm";
  rev: number | string | null;
  updated_at: string | null;
  has_save: boolean | null;
  other_label: string | null;
  other_seen: string | null;
}
interface TouchRow {
  active: boolean;
  rev: number | string | null;
}

export function createCloud(o: CloudOptions): Cloud {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const heartbeatMs = o.heartbeatMs ?? 60_000;
  const throttleMs = o.throttleMs ?? 120_000;
  const eventDelayMs = o.eventDelayMs ?? 1_000;
  const retryMs = o.retryMs ?? 60_000;

  let state: CloudSyncState = readCloudState(o.io.loadState()) ?? {
    deviceId: randomUUID(), userId: null, owner: null, syncedRev: 0, dirty: false, lastSavedAt: null, superseded: false, pendingOp: null,
  };
  let status: CloudStatus = "off";
  let busy = false;
  let error: string | null = null;
  let held: string | null = null; // 올리기를 막은 이유 — CLOUD_OWNER_OTHER · CLOUD_BAD_SAVE
  let other: OtherDevice | null = null;
  let userId: string | null = null;
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
  const view = (): CloudView => ({ status, lastSavedAt: state.lastSavedAt, busy, error: held ?? error, other });
  const emit = (): void => o.onView(view());
  const set = (next: CloudStatus, err: string | null = error): void => {
    status = next;
    error = err;
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
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; code: string }> => {
    try {
      const { data, error: e } = await o.client.rpc(fn, args);
      if (e) return { ok: false, code: codeOf(e) };
      return { ok: true, data: data as T };
    } catch (e) {
      return { ok: false, code: codeOf({ message: e instanceof Error ? e.message : String(e) }) };
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
  const updateRequired = (): void => {
    generation += 1;
    clearTimers();
    unwatch();
    busy = false;
    set("update-required", "CLOUD_UPDATE_REQUIRED");
  };

  const block = (code: string): void => {
    clearTimers();
    busy = false;
    set("blocked", code);
    o.onHalt("blocked", { other, code });
  };

  const goOffline = (code: string): void => {
    clearUpload();
    clearBeat();
    busy = false;
    set("offline", code);
    scheduleRetry();
  };

  // 공통 실패 처리 — 처리했으면 true
  const failed = (code: string): boolean => {
    if (code === "NETWORK") goOffline(code);
    else if (code === "CLOUD_UPDATE_REQUIRED") updateRequired();
    else if (code === "CLOUD_NOT_ACTIVE") supersede(null);
    else if (code === "CLOUD_TRADE_ACTIVE" || code === "CLOUD_TRADE_UNSYNCED") block(code);
    else if (code === "CLOUD_LOGIN_REQUIRED") {
      generation += 1;
      clearTimers();
      busy = false;
      set("off", code);
    } else return false;
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
        const done = setTimer(resolve, 5_000); // 구독이 늦으면 기다리지 않는다 — 하트비트·올리기 실패로도 안다
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
    if (!save) return false;
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
    const res = await rpc<number | string>("upload_save", {
      p_device: state.deviceId, p_base_rev: state.syncedRev, p_save: save,
      p_save_v: typeof save.v === "number" ? save.v : 3, p_app_version: o.appVersion, p_op: op,
    });
    if (gen !== generation) return false;
    busy = false;
    lastUploadAt = now();
    if (res.ok) {
      // 다시 쓴 키면 서버에 든 것이 지금 저장인지 모른다 — 새 키로 한 번 더 올린다
      state = { ...state, syncedRev: Number(res.data), pendingOp: null, dirty: reused || seq !== mark, lastSavedAt: now() };
      persist();
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
    if (!failed(res.code)) set(status, res.code);
    return false;
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
      if (!failed(res.code)) set(status, res.code);
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
    state = { ...state, userId: uid, owner: uid, syncedRev: rev, dirty: false, pendingOp: null, superseded: false };
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
  };

  // ── 연결 ──

  const scheduleRetry = (): void => {
    clearRetry();
    if (asleep) return; // 깨어날 때 다시 시도한다
    retryTimer = setTimer(() => { retryTimer = null; void reconnect(); }, retryMs);
  };

  const reconnect = async (): Promise<void> => {
    if (!userId || status !== "offline") return;
    if (!claimedOnce) {
      await claim(userId);
      return;
    }
    // 이미 활성이 된 적이 있다 — 넘겨받지 않고 아직 활성인지만 본다
    const gen = generation;
    const r = await touch("active");
    if (gen !== generation) return;
    if (!r.ok) {
      if (!failed(r.code)) goOffline(r.code);
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

  const claim = async (uid: string): Promise<void> => {
    const gen = generation;
    if (status !== "offline") set("connecting", null);
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
        goOffline(r.code);
      } else if (!failed(r.code)) {
        clearTimers();
        set("off", r.code);
      }
      return;
    }
    const row = r.data[0];
    if (!row) {
      goOffline("UNKNOWN");
      return;
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
    state = { ...state, owner: uid, superseded: false };
    persist();
    goOnline();
    if (state.dirty) await upload();
  };

  // ── 공개 API ──

  const start: Cloud["start"] = async (uid, m) => {
    stop(false);
    generation += 1;
    userId = uid;
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
    if (status === "offline") {
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

  const release: Cloud["release"] = async (timeoutMs = 3_000) => {
    const work = async (): Promise<void> => {
      if (status !== "online") return;
      clearBeat();
      await flush();
      if (status === "online") await touch("released");
    };
    let timer: unknown = null;
    await Promise.race([work(), new Promise<void>((r) => { timer = setTimer(r, timeoutMs); })]);
    if (timer) clearTimer(timer);
    if (status === "superseded") {
      clearTimers();
      unwatch();
      return;
    }
    stop(false);
  };

  const announceRelease: Cloud["announceRelease"] = async (timeoutMs = 3_000) => {
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
    let timer: unknown = null;
    await Promise.race([work(), new Promise<void>((r) => { timer = setTimer(r, timeoutMs); })]);
    if (timer) clearTimer(timer);
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

  return { view, start, noteSaved, confirm, sleep, wake, release, announceRelease, released: () => releasedFlag, unsaved, flush, stop };
}
