// 온라인 기능의 메인 쪽 입구 — 공유 Supabase 클라이언트, 계정, 클라우드 저장, GitHub 로그인을 묶는다.
// 설계는 worklog/records/trade/record.md "계정과 로그인", "클라우드 저장", "로그인·클라우드 저장 구현 계획"
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
import { createCloud, type Cloud, type CloudSyncState, type CloudView } from "../online/cloud.js";
import { githubLogin } from "../online/github.js";
import { onlineConfig } from "../trade/config.js";
import { devEnv, encryptedStorage, isDevRun } from "./trade.js";
import { writeAtomic } from "../save/legacy.js";
import { normalize as normalizeV3 } from "../save/v3.js";
import * as store from "../save/store.js";
import type { AccountAction, AccountReply, AccountScreen } from "../shared/manage";

export interface MainOnlineOptions {
  saveFile: string;
  tradeBlocked: () => boolean; // 걸린 교환(열린 채널·반영하지 않은 교환)이 있다
  onUserChanged: () => void; // 로그인·로그아웃·밀려남 — 앱은 교환 세션을 새로 만든다
  onSaveReplaced: () => void; // 클라우드 저장을 받아 로컬 저장을 바꿨다 — 앱은 파티를 다시 읽는다
}

export interface MainOnline {
  client: SupabaseClient;
  account: Account;
  cloud: Cloud;
  screen: () => AccountScreen;
  act: (req: AccountAction) => Promise<AccountReply>;
  onScreen: (fn: (screen: AccountScreen) => void) => () => void;
  start: () => Promise<void>; // 로그인한 채 켰으면 클라우드 저장을 시작한다
  noteSaved: () => void;
  flush: (timeoutMs?: number) => Promise<void>;
  dispose: () => void; // writer 를 놓거나 끌 때 — 클라우드 저장을 멈추고 토큰 갱신·실시간 연결을 닫는다
}

// 개발용 시험 장치 — 개발 실행에서만 읽는다. 설치본은 무시한다 (E2E 가 기다리지 않게)
//   POKEBUDDY_CLOUD_UPLOAD_MS · _RETRY_MS  자동 저장까지·다시 연결까지의 간격
const devMs = (name: string): number | undefined => {
  const v = isDevRun() ? process.env[name] : undefined;
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
};

const deviceLabel = (): string => (process.platform === "win32" ? "Windows PC" : process.platform === "darwin" ? "Mac" : "Linux PC");
const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const isState = (v: unknown): v is CloudSyncState => {
  const s = v as CloudSyncState | null;
  return !!s && typeof s.deviceId === "string" && typeof s.syncedRev === "number" && typeof s.dirty === "boolean" && typeof s.offlineDirty === "boolean";
};

export function createMainOnline(o: MainOnlineOptions): MainOnline | null {
  const config = onlineConfig(undefined, devEnv());
  if (!config.url || !config.publishableKey) return null;
  const client = createOnlineClient({ url: config.url, key: config.publishableKey, storage: encryptedStorage() });
  const cloudFile = path.join(path.dirname(o.saveFile), "cloud.json");
  const listeners = new Set<(screen: AccountScreen) => void>();
  let accountView: AccountView = viewOf(null);
  let cloudView: CloudView = { status: "off", lastSavedAt: null, busy: false, error: null, choice: null };
  let kicked = false;

  const screen = (): AccountScreen => ({
    available: true,
    ...accountView,
    blocked: o.tradeBlocked(),
    kicked,
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
    ...(devMs("POKEBUDDY_CLOUD_UPLOAD_MS") ? { uploadDelayMs: devMs("POKEBUDDY_CLOUD_UPLOAD_MS") } : {}),
    ...(devMs("POKEBUDDY_CLOUD_RETRY_MS") ? { retryMs: devMs("POKEBUDDY_CLOUD_RETRY_MS") } : {}),
    io: {
      loadState: () => {
        try {
          const raw: unknown = JSON.parse(fs.readFileSync(cloudFile, "utf8"));
          return isState(raw) ? raw : null;
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
      backupServer: (save) => {
        const file = `${o.saveFile}.cloud-server-${stamp()}.bak`;
        try {
          if (!writeAtomic(file, save)) throw new Error(file);
        } catch (e) {
          console.error("고르지 않은 계정 저장을 백업하지 못했다", e);
        }
      },
    },
    onView: (v) => {
      cloudView = v;
      push();
    },
    onKicked: () => {
      kicked = true;
      void client.auth.signOut({ scope: "local" }).catch(() => undefined).then(() => {
        accountView = viewOf(null);
        o.onUserChanged();
        push();
      });
    },
  });

  // 사용자가 바뀌었다 — 클라우드 저장을 시작·멈추고 교환 세션을 새로 만든다
  const userChanged = async (view: AccountView): Promise<void> => {
    accountView = view;
    if (view.signedIn) {
      kicked = false;
      const uid = await account.userId();
      if (uid) void cloud.start(uid);
    } else {
      cloud.stop(true);
    }
    o.onUserChanged();
    push();
  };

  const account = createAccount({ client, blocked: o.tradeBlocked, onUserChanged: userChanged });

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
        const r = await githubLogin({ client, blocked: o.tradeBlocked, openExternal: (url) => shell.openExternal(url), signal: abort.signal });
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
        // 로그아웃 전에 올린다 — 온라인이면 바뀐 것을, 저장 필요면 사용자가 "저장하고 로그아웃"을 골랐을 때만
        const unsaved = cloud.unsaved();
        if (unsaved === "dirty") await cloud.flush();
        // 저장하고 로그아웃을 골랐는데 저장하지 못했다 — 로그아웃하지 않고 알린다(R3-04)
        if (unsaved === "save-needed" && req.save && !(await cloud.saveNow())) return reply(false, cloud.view().error ?? "NETWORK");
        const r = await account.signOut();
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
      case "save-now":
        return (await cloud.saveNow()) ? reply(true, null) : reply(false, cloud.view().error ?? "CLOUD_NOT_SAVED");
      case "choose":
        return (await cloud.choose(req.which)) ? reply(true, null) : reply(false, cloud.view().error ?? "CLOUD_NOT_SAVED");
      case "dismiss-kicked":
        kicked = false;
        push();
        return reply(true, null);
    }
  };

  const start: MainOnline["start"] = async () => {
    accountView = await account.view();
    if (accountView.signedIn) {
      const uid = await account.userId();
      if (uid) await cloud.start(uid);
    }
    push();
  };

  const flush: MainOnline["flush"] = async (timeoutMs = 3_000) => {
    await Promise.race([cloud.flush(), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  };

  return {
    client, account, cloud, screen, act, start, flush,
    onScreen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    noteSaved: () => cloud.noteSaved(),
    dispose: () => {
      githubAbort?.abort();
      cloud.stop(false);
      // 같은 세션 파일을 쓰는 다음 클라이언트와 토큰 갱신이 엇갈리지 않게 닫는다(R3-09)
      void client.auth.stopAutoRefresh();
      void client.removeAllChannels();
    },
  };
}
