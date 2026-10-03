// 가방 기기 창 — 관리 창 옆에 붙어 도구 하나의 설명과 사용·판매를 보이는 창. 문서는 src/renderer/bag.html
//
// 가방 카드를 누르면 뜬다 (2026-10-01 사용자 "가방도 상점참고해서 개선하자", C안 — Figma 05 `Bag / Device / Use`,
// worklog/records/bag-device/record.md). 창의 동작은 공통 틀(src/main/item-window.ts)이다.
// 파티 고르기·수량·사용·판매 단추는 관리 창으로 돌려보낸다 — 명령은 관리 창이 보낸다
import type { BagDeviceAction, BagDeviceOpen } from "../shared/model/devices";
import type { BagDeviceChannel } from "../shared/ipc/devices";
import { createItemWindow, type ItemWindow } from "./item-window.js";
import { isQty, isRecord, isShortId, isStep } from "./windows/input.js";

const CH = {
  show: "bagdev:show",
  size: "bagdev:size",
  step: "bagdev:step",
  close: "bagdev:close",
  act: "bagdev:act",
} satisfies Record<string, BagDeviceChannel>;

// Figma `Bag / Device / Use` 폭. 높이는 첫 그림 전 어림값이다
export const BAG_WINDOW = { width: 380, height: 670 };

export interface BagWindowOptions {
  preload: string;
  html: string;
  onStep: (delta: -1 | 1) => void;
  onAct: (action: BagDeviceAction) => void;
  onClosed: (gen: number) => void;
}

export type BagWindow = ItemWindow<BagDeviceOpen>;

export function createBagWindow(opts: BagWindowOptions): BagWindow {
  return createItemWindow<BagDeviceOpen, BagDeviceAction>({ ...opts, channels: CH, size: BAG_WINDOW, keyOf: (o) => o.itemId, isAction });
}

// 렌더러가 보낸 값은 믿지 않는다 — 정해진 모양만 넘긴다
function isAction(v: unknown): v is BagDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (!isShortId(a.itemId)) return false;
  if (a.kind === "mode") return a.mode === "use" || a.mode === "sell";
  if (a.kind === "target") return isShortId(a.petId);
  if (a.kind === "qty") return isQty(a.qty);
  if (a.kind === "preset") return isStep(a.delta);
  return a.kind === "go";
}
