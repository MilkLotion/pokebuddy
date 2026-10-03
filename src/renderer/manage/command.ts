// 설정창 → 메인 명령 — 요청 식별자, 처리 중 표시, 잠금, 다시 읽기, 실패 문구
// 다시 읽기·도감 비우기는 설정창이 setCommandHooks 로 걸어 준다(뼈대 파일이 나뉘면 직접 가져온다). 모달은 dialog.ts
import type { ManageReply } from "../../shared/ipc/manage.js";
import { failTextOf } from "../../shared/fail-text.js";
import { closeDialog, drawDialog } from "./dialog.js";
import { ui } from "./state.js";

export interface CommandHooks {
  reload(): Promise<void>; // 스냅샷을 다시 읽고 그린다
  touchesDex(): void; // 도감이 함께 바뀌었다 — 다음에 도감을 열 때 다시 읽게 비운다
}
let hooks: CommandHooks | null = null;
export function setCommandHooks(next: CommandHooks): void {
  hooks = next;
}
function hooksOf(): CommandHooks {
  if (!hooks) throw new Error("command.ts 의 고리가 걸리지 않았다 — setCommandHooks 를 먼저 부른다");
  return hooks;
}

// 대상이 사라지거나 일이 끝나는 조작 — 결과를 보여 줄 곳이 없으므로 모달을 닫는다
const CLOSES = new Set(["party.keep", "party.place", "party.swap", "egg.open", "bag.use", "bag.sell", "pet.sell", "shop.buy"]);

// 도감이 함께 바뀌는 조작 — 다음에 도감을 열 때 다시 읽게 비운다
const TOUCHES_DEX = new Set(["egg.open", "shop.buy", "evolve", "bag.use"]);

// 조작 하나마다 새 요청이다. 같은 순간의 두 클릭이 하나로 합쳐지지 않게 보내는 쪽이 식별자를 만든다.
// 같은 값으로 다시 보내면 실행기가 한 번만 반영한다 (docs/specs/modules.md "거래 실행기")
let seq = 0;
const nextReqId = (cmd: string, target: string): string => `ui:${Date.now()}:${++seq}:${cmd}:${target}`;

// 응답이 없던 조작(timeout)은 결과를 모른다. 같은 조작을 다시 누르면 같은 요청 ID 로 보내 실행기가 한 번만 반영하게 한다.
// 조작이 같은지는 명령·대상·인자로 본다. 답을 받으면(성공·실패) 잊는다 (worklog/records/game-runtime/record.md "결과를 모를 때")
let unknownReq: { key: string; id: string } | null = null;
function reqIdFor(cmd: string, target: string, extra: Record<string, unknown>): string {
  const key = JSON.stringify([cmd, target, extra]);
  if (unknownReq?.key === key) return unknownReq.id;
  return nextReqId(cmd, target);
}
function rememberReply(cmd: string, target: string, extra: Record<string, unknown>, id: string, reply: ManageReply): void {
  unknownReq = !reply.ok && reply.reason === "timeout" ? { key: JSON.stringify([cmd, target, extra]), id } : null;
}

// 명령 하나를 보내고 답을 받는다 — 요청 식별자를 붙이고, 결과를 모르는 답이면 다음 같은 조작에 같은 식별자를 쓴다
export async function requestCommand(cmd: string, target: string, extra: Record<string, unknown>): Promise<ManageReply> {
  const reqId = reqIdFor(cmd, target, extra);
  const reply = await window.pokebuddyManage.command({ cmd, target, args: { ...extra, reqId } });
  rememberReply(cmd, target, extra, reqId, reply);
  return reply;
}

let lastReply: ManageReply | null = null; // 마지막으로 성공한 조작의 답 — 결과 창이 읽는다
export const lastReplyOf = (): ManageReply | null => lastReply;

// 처리 중 표시 — 답이 늦으면 누른 단추·칸에 점 세 개를 띄운다 (Figma `Button` · `Box Slot` 의 `State=Busy`).
// 빠른 답에서 깜빡이지 않게 BUSY_AFTER_MS 가 지나서야 단다 (worklog/records/response-latency/record.md "B안")
const BUSY_AFTER_MS = 300;
const PRESS_FRESH_MS = 1000; // 이보다 오래된 누름은 이번 조작의 단추가 아니다 — 튜토리얼 등 누름 없이 보낸 조작
let pressed: { button: HTMLButtonElement; at: number } | null = null;
// 조작 처리기보다 먼저 누른 단추를 기억한다 (캡처 단계). 키보드 Enter·Space 도 click 으로 온다
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest("button") : null;
  pressed = button ? { button, at: Date.now() } : null;
}, true);

export function setBusy(target: HTMLButtonElement, on: boolean): void {
  target.classList.toggle("is-busy", on);
  if (on) target.setAttribute("aria-busy", "true");
  else target.removeAttribute("aria-busy");
}

// 방금 누른 단추에 처리 중을 예약한다. 돌려주는 함수를 부르면 예약을 거두고 표시를 뗀다
function busyLater(): () => void {
  const target = pressed && Date.now() - pressed.at < PRESS_FRESH_MS ? pressed.button : null;
  if (!target) return () => {};
  const timer = setTimeout(() => setBusy(target, true), BUSY_AFTER_MS);
  return () => {
    clearTimeout(timer);
    setBusy(target, false);
  };
}

// 성공하면 true. 여러 번 보내는 쪽이 중간에 멈출 수 있게 돌려준다
export async function sendCommand(cmd: string, target: string, extra: Record<string, unknown> = {}, opts: { keepOpen?: boolean } = {}): Promise<boolean> {
  const h = hooksOf();
  if (ui.busy) return false;
  ui.busy = true;
  const unbusy = busyLater();
  let reply: ManageReply;
  try {
    reply = await requestCommand(cmd, target, extra);
    if (reply.ok && TOUCHES_DEX.has(cmd)) h.touchesDex();
    await h.reload();
  } finally {
    ui.busy = false;
    unbusy();
  }

  if (!reply.ok) {
    ui.notice = failTextOf(reply.reason, "command").text;
    drawDialog();
    return false;
  }
  ui.notice = "";
  lastReply = reply;
  if (CLOSES.has(cmd) && !opts.keepOpen) closeDialog();
  else drawDialog();
  return true;
}

// 덮개 창(화면 고르기·영역 그리기)을 열고 답을 기다린다. 메인이 저장한다. 취소는 아무것도 바꾸지 않으므로 알리지 않는다
export async function runLocked(call: () => Promise<ManageReply>): Promise<void> {
  const h = hooksOf();
  if (ui.busy) return;
  ui.busy = true;
  let reply: ManageReply;
  try {
    reply = await call();
    await h.reload();
  } finally {
    ui.busy = false;
  }
  ui.notice = reply.ok || reply.reason === "cancelled" ? "" : failTextOf(reply.reason, "command").text;
  drawDialog();
}
