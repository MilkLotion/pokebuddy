// 설정창 "연결" 탭의 요청 하나 — manage:agents 로 온다. 저장이 아니라 각 CLI 의 설정 파일과 훅 기록을 본다.
// 읽기만 하는 호출(인자 없음·check)과 바꾸는 호출(connect·disconnect), 점검(probe)을 한 입구로 받는다
// 연결 점검(2026-09-30): 읽을 때마다 Node.js 와 CLI 별 마지막 신호를 붙인다. Node.js 가 없으면 연결을 막는다. probe 는 훅을 한 번 돌려 본다
// (예전 src/main/game.ts agents — 설계 worklog/records/code-structure/design/40-contracts-save-online.md 3.8절)
import type { AgentAction, AgentReply, AgentRow } from "../shared/model/agents";
import type { AgentName } from "../shared/names/agents";
import { findNode, lastSignals, probeHook } from "./check";
import { agentInfo, agentStatusList, connectAgent, disconnectAgent, hookCommandOf } from "./registry";

export async function runAgentRequest(req: { name: string; action: AgentAction } | undefined, o: { stateDir: string }): Promise<AgentReply> {
  const node = await findNode(req?.action === "check");
  const list = (): AgentRow[] => {
    const signals = lastSignals(o.stateDir);
    return agentStatusList().map((a) => ({ ...a, lastSignalAt: signals[a.name] ?? null }));
  };
  const platform = process.platform;
  if (!req || req.action === "check") return { ok: true, reason: "ok", list: list(), platform, node };
  if (!agentInfo(req.name)) return { ok: false, reason: "unknown-cli", list: list(), platform, node };
  if (req.action === "probe") {
    const hook = hookCommandOf(req.name as AgentName);
    if (!hook) return { ok: false, reason: "unknown-cli", list: list(), platform, node };
    const r = await probeHook(req.name, hook.command, hook.file, node, o.stateDir);
    return { ok: r.ok, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}), list: list(), platform, node };
  }
  if (req.action === "connect" && !node) return { ok: false, reason: "node-missing", list: list(), platform, node };
  const res = req.action === "connect" ? connectAgent(req.name as AgentName) : disconnectAgent(req.name as AgentName);
  return { ok: res.ok, reason: res.reason, list: list(), platform, node };
}
