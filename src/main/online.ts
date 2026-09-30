// 온라인 기능의 메인 쪽 입구 — 공유 Supabase 클라이언트, 계정, 클라우드 저장, GitHub 로그인을 묶는다.
// 설계는 worklog/records/trade/record.md "계정과 로그인", "클라우드 저장", "로그인·클라우드 저장 구현 계획"
// 두 PC 규칙(밀려남·확인·잠듦·released)은 worklog-mac/records/cloud-authority/design-p1.md 2·3절
//
// 교환(src/main/trade.ts)도 이 클라이언트를 쓴다 — 로그인하면 교환 채널도 그 계정으로 연다.
// 렌더러에는 계정 화면 값(AccountScreen)만 넘긴다. 토큰·내부 주소·사용자 ID 는 넘기지 않는다.
// 클라우드 동기화 정보는 save.json 과 같은 폴더의 cloud.json 이다. save.json 에는 필드를 더하지 않는다
import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOnlineClient } from "../online/client.js";
import { createAccount, viewOf, type Account, type AccountView } from "../online/account.js";
import { createCloud, type Cloud, type CloudMode, type CloudView, type HaltInfo, type HaltReason, type SaveKind } from "../online/cloud.js";
import { githubLogin } from "../online/github.js";
import { createSessionGate, type SessionGate } from "../online/session.js";
import { onlineConfig } from "../trade/config.js";
import { devEnv, encryptedStorage, isDevRun } from "./trade.js";
import { writeAtomic } from "../save/legacy.js";
import { normalize as normalizeV3 } from "../save/v3.js";
import * as store from "../save/store.js";
import type { AccountAction, AccountReply, AccountScreen } from "../shared/manage";

export interface MainOnlineOptions {
  saveFile: string;
  tradeBlocked: () => boolean; // 걸린 교환(열린 채널·반영하지 않은 교환)이 있다
  onUserChanged: () => void; // 로그인·로그아웃 — 앱은 교환 세션을 새로 만든다
  onSaveReplaced: () => void; // 클라우드 저장을 받아 로컬 저장을 바꿨다 — 앱은 파티를 다시 읽는다
  // 게임을 멈춰야 한다 — superseded(밀려남, 안내 뒤 종료)·confirm(넘겨받기 확인)·blocked(교환 걸림).
  // 로그아웃하지 않는다(D19, 검수 F1) — 세션은 그대로 둔다
  onHalt: (reason: HaltReason, info: HaltInfo) => void;
}

export interface MainOnline {
  client: SupabaseClient;
  gate: SessionGate; // 세션 관문 — 교환(src/main/trade.ts)도 이것으로 세션을 확보한다
  account: Account;
  cloud: Cloud;
  screen: () => AccountScreen;
  act: (req: AccountAction) => Promise<AccountReply>;
  onScreen: (fn: (screen: AccountScreen) => void) => () => void;
  start: (mode: CloudMode) => Promise<void>; // 로그인한 채 켰으면 클라우드 저장을 시작한다. 오프라인으로 켠 뒤 이어받으면 late
  noteSaved: (kind: SaveKind) => void; // 로컬 저장을 썼다 — tick 은 2분 스로틀, event 는 바로
  flush: (timeoutMs?: number) => Promise<void>; // 온라인이고 바뀌었으면 올린다(최대 timeoutMs)
  sleep: () => Promise<void>; // 잠금·절전 직전
  wake: () => Promise<void>; // 잠금 해제·깨어남
  release: (timeoutMs?: number) => Promise<void>; // 정상 종료·업데이트 재시작 전 — 올리고 released 를 알린다(최대 timeoutMs)
  confirm: (go: boolean) => Promise<void>; // confirm·blocked 답 — go 면 다시 넘겨받기, 아니면 멈춤(앱이 종료)
  dispose: () => void; // writer 를 놓거나 끌 때 — 클라우드 저장을 멈추고 토큰 갱신·실시간 연결을 닫는다
}

// 개발용 시험 장치 — 개발 실행에서만 읽는다. 설치본은 무시한다 (E2E 가 기다리지 않게)
//   POKEBUDDY_CLOUD_UPLOAD_MS · _RETRY_MS · _HEARTBEAT_MS  주기 저장 스로틀·다시 연결·하트비트 간격
const devMs = (name: string): number | undefined => {
  const v = isDevRun() ? process.env[name] : undefined;
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
};

const deviceLabel = (): string => (process.platform === "win32" ? "Windows PC" : process.platform === "darwin" ? "Mac" : "Linux PC");
const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

