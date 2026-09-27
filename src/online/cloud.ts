// 클라우드 저장 — 로그인한 계정에 save.json 사본을 올리고 받는다. 설계는 docs/work/trade/record.md "클라우드 저장"
//
// Electron 을 모른다. 공유 클라이언트와 파일 입출력(동기화 정보·저장 읽기·바꾸기)을 받는다.
//   로컬 save.json 이 정본이다. 한 계정은 한 번에 한 PC 만 활성이다 — 나중에 켠 PC 가 claim_device 로 활성이 된다
//   온라인이면 저장이 바뀌고 30초 뒤에 올린다. 오프라인에서 한 진행은 자동으로 올리지 않는다 — 다시 연결되면 "저장 필요"
//   다른 PC 가 활성이 되면(kicked 신호·CLOUD_NOT_ACTIVE) 이 PC 는 로그아웃한다. 그 뒤 올리지 않는다
//   로그인할 때 서버 저장이 있으면 사용자가 고른다(pendingChoice). 고르지 않은 쪽은 백업으로 남긴다
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// cloud.json — save.json 과 같은 폴더. save.json 에는 필드를 더하지 않는다
export interface CloudSyncState {
  deviceId: string; // 설치마다 한 번 만드는 무작위 ID
  userId: string | null; // 이 저장을 올리는 계정. 로그아웃하면 null
  syncedRev: number; // 마지막으로 서버와 맞춘 rev
  dirty: boolean; // 마지막 올리기 뒤 저장이 바뀌었다
  offlineDirty: boolean; // 오프라인일 때 바뀐 진행이 있다 — 저장 버튼으로만 올린다
  lastSavedAt: number | null; // 마지막으로 올린 시각
}

//   off          로그인하지 않았다 — 저장 버튼이 없다
//   connecting   활성 기기로 만드는 중
//   choose       로그인했고 서버 저장이 있다 — 사용자가 고를 때까지 올리지 않는다
//   online       자동 저장이 돈다
//   offline      서버에 닿지 못한다 — 저장 버튼을 누를 수 없다
//   save-needed  다시 연결됐고 오프라인 진행이 있다 — 자동 저장을 멈추고 저장 버튼을 기다린다
export type CloudStatus = "off" | "connecting" | "choose" | "online" | "offline" | "save-needed";

export interface SaveSummary {
  pets: number;
  points: number;
  savedAt: number | null;
}

export interface CloudView {
  status: CloudStatus;
  lastSavedAt: number | null;
  busy: boolean;
  error: string | null; // 마지막 실패 코드 — CLOUD_TRADE_ACTIVE 등
  choice: { server: SaveSummary; local: SaveSummary | null } | null; // status 가 choose 일 때
}

export interface CloudIo {
  loadState: () => CloudSyncState | null;
  saveState: (state: CloudSyncState) => void;
  readSave: () => Record<string, unknown> | null; // 지금 로컬 저장(JSON 객체)
  // 받은 저장으로 로컬 저장을 바꾼다. 바꾸기 전 로컬 저장을 백업한다. 검사에 실패하면 false
  replaceSave: (save: Record<string, unknown>) => boolean;
  backupServer: (save: Record<string, unknown>) => void; // 고르지 않은 서버 저장을 백업 파일로 남긴다
}

