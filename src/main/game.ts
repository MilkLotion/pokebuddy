// 저장 v3 을 다루는 메인 쪽 입구 — 파일 읽기·쓰기, 거래 실행기, 시간 적용, 화면이 읽는 스냅샷을 한 곳에 모은다.
//
// 저장을 쓰는 곳은 거래 실행기 하나다 (docs/specs/modules.md "경계 원칙").
// 시간은 앱이 깨어 있는 동안만 흐른다. 앱은 15초마다, 관리 창은 열거나 명령을 받을 때 흐른 시간을 적용한다.
// 상한(`TIME_V3_RULES.maxTickMs`)을 넘는 틈은 앱 종료·절전·잠금으로 보고 버린다.
// 저장은 하나다. 기존 `save.json` 을 그대로 쓴다 — 처음 읽을 때 v2 를 v3 으로 옮기고 원본을 `save.json.v2.bak` 에 남긴다.
// 쓰기는 잠금을 잡은 프로세스만 한다. `canWrite` 를 주지 않으면 늘 쓴다 (자체 검사와 개발용 실행기).
import { PATHS } from "./paths.js";
import * as store from "../save/store.js";
import { SAVE_V3_RULES, TIME_V3_RULES } from "../save/rules.js";
import { applyTime, type TickEvents, type TimeInput } from "../state/time.js";
import { createExecutor, type Executor, type TxResult } from "../tx/executor.js";
import { HANDLERS } from "../tx/handlers.js";
import { argsOf, requestIdOf, toCommandResult } from "../tx/bridge.js";
import { dexList } from "../tx/lists.js";
import { dexDetail } from "../tx/dex-detail.js";
import { snapshot } from "../tx/snapshot.js";
import { agentInfo, connect, disconnect, status } from "../agents/registry.js";
import type { AgentAction, AgentReply, AgentRow, DexDetail, DexEntry, ManageReply, ManageRequest, Snapshot } from "../shared/manage";
import type { SaveV3 } from "../shared/save-v3";
import type { AgentName, Command, CommandName, CommandSource } from "../shared/types";

// 저장 파일 — v2 와 같은 자리다. 파일을 처음 읽을 때 v3 으로 옮긴다 (src/save/store.ts)
export const saveFile = (): string => PATHS.save;

export interface GameV3 {
  file: string;
  read: () => SaveV3 | null;
  tick: (input?: TimeInput) => TickEvents | null; // 마지막 틱 뒤로 흐른 시간을 적용한다. 상한을 넘는 틈은 버린다
  view: () => Snapshot | null;
  dex: () => DexEntry[];
  dexDetail: (slug: string) => DexDetail | null; // 도감 칸 하나의 상세
  agents: (req?: { name: string; action: AgentAction }) => AgentReply;
  send: (req: ManageRequest, from: CommandSource) => ManageReply;
  executor: Executor;
  saveFailing: () => boolean; // 저장이 이어서 SAVE_V3_RULES.saveFailNotifyAfter 번 실패했다 — 설정창이 안내를 띄운다
}

export interface GameV3Options {
  file?: string;
  now?: () => number;
  rand?: () => number;
  canWrite?: () => boolean; // 잠금을 잡은 프로세스만 쓴다. 없으면 늘 쓴다 (자체 검사·개발용 실행기)
}

export function createGame({ file = saveFile(), now = Date.now, rand = Math.random, canWrite }: GameV3Options = {}): GameV3 {
  // 파손 격리와 v2 이전 파일 교체는 쓰는 프로세스만 한다
  const read = (): SaveV3 | null => store.read(file, { repair: canWrite ? canWrite() : true }).state;
  // 이어서 실패한 횟수 — 명령과 주기 저장(tick)을 함께 센다. writer 가 아니어서 쓰지 않은 것은 세지 않는다
  let failStreak = 0;
  const write = (s: SaveV3): boolean => {
    if (canWrite && !canWrite()) return false;
    const ok = store.write(file, s);
    failStreak = ok ? 0 : failStreak + 1;
    return ok;
  };

  const executor = createExecutor({ read, write, now, rand }, HANDLERS);

  // 마지막 틱 뒤로 흐른 시간을 적용한다. 앱이 꺼져 있던 틈은 세지 않는다 — 상한을 넘는 몫은 버린다
  // input.workMs — 지난 틱 뒤로 에이전트가 작업한 시간. 흐른 시간을 넘는 몫은 applyTime 이 버린다
  const tick = (input: TimeInput = {}): TickEvents | null => {
    const save = read();
    if (!save) return null;
    const at = now();
    const elapsed = Math.min(TIME_V3_RULES.maxTickMs, Math.max(0, at - save.lastTickAt));
    const events = applyTime(save, elapsed, at, input);
    save.savedAt = at;
    if (!write(save)) return null; // 쓰지 못했으면 시간도 흐르지 않은 것으로 본다
    return events;
  };

  const view = (): Snapshot | null => {
    const save = read();
    if (!save) return null;
    const snap = snapshot(save, undefined, undefined, undefined, now());
    return failStreak >= SAVE_V3_RULES.saveFailNotifyAfter ? { ...snap, saveFailing: true } : snap;
  };

  // 화면이 보낸 요청을 명령으로 바꿔 실행기에 넘긴다. 다리와 같은 규칙을 쓴다
  const send = (req: ManageRequest, from: CommandSource): ManageReply => {
    const command: Command = { cmd: req.cmd as CommandName, target: req.target, args: req.args, from, at: now() };
    const res: TxResult = executor.run({ id: requestIdOf(command), name: command.cmd, args: argsOf(command) });
    return toCommandResult(res) as ManageReply;
  };

  const dex = (): DexEntry[] => {
    const save = read();
    return save ? dexList(save) : [];
  };

  // CLI 연결 — 저장이 아니라 각 CLI 의 설정 파일을 본다. 읽기만 하는 호출과 바꾸는 호출을 한 입구로 받는다
  const agents = (req?: { name: string; action: AgentAction }): AgentReply => {
    const list = (): AgentRow[] => status().map((a) => ({ ...a }));
    if (!req || req.action === "check") return { ok: true, reason: "ok", list: list() };
    if (!agentInfo(req.name)) return { ok: false, reason: "unknown-cli", list: list() };
    const res = req.action === "connect" ? connect(req.name as AgentName) : disconnect(req.name as AgentName);
    return { ok: res.ok, reason: res.reason, list: list() };
  };

  const detail = (slug: string): DexDetail | null => {
    const save = read();
    return save ? dexDetail(save, slug) : null;
  };

  return { file, read, tick, view, dex, dexDetail: detail, agents, send, executor, saveFailing: () => failStreak >= SAVE_V3_RULES.saveFailNotifyAfter };
}
