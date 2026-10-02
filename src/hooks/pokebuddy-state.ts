// 펫 상태 기록 — CLI LLM(claude·codex·gemini)의 훅 이벤트를 세션별 상태 파일로 남김 (pokebuddy 의 펫이 읽음)
// - 펫을 쓰지 않으면(~/.claude/pokebuddy 폴더 없음) 즉시 종료
// - 조상 프로세스(훅 → CLI → 터미널 셸)를 함께 적어, 펫이 자기 터미널 세션만 따라가게 함
// - stdout·stderr 출력 없음: claude 는 SessionStart·UserPromptSubmit 의 stdout 을 대화 컨텍스트로 넣고,
//   gemini 는 stdout(비면 stderr)을 훅 결과로 읽는다
// - codex·gemini 는 훅이 끝나길 기다린다 — 빨리 끝내야 CLI 가 느려지지 않는다
//
// 독립 실행 파일 — 프로젝트의 다른 모듈에서는 타입만 본다(import type — 컴파일하면 사라진다). 값은 node 내장만 쓴다. 컴파일 결과 dist/hooks/pokebuddy-state.js 를
// setup 이 ~/.claude/scripts/hooks/pokebuddy-state.cjs 로 복사하고(내용이 CJS 라 그대로 돈다), CLI 가 node <경로> 로 부른다
//
// 등록한 CLI 는 인자로 받는다 (node pokebuddy-state.cjs --cli gemini). 없으면 claude — 예전 등록은 인자가 없다
//
// 토큰 사용량 — claude 는 턴이 끝날 때(Stop) 대화 기록(transcript_path, JSONL)에서 응답마다 붙는 usage 를 읽어
// 기록에 누적해 적는다(usage · usageOffset). 지난번 읽은 바이트 뒤부터만 읽어 큰 기록도 빠르다.
// 세션 시작(재개 포함)에는 그 시점의 크기를 기준점으로 잡아 옛 대화를 세지 않는다. 펫(상태 모듈)은 증분만 본다.
// codex·gemini 의 기록 위치·모양은 아직 모른다 — 안 읽는다 [스펙 미확정]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookStateRecord, Usage } from "../shared/hook-record";
import type { AgentState } from "../shared/names/agents";

// ── 타입 — 훅 입력. 상태 기록의 형식(HookStateRecord)은 src/shared/hook-record.ts 에 있다 ────────────

// CLI 가 stdin 으로 주는 훅 입력 — 셋이 공통으로 쓰는 필드만. 모르는 필드는 보지 않는다
interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string; // claude — 대화 기록 JSONL
  tool_name?: string;
  tool_response?: unknown;
  error?: unknown; // claude PostToolUseFailure
  is_interrupt?: boolean; // claude — 사용자가 도구를 멈춤
  notification_type?: string; // gemini Notification
}

// 이벤트 → 펫 동작. hold 가 있으면 그 초 동안 보여준 뒤 then 으로 전환. prompt 는 사용자가 뭔가 한 순간
interface Mapping {
  state: AgentState;
  hold?: number;
  then?: AgentState;
  prompt?: true;
}
type EventEntry = Mapping | ((data: HookInput) => Mapping | null);

type BaseRecord = Omit<HookStateRecord, "promptAt" | "usage" | "usageOffset" | "usageBase" | "usageAt">;

const POKEBUDDY_DIR = path.join(os.homedir(), ".claude", "pokebuddy");
const STATE_DIR = path.join(POKEBUDDY_DIR, "state");
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ZERO_USAGE: Readonly<Usage> = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };

const cliArg = process.argv.indexOf("--cli");
const CLI = cliArg > 0 && process.argv[cliArg + 1] ? String(process.argv[cliArg + 1]) : "claude";

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// 도구 결과가 실패인가 — CLI 마다 모양이 달라 흔한 필드만 본다. 모르는 모양이면 실패로 치지 않는다
//   gemini AfterTool  tool_response.error
//   codex PostToolUse tool_response 형식이 정해져 있지 않다 (스키마가 아무 값) — 종료 코드·오류 표시가 있을 때만
function toolFailed(data: HookInput): boolean {
  const r = data.tool_response;
  if (!isObj(r)) return false;
  if (r.error) return true;
  if (r.success === false || r.is_error === true || r.isError === true) return true;
  const code = r.exit_code ?? r.exitCode;
  return typeof code === "number" && code !== 0;
}

const FAILED_TOOL: Mapping = { state: "failed", hold: 6, then: "running" };
// 응답 완료는 waving — review 줄은 프레임 6개 중 서로 다른 그림이 3개뿐이라 멈춘 것처럼 보인다
const TURN_DONE: Mapping = { state: "waving", hold: 4, then: "idle" };

// claude 도구 실패 중 실패로 치지 않는 것 (입력 실측 — { error, is_interrupt })
//   셸 명령이 0 아닌 코드로 끝남  error 가 "Exit code N" 으로 시작한다. test·diff 같은 검사 명령의 흔한 결과라
//                                작업이 이어진다 — 쓰러뜨리면 한 턴에 몇 번씩 쓰러져 진짜 실패가 묻힌다
//                                (grep 이 못 찾은 것은 claude 가 실패로 알리지도 않는다)
//   사용자가 도구를 멈춤(Esc)      턴이 끝났는데 Stop 이 오지 않는다 — 대기로 돌린다
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
function claudeToolFailure(data: HookInput): Mapping {
  if (data.is_interrupt === true) return { state: "idle" };
  if (typeof data.tool_name === "string" && SHELL_TOOLS.has(data.tool_name) && /^Exit code \d+/.test(String(data.error || ""))) return { state: "running" };
  return FAILED_TOOL;
}

// 사용자에게 묻고 답을 기다리는 도구 — 도구 호출이지만 일하는 중이 아니라 기다리는 중이다
const ASK_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

// 이벤트 → 펫 동작. hold 가 있으면 그 초 동안 보여준 뒤 then 으로 전환.
// 함수면 입력을 보고 고른다 (null 이면 기록하지 않음). 이름이 같은 claude·codex 이벤트는 뜻도 같다
const EVENT_STATES: Record<string, EventEntry> = {
  // claude · codex
  SessionStart: { state: "waving", hold: 6, then: "idle" },
  UserPromptSubmit: { state: "running", prompt: true },
  PreToolUse: (data) => (typeof data.tool_name === "string" && ASK_TOOLS.has(data.tool_name) ? { state: "waiting" } : { state: "running" }),
  PermissionRequest: { state: "waiting" },
  // 도구가 끝남 — 승인 대기에서 작업으로 돌아가는 신호이기도 하다.
  // claude 는 실패를 PostToolUseFailure 로 따로 알리므로 결과 모양을 보지 않는다 (codex 는 여기서 실패를 가린다)
  PostToolUse: (data) => (CLI !== "claude" && toolFailed(data) ? FAILED_TOOL : { state: "running" }),
  PostToolUseFailure: claudeToolFailure, // claude
  Stop: TURN_DONE,
  StopFailure: { state: "failed", hold: 10, then: "idle" }, // claude
  Interrupt: { state: "idle" }, // codex — 사용자가 턴을 멈춤
  SessionEnd: { state: "idle" }, // codex · gemini
  // gemini
  BeforeAgent: { state: "running", prompt: true },
  AfterTool: (data) => (toolFailed(data) ? FAILED_TOOL : { state: "running" }),
  Notification: (data) => (data.notification_type === "ToolPermission" ? { state: "waiting" } : null),
  AfterAgent: TURN_DONE,
};