export interface CloudOptions {
  client: SupabaseClient;
  io: CloudIo;
  appVersion: string;
  deviceLabel: string; // 안내 문구용 PC 이름
  onView: (view: CloudView) => void;
  onKicked: () => void; // 다른 PC 가 활성이 됐다 — 앱이 이 PC 를 로그아웃하고 배너를 보인다
  uploadDelayMs?: number; // 바뀐 뒤 올리기까지 (기본 30초)
  retryMs?: number; // 오프라인일 때 다시 연결을 시도하는 간격 (기본 60초)
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Cloud {
  view: () => CloudView;
  start: (userId: string) => Promise<void>; // 로그인했거나 로그인한 채 켰다
  noteSaved: () => void; // 거래 실행기가 저장했다
  saveNow: () => Promise<boolean>; // 저장 버튼
  choose: (which: "server" | "local") => Promise<boolean>; // 로그인 때 서버·이 PC 저장 고르기
  unsaved: () => "none" | "dirty" | "save-needed"; // 로그아웃 전 확인용
  flush: () => Promise<void>; // 끄기·잠금 직전 — 온라인이고 바뀌었으면 한 번 올린다
  stop: (forget?: boolean) => void; // 로그아웃 — forget 이면 이 저장과 계정의 연결을 끊는다
}

const NETWORK = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|abort|timeout/i;
const codeOf = (error: { message?: string } | null | undefined): string => {
  const message = (error?.message ?? "").trim();
  const m = /(CLOUD_[A-Z_]+)/.exec(message);
  if (m?.[1]) return m[1];
  return NETWORK.test(message) ? "NETWORK" : "UNKNOWN";
};

export function summaryOf(save: Record<string, unknown> | null, savedAt: number | null = null): SaveSummary | null {
  if (!save) return null;
  const pets = Array.isArray(save.pets) ? save.pets.length : 0;
  const points = typeof (save.points as { balance?: unknown } | undefined)?.balance === "number" ? (save.points as { balance: number }).balance : 0;
  // 저장 v3 은 마지막으로 쓴 시각을 최상위 savedAt 에 둔다
  return { pets, points, savedAt: savedAt ?? (typeof save.savedAt === "number" ? save.savedAt : null) };
}

export function createCloud(o: CloudOptions): Cloud {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const uploadDelay = o.uploadDelayMs ?? 30_000;
  const retryDelay = o.retryMs ?? 60_000;

  let state: CloudSyncState = o.io.loadState() ?? { deviceId: randomUUID(), userId: null, syncedRev: 0, dirty: false, offlineDirty: false, lastSavedAt: null };
  let status: CloudStatus = "off";
  let busy = false;
  let error: string | null = null;
  let choice: CloudView["choice"] = null;
  let serverCopy: { save: Record<string, unknown>; rev: number } | null = null;
  let uploadTimer: unknown = null;
  let retryTimer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  let userId: string | null = null;
  // 이 PC 에서 막 로그인해 서버와 맞추기(첫 올리기 또는 선택)가 아직 끝나지 않았다.
  // 끝나기 전에는 cloud.json 에 계정을 적지 않는다 — 도중에 끄거나 오프라인이 돼도 다음에 다시 묻는다
  let loginPending = false;
  // 이번 실행에서 활성 기기가 된 적이 있다. 그 뒤 다시 연결할 때는 넘겨받지(claim) 않고 아직 활성인지만 본다
  // — 끊긴 사이 사용자가 옮겨 간 PC 를 되찾아 밀어내지 않게(2026-09-27 검수 R3-02)
  let claimedOnce = false;
  let uploading: Promise<boolean> | null = null; // 올리기는 한 번에 하나 — 같은 base_rev 로 겹쳐 올리지 않게(R3-03)
  let generation = 0; // stop 뒤에 늦게 끝난 요청이 상태를 되살리지 않게

  const persist = (): void => o.io.saveState(state);
  const view = (): CloudView => ({ status, lastSavedAt: state.lastSavedAt, busy, error, choice });
  const emit = (): void => o.onView(view());
  const set = (next: CloudStatus, err: string | null = error): void => {
    status = next;
    error = err;
    emit();
  };
  const clearTimers = (): void => {
    if (uploadTimer) clearTimer(uploadTimer);
    if (retryTimer) clearTimer(retryTimer);
    uploadTimer = null;
    retryTimer = null;
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

  const goOffline = (code: string): void => {
    set("offline", code);
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (userId) void connect(userId, loginPending, !claimedOnce);
    }, retryDelay);
  };

  const kicked = (): void => {
    if (status === "off") return;
    stop(true);
    o.onKicked();
  };

