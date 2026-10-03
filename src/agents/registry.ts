// 에이전트 연결 — Claude Code · Codex · Gemini 를 하나씩 잇고(훅 등록) 끊고, 연결 상태와 사용량 읽기 가능 여부를 알린다.
// 설정창 "연결" 탭의 버튼과 커맨드 agent.connect / agent.disconnect 가 여기를 부른다 (docs/design.md "에이전트 연결").
//
// 훅 등록·해제의 실제 일은 같은 폴더의 ./hooks 가 한다(connectCli · disconnectCli · hookInstalled — 예전 cli/setup.js).
// 토큰 사용량 읽기는 ./usage 에 (배럴 없이 직접 import). CLI 마다 "읽을 수 있나" 가 다르다 — 못 읽는 CLI 는 상태 모듈이 일한 시간으로 대신한다
import { AGENTS as AGENT_LIST, type AgentName } from "../shared/names/agents";

// 사용량을 어디서 읽나 — transcript: 훅이 대화 기록에서 읽어 적는다 · none: 아직 모른다 [스펙 미확정 — codex·gemini]
export type UsageSource = "transcript" | "none";

export interface AgentInfo {
  name: AgentName;
  label: string;
  usage: UsageSource;
}

// 이름과 표시 이름의 원본은 src/shared/names/agents.ts 다. 여기서는 사용량 읽기 방식만 붙인다
const USAGE: Readonly<Record<AgentName, UsageSource>> = { claude: "transcript", codex: "none", gemini: "none" };

export const AGENTS: readonly AgentInfo[] = AGENT_LIST.map((a) => ({ name: a.name, label: a.label, usage: USAGE[a.name] }));

export const agentInfo = (name: string): AgentInfo | null => AGENTS.find((a) => a.name === name) ?? null;

export interface ConnectResult {
  ok: boolean;
  reason: "ok" | "unknown-cli" | "not-installed" | "settings-error";
  changed?: boolean;
  added?: string[];
  fixed?: string[];
  stale?: string[]; // 목록에서 빠져 걷은 이벤트
  backup?: string | null;
  notes?: string[];
  hookFile?: string;
  detail?: string;
  error?: string | null;
}

export interface DisconnectResult {
  ok: boolean;
  reason: "ok" | "unknown-cli" | "settings-error";
  removed?: string[];
  backup?: string | null;
  detail?: string;
}

// 켤 때 정리의 결과 — ./hooks tidyInstalled
export interface TidyResult {
  clis: Array<{ cli: string; removed: string[]; backup?: string | null; error?: string }>; // 옛 이벤트를 걷은(또는 못 읽은) CLI 만
  hookFile: "최신" | "바꿈" | "없음" | "원본 없음" | "실패";
  error?: string;
}

export interface AgentStatus extends AgentInfo {
  installed: boolean; // 그 CLI 의 설정 폴더가 있나 (CLI 를 쓰고 있나)
  connected: boolean; // 우리 훅이 하나라도 등록돼 있나
  outdated: boolean; // 연결됐지만 지금 등록 목록·훅 파일과 다르다 — 연결 탭 "갱신"(connect)이 맞춘다. 켤 때 정리(tidy)가 옛 이벤트·옛 파일은 먼저 맞춘다
  registered: number;
  total: number;
  error?: string;
}

// 훅 등록·해제의 실제 일 — ./hooks (예전 cli/setup.js 의 앞부분, 도구 레인 T7b-3)
type HooksModule = typeof import("./hooks");
let hooksModule: HooksModule | null = null;
function setup(): HooksModule {
  // 늦게 읽는다 — 순수 함수(usage)만 쓰는 쪽이 설정 파일 경로(platform/paths)를 읽지 않게 (예전 cli/setup.js 를 늦게 읽던 것과 같다)
  if (!hooksModule) hooksModule = require("./hooks") as HooksModule;
  return hooksModule;
}

export function connect(name: AgentName, { dryRun = false } = {}): ConnectResult {
  if (!agentInfo(name)) return { ok: false, reason: "unknown-cli" };
  return setup().connectCli(name, { dryRun });
}

export function disconnect(name: AgentName, { dryRun = false } = {}): DisconnectResult {
  if (!agentInfo(name)) return { ok: false, reason: "unknown-cli" };
  return setup().disconnectCli(name, { dryRun });
}

// 연결 점검 — 그 CLI 에 등록하는 것과 같은 훅 명령과 훅 파일 자리 (src/agents/check.ts)
export function hookCommandOf(name: AgentName): { command: string; file: string } | null {
  const command = setup().hookCommandFor(name);
  return command ? { command, file: setup().hookTarget() } : null;
}

// 켤 때 정리 — 새로 등록하지 않는다. 연결된 CLI 의 옛 이벤트(목록에 없는 우리 등록)만 걷고, 있는 훅 파일만 새 버전으로 바꾼다.
// 앱 시작 때 writer 하나가 부른다 (src/main/hook-upkeep.ts). 사용자의 설정 파일은 백업을 남기고 우리 항목만 고친다
export function tidy({ dryRun = false } = {}): TidyResult {
  return setup().tidyInstalled({ dryRun });
}

// 세 CLI 의 연결 상태 — 설정창 "연결" 탭 한 줄씩.
// 연결됨은 우리 훅이 하나라도 있는 것. 빠진 이벤트·목록에 없는 이벤트(옛 codex PreToolUse)·옛 훅 파일이면 갱신 필요.
// 훅 파일(~/.claude/scripts/hooks/pokebuddy-state.cjs)은 모든 CLI 가 함께 쓴다 — 옛 버전이면 연결된 줄이 모두 갱신 필요다.
// 원본(dist/)이 없으면 파일은 판정하지 않는다. 켤 때 정리(tidy)가 이미 있는 파일은 새 버전으로 바꾼다 — 남는 것은 빠진 이벤트 등 "갱신" 이 할 일
export function status(): AgentStatus[] {
  const installed = setup().hookInstalled();
  const { clis } = installed;
  const fileStale = installed.source && !installed.current;
  const TARGET_CLIS = setup().TARGET_CLIS;
  return AGENTS.map((a) => {
    const label = TARGET_CLIS.find((t) => t.cli === a.name)?.name;
    const row = clis.find((c) => c.name === label);
    const registered = row?.registered ?? 0;
    const total = row?.total ?? 0;
    const stale = row?.stale ?? [];
    const connected = !!row?.used && !row.error && (registered > 0 || stale.length > 0);
    return {
      ...a,
      installed: !!row?.used,
      connected,
      outdated: connected && (registered < total || stale.length > 0 || fileStale),
      registered,
      total,
      ...(row?.error ? { error: row.error } : {}),
    };
  });
}
