// 에이전트 연결 — Claude Code · Codex · Gemini 를 하나씩 잇고(훅 등록) 끊고, 연결 상태와 사용량 읽기 가능 여부를 알린다.
// 설정창 "연결" 탭의 버튼과 커맨드 agent.connect / agent.disconnect 가 여기를 부른다 (docs/design.md "에이전트 연결").
//
// 훅 등록·해제의 실제 일은 아직 JS 인 cli/setup.js 가 한다(connectCli · disconnectCli · hookInstalled) — [리팩토링 대상] 이 모듈로 옮긴다.
// 토큰 사용량 읽기는 ./usage 에 (배럴 없이 직접 import). CLI 마다 "읽을 수 있나" 가 다르다 — 못 읽는 CLI 는 상태 모듈이 일한 시간으로 대신한다
import type { AgentName } from "../shared/types";

// 사용량을 어디서 읽나 — transcript: 훅이 대화 기록에서 읽어 적는다 · none: 아직 모른다 [스펙 미확정 — codex·gemini]
export type UsageSource = "transcript" | "none";

export interface AgentInfo {
  name: AgentName;
  label: string;
  usage: UsageSource;
}

export const AGENTS: readonly AgentInfo[] = [
  { name: "claude", label: "Claude Code", usage: "transcript" },
  { name: "codex", label: "Codex CLI", usage: "none" },
  { name: "gemini", label: "Gemini CLI", usage: "none" },
];

export const agentInfo = (name: string): AgentInfo | null => AGENTS.find((a) => a.name === name) ?? null;

export interface ConnectResult {
  ok: boolean;
  reason: "ok" | "unknown-cli" | "not-installed" | "settings-error";
  changed?: boolean;
  added?: string[];
  fixed?: string[];
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

export interface AgentStatus extends AgentInfo {
  installed: boolean; // 그 CLI 의 설정 폴더가 있나 (CLI 를 쓰고 있나)
  connected: boolean; // 우리 훅이 이벤트 전부에 등록돼 있나
  registered: number;
  total: number;
  error?: string;
}

// cli/setup.js 의 모양 — JS 라 여기서 선언만 한다. 옮길 때 이 선언도 사라진다
interface SetupModule {
  connectCli(cli: string, opts?: { dryRun?: boolean }): ConnectResult;
  disconnectCli(cli: string, opts?: { dryRun?: boolean }): DisconnectResult;
  hookInstalled(): { file: boolean; current: boolean; clis: Array<{ name: string; used: boolean; error?: string; registered?: number; total?: number }> };
  TARGET_CLIS: Array<{ cli: string; name: string }>;
}

let setupModule: SetupModule | null = null;
function setup(): SetupModule {
  // dist/agents → 프로젝트 루트의 cli/setup.js. 늦게 읽는다 — 순수 함수(usage)만 쓰는 쪽이 설정 파일을 건드리지 않게
  if (!setupModule) setupModule = require("../../cli/setup.js") as SetupModule;
  return setupModule;
}

export function connect(name: AgentName, { dryRun = false } = {}): ConnectResult {
  if (!agentInfo(name)) return { ok: false, reason: "unknown-cli" };
  return setup().connectCli(name, { dryRun });
}

export function disconnect(name: AgentName, { dryRun = false } = {}): DisconnectResult {
  if (!agentInfo(name)) return { ok: false, reason: "unknown-cli" };
  return setup().disconnectCli(name, { dryRun });
}

// 세 CLI 의 연결 상태 — 설정창 "연결" 탭 한 줄씩
export function status(): AgentStatus[] {
  const { clis, TARGET_CLIS } = { clis: setup().hookInstalled().clis, TARGET_CLIS: setup().TARGET_CLIS };
  return AGENTS.map((a) => {
    const label = TARGET_CLIS.find((t) => t.cli === a.name)?.name;
    const row = clis.find((c) => c.name === label);
    const registered = row?.registered ?? 0;
    const total = row?.total ?? 0;
    return {
      ...a,
      installed: !!row?.used,
      connected: !!row?.used && total > 0 && registered === total,
      registered,
      total,
      ...(row?.error ? { error: row.error } : {}),
    };
  });
}
