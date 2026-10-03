// 명령 통로 — mailbox/ 폴더의 파일 하나 = 요청 하나 (config.js PATHS.mailbox). 우편함(src/mail)과 다르다. 1판 game/mailbox.js 를 옮기며 요청·회신을 Command · CommandResult 로
//
// 소켓·IPC 서버 없이 파일로만 (저장소 원칙). CLI·확장·읽기 전용 펫이 요청을 두고, writer 펫이 처리해 회신한다.
//   요청  <시각>-<pid>-<cmd>.json          Command 그대로 { cmd, target?, args?, from, at }   — tmp 에 쓰고 rename (반쪽 파일을 읽지 않게)
//   회신  <시각>-<pid>-<cmd>.result.json   CommandResult 그대로                              — 보낸 쪽이 받으면 지운다
// writer 는 fs.watch (src/main/anchor.ts watchRecords 의 pending 디바운스) + 5초 폴링 보강으로 폴더를 본다.
// 파손 요청은 지운다. 60초 넘은 회신은 청소한다. 60초 넘은 요청도 처리하지 않고 지운다 — 죽은 writer 가 남긴 어제의 밥을 주지 않게
// 시계는 기본 실제 시계(realClock) — 다른 프로세스가 쓴 at·mtime 과 견주므로 게임 시계를 주입하면 어긋난다. 시험에서만 바꾼다
// 명령 이름은 소문자·점 (party.show 처럼) — 파일 이름에 그대로 들어가므로 그 밖의 글자는 bad-cmd
import fs from "node:fs";
import path from "node:path";
import { realClock, type Clock } from "../shared/clock.js";
import type { Command, CommandResult } from "../shared/command.js";
import type { CommandName } from "../shared/names/commands.js";
import { hasCommandFlag, isCommandSource } from "../shared/names/commands.js";
import { SAVE_RULES } from "./rules.js";
import { writeAtomic } from "../platform/atomic-write.js";
import { watchDir } from "../platform/watch-dir.js";

export type ChannelLog = (entry: Record<string, unknown>) => void;
export type CommandHandler = (command: Command) => CommandResult | Promise<CommandResult>;

export interface SendOptions {
  timeoutMs?: number;
  pollMs?: number;
  clock?: Clock;
}

export interface ServeOptions {
  pollMs?: number; // fs.watch 보강 폴링 간격
  log?: ChannelLog | null;
  clock?: Clock;
}

export interface CommandServer {
  scan(): Promise<void>; // 지금 쌓인 요청을 한 번 처리 (시험·즉시 반영용)
  stop(): void; // 감시·폴링을 멈춘다
}

export const CMD = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
export const REQUEST = /^(\d+)-(\d+)-([a-z][a-z0-9.-]*)(?:-\d+)?\.json$/;
export const RESULT = /\.result\.json$/;

// 파일 이름에 넣을 수 있는 명령 이름인가 — ".result" 로 끝나면 회신 파일과 헷갈리므로 막는다
export const isCmdName = (v: unknown): v is CommandName => typeof v === "string" && CMD.test(v) && !v.endsWith(".result");

export const requestName = (at: number, pid: number, cmd: string): string => `${at}-${pid}-${cmd}.json`;
export const resultName = (name: string): string => name.replace(/\.json$/, ".result.json");

// 처리 줄을 막지 않고 따로 도는 명령 — 서버를 타는 교환의 조작. 목록은 src/shared/names/commands.ts 의 detached
const detached = (cmd: string): boolean => hasCommandFlag(cmd, "detached");

// 같은 밀리초에 같은 명령이 여러 번 와도 요청·회신 파일을 공유하지 않음
let sequence = 0;

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const isResult = (v: unknown): v is CommandResult => isObj(v) && typeof v.ok === "boolean";
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function unlinkQuiet(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // 이미 없다
  }
}

// 파일에서 읽은 것 → Command. cmd 가 없거나 이름이 틀리면 null. from 을 모르면 cli 로 본다 (통로를 쓰는 쪽은 CLI·확장·읽기 전용 펫)
function toCommand(raw: unknown): Command | null {
  if (!isObj(raw) || !isCmdName(raw.cmd)) return null;
  const command: Command = { cmd: raw.cmd, from: isCommandSource(raw.from) ? raw.from : "cli" };
  if (typeof raw.target === "string") command.target = raw.target;
  if (isObj(raw.args)) command.args = raw.args;
  if (typeof raw.at === "number" && Number.isFinite(raw.at)) command.at = raw.at;
  return command;
}

