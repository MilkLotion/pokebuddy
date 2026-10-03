// 명령 통로 — 우클릭·트레이·설정창·CLI·확장의 요청 { cmd, target?, args?, from } 을 한 곳에서 받아 모듈에 분배한다 (design.md "커맨드 처리기")
//
// 비즈니스 로직은 없다 — 모듈(state · dex · shop · agents · main)이 자기 명령을 register 하고, 여기는 이름으로 찾아 부르기만 한다.
// 결과는 문구가 아니라 코드(CommandResult) — 문구는 표면(메뉴·설정창·CLI)이 언어 파일로 만든다.
//   모르는 명령            { ok:false, reason:"unknown-cmd" }
//   핸들러가 던짐          { ok:false, reason:"error", message }   — 표면이 죽지 않게 여기서 받는다
//   핸들러가 결과를 안 줌   { ok:false, reason:"no-result" }
// 같은 명령을 두 번 register 하면 던진다 — 모듈 배선 실수를 기동 때 바로 드러내기 위해. 바꿔 끼우려면 먼저 해제(register 가 돌려준 함수)
import type { Command, CommandResult } from "../shared/command.js";
import { COMMANDS, type CommandName, type TxName } from "../shared/names/commands.js";
import type { Reason } from "../shared/names/reasons.js";

export type CommandHandler = (command: Command) => CommandResult | Promise<CommandResult>;
export type DispatchLog = (entry: Record<string, unknown>) => void;

export interface DispatcherOptions {
  log?: DispatchLog | null;
  // 까닭을 주면 처리기를 부르지 않고 그 까닭으로 거절한다 — 메인이 "멈춘 동안에는 haltOpen 인 것만 받는다"를 꽂는다 (메인 레인 M7)
  guard?: ((command: Command) => Reason | null) | null;
  // 처리기가 답한 뒤 한 번 — 성공과 실패 모두. guard 가 거절한 명령에는 부르지 않는다. 메인이 화면 동기화를 꽂는다 (메인 레인 M7)
  onDone?: ((command: Command, result: CommandResult) => void) | null;
}

export interface Dispatcher {
  register(cmd: CommandName, handler: CommandHandler): () => void; // 돌려주는 함수로 해제
  has(cmd: string): boolean;
  dispatch(command: Command): Promise<CommandResult>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const isResult = (v: unknown): v is CommandResult => isObj(v) && typeof v.ok === "boolean";
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createDispatcher({ log = null, guard = null, onDone = null }: DispatcherOptions = {}): Dispatcher {
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
      const refused = guard?.(command) ?? null;
      if (refused) return { ok: false, reason: refused, cmd };
      const done = (r: CommandResult): CommandResult => {
        onDone?.(command, r);
        return r;
      };
      try {
        const r = await handler(command);
        if (!isResult(r)) return done({ ok: false, reason: "no-result", cmd });
        if (typeof r.reason !== "string") r.reason = r.ok ? "ok" : "error"; // 핸들러가 reason 을 빼먹어도 표면이 코드를 받게
        return done(r);
      } catch (e) {
        const message = errMessage(e);
        log?.({ dispatch: "handler-error", cmd, message });
        return done({ ok: false, reason: "error", message, cmd });
      }
    },
  };
}

// 표면이 보낼 수 있는 거래 명령 — 명령 표의 via "tx" 가운데 internal 이 아닌 것
export type SurfaceTxName = Extract<TxName, CommandName>;
export const SURFACE_TX_NAMES = (Object.keys(COMMANDS) as (keyof typeof COMMANDS)[]).filter((name) => {
  const spec = COMMANDS[name] as { via: string; internal?: true };
  return spec.via === "tx" && spec.internal !== true;
}) as SurfaceTxName[];

// 거래 명령을 한꺼번에 등록한다 — 처리는 run 하나다(writer 면 실행기, reader 면 명령 통로 파일).
// except 의 이름은 부르는 쪽이 따로 등록한다(무대 반응·그림 준비가 필요한 명령). 돌려주는 함수로 모두 해제한다
export function registerTxCommands(dispatcher: Dispatcher, run: CommandHandler, o: { except?: readonly SurfaceTxName[] } = {}): () => void {
  const off = SURFACE_TX_NAMES.filter((name) => !o.except?.includes(name)).map((name) => dispatcher.register(name, run));
  return () => {
    for (const fn of off) fn();
  };
}
