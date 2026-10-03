// 온라인 기능의 메인 쪽 입구 — 공유 Supabase 클라이언트, 계정, 클라우드 저장, GitHub 로그인을 묶는다.
// 설계는 worklog/records/trade/record.md "계정과 로그인", "클라우드 저장", "로그인·클라우드 저장 구현 계획"
// 두 PC 규칙(밀려남·확인·잠듦·released)은 worklog-mac/records/cloud-authority/design-p1.md 2·3절
//
// 교환(src/main/trade.ts)도 이 클라이언트를 쓴다 — 로그인하면 교환 채널도 그 계정으로 연다.
// 렌더러에는 계정 화면 값(AccountScreen)만 넘긴다. 토큰·내부 주소·사용자 ID 는 넘기지 않는다.
// 클라우드 동기화 정보는 save.json 과 같은 폴더의 cloud.json 이다. save.json 에는 필드를 더하지 않는다
//
// P2 수명주기 (worklog-mac/records/cloud-authority/design-p2.md 2절·12절·15절)
//   부팅: 세션 있음 → 그 계정(익명·로그인)으로 클라우드 시작. 모름(망 오류) → 60초 뒤 다시. 없음 + 저장 주인 있음 → 분실(D29).
//     없음 + 주인 없음 → 새 익명 계정. 익명 계정을 만들지 못하면(망·가입 제한) 게임은 로컬로 계속하고 60초 뒤 다시
//   로그인·가입·GitHub: 세션 교체 직전에 올리고 멈춘다 → 익명 저장 이관(handoff.ts) → 정식 계정으로 다시 시작. 실패하면 원래대로 다시 시작
//   로그아웃·삭제(D12): 올리고 released → 서버 처리 → save.json 을 백업으로 옮김 → cloud.json 비움 → 앱이 다시 켠다(선택 창)
//   분실(D29): 클라우드는 끄고 게임은 계속. 창은 앱이 띄우고, 답에 따라 continueLocal·fresh 를 부른다
import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOnlineClient } from "../online/client.js";
import { createAccount, viewOf, type Account, type AccountView } from "../online/account.js";
import { createCloud } from "../online/cloud.js";
import { normalizeCloudState, strayAnonymous, type Cloud, type CloudMode, type CloudView, type HaltInfo, type HaltReason, type OwnerKind, type SaveKind } from "../online/cloud-state.js";
import { githubLogin } from "../online/github.js";
import { handoffHooks, type HandoffReport, type SwitchHooks } from "../online/handoff.js";
import { createSessionGate, type SessionGate } from "../online/session.js";
import { withTimeout } from "../online/server-call.js";
import { ONLINE_TIMING } from "../online/timing.js";
import { onlineConfig } from "../online/config.js";
import type { SessionStorage } from "../online/client.js";
import { devEnv, devNumber } from "./app/dev-run.js";
import { writeAtomic } from "../platform/atomic-write.js";
import { readSaveRaw, replaceSave, setAsideSave } from "../save/save-file.js";
import { loadCloudState } from "../online/lost.js";
import { t } from "../view/text";
import type { AccountAction, AccountReply, AccountScreen } from "../shared/model/account";
import type { AccountReplyCode, CloudErrorCode } from "../shared/names/online-codes.js";

