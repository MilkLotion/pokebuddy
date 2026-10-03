// 친구 교환의 메인 쪽 입구 — 세션 저장소(safeStorage)와 교환 흐름(src/online/trade-session.ts)을 잇는다.
// 설계는 worklog/records/trade/record.md "앱 구조", "세션 저장", 세션 파일 상태는 worklog-mac/records/cloud-authority/design-p2.md 2절·12절 Q3
//
// Supabase 클라이언트는 메인 프로세스에서만 쓴다. 렌더러에는 교환 보기(TradeViewModel)만 넘긴다. 토큰은 넘기지 않는다.
// 세션은 safeStorage 로 암호화해 ~/.claude/pokebuddy/online/session.bin 에 둔다.
// 암호화를 쓸 수 없는 환경(키 저장소 없음)이면 같은 폴더의 session.json 에 평문으로 둔다 — 권한 0600(Q3)
// 암호화가 한 번 실패해도 평문으로 둔다. 두 파일이 다 있으면 더 나중에 쓴 쪽을 읽는다(W5)
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { PATHS } from "./paths.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTradeNet, type SessionStorage } from "../online/trade-net.js";
import type { SessionGate } from "../online/session.js";
import { createTradeSession, type TradeSession, type TradeViewModel } from "../online/trade-session.js";
import { onlineConfig } from "../online/config.js";
import { dataVersion } from "../trade/data-version.js";
import { devEnv, isDevRun } from "./app/dev-run.js";
import { linkOf } from "../trade/link.js";
import type { GameV3 } from "./game";
import { stampOf } from "../platform/move-file.js";

const sessionFile = (): string => path.join(PATHS.home, "online", "session.bin");

// 세션 파일 상태 — 첫 읽기 뒤에 정해진다
//   ok           암호화 파일을 읽었다
//   missing      세션 파일이 없다(처음·로그아웃 뒤)
//   unreadable   암호화 파일을 풀지 못했다(키가 바뀜·키체인 거부) — 첫 쓰기 전에 session.bin.unreadable-<시각> 으로 옮긴다
//   unavailable  이 환경은 암호화를 쓸 수 없다 — 평문 session.json(0600)을 쓴다
export type SessionFileStatus = "ok" | "missing" | "unreadable" | "unavailable";

export interface SessionFileStorage extends SessionStorage {
  status: () => Promise<SessionFileStatus>;
}