// 이 훅을 띄운 조상 프로세스 목록 — 훅 → (셸) → CLI → 터미널 셸 순으로 올라간다
// 펫 오버레이가 자기 터미널 셸 번호가 이 목록에 있는지로 "내 세션"을 가린다.
// 비어 있으면 펫은 작업 폴더(cwd)로만 가려서, 같은 폴더를 연 두 터미널의 상태가 섞인다
function ancestorPids(): number[] {
  try {
    // Windows 에는 ps 가 없다 — PowerShell 로 프로세스 표를 읽는다 (수백 ms, 그래서 세션마다 한 번만 부른다)
    const out =
      process.platform === "win32"
        ? execFileSync(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }",
            ],
            { encoding: "utf8", timeout: 4000, windowsHide: true },
          )
        : execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8", timeout: 2000 });
    const parent = new Map<number, number>();
    for (const line of out.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid && ppid !== undefined) parent.set(pid, ppid);
    }
    const chain: number[] = [];
    let cur = process.pid;
    for (let depth = 0; depth < 12; depth++) {
      const next = parent.get(cur);
      if (!next || next <= 1) break;
      chain.push(next);
      cur = next;
    }
    return chain;
  } catch {
    return [];
  }
}

// 대화 기록의 fromOffset 뒤를 읽어 assistant 응답의 usage 를 더한다. 반환 { usage, offset }.
// 파일이 줄었으면(새 기록) 처음부터. 마지막 줄이 아직 쓰는 중이면 그 줄은 다음에 (offset 을 그 앞에 둔다)
function readUsageDelta(file: string, fromOffset: number): { usage: Usage; offset: number } {
  const zero: Usage = { ...ZERO_USAGE };
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    let offset = fromOffset > 0 && fromOffset <= size ? fromOffset : 0;
    if (size <= offset) return { usage: zero, offset };
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    let text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { usage: zero, offset };
    text = text.slice(0, lastNl + 1);
    offset += Buffer.byteLength(text, "utf8");
    const usage: Usage = { ...zero };
    for (const line of text.split("\n")) {
      if (!line) continue;
      let j: unknown;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObj(j) || j.type !== "assistant" || !isObj(j.message) || !isObj(j.message.usage)) continue;
      const u = j.message.usage;
      usage.in += Number(u.input_tokens) || 0;
      usage.out += Number(u.output_tokens) || 0;
      usage.cacheRead += Number(u.cache_read_input_tokens) || 0;
      usage.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
    }
    return { usage, offset };
  } catch {
    return { usage: zero, offset: fromOffset || 0 };
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

// 지난 기록 — 우리가 쓴 파일이라 모양을 믿되, 객체가 아니면 없는 것으로 본다
function readState(file: string): Partial<HookStateRecord> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObj(parsed) ? (parsed as Partial<HookStateRecord>) : null;
  } catch {
    return null;
  }
}

