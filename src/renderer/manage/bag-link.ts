// 설정창의 가방 기기 창 연결 — 고른 도구, 사용·판매 갈래, 대상·수량, 결과·실패 (P10s)
// 가방 칸을 누르면 관리 창 옆에 가방 기기 창이 뜬다 (src/main/bag-window.ts, Figma 05 `Bag / Device / Use`·`Sell`·`Evolution`).
// 상점 기기 창과 같은 틀이다. 격자 아래 사용 판은 없앴다 (2026-10-01 사용자 결정 C안, worklog/records/bag-device/record.md).
// 도구는 파티 개체에게만 쓴다 ("파티를 기준으로만 사용할 수 있게 하자"). 여기서는 고른 값만 보내고 무엇을 보일지는 메인이 정한다 (src/view/device-bag.ts). 단추는 여기로 돌아와 명령으로 처리한다
import type { BagDeviceAction, BagDeviceInput } from "../../shared/model/devices.js";
import type { BagItemView } from "../../shared/model/snapshot.js";
import { api } from "./api.js";
import { lastReplyOf, sendCommand } from "./command.js";
import { createDeviceLink } from "./device-link.js";
import { redrawBody } from "./shell.js";
import { petInView, ui } from "./state.js";

// 설정창이 거는 고리 — 탭의 순서와 파티 프리셋 넘김을 이 파일이 가져오지 않게
export interface BagLinkHooks {
  stepRows(bag: readonly BagItemView[]): BagItemView[]; // 이전·다음이 도는 순서 — 가방 탭의 bagStepRows
  stepPreset(delta: -1 | 1): void; // 사용 쪽 파티 줄의 ◀ ▶ — 앞·뒤 프리셋을 적용한다(파티 탭)
}
let hooks: BagLinkHooks | null = null;
export function setBagLinkHooks(next: BagLinkHooks): void {
  hooks = next;
}
function hooksOf(): BagLinkHooks {
  if (!hooks) throw new Error("bag-link.ts 의 고리가 걸리지 않았다 — setBagLinkHooks 를 먼저 부른다");
  return hooks;
}

let bagPick: string | null = null; // 가방 기기 창에 띄운 도구
let bagTarget: string | null = null; // 사용 쪽에서 고른 파티 개체
let bagQty = 1;
// 방금 쓴 결과 — 미리보기 상자가 초록으로 보인다. 도구·대상·갈래·수량·탭을 바꾸면 지운다 (2026-09-30 사용자 결정 "추천대로 진행해")
let bagResult = "";
let bagResultNote = ""; // 결과 둘째 줄 — "이상한사탕 1개를 썼어요"
let bagNotice = ""; // 마지막 사용·판매 실패 — 미리보기 상자가 빨강으로 보인다
// 조작 칸의 갈래 — 사용·판매. 판매가(sellPrice)가 있는 도구만 판매 갈래가 있다. 진화용 도구는 판매만 (2026-10-01 사용자 결정 "진화아이템에는 사용을 없애자")
let bagMode: "use" | "sell" = "use";
let sellQty = 1;

// 누른 도구 — 같은 도구를 다시 누르면 닫는다(상점 상품·도감 칸과 같다)
export function pickBag(id: string): void {
  bagPick = bagPick === id ? null : id;
  bagMode = "use";
  bagQty = 1;
  sellQty = 1;
  bagNotice = "";
  bagResult = "";
  redrawBody();
}

let bagSending = false; // 사용·판매 명령을 보내는 중 — 두 번 누르기를 막는다
let bagBusy = false; // 0.3초 넘게 답이 없다 — 주 단추가 점 세 개
// 가방 기기 창 연결 — 도구를 고른 동안 연다 (bagDeviceBuild)
export const bagLink = createDeviceLink<BagDeviceInput>({
  build: bagDeviceBuild,
  stamp: () => ui.view,
  open: (input, gen) => api.bagOpen(input, gen),
  holding: () => bagSending, // 쓰기·팔기 중 — 결과가 붙은 뒤 한 번 보낸다 (device-link.ts)
  apply: (input) => {
    bagMode = input.mode;
    bagTarget = input.targetPetId;
    bagQty = input.qty;
    sellQty = input.sellQty;
  },
  afterClosed: () => {
    if (!bagPick) return false;
    bagPick = null;
    return true;
  },
  redraw: () => redrawBody(),
});
// 가방 기기 창에 보낼 고른 값 — 고른 도구가 없으면 null(닫는다). 모델은 메인이 만든다 (src/view/device-bag.ts)
function bagDeviceBuild(): BagDeviceInput | null {
  if (!bagPick || !ui.view?.bag.some((i) => i.id === bagPick)) return null;
  return { itemId: bagPick, mode: bagMode, targetPetId: bagTarget, qty: bagQty, sellQty, notice: bagNotice, result: bagResult ? { lead: bagResult, line: bagResultNote } : null, busy: bagBusy };
}

