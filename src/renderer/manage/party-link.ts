// 설정창의 교체 화면과 파티 기기 창 연결 — 박스 탭 + 파티 기기 창, 눌러서 들고 눌러서 놓기, 프리셋 칩 (P10 13a)
// 파티 탭의 `교체` 와 빈 파티 칸이 연다 (Figma 05 `Party / Swap · Open` `1248:2567`, 2026-10-02 사용자 결정 — 옛 교체 모달을 대신한다).
// 조작은 포켓몬 메뉴의 `옮기기` 와 같다. 눌러서 들고 눌러서 놓는다
//   박스 칸 → 파티 개체 칸    맞바꾸기(party.swap). 나간 개체는 들어온 개체가 있던 박스 칸으로
//   박스 칸 → 파티 빈 칸      배치(party.place)
//   파티 칸 → 다른 파티 칸    칸 옮기기(party.move)
//   파티 칸 → 박스 빈 칸      보관(party.keep, 그 칸에)
//   파티 칸 → 박스 개체 칸    맞바꾸기(party.swap)
//   박스 칸 → 박스 칸         칸 옮기기(box.move) — 박스 탭의 옮기기 그대로
// 프리셋 칩을 누르면 그 프리셋을 적용한다(party.preset)
import type { PartyDeviceAction, PartyDeviceInput } from "../../shared/model/devices.js";
import { partyBusyKey } from "../../shared/device-busy.js";
import { api } from "./api.js";
import { hold } from "./box-state.js";
import { endHold } from "./box-move.js";
import { sendCommand, whenSlow } from "./command.js";
import { createDeviceLink } from "./device-link.js";
import { closeDialog } from "./dialog.js";
import { redrawBody, setTab } from "./shell.js";
import { ui } from "./state.js";

let partyNote = ""; // 교체 명령이 실패한 이유 — 파티 기기 창의 머리 줄에 보인다
let partyBusy: string | null = null; // 0.3초 넘게 답이 없는 칸·칩의 열쇠 — 파티 기기 창이 그것만 점 세 개로
// 파티 기기 창 연결 — 교체 화면인 동안 연다 (partyDeviceBuild)
export const partyLink = createDeviceLink<PartyDeviceInput>({
  build: partyDeviceBuild,
  stamp: () => ui.view,
  open: (input, gen) => api.partyOpen(input, gen),
  apply: (input) => {
    hold.party = input.heldPetId;
  },
  afterClosed: () => {
    if (!hold.swap) return false;
    closeSwap();
    endHold();
    return true;
  },
  redraw: () => redrawBody(),
});

export function openSwap(): void {
  if (ui.dialog) closeDialog();
  endHold();
  setTab("box");
  hold.swap = true;
  hold.party = null;
  partyNote = "";
  redrawBody();
}

export function closeSwap(): void {
  hold.swap = false;
  hold.party = null;
  partyNote = "";
}

// 교체 명령 — 실패 이유는 파티 기기 창의 머리 줄에 보인다
// - pressedKey: 파티 기기 창에서 누른 칸·칩. 답이 늦으면 그것만 처리 중 (94 2-1). 박스 탭 칸은 sendCommand 의 처리 중이 맡아 null
export async function swapSend(cmd: string, target: string, extra: Record<string, unknown>, pressedKey: string | null = null): Promise<void> {
  const settle = pressedKey
    ? whenSlow(() => {
        partyBusy = pressedKey;
        syncPartyDevice();
      })
    : () => {};
  const ok = await sendCommand(cmd, target, extra, { keepOpen: true });
  settle();
  partyBusy = null;
  partyNote = ok ? "" : ui.notice;
  ui.notice = "";
  redrawBody();
}

// 파티 기기 창에 보낼 고른 값 — 교체 화면이 아니면 null(닫는다). 모델은 메인이 만든다 (src/view/device-party.ts)
function partyDeviceBuild(): PartyDeviceInput | null {
  if (!hold.swap || ui.tab !== "box" || !ui.view) return null;
  return { heldPetId: hold.party, heldFromBox: !!hold.box, notice: partyNote, busy: partyBusy };
}

export function syncPartyDevice(): void {
  partyLink.sync();
}

// 파티 기기 창에서 누른 칸·칩
export function onPartyAction(action: PartyDeviceAction): void {
  const v = ui.view;
  if (!hold.swap || !v) return;
  partyNote = "";
  if (action.kind === "preset") {
    const p = v.party.preset;
    endHold();
    hold.party = null;
    if (action.index !== p.index && action.index < p.count) void swapSend("party.preset", "", { preset: action.index }, partyBusyKey(action));
    else redrawBody();
    return;
  }
  const slot = v.party.slots[action.index];
  if (!slot || slot.state === "locked") return;
  const h = hold.box;
  if (h) {
    // 박스 개체를 든 채 파티 칸을 눌렀다
    endHold();
    void swapSend(slot.pet ? "party.swap" : "party.place", h.petId, { slotIndex: slot.index }, partyBusyKey(action));
    return;
  }
  if (hold.party) {
    // 파티 개체를 든 채 다른 파티 칸을 눌렀다. 제자리면 내려놓는다
    const held = hold.party;
    hold.party = null;
    if (slot.pet?.id === held) redrawBody();
    else void swapSend("party.move", held, { toSlot: slot.index }, partyBusyKey(action));
    return;
  }
  if (slot.pet) {
    hold.party = slot.pet.id;
    redrawBody();
  }
}
