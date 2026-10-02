// 커맨드 처리기 — 우클릭·트레이·설정창·CLI·확장의 요청 { cmd, target?, args?, from } 을 한 곳에서 받아 모듈에 분배한다 (design.md "커맨드 처리기")
//
// 비즈니스 로직은 없다 — 모듈(state · dex · shop · agents · main)이 자기 명령을 register 하고, 여기는 이름으로 찾아 부르기만 한다.
// 결과는 문구가 아니라 코드(CommandResult) — 문구는 표면(메뉴·설정창·CLI)이 언어 파일로 만든다.
//   모르는 명령            { ok:false, reason:"unknown-cmd" }
//   핸들러가 던짐          { ok:false, reason:"error", message }   — 표면이 죽지 않게 여기서 받는다
//   핸들러가 결과를 안 줌   { ok:false, reason:"no-result" }
// 같은 명령을 두 번 register 하면 던진다 — 모듈 배선 실수를 기동 때 바로 드러내기 위해. 바꿔 끼우려면 먼저 해제(register 가 돌려준 함수)
import { serve, type MailServer, type ServeOptions } from "../save/mailbox.js";
import type { Command, CommandResult } from "../shared/command.js";
import type { CommandName } from "../shared/names/commands.js";

export type CommandHandler = (command: Command) => CommandResult | Promise<CommandResult>;
export type DispatchLog = (entry: Record<string, unknown>) => void;

export interface DispatcherOptions {
  log?: DispatchLog | null;
}

export interface Dispatcher {
  register(cmd: CommandName, handler: CommandHandler): () => void; // 돌려주는 함수로 해제
  has(cmd: string): boolean;
  dispatch(command: Command): Promise<CommandResult>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const isResult = (v: unknown): v is CommandResult => isObj(v) && typeof v.ok === "boolean";
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createDispatcher({ log = null }: DispatcherOptions = {}): Dispatcher {
  const handlers = new Map<string, CommandHandler>();

  return {
    register(cmd, handler) {
      if (handlers.has(cmd)) throw new Error(`dispatcher: "${cmd}" 는 이미 등록됐다`);
      handlers.set(cmd, handler);
      return () => {
        if (handlers.get(cmd) === handler) handlers.delete(cmd);
      };
    },

    has: (cmd) => handlers.has(cmd),

    async dispatch(command) {
      const cmd = isObj(command) && typeof command.cmd === "string" ? command.cmd : "";
      const handler = handlers.get(cmd);
      if (!handler) return { ok: false, reason: "unknown-cmd", cmd };
      try {
        const r = await handler(command);
        if (!isResult(r)) return { ok: false, reason: "no-result", cmd };
        if (typeof r.reason !== "string") r.reason = r.ok ? "ok" : "error"; // 핸들러가 reason 을 빼먹어도 표면이 코드를 받게
        return r;
      } catch (e) {
        const message = errMessage(e);
        log?.({ dispatch: "handler-error", cmd, message });
        return { ok: false, reason: "error", message, cmd };
      }
    },
  };
}

// mailbox 의 요청을 처리기에 잇는다 — writer 만 부른다. 돌려주는 stop 으로 끊는다
export function bridgeMailbox(dispatcher: Dispatcher, dir: string, opts: ServeOptions = {}): MailServer {
  return serve(dir, (command) => dispatcher.dispatch(command), opts);
}
