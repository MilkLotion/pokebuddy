// 파티 기기 창 — 교체 화면. 관리 창(박스 탭) 옆에 붙어 지금 프리셋의 파티 칸과 프리셋 칩을 보이는 창. 문서는 src/renderer/party.html
//
// 파티 탭의 `교체` 나 빈 파티 칸을 누르면 뜬다 (2026-10-02 사용자 "교체버튼을 누르면 박스화면으로 이동하고 … 창이 뜨면서 파티목록 볼 수 있게",
// Figma 05 `Party / Swap · Open` `1248:2567`, worklog/records/party-preset/record.md). 창의 동작은 공통 틀(src/main/item-window.ts)이다.
// 누른 칸과 칩은 관리 창으로 돌려보낸다 — 명령은 관리 창이 보낸다
import type { PartyDeviceAction, PartyDeviceOpen } from "../shared/model/devices";
import type { PartyDeviceChannel } from "../shared/ipc/devices";
import { createItemWindow, type ItemWindow } from "./item-window.js";
import { PARTY_RULES } from "../party/rules.js";
import { isIndexBelow, isRecord } from "./windows/input.js";

const CH = {
  show: "partydev:show",
  size: "partydev:size",
  step: "partydev:step",
  close: "partydev:close",
  act: "partydev:act",
} satisfies Record<string, PartyDeviceChannel>;

// 폭은 다른 기기 창과 같다. 높이는 첫 그림 전 어림값이다
export const PARTY_WINDOW = { width: 380, height: 508 };

export interface PartyWindowOptions {
  preload: string;
  html: string;
  onStep: (delta: -1 | 1) => void;
  onAct: (action: PartyDeviceAction) => void;
  onClosed: (gen: number) => void;
}

export type PartyWindow = ItemWindow<PartyDeviceOpen>;

export function createPartyWindow(opts: PartyWindowOptions): PartyWindow {
  // 창은 하나다 — 열쇠가 늘 같아 내용을 다시 보내도 초점을 빼앗지 않는다
  return createItemWindow<PartyDeviceOpen, PartyDeviceAction>({ ...opts, channels: CH, size: PARTY_WINDOW, keyOf: () => "party", isAction });
}

// 렌더러가 보낸 값은 믿지 않는다 — 정해진 모양만 넘긴다
function isAction(v: unknown): v is PartyDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (a.kind !== "slot" && a.kind !== "preset") return false;
  return isIndexBelow(a.index, PARTY_RULES.total); // 파티 칸은 늘 여섯 (src/party/rules.ts)
}
