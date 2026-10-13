// 배틀 로그 창 — 메인이 보낸 줄(재생 시각까지)을 그린다 (docs/specs/adventure.md "배틀 로그")
// - 머리 줄(상태 등·LED·제목·✕)과 Esc 닫기는 기기 창 틀(device-frame.ts)을 쓴다. ◀▶ 넘기기는 없다
// - 줄이 늘면 뒤에 붙인다. 줄이 줄면(새 판) 처음부터 다시 그린다
// - 맨 아래를 보고 있을 때만 새 줄을 따라 내려간다. 위로 올려 둔 동안에는 자리를 지킨다
import type { BattleLogLine, BattleLogName } from "../../shared/battle-log.js";
import { clockText } from "../../shared/battle-timeline.js";
import type { BattleLogView } from "../../shared/ipc/battle.js";
import { createDeviceFrame } from "../device/device-frame.js";
import { needBridge } from "../ui/bridge.js";
import { el } from "../ui/dom.js";

const api = needBridge("pokebuddyBattleLog");
const frame = createDeviceFrame({
  api: { size: () => {}, step: () => {}, close: () => api.close() },
  windowName: "battle-log",
  canKey: (key) => key === "Escape",
});

const TITLE = "배틀 로그";
const FOLLOW_SLACK = 4; // 맨 아래로 보는 여유(px)

let list: HTMLElement | null = null;
let shown: BattleLogLine[] = [];

const sameLine = (a: BattleLogLine, b: BattleLogLine | undefined): boolean => !!b && a.t === b.t && a.kind === b.kind && a.who.text === b.who.text && a.whom?.text === b.whom?.text && a.move === b.move;

function nameEl(n: BattleLogName): HTMLElement {
  return el("span", `name ${n.side === 0 ? "mine" : "opp"}`, n.text);
}

function rowEl(line: BattleLogLine, maxMs: number): HTMLElement {
  const row = el("div", `log-row ${line.kind}`);
  row.appendChild(el("span", "time", clockText(maxMs, line.t)));
  row.appendChild(nameEl(line.who));
  if (line.whom) row.appendChild(nameEl(line.whom));
  if (line.move) {
    const move = el("span", "move");
    move.append(el("b", undefined, line.move), line.tail);
    row.appendChild(move);
  }
  if (line.result) row.appendChild(el("span", "result", line.result));
  return row;
}

function drawFrame(): HTMLElement {
  frame.beginDraw("right", TITLE, "battle-log");
  const box = el("div", "log-list");
  box.setAttribute("role", "log");
  box.setAttribute("aria-label", TITLE);
  frame.device.appendChild(box);
  frame.endDraw();
  return box;
}

function draw(view: BattleLogView): void {
  if (!list) list = drawFrame();
  const box = list;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_SLACK;
  // 앞 줄이 그대로면 늘어난 줄만 붙인다. 아니면(새 판·줄이 줄었다) 다시 그린다 — 그린 마지막 줄이 같은 자리에 있는지로 본다
  const last = shown.at(-1);
  const same = view.lines.length >= shown.length && (!last || sameLine(last, view.lines[shown.length - 1]));
  if (!same) box.replaceChildren();
  const from = same ? shown.length : 0;
  for (const line of view.lines.slice(from)) box.appendChild(rowEl(line, view.maxMs));
  shown = view.lines;
  if (!same || atBottom) box.scrollTop = box.scrollHeight;
}

frame.showWith<BattleLogView>((cb) => api.onShow(cb), draw);
api.ready();
