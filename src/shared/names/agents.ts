// 에이전트 이름의 원본 — 연결할 수 있는 CLI 에이전트와 훅이 알려 주는 동작 상태.
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다

// 연결할 수 있는 CLI 에이전트 — 이름과 화면에 보이는 이름
export const AGENTS = [
  { name: "claude", label: "Claude Code" },
  { name: "codex", label: "Codex CLI" },
  { name: "gemini", label: "Gemini CLI" },
] as const;

export type AgentName = (typeof AGENTS)[number]["name"];

export const isAgentName = (v: unknown): v is AgentName => typeof v === "string" && AGENTS.some((a) => a.name === v);

// 훅이 알려 주는 에이전트 상태 (src/follow/state.ts resolveState 가 주는 값 그대로)
export const AGENT_STATES = ["idle", "running", "waiting", "waving", "failed"] as const;

export type AgentState = (typeof AGENT_STATES)[number];
