// 명령 통로 파일과 명령 통로를 잇는다 — 명령 통로는 src/tx/dispatcher.ts 에 있다
// bridgeMailbox 는 메인의 명령 배선(src/main/commands.ts)으로 간다 — 그때 이 파일을 지운다
import { serveCommands, type CommandServer, type ServeOptions } from "../save/command-channel.js";
import type { Dispatcher } from "../tx/dispatcher.js";

// 명령 통로 파일의 요청을 처리기에 잇는다 — writer 만 부른다. 돌려주는 stop 으로 끊는다
export function bridgeMailbox(dispatcher: Dispatcher, dir: string, opts: ServeOptions = {}): CommandServer {
  return serveCommands(dir, (command) => dispatcher.dispatch(command), opts);
}
