// 커맨드 처리기와 거래 실행기를 잇는 다리 — 계약은 docs/specs/modules.md "명령 계약"
//
// 표면(우클릭·트레이·CLI·확장)은 지금처럼 `Command` 를 보낸다. 여기서 `TxRequest` 로 바꿔 실행기에 넘기고
// 돌아온 결과를 다시 `CommandResult` 로 바꾼다. 표면은 v3 을 알 필요가 없다.
//
// 요청 식별자
//   보낸 쪽이 `args.reqId` 를 주면 그것을 쓴다. 같은 값으로 다시 보내면 한 번만 반영한다.
//   주지 않으면 보낸 곳·시각·명령·대상으로 만든다. 같은 순간에 같은 명령을 두 번 보내면 구분하지 못한다.
//   한 번만 반영해야 하는 조작(구매·부화·보상)은 보낸 쪽이 `reqId` 를 주는 것이 맞다.
import type { Command, CommandName, CommandResult } from "../shared/types.js";
import type { Dispatcher } from "../commands/dispatcher";
import type { Executor, TxRequest } from "./executor";

// 이 다리가 맡을 수 있는 명령 — 인자를 푸는 규칙(`argsOf`)이 여기 있다.
// 실제 배선은 `src/main/commands.ts` 가 한다. 무대 반응이나 그림 준비가 필요한 명령은 그쪽이 감싸서 등록한다.
// `settings.set` 은 넣지 않는다. 같은 이름을 `src/main/commands.ts` 가 창 표시 항목으로 먼저 맡는다.
export const V3_COMMANDS: readonly CommandName[] = [
  "party.show",
  "party.hide",
  "party.place",
  "party.swap",
  "party.keep",
  "egg.care",
  "egg.open",
  "bag.use",
  "shop.buy",
  "evolve",
  "feed",
  "play",
  "achievement.claim",
  "tutorial.skip",
  "tutorial.done",
  "starter.pick",
  "pet.set",
  "pet.form",
  "box.sort",
  "box.move",
  "box.rename",
];

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

export function requestIdOf(command: Command): string {
  const given = str(command.args?.reqId);
  if (given) return given;
  return `${command.from}:${command.at ?? 0}:${command.cmd}:${command.target ?? ""}`;
}

// `Command` 의 target·args 를 명령마다 다른 인자 모양으로 바꾼다
export function argsOf(command: Command): Record<string, unknown> {
  const a = command.args ?? {};
  const target = command.target;
  switch (command.cmd) {
    case "party.show":
    case "party.hide":
    case "party.keep":
      return { petId: target ?? str(a.petId) };
    case "party.place":
    case "party.swap":
      return { petId: target ?? str(a.petId), slotIndex: int(a.slotIndex) };
    case "egg.care":
      return { eggId: target ?? str(a.eggId), action: a.action };
    case "egg.open":
      return { eggId: target ?? str(a.eggId) };
    case "bag.use":
      return { itemId: target ?? str(a.itemId), petId: str(a.petId), nature: str(a.nature), ...(a.count !== undefined ? { count: a.count } : {}) };
    case "shop.buy":
      return { productId: target ?? str(a.productId), ...(a.count !== undefined ? { count: a.count } : {}) };
    case "evolve":
      return { petId: target ?? str(a.petId), to: str(a.to) };
    case "feed":
    case "play":
      return { petId: target ?? str(a.petId) };
    case "achievement.claim":
      return { id: target ?? str(a.id) };
    case "tutorial.skip":
    case "tutorial.done":
      return { id: target ?? str(a.id), steps: int(a.steps) };
    case "settings.set":
      return { key: target ?? str(a.key), value: a.value };
    case "starter.pick":
      return { species: target ?? str(a.species) };
    case "box.sort":
      return { boxId: target ?? str(a.boxId), by: str(a.by) };
    case "box.move":
      return { boxId: target ?? str(a.boxId), slot: int(a.slot), ...(a.toBoxId !== undefined ? { toBoxId: str(a.toBoxId) } : {}), ...(a.toSlot !== undefined ? { toSlot: int(a.toSlot) } : {}) };
    case "box.rename":
      return { boxId: target ?? str(a.boxId), name: typeof a.name === "string" ? a.name : undefined };
    case "pet.form":
      return { petId: target ?? str(a.petId), species: str(a.species) };
    case "pet.set":
      return { petId: target ?? str(a.petId), home: a.home, ...(a.size !== undefined ? { size: a.size } : {}) };
    default:
      return { ...a };
  }
}

// 실행기 결과 → 표면이 읽는 결과. 성공은 reason 이 "ok" 다
export function toCommandResult(res: ReturnType<Executor["run"]>): CommandResult {
  if (!res.ok) return { ok: false, reason: res.reason };
  const body = res.result != null && typeof res.result === "object" ? (res.result as Record<string, unknown>) : {};
  return { ok: true, reason: "ok", replayed: res.replayed, ...body };
}

// 다리를 놓는다. 돌려주는 함수를 부르면 걷는다
export function registerV3(dispatcher: Dispatcher, executor: Executor): () => void {
  const off: (() => void)[] = [];
  for (const cmd of V3_COMMANDS) {
    const handler = (command: Command): CommandResult => {
      const req: TxRequest = { id: requestIdOf(command), name: command.cmd, args: argsOf(command) };
      return toCommandResult(executor.run(req));
    };
    off.push(dispatcher.register(cmd, handler));
  }
  return () => {
    for (const fn of off) fn();
  };
}
