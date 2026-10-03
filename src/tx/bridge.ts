// [임시] 옛 자리 — 인자 풀기는 ./args.ts, 표면 명령 입구는 ./commands.ts, 거래 명령 등록은 ./dispatcher.ts 의 registerTxCommands 다.
// src/tools/selftest/selftest-box.ts(계약 레인 C6b 몫)가 새 자리로 가면 이 파일을 지운다

export { argsFromCommand as argsOf } from "./args.js";
export { requestIdOf, toCommandResult } from "./commands.js";