export interface MainOnlineOptions {
  saveFile: string;
  storage: SessionStorage; // 세션 파일 저장소 — 교환과 같은 한 벌을 앱이 넘긴다 (src/main/services/registry.ts)
  tradeBlocked: () => boolean; // 걸린 교환(열린 채널·반영하지 않은 교환)이 있다
  onUserChanged: () => void; // 로그인·로그아웃·익명 계정 발급 — 앱은 교환 세션을 새로 만든다
  onSaveReplaced: () => void; // 클라우드 저장을 받아 로컬 저장을 바꿨다 — 앱은 파티를 다시 읽는다
  // 게임을 멈춰야 한다 — superseded(밀려남, 안내 뒤 종료)·confirm(넘겨받기 확인)·blocked(교환 걸림).
  // 로그아웃하지 않는다(D19, 검수 F1) — 세션은 그대로 둔다
  onHalt: (reason: HaltReason, info: HaltInfo) => void;
  // 저장 계정을 잃었다(D29) — 클라우드는 꺼져 있고 게임은 계속. 앱이 분실 창을 띄운다.
  //   synced — 익명 계정이 서버에 한 번이라도 올렸다(되찾을 수 없는 서버 저장이 있다, G-c)
  onLost: (kind: OwnerKind, synced: boolean) => void;
  onNotice: (text: string) => void; // 알림 한 줄 — 이관으로 이 PC 진행을 백업했다 등
  onUpdateRequired: () => void; // 서버가 이 앱 버전을 거절했다(CLOUD_UPDATE_REQUIRED) — 앱이 바로 업데이트를 확인한다
  // 저장을 비우고 새로 시작하기 직전 — 앱은 메모리 진행을 쓰고 저장 쓰기·교환·우편을 멈춘다
  freeze: () => void;
  thaw: () => void; // 서버 처리가 실패해 새로 시작하지 않는다 — 앱은 멈춘 것을 되돌린다
  onRestart: () => void; // save.json 을 백업으로 옮기고 cloud.json 을 비웠다 — 앱은 다시 켠다
}

// 새로 시작하는 까닭 — 백업 파일 이름에 쓴다 (save.json.<까닭>-<시각>.bak)
//   signout 로그아웃, delete 계정 삭제, fresh 분실 창의 [처음부터]
export type FreshReason = "signout" | "delete" | "fresh";

export interface MainOnline {
  client: SupabaseClient;
  gate: SessionGate; // 세션 관문 — 교환(src/main/trade.ts)도 이것으로 세션을 확보한다
  account: Account;
  cloud: Cloud;
  screen: () => AccountScreen;
  act: (req: AccountAction) => Promise<AccountReply>;
  onScreen: (fn: (screen: AccountScreen) => void) => () => void;
  // 세션을 확인해 클라우드 저장을 시작한다(부팅 판단). 오프라인으로 켠 뒤 이어받으면 late
  start: (mode: CloudMode) => Promise<void>;
  noteSaved: (kind: SaveKind) => void; // 로컬 저장을 썼다 — tick 은 2분 스로틀, event 는 바로
  flush: (timeoutMs?: number) => Promise<void>; // 온라인이고 바뀌었으면 올린다(최대 timeoutMs)
  sleep: () => Promise<void>; // 잠금·절전 직전
  wake: () => Promise<void>; // 잠금 해제·깨어남
  release: (timeoutMs?: number) => Promise<void>; // 정상 종료·업데이트 재시작 전 — 올리고 released 를 알린다(최대 timeoutMs)
  confirm: (go: boolean) => Promise<void>; // confirm·blocked 답 — go 면 다시 넘겨받기, 아니면 멈춤(앱이 종료)
  isAnonymous: () => Promise<boolean>; // 지금 세션이 익명 계정인가 — 교환 거절(design-p2.md 14절)
  // 교환이 세션이 없을 때 새 익명 계정을 만들어도 되는가 — 분실 중이거나 저장 주인이 있으면 거짓(검수 H1).
  //   주인 있고 세션 없음은 부팅 판단이 분실로 본다. 그때 교환이 익명을 만들면 다음 부팅이 분실 창 없이 OWNER_OTHER 에 걸린다
  mayIssue: () => boolean;
  // 분실 창 [이 PC 저장으로 계속](Q4, G-a) — 새 익명 계정을 만들어 이 PC 저장을 그 계정 첫 저장으로. 계정을 못 만들면 60초 뒤 다시
  continueLocal: () => Promise<void>;
  // 분실 창 [처음부터] — 저장을 백업하고 새로 시작한다(D12 경로). 서버 처리는 없다
  fresh: () => Promise<void>;
  dispose: () => void; // writer 를 놓거나 끌 때 — 클라우드 저장을 멈추고 토큰 갱신·실시간 연결을 닫는다
}

