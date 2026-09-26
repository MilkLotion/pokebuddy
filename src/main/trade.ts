// 친구 교환의 메인 쪽 입구 — 세션 저장소(safeStorage)와 교환 흐름(src/trade/session.ts)을 잇는다.
// 설계는 docs/work/trade/record.md "앱 구조", "세션 저장"
//
// Supabase 클라이언트는 메인 프로세스에서만 쓴다. 렌더러에는 교환 보기(TradeViewModel)만 넘긴다. 토큰은 넘기지 않는다.
// 세션은 safeStorage 로 암호화해 ~/.claude/pokebuddy/online/session.bin 에 둔다. 암호화를 쓸 수 없으면 메모리에만 둔다
// — 그러면 앱을 다시 켤 때 새 익명 계정이 된다. 반영하지 않은 교환은 저장의 pending 으로 이어 가지만 채널은 찾지 못한다.
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { PATHS } from "./paths.js";
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

// 앱이 준비된 뒤(safeStorage 사용 가능) 한 번 만든다
export function createMainTrade(game: GameV3): MainTrade | null {
  const config = onlineConfig();
  if (!config.url || !config.publishableKey) return null;
  const listeners = new Set<(view: TradeViewModel) => void>();
  const session = createTradeSession({
    net: createTradeNet({ url: config.url, key: config.publishableKey, storage: encryptedStorage() }),
    run: (id, name, args) => game.executor.run({ id, name, args }),
    read: game.read,
    protocol: config.protocol,
    dataVersion: dataVersion(),
    linkOf: (token) => linkOf(config, token),
    onView: (view) => { for (const fn of listeners) fn(view); },
  });
  return {
    session,
    onView: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