// 키 하나에 값 하나 — supabase-js 는 키 몇 개만 쓴다. 통째로 암호화해 한 파일에 둔다.
// 비동기 safeStorage 만 쓴다 — mac 은 키체인 허용 창이 뜨면 동기 호출이 답할 때까지 메인을 멈춘다.
// 멈추면 무대·꺼내기 처리가 서서 포켓몬이 안 보인다 (2026-09-28 사용자 "업데이트하니 기존포켓몬들을 꺼내도 안보이는데")
// 풀지 못한 파일은 덮어쓰지 않는다 — 옮겨 두고 새로 쓴다. 키가 돌아오면 사람이 되살릴 수 있다
// 개발 실행·업데이트 시험 빌드의 use-mock-keychain(src/main/app.ts)은 그대로 — 가짜 키로 암호화 파일을 쓴다
export function encryptedStorage(file = sessionFile()): SessionFileStorage {
  const plainFile = path.join(path.dirname(file), "session.json");
  const memory = new Map<string, string>();
  let ready: Promise<SessionFileStatus> | null = null; // 파일을 한 번 읽었다 — 값은 첫 읽기의 상태
  let writing: Promise<void> = Promise.resolve(); // 쓰기를 차례로 — 앞선 쓰기가 뒤의 값을 덮지 않게
  let aside = false; // 풀지 못한 암호화 파일을 아직 옮기지 않았다
  const can = async (): Promise<boolean> => {
    try { return await safeStorage.isAsyncEncryptionAvailable(); } catch { return false; }
  };
  const mtimeOf = (f: string): number | null => {
    try { return fs.statSync(f).mtimeMs; } catch { return null; }
  };
  const take = (text: string): void => {
    const obj = JSON.parse(text) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) if (typeof v === "string" && !memory.has(k)) memory.set(k, v);
  };
  // 평문 파일 — 만들 때 0600, 이미 있던 파일도 쓸 때마다 0600 으로 좁힌다.
  // Windows 는 권한 비트가 거의 뜻이 없다(읽기 전용만 반영) — 대신 사용자 프로필 폴더(~/.claude)라 다른 사용자 계정은 기본 ACL 로 막힌다
  const writePlain = async (): Promise<void> => {
    await fs.promises.mkdir(path.dirname(plainFile), { recursive: true });
    await fs.promises.writeFile(plainFile, JSON.stringify(Object.fromEntries(memory)), { mode: 0o600 });
    await fs.promises.chmod(plainFile, 0o600).catch(() => undefined);
  };
  const flushNow = async (): Promise<void> => {
    try {
      if (!(await can())) {
        await writePlain();
        return;
      }
      if (aside) {
        // 풀지 못한 파일을 덮지 않게 먼저 옮긴다
        if (fs.existsSync(file)) await fs.promises.rename(file, `${file}.unreadable-${stampOf()}`);
        aside = false;
      }
      let data: Buffer;
      try {
        data = await safeStorage.encryptStringAsync(JSON.stringify(Object.fromEntries(memory)));
      } catch (e) {
        // 키 저장소가 이번만 거부했다 — 세션을 잃지 않게 평문(0600)으로 둔다. session.bin 은 그대로 둔다
        // 다음 읽기는 더 나중에 쓴 쪽(평문)을 쓴다 — 옛 암호화 파일의 계정으로 되돌아가지 않게(load)
        console.error("세션을 암호화하지 못해 평문 파일로 둔다", e);
        await writePlain();
        return;
      }
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, data);
      // 암호화를 다시 쓸 수 있게 됐다 — 평문 사본을 남기지 않는다
      if (fs.existsSync(plainFile)) await fs.promises.rm(plainFile, { force: true });
    } catch (e) {
      console.error("교환 세션 파일을 쓰지 못했다", e);
    }
  };
  const flush = (): Promise<void> => (writing = writing.then(flushNow));
  const load = (): Promise<SessionFileStatus> =>
    (ready ??= (async (): Promise<SessionFileStatus> => {
      if (!(await can())) {
        try {
          if (!fs.existsSync(plainFile)) return "unavailable";
          take(await fs.promises.readFile(plainFile, "utf8"));
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 새로 시작한다", e);
        }
        return "unavailable";
      }
      // 평문 파일이 암호화 파일보다 나중에 쓰였다 — 암호화를 못 쓰던 때나 암호화가 한 번 실패한 때의 세션이다.
      // 더 나중에 쓴 쪽을 쓴다 — 옛 암호화 파일의 계정으로 되돌아가지 않게. 읽은 뒤 암호화 파일로 옮긴다
      const binAt = mtimeOf(file);
      const plainAt = mtimeOf(plainFile);
      if (plainAt != null && binAt != null && plainAt > binAt) {
        try {
          take(await fs.promises.readFile(plainFile, "utf8"));
          void flush();
          return "ok";
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 암호화 파일을 읽는다", e);
        }
      }
      if (!fs.existsSync(file)) {
        // 암호화를 못 쓰던 때의 평문 파일 — 읽어 암호화 파일로 옮긴다
        if (!fs.existsSync(plainFile)) return "missing";
        try {
          take(await fs.promises.readFile(plainFile, "utf8"));
          void flush();
          return "ok";
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 새로 시작한다", e);
          return "missing";
        }
      }
      try {
        const out = await safeStorage.decryptStringAsync(await fs.promises.readFile(file));
        take(out.result);
        if (out.shouldReEncrypt) void flush(); // 키가 바뀌었다 — 새 키로 다시 쓴다
        return "ok";
      } catch (e) {
        console.error("교환 세션 파일을 읽지 못해 새로 시작한다 — 쓰기 전에 옮겨 둔다", e);
        aside = true;
        return "unreadable";
      }
    })());
  return {
    getItem: async (k) => { await load(); return memory.get(k) ?? null; },
    setItem: async (k, v) => { await load(); memory.set(k, v); await flush(); },
    removeItem: async (k) => { await load(); memory.delete(k); await flush(); },
    status: load,
  };
}

