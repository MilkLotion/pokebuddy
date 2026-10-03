// 친구 교환의 메인 쪽 입구 — 세션 저장소(src/online/session-storage.ts)와 교환 흐름(src/online/trade-session.ts)을 잇는다.
// 설계는 worklog/records/trade/record.md "앱 구조"
//
// Supabase 클라이언트는 메인 프로세스에서만 쓴다. 렌더러에는 교환 보기(TradeViewModel)만 넘긴다. 토큰은 넘기지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTradeNet } from "../online/trade-net.js";
import type { SessionStorage } from "../online/client.js";
import type { SessionGate } from "../online/session.js";
import { createTradeSession, type TradeSession, type TradeViewModel } from "../online/trade-session.js";
import { onlineConfig } from "../online/config.js";
import { dataVersion } from "../trade/data-version.js";
import { devEnv, isDevRun } from "./app/dev-run.js";
import { linkOf } from "../trade/link.js";
import type { GameV3 } from "./game";

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

// 앱이 준비된 뒤(키 저장소 safeStorage 사용 가능) 한 번 만든다. 서버 설정이 없으면 null
// link — 계정·클라우드 저장과 같은 세션을 쓰는 공유 클라이언트와 세션 관문(src/main/online.ts).
//   계정이 없으면 클라이언트만 따로 만들고, 세션 파일 저장소는 앱이 넘긴 같은 한 벌을 쓴다 (src/main/services/registry.ts)
// onSettled — 교환 반영을 서버에 알린 뒤. 앱이 클라우드 저장을 바로 올린다 (src/online/trade-session.ts)
// hold — 새 교환(만들기·참가)을 막아야 하는가. 로그인 계정의 클라우드 저장이 올릴 수 있는 상태가 아니다
// account — 익명 계정 교환 거절과 제안 전 클라우드 올리기 (design-p2.md 14절). 없으면 서버가 거절한다
//   mayIssue 가 거짓이면 교환은 익명 계정을 만들지 않는다 — 분실·주인 있고 세션 없음(검수 H1)
export function createMainTrade(
  game: GameV3,
  link: { client: SupabaseClient; gate: SessionGate } | { storage: SessionStorage },
  onSettled?: () => void,
  hold?: () => boolean | Promise<boolean>,
  account?: { isAnonymous: () => boolean | Promise<boolean>; beforeOffer: () => Promise<void>; mayIssue?: () => boolean },
): MainTrade | null {
  const config = onlineConfig(undefined, devEnv());
  if (!config.url || !config.publishableKey) return null;
  const dev = devHooks();
  const listeners = new Set<(view: TradeViewModel) => void>();
  const session = createTradeSession({
    net: createTradeNet("client" in link ? { client: link.client, gate: link.gate } : { url: config.url, key: config.publishableKey, storage: link.storage }),
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