export function createMainOnline(o: MainOnlineOptions): MainOnline | null {
  const config = onlineConfig(undefined, devEnv());
  if (!config.url || !config.publishableKey) return null;
  const client = createOnlineClient({ url: config.url, key: config.publishableKey, storage: encryptedStorage() });
  const gate = createSessionGate(client);
  const cloudFile = path.join(path.dirname(o.saveFile), "cloud.json");
  const listeners = new Set<(screen: AccountScreen) => void>();
  let accountView: AccountView = viewOf(null);
  let cloudView: CloudView = { status: "off", lastSavedAt: null, busy: false, error: null, other: null };

  const screen = (): AccountScreen => ({
    available: true,
    ...accountView,
    blocked: o.tradeBlocked(),
    cloud: cloudView,
  });
  const push = (): void => {
    const s = screen();
    for (const fn of listeners) fn(s);
  };

  const cloud = createCloud({
    client,
    appVersion: app.getVersion(),
    deviceLabel: deviceLabel(),
    ...(devMs("POKEBUDDY_CLOUD_UPLOAD_MS") ? { throttleMs: devMs("POKEBUDDY_CLOUD_UPLOAD_MS") } : {}),
    ...(devMs("POKEBUDDY_CLOUD_RETRY_MS") ? { retryMs: devMs("POKEBUDDY_CLOUD_RETRY_MS") } : {}),
    ...(devMs("POKEBUDDY_CLOUD_HEARTBEAT_MS") ? { heartbeatMs: devMs("POKEBUDDY_CLOUD_HEARTBEAT_MS") } : {}),
    io: {
      loadState: () => {
        try {
          return JSON.parse(fs.readFileSync(cloudFile, "utf8")) as unknown; // 형식 검사·옛 형식 변환은 cloud.ts readCloudState
        } catch {
          return null; // 처음이거나 파손 — 새 기기 ID 로 시작한다
        }
      },
      saveState: (s) => {
        try {
          if (!writeAtomic(cloudFile, s)) throw new Error(cloudFile);
        } catch (e) {
          console.error("cloud.json 을 쓰지 못했다", e);
        }
      },
      readSave: () => {
        try {
          return JSON.parse(fs.readFileSync(o.saveFile, "utf8")) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      // 받은 저장을 v3 검사로 읽은 뒤 바꾼다. 바꾸기 전 로컬 저장을 백업한다
      replaceSave: (save) => {
        const v3 = normalizeV3(save, Date.now());
        if (!v3) return false;
        try {
          if (fs.existsSync(o.saveFile)) fs.copyFileSync(o.saveFile, `${o.saveFile}.cloud-${stamp()}.bak`);
        } catch (e) {
          console.error("클라우드 저장을 받기 전 백업에 실패했다 — 바꾸지 않는다", e);
          return false;
        }
        if (!store.write(o.saveFile, v3)) return false;
        o.onSaveReplaced();
        return true;
      },
    },
    onView: (v) => {
      cloudView = v;
      push();
    },
    // 밀려나도 로그아웃하지 않는다 — 다시 켜면 같은 세션으로 넘겨받는다(D19, F1)
    onHalt: (reason, info) => {
      push();
      o.onHalt(reason, info);
    },
  });

  // 사용자가 바뀌었다 — 클라우드 저장을 시작·멈추고 교환 세션을 새로 만든다
  const userChanged = async (view: AccountView): Promise<void> => {
    accountView = view;
    if (view.signedIn) {
      const uid = await account.userId();
      if (uid) void cloud.start(uid, "boot"); // 이 PC 에서 로그인했다 — 사용자가 여기 있다
    } else {
      cloud.stop(true);
    }
    o.onUserChanged();
    push();
  };

  const account = createAccount({ client, gate, blocked: o.tradeBlocked, onUserChanged: userChanged });

  const reply = (ok: boolean, code: string | null, extra: Partial<AccountReply> = {}): AccountReply => ({ ok, code, ...extra, screen: screen() });
  let githubAbort: AbortController | null = null;

  const act: MainOnline["act"] = async (req) => {
    switch (req.action) {
      case "status":
        accountView = await account.view();
        return reply(true, null);
      case "check-username":
        return reply(true, null, { check: await account.checkUsername(req.username) });
      case "sign-up": {
        const r = await account.signUp(req.username, req.displayName, req.password);
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "sign-in": {
        const r = await account.signIn(req.username, req.password);
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "github": {
        githubAbort?.abort();
        const abort = new AbortController();
        githubAbort = abort;
        const r = await githubLogin({ client, gate, blocked: o.tradeBlocked, openExternal: (url) => shell.openExternal(url), signal: abort.signal });
        if (githubAbort === abort) githubAbort = null;
        if (!r.ok) return reply(false, r.code);
        await userChanged(r.view);
        return reply(true, null);
      }
      case "github-cancel":
        githubAbort?.abort();
        githubAbort = null;
        return reply(true, null);
      case "sign-out": {
        // 올리기 → released 알림 → 세션 교체(account.signOut 이 gate.exclusive 안에서) → cloud.stop(true)(userChanged)
        //   owner 는 남긴다 — 다른 계정으로 로그인해도 이 저장을 그 계정 첫 저장으로 올리지 않는다(10절 Q1)
        if (o.tradeBlocked()) return reply(false, "AUTH_TRADE_ACTIVE");
        const uid = await account.userId();
        await flush();
        await cloud.release(3_000);
        const r = await account.signOut();
        if (!r.ok && uid) void cloud.start(uid, "boot"); // 로그아웃하지 못했다 — 이 PC 가 활성이던 대로 다시 잇는다
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "rename": {
        const r = await account.rename(req.displayName);
        if (r.ok) accountView = r.view;
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
      case "delete": {
        const r = await account.deleteAccount();
        return r.ok ? reply(true, null) : reply(false, r.code);
      }
    }
  };

  const start: MainOnline["start"] = async (mode) => {
    accountView = await account.view();
    if (accountView.signedIn) {
      const uid = await account.userId();
      if (uid) await cloud.start(uid, mode);
    }
    push();
  };

  const flush: MainOnline["flush"] = async (timeoutMs = 3_000) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([cloud.flush(), new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); })]);
    clearTimeout(timer);
  };

  return {
    client, gate, account, cloud, screen, act, start, flush,
    onScreen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    noteSaved: (kind) => cloud.noteSaved(kind),
    sleep: () => cloud.sleep(),
    wake: () => cloud.wake(),
    release: (timeoutMs) => cloud.release(timeoutMs),
    confirm: (go) => cloud.confirm(go),
    dispose: () => {
      githubAbort?.abort();
      cloud.stop(false);
      // 같은 세션 파일을 쓰는 다음 클라이언트와 토큰 갱신이 엇갈리지 않게 닫는다(R3-09)
      void client.auth.stopAutoRefresh();
      void client.removeAllChannels();
    },
  };
}