  // 밀려남 신호를 듣는다. 구독이 끝난 뒤에 돌아온다 — 활성 기기가 되기(claim) 전에 들어야
  // 그 사이 다른 PC 가 넘겨받은 신호를 놓치지 않는다. 신호는 저장되지 않는다(2026-09-27 자체 검사)
  const watchKicked = async (uid: string): Promise<void> => {
    if (unsubscribe) return;
    try {
      await o.client.realtime.setAuth();
      const ch = o.client
        .channel(`account:${uid}`, { config: { private: true } })
        .on("broadcast", { event: "kicked" }, (msg: { payload?: { device?: unknown } }) => {
          if (msg.payload?.device && msg.payload.device !== state.deviceId) kicked();
        })
      unsubscribe = () => void o.client.removeChannel(ch);
      await new Promise<void>((resolve) => {
        const done = setTimer(resolve, 5_000); // 구독이 늦으면 기다리지 않는다 — 올리기 실패로도 안다
        ch.subscribe((s: string) => {
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
            clearTimer(done);
            resolve();
          }
        });
      });
    } catch (e) {
      console.error("계정 신호 구독에 실패했다 — 올리기 실패(CLOUD_NOT_ACTIVE)로 밀려남을 안다", e);
    }
  };

  // 진행 중인 올리기가 있으면 끝나기를 기다린다. 그사이 또 바뀌었으면 한 번 더 올린다
  const upload = (): Promise<boolean> => {
    if (uploading) return uploading.then((ok) => (state.dirty && (status === "online" || status === "save-needed") ? upload() : ok));
    const run = uploadOnce().finally(() => { uploading = null; });
    uploading = run;
    return run;
  };

  const uploadOnce = async (): Promise<boolean> => {
    const save = o.io.readSave();
    if (!save) return false;
    const gen = generation;
    busy = true;
    emit();
    const res = await rpc<number>("upload_save", {
      p_device: state.deviceId, p_base_rev: state.syncedRev, p_save: save,
      p_save_v: typeof save.v === "number" ? save.v : 3, p_app_version: o.appVersion,
    });
    if (gen !== generation) return false;
    busy = false;
    if (res.ok) {
      state = { ...state, syncedRev: Number(res.data), dirty: false, offlineDirty: false, lastSavedAt: now() };
      persist();
      set("online", null);
      return true;
    }
    if (res.code === "CLOUD_NOT_ACTIVE") {
      kicked();
      return false;
    }
    if (res.code === "NETWORK") {
      goOffline(res.code);
      return false;
    }
    if (res.code === "CLOUD_REV_CONFLICT" && userId) {
      // 서버가 더 새것이다 — 넘겨받지 않고 다시 맞춘다(서버 저장을 받는다). 이 올리기를 끝낸 뒤에 돈다 — 기다리면 서로 기다린다
      void connect(userId, loginPending, false);
      return false;
    }
    set(status, res.code);
    return false;
  };

  const scheduleUpload = (): void => {
    if (uploadTimer || status !== "online") return;
    uploadTimer = setTimer(() => {
      uploadTimer = null;
      if (status === "online" && state.dirty) void upload();
    }, uploadDelay);
  };

  // 서버 저장을 받는다. 활성 기기가 아니면 밀려난 것이다. save 가 null 이면 아직 올린 적이 없다
  const download = async (): Promise<{ save: Record<string, unknown> | null; rev: number } | "failed"> => {
    const res = await rpc<{ save: Record<string, unknown> | null; rev: number }[]>("download_save", { p_device: state.deviceId });
    if (!res.ok) {
      if (res.code === "CLOUD_NOT_ACTIVE") kicked();
      else if (res.code === "NETWORK") goOffline(res.code);
      else set(status, res.code);
      return "failed";
    }
    const row = res.data[0];
    return { save: row?.save ?? null, rev: Number(row?.rev ?? 0) };
  };

  // 서버와 맞춘다. login 이면 이 PC 에서 막 로그인했다(선택 대화상자).
  // reclaim 이면 활성 기기가 된다(켤 때·로그인할 때). 아니면 넘겨받지 않고 아직 활성인지만 본다(다시 연결·rev 충돌)
  const connect = async (uid: string, login: boolean, reclaim = true): Promise<void> => {
    const gen = generation;
    set(status === "offline" || status === "save-needed" ? status : "connecting");
    await watchKicked(uid);
    if (gen !== generation) return;
    let rev = 0;
    let hasSave = false;
    let savedAt: number | null = null;
    let got: { save: Record<string, unknown> | null; rev: number } | null = null;
    if (reclaim) {
      const claimed = await rpc<{ rev: number; updated_at: string; has_save: boolean }[]>("claim_device", { p_device: state.deviceId, p_label: o.deviceLabel });
      if (gen !== generation) return;
      if (!claimed.ok) {
        if (claimed.code === "NETWORK" || claimed.code === "CLOUD_TRADE_ACTIVE") goOffline(claimed.code);
        else set("off", claimed.code);
        return;
      }
      claimedOnce = true;
      const server = claimed.data[0];
      rev = Number(server?.rev ?? 0);
      hasSave = server?.has_save === true;
      savedAt = server?.updated_at ? Date.parse(server.updated_at) || null : null;
    } else {
      const d = await download(); // 활성이 아니면 여기서 밀려난다
      if (gen !== generation || d === "failed") return;
      got = d;
      rev = d.rev;
      hasSave = d.save != null;
    }

    if (login) {
      if (!hasSave) {
        finishLogin(uid, rev);
        set("online", null);
        await upload(); // 그 계정의 첫 저장
        return;
      }
      const g = got ?? (await download());
      if (gen !== generation || g === "failed" || !g.save) return;
      serverCopy = { save: g.save, rev: g.rev };
      choice = { server: summaryOf(g.save, savedAt)!, local: summaryOf(o.io.readSave()) };
      set("choose", null);
      return;
    }

    if (rev > state.syncedRev) {
      // 서버가 더 새것 — 로컬에 올리지 않은 진행이 있어도 바꾼다(사용자 결정 "오프라인으로 놀다가 덮어써지면 유감이지 뭐")
      const g = got ?? (await download());
      if (gen !== generation || g === "failed") return;
      if (g.save && !o.io.replaceSave(g.save)) {
        set("online", "CLOUD_BAD_SAVE");
        return;
      }
      state = { ...state, syncedRev: g.rev, dirty: false, offlineDirty: false };
      persist();
      set("online", null);
      return;
    }
    if (state.offlineDirty) {
      set("save-needed", null);
      return;
    }
    set("online", null);
    if (state.dirty) await upload(); // 온라인 중에 바뀌었지만 끄기 전에 못 올린 진행
  };

  // 로그인 맞추기가 끝났다 — 이제 계정을 적는다. 이어서 올릴 것으로 둔다: 첫 올리기가 실패해도 다음 실행에서 올린다(R3-05)
  const finishLogin = (uid: string, rev: number): void => {
    loginPending = false;
    state = { ...state, userId: uid, syncedRev: rev, dirty: true };
    persist();
  };

  const start: Cloud["start"] = async (uid) => {
    stop(false);
    generation += 1;
    userId = uid;
    claimedOnce = false;
    loginPending = state.userId !== uid; // 이 PC 에서 새로 로그인했다(다른 계정이었거나 로그아웃 상태였다)
    if (loginPending) {
      state = { ...state, userId: null, syncedRev: 0, dirty: false, offlineDirty: false, lastSavedAt: null };
      persist();
    }
    await connect(uid, loginPending);
  };

  const noteSaved: Cloud["noteSaved"] = () => {
    if (status === "off" || status === "choose") return;
    // 오프라인 진행은 오프라인 상태에서 바뀐 것만이다 — 켤 때 연결하는 동안의 주기 저장은 넣지 않는다(R3-01)
    if (status === "offline") state = { ...state, dirty: true, offlineDirty: true };
    else state = { ...state, dirty: true };
    persist();
    if (status === "online") scheduleUpload();
    emit();
  };

  const saveNow: Cloud["saveNow"] = async () => {
    if (status !== "online" && status !== "save-needed") return false;
    if (uploadTimer) clearTimer(uploadTimer);
    uploadTimer = null;
    return upload();
  };

  const choose: Cloud["choose"] = async (which) => {
    if (status !== "choose" || !serverCopy) return false;
    const copy = serverCopy;
    serverCopy = null;
    choice = null;
    if (which === "server") {
      if (!o.io.replaceSave(copy.save)) {
        // 고르기 창을 그대로 두고 오류를 보인다 — 다른 쪽을 고를 수 있다(R3-06)
        serverCopy = copy;
        choice = { server: summaryOf(copy.save)!, local: summaryOf(o.io.readSave()) };
        set("choose", "CLOUD_BAD_SAVE");
        return false;
      }
      finishLogin(userId!, copy.rev);
      state = { ...state, dirty: false, offlineDirty: false, lastSavedAt: now() };
      persist();
      set("online", null);
      return true;
    }
    o.io.backupServer(copy.save);
    finishLogin(userId!, copy.rev);
    set("online", null);
    return upload();
  };

  const unsaved: Cloud["unsaved"] = () => (status === "save-needed" ? "save-needed" : state.dirty && status === "online" ? "dirty" : "none");

  const flush: Cloud["flush"] = async () => {
    if (uploading) await uploading;
    if (status === "online" && state.dirty) await upload();
  };

  const stop: Cloud["stop"] = (forget = false) => {
    generation += 1;
    clearTimers();
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    serverCopy = null;
    choice = null;
    busy = false;
    if (forget) {
      userId = null;
      state = { ...state, userId: null, dirty: false, offlineDirty: false };
      persist();
    }
    if (status !== "off") set("off", null);
  };

  return { view, start, noteSaved, saveNow, choose, unsaved, flush, stop };
}
