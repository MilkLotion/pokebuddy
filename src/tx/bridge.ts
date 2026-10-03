// [임시] 옛 자리 — 인자 풀기는 ./args.ts, 표면 명령 입구는 ./commands.ts, 거래 명령 등록은 ./dispatcher.ts 의 registerTxCommands 다.
// src/tools/selftest/selftest-tx.ts·selftest-box.ts 가 새 자리로 가면 이 파일을 지운다
import type { CommandName } from "../shared/names/commands.js";
import type { Dispatcher } from "./dispatcher.js";
import type { Executor } from "./executor";
import { runTxCommand } from "./commands.js";

// 이 다리가 맡을 수 있는 명령 — 인자를 푸는 규칙(`argsOf`)이 여기 있다.
// 실제 배선은 `src/main/commands.ts` 가 한다. 무대 반응이나 그림 준비가 필요한 명령은 그쪽이 감싸서 등록한다.
// `settings.set` 은 넣지 않는다. 같은 이름을 `src/main/commands.ts` 가 창 표시 항목으로 먼저 맡는다.
export const V3_COMMANDS: readonly CommandName[] = [
  "party.show",
  "party.hide",
  "party.place",
  "party.swap",
  "party.move",
  "party.keep",
  "party.preset",
  "party.preset.rename",
  "egg.open",
  "bag.use",
  "bag.sell",
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
  "pet.sell",
  "box.sort",
  "box.move",
  "box.rename",
  "box.order",
];

export { argsFromCommand as argsOf } from "./args.js";
export { requestIdOf, toCommandResult } from "./commands.js";

// 다리를 놓는다 — 이 목록의 명령마다 runTxCommand. 돌려주는 함수를 부르면 걷는다
export function registerV3(dispatcher: Dispatcher, executor: Executor): () => void {
  const off = V3_COMMANDS.map((cmd) => dispatcher.register(cmd, (command) => runTxCommand(executor, command)));
  return () => {
    for (const fn of off) fn();
  };
}