export function syncBagDevice(): void {
  bagLink.sync();
}

// 이전·다음 — 지금 분류 탭의 도구 순서로 돈다. 넘기면 갈래·수량·결과는 처음으로
export function stepBag(delta: -1 | 1): void {
  if (!bagPick || !ui.view) return;
  const list = hooksOf().stepRows(ui.view.bag);
  if (list.length < 2) return;
  const at = list.findIndex((i) => i.id === bagPick);
  const next = list[(at + delta + list.length) % list.length];
  if (!next) return;
  pickBag(next.id);
}

// 기기 창에서 누른 단추 — 기기 창이 다른 도구를 보이던 때 누른 것은 버린다
export function onBagAction(action: BagDeviceAction): void {
  if (!bagPick || action.itemId !== bagPick) return;
  if (action.kind === "go") {
    void (bagMode === "sell" ? sellBag(bagPick) : useBag(bagPick));
    return;
  }
  if (action.kind === "preset") {
    // 파티 줄 양끝의 ◀ ▶ — 앞·뒤 프리셋을 적용한다. 대상·수량·결과는 처음으로
    bagNotice = "";
    bagResult = "";
    bagTarget = null;
    bagQty = 1;
    hooksOf().stepPreset(action.delta);
    return;
  }
  bagNotice = "";
  bagResult = "";
  if (action.kind === "mode") {
    bagMode = action.mode;
    sellQty = 1;
  } else if (action.kind === "target") {
    bagTarget = action.petId;
    bagQty = 1;
  } else if (bagMode === "sell") sellQty = action.qty;
  else bagQty = action.qty;
  syncBagDevice();
}

// 명령 보내기 — 0.3초 넘게 답이 없으면 주 단추가 점 세 개. 실패 문구는 기기 창의 미리보기 상자에만 보인다
async function bagSend(cmd: string, id: string, extra: Record<string, unknown>): Promise<boolean> {
  bagSending = true;
  const slow = setTimeout(() => {
    bagBusy = true;
    bagLink.sync(true); // 처리 중 점 표시는 보내는 중에도 보낸다
  }, 300);
  const ok = await sendCommand(cmd, id, extra, { keepOpen: true });
  clearTimeout(slow);
  bagSending = false;
  bagBusy = false;
  bagNotice = ok ? "" : ui.notice;
  ui.notice = "";
  return ok;
}

async function useBag(id: string): Promise<void> {
  const item = ui.view?.bag.find((i) => i.id === id);
  const pet = bagTarget ? petInView(bagTarget) : null;
  if (!item || !pet || !ui.view || bagSending) return;
  const count = bagQty; // 메인이 바로잡은 수량 — 사탕이 아니면 1 (src/view/device-bag.ts)
  bagResult = "";
  const ok = await bagSend("bag.use", id, { petId: pet.id, ...(count > 1 ? { count } : {}) });
  if (ok) {
    // 결과 두 줄은 메인이 거래 앞뒤 화면 값으로 만들어 답에 싣는다 (src/view/result-lines.ts)
    bagResult = lastReplyOf()?.result?.lead ?? "";
    bagResultNote = lastReplyOf()?.result?.line ?? "";
    bagQty = 1;
    if (!ui.view?.bag.some((i) => i.id === id)) bagPick = null; // 다 썼다 — 기기 창을 닫는다
  }
  redrawBody();
}

async function sellBag(id: string): Promise<void> {
  const item = ui.view?.bag.find((i) => i.id === id);
  if (!item || item.sellPrice === undefined || bagSending) return;
  const count = sellQty; // 메인이 보유 수까지로 바로잡은 수량
  const ok = await bagSend("bag.sell", id, count > 1 ? { count } : {});
  if (ok) {
    sellQty = 1;
    if (!ui.view?.bag.some((i) => i.id === id)) bagPick = null; // 다 팔았다 — 기기 창을 닫는다
  }
  redrawBody();
}

// 지금 고른 도구 — 탭이 칸 표시에, 튜토리얼이 단계에 쓴다
export const bagPickOf = (): string | null => bagPick;
// 결과 줄을 지운다 — 분류를 바꾸거나 탭을 떠날 때
export function clearBagResult(): void {
  bagResult = "";
}
// 가방 탭을 떠난다 — 다음 그리기의 syncBagDevice 가 기기 창을 닫는다
export function leaveBag(): void {
  bagPick = null;
}
// 고른 도구가 가방에서 사라졌으면 놓는다 — 다 쓰거나 팔았다(본문 맞추기)
export function dropGoneBagPick(): void {
  if (bagPick && ui.view && !ui.view.bag.some((i) => i.id === bagPick)) bagPick = null;
}