export interface MainTrade {
  session: TradeSession;
  onView: (fn: (view: TradeViewModel) => void) => () => void;
}

// 개발용 시험 장치 — 개발 실행에서만 읽는다. 설치본은 무시한다 (worklog/records/trade/record.md "E2E 설계")
//   POKEBUDDY_TRADE_FAULT=before-apply   서버 완료 뒤 로컬 반영 직전에 앱을 끝낸다
//   POKEBUDDY_TRADE_DATA_VERSION         데이터 버전을 바꿔 참가 거절을 재현한다
//   POKEBUDDY_TRADE_POLL_MS · _RETRY_MS  다시 읽기·재시도 간격
export interface TradeDevHooks {
  fault: "before-apply" | null;
  dataVersion: string | null;
  pollMs: number | null;
  retryMs: number | null;
}

export function devHooks(env: NodeJS.ProcessEnv = process.env, dev = isDevRun()): TradeDevHooks {
  if (!dev) return { fault: null, dataVersion: null, pollMs: null, retryMs: null };
  const ms = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);
  return {
    fault: env.POKEBUDDY_TRADE_FAULT === "before-apply" ? "before-apply" : null,
    dataVersion: env.POKEBUDDY_TRADE_DATA_VERSION || null,
    pollMs: ms(env.POKEBUDDY_TRADE_POLL_MS),
    retryMs: ms(env.POKEBUDDY_TRADE_RETRY_MS),
  };
}

// 앱이 준비된 뒤(safeStorage 사용 가능) 한 번 만든다. 서버 설정이 없으면 null
// shared — 계정·클라우드 저장과 같은 세션을 쓰는 공유 클라이언트와 세션 관문(src/main/online.ts). 없으면 따로 만든다
// onSettled — 교환 반영을 서버에 알린 뒤. 앱이 클라우드 저장을 바로 올린다 (src/online/trade-session.ts)
// hold — 새 교환(만들기·참가)을 막아야 하는가. 로그인 계정의 클라우드 저장이 올릴 수 있는 상태가 아니다
// account — 익명 계정 교환 거절과 제안 전 클라우드 올리기 (design-p2.md 14절). 없으면 서버가 거절한다
//   mayIssue 가 거짓이면 교환은 익명 계정을 만들지 않는다 — 분실·주인 있고 세션 없음(검수 H1)
export function createMainTrade(
  game: GameV3,
  shared?: { client: SupabaseClient; gate: SessionGate },
  onSettled?: () => void,
  hold?: () => boolean | Promise<boolean>,
  account?: { isAnonymous: () => boolean | Promise<boolean>; beforeOffer: () => Promise<void>; mayIssue?: () => boolean },
): MainTrade | null {
  const config = onlineConfig(undefined, devEnv());
  if (!config.url || !config.publishableKey) return null;
  const dev = devHooks();
  const listeners = new Set<(view: TradeViewModel) => void>();
  const session = createTradeSession({
    net: createTradeNet(shared ? { client: shared.client, gate: shared.gate } : { url: config.url, key: config.publishableKey, storage: encryptedStorage() }),
    run: (id, name, args) => game.executor.run({ id, name, args }),
    read: game.read,
    protocol: config.protocol,
    dataVersion: dev.dataVersion ?? dataVersion(),
    linkOf: (token) => linkOf(config.linkBase, token),
    onView: (view) => { for (const fn of listeners) fn(view); },
    ...(onSettled ? { onSettled } : {}),
    ...(hold ? { hold } : {}),
    ...(account ? { isAnonymous: account.isAnonymous, beforeOffer: account.beforeOffer } : {}),
    ...(account?.mayIssue ? { mayIssue: account.mayIssue } : {}),
    ...(dev.pollMs ? { pollMs: dev.pollMs } : {}),
    ...(dev.retryMs ? { retryMs: dev.retryMs } : {}),
    // 반영을 건너뛰고 바로 끝낸다. process.exit 는 Electron 에서 창을 정리하며 끝나 그 사이 반영이 돌 수 있다(2026-09-27 E2E 에서 발견)
    ...(dev.fault === "before-apply" ? { beforeApply: () => { setImmediate(() => process.kill(process.pid, "SIGKILL")); return true; } } : {}),
  });
  return {
    session,
    onView: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
