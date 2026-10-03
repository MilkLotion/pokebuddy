// 표면 명령 입구 — 계약은 docs/specs/modules.md "명령 계약"
//
// 표면(우클릭·트레이·CLI·확장)은 지금처럼 `Command` 를 보낸다. 여기서 `TxRequest` 로 바꿔 실행기에 넘기고
// 돌아온 결과를 다시 `CommandResult` 로 바꾼다. 표면은 v3 을 알 필요가 없다.
//
// 요청 식별자
//   보낸 쪽이 `args.reqId` 를 주면 그것을 쓴다. 같은 값으로 다시 보내면 한 번만 반영한다.
//   주지 않으면 보낸 곳·시각·명령·대상으로 만든다. 같은 순간에 같은 명령을 두 번 보내면 구분하지 못한다.
//   한 번만 반영해야 하는 조작(구매·부화·보상)은 보낸 쪽이 `reqId` 를 주는 것이 맞다.
import { COMMANDS } from "../shared/names/commands.js";
import type { Command, CommandResult, TxRequest } from "../shared/command.js";
import { argsFromCommand } from "./args.js";
import type { Executor } from "./executor";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function requestIdOf(command: Command): string {
  const given = str(command.args?.reqId);
  if (given) return given;
  return `${command.from}:${command.at ?? 0}:${command.cmd}:${command.target ?? ""}`;
}

// 실행기 결과 → 표면이 읽는 결과. 성공은 reason 이 "ok" 다
export function toCommandResult(res: ReturnType<Executor["run"]>): CommandResult {
  if (!res.ok) return { ok: false, reason: res.reason };
  const body = res.result != null && typeof res.result === "object" ? (res.result as Record<string, unknown>) : {};
  return { ok: true, reason: "ok", replayed: res.replayed, ...body };
}

// 표면이 보낸 명령 하나를 실행기에 넘긴다 — 명령 표에 없거나, 거래 명령이 아니거나, 표면이 보낼 수 없는(internal) 명령이면 unknown-cmd
export function runTxCommand(executor: Executor, command: Command): CommandResult {
  const spec = (COMMANDS as Record<string, { via: string; internal?: true } | undefined>)[command.cmd];
  if (!spec || spec.via !== "tx" || spec.internal === true) return { ok: false, reason: "unknown-cmd" };
  const req: TxRequest = { id: requestIdOf(command), name: command.cmd, args: argsFromCommand(command) };
  return toCommandResult(executor.run(req));
}
