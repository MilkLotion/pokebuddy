// 설정창 사용자 모달의 연결 탭 — CLI 연결 상태 한 줄씩, 연결·해제·다시 확인·점검 명령 (P10o)
import type { AgentAction, AgentReply, AgentRow } from "../../shared/model/agents.js";
import { failTextOf } from "../../shared/fail-text.js";
import { el } from "../ui/dom.js";
import { api } from "./api.js";
import { actionButtonEl, drawDialog } from "./dialog.js";
import { ui } from "./state.js";
import { alertEl, settingRow } from "./widgets.js";
import { shortAgoText } from "./account.js";

// 연결 탭 상태 — 처음 열 때 읽고 그다음부터 들고 있는다. agentRows 는 튜토리얼(사용자 단계)이 읽는다
export let agentRows: AgentRow[] | null = null;
let agentPlatform = ""; // 연결 탭의 Windows 안내를 가른다 — 에이전트 응답이 싣는다
// 연결 점검 (worklog/records/hook-check/record.md) — Node.js(undefined 면 아직 모름), CLI 별 점검 결과, 점검 중인 CLI
let agentNode: AgentReply["node"] | undefined;
const agentChecks = new Map<string, { ok: boolean; text: string; at: number }>();
const agentFails = new Map<string, string>(); // 연결·해제·다시 확인 실패 — 그 줄의 상태 글자로 보인다(경고 줄을 끼우지 않는다)
let agentProbing: string | null = null;

// 점검 실패 이유 — 상태 글자에 붙인다 (src/agents/check.ts ProbeReason)
const PROBE_TEXT: Record<string, string> = {
  "node-missing": "Node.js 없음",
  "hook-missing": "훅 파일 없음",
  "no-record": "기록이 생기지 않음",
  timeout: "5초 안에 끝나지 않음",
  "spawn-failed": "실행하지 못함",
};

// CLI 한 줄 — 상태를 글자와 점으로 보인다 (docs/specs/game.md "설정과 연결", Figma 05 `User / Connect` `1079:1891`).
// 결과는 새 줄을 끼우지 않고 이 줄의 상태 글자·점 색만 바꾼다 — 레이아웃이 흔들리지 않게 (2026-09-30 사용자 결정)
//   연결됨        마지막 신호(훅이 쓴 state 기록) · 없으면 아직 신호 없음
//   점검 뒤       점검 정상 · 방금 / 점검 실패 · 이유 (빨강)
//   명령 실패     연결하지 못했어요 · 이유 (빨강) — 연결 탭은 바닥 단추 줄이 없어 줄의 상태 글자로 보인다
//   Node.js 없음  연결된 줄은 확인 필요(주황), 연결 안 된 줄의 `연결` 은 막는다
//   갱신 필요     연결됐지만 등록 목록·훅 파일이 지금과 다르다(옛 codex PreToolUse 등). "갱신" 이 connect 를 다시 불러 맞춘다
function agentRow(row: AgentRow): HTMLElement {
  const noNode = agentNode === null;
  const check = agentChecks.get(row.name);
  let hint: string;
  let dot = "agent-dot";
  const fail = agentFails.get(row.name);
  if (fail) {
    hint = fail;
    dot = "agent-dot bad";
  } else if (row.error) hint = `확인 필요 · ${row.error}`;
  else if (!row.installed) hint = "미설치";
  else if (!row.connected) hint = "연결 안 됨";
  else if (noNode) {
    hint = "확인 필요 · Node.js 없음";
    dot = "agent-dot warn";
  } else if (row.outdated) {
    hint = "연결됨 · 갱신 필요";
    dot = "agent-dot warn";
  } else if (check && !check.ok) {
    hint = `점검 실패 · ${check.text}`;
    dot = "agent-dot bad";
  } else if (check) {
    hint = `연결됨 · 점검 정상 · ${shortAgoText(check.at)}`;
    dot = "agent-dot on";
  } else {
    hint = row.lastSignalAt ? `연결됨 · 마지막 신호 ${shortAgoText(row.lastSignalAt)}` : "연결됨 · 아직 신호 없음";
    dot = "agent-dot on";
  }

  const control = el("div", "actions");
  control.style.margin = "0";
  if (!row.installed) control.appendChild(actionButtonEl("다시 확인", false, false, () => void agent(row.name, "check")));
  else if (row.connected && row.outdated && !noNode) control.appendChild(actionButtonEl("갱신", true, false, () => void agent(row.name, "connect")));
  else if (row.connected) {
    if (!noNode) {
      const probing = agentProbing === row.name;
      const probe = actionButtonEl("점검", false, agentProbing != null, () => void agent(row.name, "probe"));
      probe.classList.toggle("is-busy", probing); // 점검 중 — 글자 대신 점 세 개(폭 그대로)
      control.appendChild(probe);
    }
    control.appendChild(actionButtonEl("해제", false, agentProbing != null, () => void agent(row.name, "disconnect")));
  } else control.appendChild(actionButtonEl("연결", true, noNode, () => void agent(row.name, "connect")));

  const line = settingRow(row.label, hint, control);
  const hintEl = line.querySelector<HTMLElement>(".hint");
  if (hintEl) hintEl.prepend(el("span", dot));
  // Windows codex 데몬은 훅마다 콘솔 창을 띄운다(openai/codex#44768) — 알려진 우회를 줄 아래에 둔다
  if (row.name === "codex" && row.installed && agentPlatform === "win32") {
    line.querySelector(".body")?.appendChild(el("div", "hint agent-tip", "Windows 에서 창이 깜빡이면 codex --no-daemon 으로 실행하세요"));
  }
  return line;
}

