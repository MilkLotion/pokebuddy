// 화면 모델 — 설정 모달의 연결 탭. 타입만 둔다

// ── CLI 연결 ───────────────────────────────────────────────────────────────────
// 설정 모달의 연결 탭. 저장이 아니라 각 CLI 의 설정 파일을 본다. 그래서 스냅샷이 아니라 따로 읽는다
export type AgentAction = "connect" | "disconnect" | "check" | "probe"; // probe — 연결 점검(훅을 한 번 실제로 돌려 본다)

export interface AgentRow {
  name: string;
  label: string;
  installed: boolean; // 그 CLI 를 쓰고 있는가
  connected: boolean; // 우리 훅이 하나라도 등록돼 있는가
  outdated: boolean; // 연결됐지만 등록 목록·훅 파일이 지금과 다르다 — 연결 탭 "갱신"
  registered: number;
  total: number;
  usage: string; // transcript 이면 토큰을 읽는다. none 이면 작업 시간으로 적립한다
  lastSignalAt: number | null; // 마지막 신호 시각(ms) — 훅이 쓴 state 기록 가운데 가장 늦은 것. 없으면 null
  error?: string;
}

export interface AgentReply {
  ok: boolean;
  reason: string;
  list: AgentRow[]; // 처리 뒤 다시 읽은 상태
  platform: string; // process.platform — Windows 에서만 붙이는 안내(codex --no-daemon)를 가른다
  node: { path: string; version: string } | null; // 훅을 돌릴 Node.js — 없으면 연결을 막는다 (src/agents/check.ts)
  detail?: string; // probe 실패 — exit 의 종료 코드
}
