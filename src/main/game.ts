// 저장 v3 을 다루는 메인 쪽 입구 — 파일 읽기·쓰기, 거래 실행기, 시간 적용, 화면이 읽는 스냅샷을 한 곳에 모은다.
//
// 저장을 쓰는 곳은 거래 실행기 하나다 (docs/specs/modules.md "경계 원칙").
// 시간은 앱이 깨어 있는 동안만 흐른다. 앱은 전역 시계(src/main/clock.ts)의 1초 틱마다 흐른 시간을 적용한다 (2026-09-29 사용자 결정).
// 상한(`TIME_V3_RULES.maxTickMs`)을 넘는 틈은 앱 종료·절전·잠금으로 보고 버린다.
// 1초마다 적용한 값은 메모리(pending)에 두고, 파일은 flushMs 마다와 명령·줍기 때 쓴다. 1초마다 파일을 쓰면 하루 수 GB 를 쓰고
// 저장 감시(src/main/save-party.ts)·클라우드 표시(cloud.json)가 1초마다 돈다. 읽는 쪽(명령·스냅샷)은 pending 의 사본을 본다.
// 다른 곳이 파일을 바꾸면(클라우드 저장 받기 등) pending 을 버리고 파일을 따른다. 시간 진행은 잃지 않는다 — 다음 틱이
// 파일의 lastTickAt 부터 다시 적용한다(flushMs 15초 < TIME_V3_RULES.maxTickMs 30초). 파일에 아직 안 쓴 작업 시간(workMs)은
// 따로 들고 있다가 다음 틱에 다시 넘긴다.
// 쓰기 간격은 단조 시계(mono)로 잰다 — 시스템 시각을 뒤로 돌려도 쓰기가 멈추지 않는다.
// 시각(now)은 앱이 전역 시계의 1초 틱 시각을 준다(src/main/app.ts). 명령 처리처럼 틱 밖에서 부르는 경로도 그 마지막 틱 시각을 쓴다 — 1초 안의 차이다
// 저장은 하나다. 기존 `save.json` 을 그대로 쓴다 — 처음 읽을 때 v2 를 v3 으로 옮기고 원본을 `save.json.v2.bak` 에 남긴다.
// 쓰기는 잠금을 잡은 프로세스만 한다. `canWrite` 를 주지 않으면 늘 쓴다 (자체 검사와 개발용 실행기).
import fs from "node:fs";
import { PATHS } from "./paths.js";
import * as store from "../save/store.js";
import { SAVE_V3_RULES, TIME_V3_RULES } from "../save/rules.js";
import { applyTime, type TickEvents, type TimeInput } from "../state/time.js";
import { applyHits } from "../find/core.js";
import { createExecutor, type Executor, type TxResult } from "../tx/executor.js";
import { HANDLERS } from "../tx/handlers.js";
import { argsOf, requestIdOf, toCommandResult } from "../tx/bridge.js";
import { dexList } from "../tx/lists.js";
import { dexDetail } from "../tx/dex-detail.js";
import { shopDetail } from "../tx/shop-detail.js";
import { snapshot } from "../tx/snapshot.js";
import { agentInfo, connect, disconnect, hookCommandOf, status } from "../agents/registry.js";
import { findNode, lastSignals, probe } from "../agents/check.js";
import type { AgentAction, AgentReply, AgentRow, DexDetail, DexEntry, ManageReply, ManageRequest, ShopDetail, Snapshot } from "../shared/manage";
import type { FindRecordV3, SaveV3 } from "../shared/save-v3";
import { FIND_POKEMON } from "../shared/names/commands.js";
import type { AgentName, Command, CommandName, CommandSource } from "../shared/types";

// 저장 파일 — v2 와 같은 자리다. 파일을 처음 읽을 때 v3 으로 옮긴다 (src/save/store.ts)
export const saveFile = (): string => PATHS.save;

// 줍기로 포켓몬을 데려온 쓰기의 이름(FIND_POKEMON)은 src/shared/names/commands.ts 에 있다