function pruneOldStates(): void {
  // 7일 넘은 세션 상태 파일 정리 — SessionStart 때만 실행
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(STATE_DIR)) {
      const file = path.join(STATE_DIR, name);
      if (now - fs.statSync(file).mtimeMs > STATE_TTL_MS) fs.unlinkSync(file);
    }
  } catch {
    // 정리 실패는 무시
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string | Buffer) => {
  input += String(chunk);
});
process.stdin.on("end", () => {
  try {
    // 펫을 한 번도 설정한 적 없으면(~/.claude/pokebuddy 없음) 아무것도 하지 않음
    if (!fs.existsSync(POKEBUDDY_DIR)) return process.exit(0);

    const parsed: unknown = JSON.parse(input);
    const data: HookInput = isObj(parsed) ? (parsed as HookInput) : {};
    const event = data.hook_event_name;
    if (typeof event !== "string") return process.exit(0);
    const entry = Object.hasOwn(EVENT_STATES, event) ? (EVENT_STATES[event] ?? null) : null;
    const mapping = typeof entry === "function" ? entry(data) : entry;
    const sessionId = String(data.session_id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!mapping || !sessionId) return process.exit(0);

    fs.mkdirSync(STATE_DIR, { recursive: true });
    if (event === "SessionStart") pruneOldStates();

    const file = path.join(STATE_DIR, `${sessionId}.json`);
    const now = Date.now() / 1000;
    const prev = readState(file);
    // 조상은 한 세션 안에서 바뀌지 않는다. Windows 는 구하는 데 PowerShell 을 띄워야 해서, 도구를 쓸 때마다
    // 부르지 않고 세션 시작(재개 포함 — 다른 터미널에서 이어 열 수 있다) 때 구한 것을 이어 쓴다
    const known = prev && Array.isArray(prev.ancestors) && prev.ancestors.length ? prev.ancestors : null;
    const ancestors = process.platform === "win32" && event !== "SessionStart" && known ? known : ancestorPids();
    const { prompt, ...shown } = mapping;
    // cwd·조상 프로세스 기록 — 펫 오버레이가 자기 터미널의 세션만 따라가는 데 씀
    const base: BaseRecord = { ...shown, cli: CLI, event, at: now, cwd: data.cwd || "", ancestors };

    // 실패 표시 중에 바로 다음 도구 호출이 와도 실패 동작을 끝까지 보여줌 — 전환 대상만 갱신
    const holding = shown.state === "running" && prev?.state === "failed" && prev.hold !== undefined && prev.hold > 0 && prev.at !== undefined && now - prev.at < prev.hold;
    const record: HookStateRecord = {
      ...(holding ? ({ ...prev, then: "running" } as BaseRecord) : base),
      // 마지막 프롬프트 시각은 이어 간다 — 뒤따르는 도구 호출·응답 완료 기록이 덮어쓰면 사라진다.
      // 펫이 "사용자가 마지막으로 뭔가 한 때"를 알아야 5분 뒤에 잠든다
      promptAt: prompt ? now : prev ? prev.promptAt : null,
      // 토큰 사용량 — 누적값과 읽은 자리를 이어 간다. claude 만, 대화 기록 경로가 있을 때만
      usage: prev && prev.usage ? prev.usage : { ...ZERO_USAGE },
      usageOffset: prev && typeof prev.usageOffset === "number" && prev.usageOffset > 0 ? prev.usageOffset : 0,
      // 기준점을 잡았는가 — 훅이 이 세션 도중에 새 버전으로 바뀌었으면(SessionStart 를 옛 훅이 받음) 첫 Stop 에서
      // 지금까지의 대화 전체가 한 번에 들어온다. 그때는 세지 않고 기준점만 잡는다
      usageBase: !!(prev && prev.usageBase),
    };
    if (CLI === "claude" && typeof data.transcript_path === "string" && data.transcript_path) {
      const transcript = data.transcript_path;
      const sizeOf = (): number => {
        try {
          return fs.statSync(transcript).size;
        } catch {
          return 0;
        }
      };
      if (event === "SessionStart") {
        // 기준점 — 재개한 세션의 옛 대화는 세지 않는다
        record.usageOffset = sizeOf();
        record.usageBase = true;
      } else if (!record.usageBase && (event === "Stop" || event === "StopFailure")) {
        record.usageOffset = sizeOf();
        record.usageBase = true;
      } else if (event === "Stop" || event === "StopFailure") {
        const d = readUsageDelta(transcript, record.usageOffset);
        record.usage = {
          in: record.usage.in + d.usage.in,
          out: record.usage.out + d.usage.out,
          cacheRead: record.usage.cacheRead + d.usage.cacheRead,
          cacheWrite: record.usage.cacheWrite + d.usage.cacheWrite,
        };
        record.usageOffset = d.offset;
        record.usageAt = now;
      }
    }

    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  } catch {
    // 상태 기록 실패는 무시 — 작업 흐름을 막지 않음
  }
  process.exit(0);
});