const deviceLabel = (): string => (process.platform === "win32" ? "Windows PC" : process.platform === "darwin" ? "Mac" : "Linux PC");

// 익명 계정 발급·세션 확인을 다시 시도하는 간격 — 클라우드 다시 연결과 같다
const SESSION_RETRY_MS = ONLINE_TIMING.retryMs;

// 계정 시드(P4b) — 클라우드가 아직 돌지 않을 때 cloud.json 에서 읽는다. 저장 주인의 시드일 때만
export function cloudSeedOf(saveFile: string): string | null {
  try {
    const s = normalizeCloudState(JSON.parse(fs.readFileSync(path.join(path.dirname(saveFile), "cloud.json"), "utf8")));
    return s?.seed && s.owner && s.seedOwner === s.owner ? s.seed : null;
  } catch {
    return null;
  }
}

export function createMainOnline(o: MainOnlineOptions): MainOnline | null {
  const config = onlineConfig(undefined, devEnv());
  if (!config.url || !config.publishableKey) return null;
  const client = createOnlineClient({ url: config.url, key: config.publishableKey, storage: o.storage });
  const gate = createSessionGate(client);
  const cloudFile = path.join(path.dirname(o.saveFile), "cloud.json");
  const listeners = new Set<(screen: AccountScreen) => void>();
  let accountView: AccountView = viewOf(null);
  let cloudView: CloudView = { status: "off", lastSavedAt: null, busy: false, error: null, other: null };
  let lost: OwnerKind | null = null; // 저장 계정을 잃었다(D29) — 로그인하거나 이 PC 저장으로 계속할 때까지
  let retryTimer: ReturnType<typeof setTimeout> | null = null; // 세션 확인·익명 발급 다시 시도
  let disposed = false;
  let unsticking = false; // G-b 풀기가 도는 중
  let switched = false; // 로그인 흐름이 세션 교체 직전에 클라우드를 멈췄다 — 실패하면 다시 시작한다

  // 서버에 올리지 못한 진행이 있을 수 있다 — 로그아웃·삭제 확인 창의 경고 줄(검수 M3)
  //   올리지 않은 진행(dirty)이 있거나, 온라인이 아니거나, 올리기가 막혔다(OWNER_OTHER·BAD_SAVE·PET_TRADED_OUT)
  const unsynced = (): boolean => cloud.unsaved() === "dirty" || cloudView.status !== "online" || cloudView.error != null;
  const screen = (): AccountScreen => ({
    available: true,
    ...accountView,
    lost,
    blocked: o.tradeBlocked(),
    unsynced: unsynced(),
    cloud: cloudView,
  });
  const push = (): void => {
    const s = screen();
    for (const fn of listeners) fn(s);
  };
  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const retryLater = (fn: () => void): void => {
    clearRetry();
    if (!disposed) retryTimer = setTimeout(fn, SESSION_RETRY_MS);
  };
  // 클라우드가 아직 돌지 않는 동안의 표시 — 서버에 닿지 못했다
  const showOffline = (code: CloudErrorCode): void => {
    cloudView = { status: "offline", lastSavedAt: cloudView.lastSavedAt, busy: false, error: code, other: null };
    push();
  };

  const cloud = createCloud({
    client,
    appVersion: app.getVersion(),
    deviceLabel: deviceLabel(),
    // 개발용 시험 장치 — 개발 실행에서만 읽는다(src/main/app/dev-run.ts devNumber). 설치본은 무시한다 (E2E 가 기다리지 않게)
    //   POKEBUDDY_CLOUD_UPLOAD_MS · _RETRY_MS · _HEARTBEAT_MS  주기 저장 스로틀·다시 연결·하트비트 간격
    ...(devNumber("POKEBUDDY_CLOUD_UPLOAD_MS") ? { throttleMs: devNumber("POKEBUDDY_CLOUD_UPLOAD_MS") } : {}),
    ...(devNumber("POKEBUDDY_CLOUD_RETRY_MS") ? { retryMs: devNumber("POKEBUDDY_CLOUD_RETRY_MS") } : {}),
    ...(devNumber("POKEBUDDY_CLOUD_HEARTBEAT_MS") ? { heartbeatMs: devNumber("POKEBUDDY_CLOUD_HEARTBEAT_MS") } : {}),
    io: {
      // 로컬 저장을 격리했으면(풀지 못함·손으로 고친 평문·키 분실) 맞춘 rev 를 잊는다 — 다음 맞추기가 서버 저장을 받는다 (src/online/lost.ts)
      loadState: () => loadCloudState(cloudFile, o.saveFile),
      saveState: (s) => {
        try {
          if (!writeAtomic(cloudFile, s)) throw new Error(cloudFile);
        } catch (e) {
          console.error("cloud.json 을 쓰지 못했다", e);
        }
      },
      readSave: () => readSaveRaw(o.saveFile), // 암호화 저장을 풀어 JSON 으로 (src/save/save-file.ts)
      // 받은 저장을 v3 검사로 읽은 뒤 바꾼다. 바꾸기 전 로컬 저장을 백업한다
      replaceSave: (save) => {
        if (!replaceSave(o.saveFile, save, Date.now())) return false;
        o.onSaveReplaced();
        return true;
      },
    },
    onView: (v) => {
      cloudView = v;
      push();
      if (v.error === "CLOUD_OWNER_OTHER") void unstick();
      if (v.status === "update-required" || v.error === "CLOUD_UPDATE_REQUIRED") o.onUpdateRequired();
    },
    // 밀려나도 로그아웃하지 않는다 — 다시 켜면 같은 세션으로 넘겨받는다(D19, F1)
    onHalt: (reason, info) => {
      push();
      o.onHalt(reason, info);
    },
    // 돌던 계정이 서버에서 사라졌다(정리·다른 PC 에서 삭제·이관 뒤 옛 익명 토큰) — 분실(D29)
    onLost: (kind) => lose(kind),
    // 정식 계정 start 가 남은 이관 티켓을 늦게 옮겼다 — 로그인 때와 같은 알림
    onHandoff: (outcome) => {
      if (outcome === "discarded") o.onNotice(t("cloud.handoff.discarded"));
    },
  });

  // 저장 계정을 잃었다 — 클라우드를 끄고 앱에 알린다. 게임은 계속(D29). 익명 계정을 새로 만들지 않는다
  const lose = (kind: OwnerKind): void => {
    clearRetry();
    cloud.stop(false);
    lost = kind;
    push();
    o.onLost(kind, kind === "anonymous" && cloud.synced() > 0);
  };

  // 익명 계정으로 시작한다 — 세션이 없으면 새로 만든다. 만들지 못하면(망·가입 제한) 로컬로 계속하고 다시 시도한다
  const startAnonymous = async (mode: CloudMode): Promise<void> => {
    const r = await gate.ensure();
    if (disposed) return;
    if (!r.ok) {
      if (r.code === "NETWORK" || r.code === "AUTH_RATE_LIMITED") {
        showOffline(r.code);
        retryLater(() => void start("late"));
      } else {
        // 다시 시도하지 않는다 — 코드는 계정 탭 저장 표시로 보인다. 다음 켤 때 다시 시도한다
        cloudView = { ...cloudView, status: "off", busy: false, error: r.code };
        push();
      }
      return;
    }
    // 교환 세션은 다시 만들지 않는다 — 교환도 같은 관문(gate.ensure 단일 비행)으로 이 계정을 받는다
    accountView = viewOf(r.user);
    push();
    await cloud.start(r.user.id, mode, r.user.is_anonymous ? "anonymous" : "member");
  };

  // 부팅 판단 — 세션 있음·모름·없음 (design-p2.md 2절)
  //   로그인 흐름이 세션 교체 직전에 클라우드를 멈춘 동안(switched)은 무시한다 — 교체 뒤 userChanged·실패 복구가 다시 시작한다(검수 M2)
  const start: MainOnline["start"] = async (mode) => {
    clearRetry();
    if (disposed || switched) return;
    const probe = await gate.probe();
    if (disposed || switched) return;
    if (probe.state === "present") {
      // 익명 세션인데 저장 주인이 다른 계정이다 — 분실 부팅 때 누가 새 익명 계정을 만들었다(P1 로그아웃 뒤 교환 탭 등).
      // 남은 이관 티켓이 없으면 이 세션으로 올릴 수 없다(OWNER_OTHER 고착) — 분실로 본다(검수 H1)
      const stray = strayAnonymous(probe.user, cloud.owner(), cloud.pendingHandoff());
      if (stray) {
        lose(stray);
        return;
      }
      lost = null;
      accountView = probe.user.is_anonymous ? viewOf(probe.user) : await account.view();
      push();
      await cloud.start(probe.user.id, mode, probe.user.is_anonymous ? "anonymous" : "member");
      push();
      return;
    }
    // 이용 정지를 적어 두었다(P4c) — 서버에 닿아 풀렸는지 확인할 수 없으면 멈춘다. 세션을 지워(분실) 새 익명 계정으로 조작 저장을
    // 첫 저장으로 올리는 길도 막는다(검수 P4c H2). 세션이 있고 서버에 닿으면 cloud.start 의 claim 이 풀림·정지를 가른다
    if (cloud.held()) {
      o.onHalt("held", { other: null, code: "CLOUD_ACCOUNT_HELD" });
      return;
    }
    if (probe.state === "unknown") {
      // 저장소의 세션은 남아 있다 — 분실로 보지 않고 익명 계정도 만들지 않는다. 게임은 로컬로 계속
      showOffline(probe.code);
      retryLater(() => void start("late"));
      return;
    }
    const own = cloud.owner();
    if (own) {
      lose(own.kind ?? "member");
      return;
    }
    lost = null;
    await startAnonymous(mode);
    push();
  };

  // G-b — 로그인 계정에 서버 저장이 없는데 로컬 주인이 익명 그대로다(이관 티켓 만료 등).
  // 로그인 계정 첫 저장으로 다시 묶는다(unverified). 주인이 정식 계정이면 풀지 않는다(P1 10절 Q1)
  const unstick = async (): Promise<void> => {
    if (unsticking) return;
    const own = cloud.owner();
    if (!own || own.kind !== "anonymous" || cloud.pendingHandoff()) return;
    unsticking = true;
    try {
      const user = await gate.current();
      if (!user || user.is_anonymous || user.id === own.id || cloud.view().error !== "CLOUD_OWNER_OTHER") return;
      cloud.stop(false);
      if (cloud.rebind(own.id, user.id, "member")) await cloud.start(user.id, "boot", "member");
    } finally {
      unsticking = false;
    }
  };

  // 사용자가 바뀌었다 — 로그인이면 이관 결과를 적고 정식 계정으로 시작한다. 로그아웃이면 멈춘다(앱이 곧 다시 켠다)
  const userChanged = async (view: AccountView, handoff?: HandoffReport): Promise<void> => {
    accountView = view;
    switched = false;
    if (view.signedIn) {
      lost = null;
      clearRetry();
      const uid = await account.userId();
      if (uid) {
        if (handoff) cloud.applyHandoff(handoff, uid);
        if (handoff?.kind === "adopted" && handoff.outcome === "discarded") o.onNotice(t("cloud.handoff.discarded"));
        void cloud.start(uid, "boot", "member"); // 이 PC 에서 로그인했다 — 사용자가 여기 있다
      }
    } else {
      cloud.stop(true);
    }
    o.onUserChanged();
    push();
  };

  // 세션 교체 앞뒤 훅 — 교체 직전에 올리고 클라우드를 멈춘 뒤 익명 저장 이관 티켓을 받는다.
  // GitHub 는 브라우저를 기다리는 동안 클라우드를 멈추지 않게 이 훅(교체 직전)에서 멈춘다
  const hooks = handoffHooks(client);
  const switchHooks: SwitchHooks = {
    before: async (current) => {
      clearRetry(); // 세션 확인·익명 발급 재시도가 교체 사이에 끼어들지 않게(검수 M2)
      switched = true;
      await flush();
      cloud.stop(false);
      return hooks.before(current);
    },
    after: hooks.after,
  };

  const account = createAccount({ client, gate, blocked: o.tradeBlocked, onUserChanged: userChanged, switchHooks });

  // 로그인이 실패했다 — 교체 직전에 멈춘 클라우드를 원래 세션으로 다시 시작한다.
  // 분실(D29) 중이면 클라우드는 원래 꺼져 있다 — 다시 시작하면 분실 창이 또 뜨므로 그대로 둔다
  const resumeAfterFailedSwitch = async (): Promise<void> => {
    if (!switched) return;
    switched = false;
    if (lost) return;
    await start("boot");
  };

  const reply = (ok: boolean, code: AccountReplyCode | null, extra: Partial<AccountReply> = {}): AccountReply => ({ ok, code, ...extra, screen: screen() });
  let githubAbort: AbortController | null = null;

  // save.json 을 백업 이름으로 옮긴다. 저장이 없으면 옮길 것이 없다 (src/save/save-file.ts setAsideSave)
  const backupSave = (reason: FreshReason): boolean => setAsideSave(o.saveFile, reason) !== null;

  // 새로 시작한다(D12) — 올리고 released → 서버 처리(로그아웃·삭제·없음) → save.json 백업 → cloud.json 비움 → 앱이 다시 켠다.
  // 서버 처리나 백업이 실패하면 앱의 멈춤을 풀고 클라우드를 다시 시작한다
  const restartFresh = async (reason: FreshReason, server: () => Promise<{ ok: true } | { ok: false; code: AccountReplyCode }>): Promise<AccountReply> => {
    o.freeze();
    clearRetry();
    await flush();
    await cloud.release(3_000);
    const r = await server();
    if (!r.ok) {
      o.thaw();
      await start("boot");
      return reply(false, r.code);
    }
    if (!backupSave(reason)) {
      o.thaw();
      await start("boot");
      return reply(false, "SAVE_BACKUP_FAILED");
    }
    cloud.reset();
    lost = null;
    push();
    o.onRestart();
    return reply(true, null);
  };

  // 이 PC 의 세션만 지운다 — 서버에서 사라진 계정의 토큰이 남아 다시 켜도 분실로 돌지 않게
  const dropLocalSession = (): Promise<void> =>
    gate.exclusive(async () => {
      try {
        await client.auth.signOut({ scope: "local" });
      } catch (e) {
        console.error("이 PC 의 세션을 지우지 못했다", e);
      }
    });

  const act: MainOnline["act"] = async (req) => {
    switch (req.action) {
      case "status":
        accountView = await account.view();
        return reply(true, null);
      case "check-username":
        return reply(true, null, { check: await account.checkUsername(req.username) });
      case "sign-up": {
        const r = await account.signUp(req.username, req.displayName, req.password);
        if (!r.ok) await resumeAfterFailedSwitch();
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "sign-in": {
        const r = await account.signIn(req.username, req.password);
        if (!r.ok) await resumeAfterFailedSwitch();
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "github": {
        githubAbort?.abort();
        const abort = new AbortController();
        githubAbort = abort;
        const r = await githubLogin({ client, gate, blocked: o.tradeBlocked, openExternal: (url) => shell.openExternal(url), signal: abort.signal, switchHooks });
        if (githubAbort === abort) githubAbort = null;
        if (!r.ok) {
          await resumeAfterFailedSwitch();
          return reply(false, r.code);
        }
        await userChanged(r.view, r.handoff);
        return reply(true, null);
      }
      case "github-cancel":
        githubAbort?.abort();
        githubAbort = null;
        return reply(true, null);
      case "sign-out":
        // 로그아웃하면 이 PC 는 처음부터 새로 시작한다(D12). 계정 저장은 서버에 그대로다
        if (o.tradeBlocked()) return reply(false, "AUTH_TRADE_ACTIVE");
        return restartFresh("signout", () => account.signOut());
      case "rename": {
        const r = await account.rename(req.displayName);
        if (r.ok) accountView = r.view;
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "delete":
        if (o.tradeBlocked()) return reply(false, "AUTH_TRADE_ACTIVE");
        if (!(await account.view()).signedIn) return reply(false, "AUTH_INVALID_LOGIN");
        return restartFresh("delete", () => account.deleteAccount());
    }
  };

  // 분실 창 [이 PC 저장으로 계속] — 옛 세션을 지우고 새 익명 계정을 만든 뒤 이 PC 저장을 그 계정 첫 저장으로 묶는다
  const continueLocal: MainOnline["continueLocal"] = async () => {
    if (!lost || disposed) return;
    clearRetry();
    // 분실 중에 남은 세션은 서버에서 사라진 계정 것이다 — 지워야 새 익명 계정을 만든다
    if (await gate.current()) await dropLocalSession();
    const own = cloud.owner();
    const r = await gate.ensure();
    if (disposed || !lost) return;
    if (!r.ok) {
      showOffline(r.code === "AUTH_RATE_LIMITED" ? "AUTH_RATE_LIMITED" : "NETWORK");
      retryLater(() => void continueLocal());
      return;
    }
    const kind: OwnerKind = r.user.is_anonymous ? "anonymous" : "member";
    cloud.stop(false);
    if (own && own.id !== r.user.id) cloud.rebind(own.id, r.user.id, kind);
    lost = null;
    accountView = r.user.is_anonymous ? viewOf(r.user) : await account.view();
    o.onUserChanged();
    push();
    await cloud.start(r.user.id, "boot", kind);
    push();
  };

  // 분실 창 [처음부터] — 옛 세션을 지우고 저장을 백업한 뒤 다시 켠다. 다시 켜면 선택 창 → 새 익명 계정
  const fresh: MainOnline["fresh"] = async () => {
    if (!lost || disposed) return;
    await restartFresh("fresh", async () => {
      await dropLocalSession();
      return { ok: true };
    });
  };

  const flush: MainOnline["flush"] = async (timeoutMs = 3_000) => {
    await withTimeout(cloud.flush(), timeoutMs);
  };

  const isAnonymous: MainOnline["isAnonymous"] = async () => (await gate.current())?.is_anonymous === true;
  const mayIssue: MainOnline["mayIssue"] = () => !lost && !disposed && cloud.owner() == null;

  return {
    client, gate, account, cloud, screen, act, start, flush, isAnonymous, mayIssue, continueLocal, fresh,
    onScreen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    noteSaved: (kind) => cloud.noteSaved(kind),
    sleep: () => cloud.sleep(),
    wake: () => cloud.wake(),
    release: (timeoutMs) => cloud.release(timeoutMs),
    confirm: (go) => cloud.confirm(go),
    dispose: () => {
      disposed = true;
      clearRetry();
      githubAbort?.abort();
      cloud.stop(false);
      // 같은 세션 파일을 쓰는 다음 클라이언트와 토큰 갱신이 엇갈리지 않게 닫는다(R3-09)
      void client.auth.stopAutoRefresh();
      void client.removeAllChannels();
    },
  };
}