// 클라우드에 바로 올리는 쓰기 — 잃으면 되돌리기 어려운 사건 (design-p1.md 6절, record.md D27).
// 이름은 src/tx/handlers.ts 의 거래 이름이다. 나머지 쓰기(시간 진행·돌봄·설정 등)는 2분 스로틀로 모아 올린다.
// 교환 ack 뒤 올리기는 교환 세션이 따로 알린다 (src/trade/session.ts onSettled)
export const EVENT_WRITES: ReadonlySet<string> = new Set([
  "trade.lock",
  "trade.unlock",
  "trade.apply",
  "mail.apply",
  "egg.open",
  "evolve",
  "starter.pick",
  FIND_POKEMON,
]);

// 쓰기 종류 — event 는 바로, tick 은 스로틀 (src/online/cloud.ts noteSaved)
export type WriteKind = "tick" | "event";

export interface GameV3 {
  file: string;
  read: () => SaveV3 | null;
  tick: (input?: TimeInput) => TickEvents | null; // 마지막 틱 뒤로 흐른 시간을 적용한다. 상한을 넘는 틈은 버린다. 파일은 flushMs 마다 쓴다
  flush: () => boolean; // 메모리에만 있는 시간 진행을 지금 쓴다 — 끄기·화면 잠금 직전. 쓸 것이 없으면 true
  find: (petIds: string[]) => FindRecordV3[] | null; // 줍기 — 굴림에서 주운 마리를 그 자리에서 저장에 넣는다. 쓰지 못했으면 null (src/find/core.ts)
  view: () => Snapshot | null;
  dex: () => DexEntry[];
  dexDetail: (slug: string) => DexDetail | null; // 도감 칸 하나의 상세
  shopDetail: (productId: string) => ShopDetail | null; // 상점 구매 창의 상세 (src/tx/shop-detail.ts)
  agents: (req?: { name: string; action: AgentAction }) => Promise<AgentReply>;
  send: (req: ManageRequest, from: CommandSource) => ManageReply;
  executor: Executor;
  saveFailing: () => boolean; // 저장이 이어서 SAVE_V3_RULES.saveFailNotifyAfter 번 실패했다 — 설정창이 안내를 띄운다
}

export interface GameV3Options {
  file?: string;
  now?: () => number;
  rand?: () => number;
  eggRand?: (eggId: string) => (() => number) | null; // 알 열기의 결정적 난수(P4b 계정 시드). 없거나 null 이면 rand
  canWrite?: () => boolean; // 잠금을 잡은 프로세스만 쓴다. 없으면 늘 쓴다 (자체 검사·개발용 실행기)
  onWrite?: (kind: WriteKind) => void; // 저장을 썼다 — 클라우드 저장이 바뀐 것으로 보고 올린다. EVENT_WRITES 면 event (src/online/cloud.ts noteSaved)
  flushMs?: number; // 시간 진행을 파일에 쓰는 간격. 0 이면 틱마다 쓴다(기본 — 자체 검사·개발용 실행기). 앱은 STATE_RULES.saveMs
  mono?: () => number; // 단조 시계 ms — 쓰기 간격을 잰다. 기본 performance.now. 자체 확인이 가짜로 준다
}