// 요청을 두고 결과를 기다린다 — CommandResult 또는 { ok:false, reason:"timeout" }. 절대 throw 하지 않는다
//   at 은 여기서 찍는다 (보낸 시각) — writer 가 오래된 요청을 가르는 기준
export function sendToWriter(dir: string, command: Command, opts: SendOptions = {}): Promise<CommandResult> {
  const name = isObj(command) && typeof command.cmd === "string" ? command.cmd : ""; // 옛 형식·파손 요청은 cmd 가 없을 수 있다 — 아래에서 bad-cmd 로 돌려준다
  const slow = hasCommandFlag(name, "slow"); // 그림을 받거나 서버를 타는 명령 — 목록은 src/shared/names/commands.ts 의 slow
  const { channel } = SAVE_RULES;
  const { timeoutMs = slow ? channel.sendSlowTimeoutMs : channel.sendTimeoutMs, pollMs = channel.sendPollMs, clock = realClock } = opts;
  return new Promise((resolve) => {
    const cmd = isObj(command) ? command.cmd : undefined;
    if (!isCmdName(cmd)) return resolve({ ok: false, reason: "bad-cmd", cmd: String(cmd) });
    const at = clock();
    const name = requestName(at, process.pid, cmd).replace(/\.json$/, `-${++sequence}.json`);
    const file = path.join(dir, name);
    const resultFile = path.join(dir, resultName(name));
    if (!writeAtomic(file, { ...command, at })) return resolve({ ok: false, reason: "send-failed", cmd });

    let done = false;
    const finish = (value: CommandResult) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(value);
    };
    const poll = setInterval(() => {
      let data: unknown;
      try {
        data = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      } catch {
        return; // 아직 없다 · 쓰는 중
      }
      unlinkQuiet(resultFile);
      finish(isResult(data) ? data : { ok: false, reason: "bad-result", cmd });
    }, pollMs);
    const timer = setTimeout(() => {
      unlinkQuiet(file); // 요청 회수 — writer 가 없거나 늦다. 나중에 처리돼 밥이 두 번 가지 않게
      finish({ ok: false, reason: "timeout", cmd });
    }, timeoutMs);
  });
}

// 폴더를 지켜보며 요청을 처리한다 — handler(command) 의 반환(값 또는 Promise)이 회신이 된다.
// handler 가 던지면 { ok:false, reason:"error", message } 로 회신한다 — 통로가 멈추지 않게
export function serveCommands(dir: string, handler: CommandHandler, opts: ServeOptions = {}): CommandServer {
  const { pollMs = SAVE_RULES.channel.pollMs, log = null, clock = realClock } = opts;
  let closed = false;
  let busy = false;
  let again = false;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // 폴더를 못 만들면 폴링이 매번 빈손 — 조용히
  }

  async function handleRequest(name: string): Promise<void> {
    const file = path.join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      unlinkQuiet(file); // 파손 — 지운다
      return;
    }
    unlinkQuiet(file); // 먼저 지운다 — 처리 중 다시 스캔돼도 두 번 하지 않게
    const command = toCommand(raw);
    if (!command) return;
    if (command.at != null && clock() - command.at > SAVE_RULES.channel.requestTtlMs) return; // 오래된 요청은 버린다
    const run = async (): Promise<void> => {
      let result: CommandResult;
      try {
        const r = await handler(command);
        result = isResult(r) ? r : { ok: false, reason: "no-result", cmd: command.cmd };
      } catch (e) {
        log?.({ mailbox: "handle-error", cmd: command.cmd, error: errMessage(e) });
        result = { ok: false, reason: "error", message: errMessage(e), cmd: command.cmd };
      }
      writeAtomic(path.join(dir, resultName(name)), result);
    };
    // 서버를 기다리는 명령은 줄에서 빼 따로 돌린다 — 뒤에 온 돌봄 같은 명령이 수십 초 기다리지 않게(교환 T-06).
    // 교환 명령끼리 겹치면 교환 세션이 busy 로 거절한다
    if (detached(command.cmd)) void run();
    else await run();
  }

  function sweepResult(name: string): void {
    const file = path.join(dir, name);
    try {
      if (clock() - fs.statSync(file).mtimeMs > SAVE_RULES.channel.resultTtlMs) fs.unlinkSync(file);
    } catch {
      // 사이에 가져갔다
    }
  }

  async function scan(): Promise<void> {
    if (closed) return;
    if (busy) {
      again = true; // 처리 중 새 요청이 왔다 — 끝나고 한 번 더
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        let names: string[] = [];
        try {
          names = fs.readdirSync(dir).sort();
        } catch {
          names = [];
        }
        for (const name of names) {
          if (closed) break;
          if (RESULT.test(name)) sweepResult(name);
          else if (REQUEST.test(name)) await handleRequest(name);
        }
      } while (again && !closed);
    } catch (e) {
      log?.({ mailbox: "scan-error", error: errMessage(e) });
    } finally {
      busy = false;
    }
  }

  // tmp+rename 은 이벤트를 여러 번 낸다 — 한 틱으로 묶는다 (src/platform/watch-dir.ts). 감시가 멈추면 폴링이 이어 간다
  const watcher = watchDir(dir, () => void scan());
  const timer = setInterval(() => void scan(), pollMs);
  void scan(); // 떠 있는 동안 쌓인 요청부터

  return {
    scan,
    stop() {
      closed = true;
      clearInterval(timer);
      watcher.stop();
    },
  };
}