export function drawAgents(scroll: HTMLElement): void {
  if (!agentRows) {
    scroll.appendChild(el("div", "empty-note", "연결 상태를 읽는 중입니다."));
    return;
  }
  // Node.js 가 없는 동안 늘 보이는 경고 — 누를 때마다 생겼다 사라지는 것이 아니다 (Figma 05 `User / Connect · Node.js 없음` `1079:2477`)
  if (agentNode === null) scroll.appendChild(alertEl("warn", "Node.js 가 없어요", "연결하려면 Node.js 를 설치한 뒤 다시 확인을 눌러 주세요"));
  for (const row of agentRows) scroll.appendChild(agentRow(row));
  scroll.appendChild(el("div", "agents-note hint", "연결하면 각 CLI 설정에 훅을 넣어요. 해제하면 다시 빼요."));
}

// 연결 탭 명령 — 연결·해제·다시 확인·점검. 결과는 그 줄의 상태 글자로 보인다
async function agent(name: string, action: AgentAction): Promise<void> {
  // 점검 — 결과는 그 줄의 상태 글자로만 보인다(오류 줄을 끼우지 않는다). 점검 중에는 단추가 점 세 개
  if (action === "probe") {
    agentProbing = name;
    drawDialog();
  }
  const reply = await api.agents({ name, action });
  agentRows = reply.list;
  agentPlatform = reply.platform;
  agentNode = reply.node;
  if (action === "probe") {
    agentProbing = null;
    agentFails.delete(name);
    agentChecks.set(name, { ok: reply.ok, text: reply.reason === "exit" ? `종료 코드 ${reply.detail ?? "?"}` : (PROBE_TEXT[reply.reason] ?? reply.reason), at: Date.now() });
  } else {
    agentChecks.delete(name); // 연결·해제·다시 확인 뒤에는 옛 점검 결과를 지운다
    const verb = action === "connect" ? "연결하지 못했어요" : action === "disconnect" ? "해제하지 못했어요" : "확인하지 못했어요";
    if (reply.ok) agentFails.delete(name);
    else agentFails.set(name, `${verb} · ${failTextOf(reply.reason, "command").text}`);
  }
  drawDialog();
}

export async function loadAgents(): Promise<void> {
  const reply = await api.agents();
  agentRows = reply.list;
  agentPlatform = reply.platform;
  agentNode = reply.node;
  if (ui.dialog?.kind === "user" && ui.dialog.tab === "agents") drawDialog();
}