export function createGame({ file = saveFile(), now = Date.now, rand = Math.random, eggRand, canWrite, onWrite, flushMs = 0, mono = () => performance.now() }: GameV3Options = {}): GameV3 {
  // 메모리에만 있는 시간 진행 — 파일보다 새 저장. diskKey 는 그 저장의 바탕이 된 파일의 수정 시각·크기다
  let pending: SaveV3 | null = null;
  let diskKey: string | null = null;
  let lastFlushMono: number | null = null; // 마지막 주기 쓰기(성공·실패)의 단조 시각. null 이면 아직 없다 — 첫 틱은 쓴다
  let pendingWorkMs = 0; // pending 에 넣었지만 파일에 아직 안 쓴 작업 시간
  let carriedWorkMs = 0; // 밖에서 파일이 바뀌어 pending 을 버릴 때 건진 작업 시간 — 다음 틱에 다시 넘긴다
  const statKey = (): string | null => {
    try {
      const st = fs.statSync(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return null;
    }
  };
  // pending 이 아직 파일 위에 있는가 — 다른 곳이 파일을 바꿨으면 버린다
  const livePending = (): SaveV3 | null => {
    if (pending && statKey() !== diskKey) {
      pending = null;
      carriedWorkMs += pendingWorkMs; // 작업 시간은 파일에 없다 — 다음 틱이 다시 넣는다
      pendingWorkMs = 0;
    }
    return pending;
  };
  // 메모리 진행을 버린다 — 쓰는 프로세스가 아니게 됐다. reader 는 작업 시간도 들고 있지 않는다
  const dropPending = (): void => {
    pending = null;
    pendingWorkMs = 0;
    carriedWorkMs = 0;
  };
  // 파손 격리와 v2 이전 파일 교체는 쓰는 프로세스만 한다.
  // 수정 시각을 읽기보다 먼저 잰다 — 읽는 사이에 다른 곳이 쓰면 다음 확인에서 알아챈다. 읽으면서 이전·격리로 다시 썼으면 그 뒤 값을 쓴다
  const readDisk = (): SaveV3 | null => {
    const before = statKey();
    const r = store.read(file, { repair: canWrite ? canWrite() : true });
    diskKey = r.migrated || r.corrupted ? statKey() : before;
    return r.state;
  };
  // 읽는 쪽에는 사본을 준다 — 거래가 검사 중에 값을 바꾸고 실패해도 pending 이 더럽혀지지 않게
  const read = (): SaveV3 | null => {
    const p = livePending();
    return p ? structuredClone(p) : readDisk();
  };
  // 이어서 실패한 횟수 — 명령과 주기 저장(tick)을 함께 센다. writer 가 아니어서 쓰지 않은 것은 세지 않는다
  let failStreak = 0;
  // name — 거래 이름·FIND_POKEMON. 시간 진행 쓰기는 이름이 없다
  const write = (s: SaveV3, name?: string): boolean => {
    if (canWrite && !canWrite()) {
      dropPending(); // 쓰는 프로세스가 아니다 — 메모리 진행도 들고 있지 않는다
      return false;
    }
    const ok = store.write(file, s);
    failStreak = ok ? 0 : failStreak + 1;
    if (ok) {
      pending = null; // 파일이 가장 새 저장이다
      pendingWorkMs = 0;
      diskKey = statKey();
      onWrite?.(name && EVENT_WRITES.has(name) ? "event" : "tick");
    }
    return ok;
  };

  const executor = createExecutor({ read, write, now, rand, ...(eggRand ? { eggRand } : {}) }, HANDLERS);

  // 마지막 틱 뒤로 흐른 시간을 적용한다. 앱이 꺼져 있던 틈은 세지 않는다 — 상한을 넘는 몫은 버린다
  // input.workMs — 지난 틱 뒤로 에이전트가 작업한 시간. 흐른 시간을 넘는 몫은 applyTime 이 버린다
  // 주기 쓰기가 실패해도 pending 은 들고 있다(화면 값이 되돌아가지 않게). 다음 시도는 flushMs 뒤다 — 실패는 쓰기 주기마다 한 번 센다.
  // 그래서 저장 실패 안내(saveFailNotifyAfter 3번)는 주기 쓰기만으로는 약 45초 뒤에 뜬다. 명령 저장의 실패는 따로 센다
  const tick = (input: TimeInput = {}): TickEvents | null => {
    if (canWrite && !canWrite()) {
      dropPending();
      return null;
    }
    const save = livePending() ?? readDisk();
    if (!save) return null;
    const at = now();
    const elapsed = Math.min(TIME_V3_RULES.maxTickMs, Math.max(0, at - save.lastTickAt));
    const workMs = Math.max(0, input.workMs ?? 0) + carriedWorkMs;
    const events = applyTime(save, elapsed, at, { ...input, workMs });
    carriedWorkMs = 0;
    pendingWorkMs += Math.min(elapsed, workMs); // applyTime 이 흐른 시간을 넘는 작업 시간은 버린다
    save.savedAt = at;
    pending = save; // 읽는 쪽은 이 값을 본다
    const m = mono();
    if (lastFlushMono !== null && m - lastFlushMono < flushMs) return events;
    lastFlushMono = m;
    write(save); // 실패해도 pending 을 버리지 않는다 — 다음 쓰기 주기에 다시 쓴다
    return events;
  };

  const flush = (): boolean => {
    const p = livePending();
    if (!p) return true;
    lastFlushMono = mono();
    return write(p);
  };

  // 줍기 한 건(또는 같은 폴링의 몇 건)만 쓰는 작은 쓰기. 시간 적용은 하지 않는다 — 다음 틱이 한다.
  // 쓰지 못하면 null 이고 아무것도 반영하지 않는다. 그 건은 버린다 — 굴림이 무기억이라 다음 폴링에 다시 굴린다
  const find = (petIds: string[]): FindRecordV3[] | null => {
    const save = read();
    if (!save) return null;
    const at = now();
    const found = applyHits(save, petIds, at, rand);
    if (!found.length) return [];
    save.savedAt = at;
    return write(save, found.some((f) => f.kind === "pokemon") ? FIND_POKEMON : undefined) ? found : null;
  };

  const view = (): Snapshot | null => {
    const save = read();
    if (!save) return null;
    const snap = snapshot(save, undefined, undefined, undefined, now());
    return failStreak >= SAVE_V3_RULES.saveFailNotifyAfter ? { ...snap, saveFailing: true } : snap;
  };

  // 화면이 보낸 요청을 명령으로 바꿔 실행기에 넘긴다. 다리와 같은 규칙을 쓴다
  // 보낸 쪽이 reqId 를 주지 않으면 순번을 붙인다 — now() 는 마지막 1초 틱 시각이라, 같은 틱 안의 같은 명령 두 번이 같은 식별자가 돼
  // 두 번째가 replayed(앞 결과 재사용)로 처리됐다(2026-09-30 e2e-companion `game play` 두 번). 다시 보내 한 번만 반영할 조작은 reqId 를 준다
  let sendSeq = 0;
  const send = (req: ManageRequest, from: CommandSource): ManageReply => {
    const command: Command = { cmd: req.cmd as CommandName, target: req.target, args: req.args, from, at: now() };
    const given = typeof req.args?.reqId === "string" && req.args.reqId !== "";
    const id = given ? requestIdOf(command) : `${requestIdOf(command)}:${++sendSeq}`;
    const res: TxResult = executor.run({ id, name: command.cmd, args: argsOf(command) });
    return toCommandResult(res) as ManageReply;
  };

  const dex = (): DexEntry[] => {
    const save = read();
    return save ? dexList(save) : [];
  };

  // CLI 연결 — 저장이 아니라 각 CLI 의 설정 파일을 본다. 읽기만 하는 호출과 바꾸는 호출을 한 입구로 받는다
  // 연결 점검(2026-09-30): 읽을 때마다 Node.js 와 CLI 별 마지막 신호를 붙인다. Node.js 가 없으면 연결을 막는다. probe 는 훅을 한 번 돌려 본다
  const agents = async (req?: { name: string; action: AgentAction }): Promise<AgentReply> => {
    const node = await findNode(req?.action === "check");
    const list = (): AgentRow[] => {
      const signals = lastSignals(PATHS.state);
      return status().map((a) => ({ ...a, lastSignalAt: signals[a.name] ?? null }));
    };
    const platform = process.platform;
    if (!req || req.action === "check") return { ok: true, reason: "ok", list: list(), platform, node };
    if (!agentInfo(req.name)) return { ok: false, reason: "unknown-cli", list: list(), platform, node };
    if (req.action === "probe") {
      const hook = hookCommandOf(req.name as AgentName);
      if (!hook) return { ok: false, reason: "unknown-cli", list: list(), platform, node };
      const r = await probe(req.name, hook.command, hook.file, node, PATHS.state);
      return { ok: r.ok, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}), list: list(), platform, node };
    }
    if (req.action === "connect" && !node) return { ok: false, reason: "node-missing", list: list(), platform, node };
    const res = req.action === "connect" ? connect(req.name as AgentName) : disconnect(req.name as AgentName);
    return { ok: res.ok, reason: res.reason, list: list(), platform, node };
  };

  const detail = (slug: string): DexDetail | null => {
    const save = read();
    return save ? dexDetail(save, slug) : null;
  };

  const shop = (productId: string): ShopDetail | null => {
    const save = read();
    return save ? shopDetail(save, productId) : null;
  };

  return { file, read, tick, flush, find, view, dex, dexDetail: detail, shopDetail: shop, agents, send, executor, saveFailing: () => failStreak >= SAVE_V3_RULES.saveFailNotifyAfter };
}
