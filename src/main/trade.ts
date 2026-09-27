// 친구 교환의 메인 쪽 입구 — 세션 저장소(safeStorage)와 교환 흐름(src/trade/session.ts)을 잇는다.
// 설계는 docs/work/trade/record.md "앱 구조", "세션 저장"
//
// Supabase 클라이언트는 메인 프로세스에서만 쓴다. 렌더러에는 교환 보기(TradeViewModel)만 넘긴다. 토큰은 넘기지 않는다.
// 세션은 safeStorage 로 암호화해 ~/.claude/pokebuddy/online/session.bin 에 둔다. 암호화를 쓸 수 없으면 메모리에만 둔다
// — 그러면 앱을 다시 켤 때 새 익명 계정이 된다. 반영하지 않은 교환은 저장의 pending 으로 이어 가지만 채널은 찾지 못한다.
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { PATHS } from "./paths.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTradeNet, type SessionStorage } from "../trade/net.js";
import { createTradeSession, type TradeSession, type TradeViewModel } from "../trade/session.js";
import { dataVersion, linkOf, onlineConfig } from "../trade/config.js";
import type { GameV3 } from "./game";

const sessionFile = (): string => path.join(PATHS.home, "online", "session.bin");

// 키 하나에 값 하나 — supabase-js 는 키 몇 개만 쓴다. 통째로 암호화해 한 파일에 둔다
export function encryptedStorage(file = sessionFile()): SessionStorage {
  const memory = new Map<string, string>();
  const can = (): boolean => {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  };
  const load = (): void => {
    if (!can() || memory.size || !fs.existsSync(file)) return;
    try {
      const obj = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) if (typeof v === "string") memory.set(k, v);
    } catch (e) {
      console.error("교환 세션 파일을 읽지 못해 새로 시작한다", e);
    }
  };
  const flush = (): void => {
    if (!can()) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(Object.fromEntries(memory))));
    } catch (e) {
      console.error("교환 세션 파일을 쓰지 못했다", e);
    }
  };
  return {
    getItem: (k) => { load(); return memory.get(k) ?? null; },
    setItem: (k, v) => { load(); memory.set(k, v); flush(); },
    removeItem: (k) => { load(); memory.delete(k); flush(); },
  };
}

export interface MainTrade {
  session: TradeSession;
  onView: (fn: (view: TradeViewModel) => void) => () => void;
}

// 개발용 시험 장치 — 개발 실행에서만 읽는다. 설치본은 무시한다 (docs/work/trade/record.md "E2E 설계")
//   POKEBUDDY_TRADE_FAULT=before-apply   서버 완료 뒤 로컬 반영 직전에 앱을 끝낸다
//   POKEBUDDY_TRADE_DATA_VERSION         데이터 버전을 바꿔 참가 거절을 재현한다
//   POKEBUDDY_TRADE_POLL_MS · _RETRY_MS  다시 읽기·재시도 간격
export interface TradeDevHooks {
  fault: "before-apply" | null;
  dataVersion: string | null;
  pollMs: number | null;
  retryMs: number | null;
}

export function devHooks(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): TradeDevHooks {
  if (packaged) return { fault: null, dataVersion: null, pollMs: null, retryMs: null };
  const ms = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);
  return {
    fault: env.POKEBUDDY_TRADE_FAULT === "before-apply" ? "before-apply" : null,
    dataVersion: env.POKEBUDDY_TRADE_DATA_VERSION || null,
    pollMs: ms(env.POKEBUDDY_TRADE_POLL_MS),
    retryMs: ms(env.POKEBUDDY_TRADE_RETRY_MS),
  };
}

// 앱이 준비된 뒤(safeStorage 사용 가능) 한 번 만든다. 서버 설정이 없으면 null
// client — 계정·클라우드 저장과 같은 세션을 쓰는 공유 클라이언트(src/main/online.ts). 없으면 따로 만든다
export function createMainTrade(game: GameV3, client?: SupabaseClient): MainTrade | null {
  const config = onlineConfig(undefined, app.isPackaged ? {} : process.env);
  if (!config.url || !config.publishableKey) return null;
  const dev = devHooks();
  const listeners = new Set<(view: TradeViewModel) => void>();
  const session = createTradeSession({
    net: createTradeNet(client ? { client } : { url: config.url, key: config.publishableKey, storage: encryptedStorage() }),
    run: (id, name, args) => game.executor.run({ id, name, args }),
    read: game.read,
    protocol: config.protocol,
    dataVersion: dev.dataVersion ?? dataVersion(),
    linkOf: (token) => linkOf(config, token),
    onView: (view) => { for (const fn of listeners) fn(view); },
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
