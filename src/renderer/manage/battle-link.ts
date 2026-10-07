// 설정창의 배틀 파티 상세 기기 창 연결 — 고른 칸, 이전·다음, 기술 순서 바꾸기 (docs/specs/adventure.md "배틀 파티 상세 기기 창")
// 여기서는 칸 번호만 보내고 무엇을 보일지는 메인이 정한다 (src/view/device-battle.ts). 세대 번호·보낸 값은 device-link.ts 가 든다
import { battleBusyKey } from "../../shared/device-busy.js";
import type { BattleDeviceAction, BattleDeviceInput } from "../../shared/model/devices.js";
import { api } from "./api.js";
import { sendCommand, whenSlow } from "./command.js";
import { createDeviceLink } from "./device-link.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";

let shownSlot: number | null = null; // 기기 창에 띄운 배틀 파티 칸
let busy: string | null = null; // 0.3초 넘게 답이 없는 단추의 열쇠

// 지금 칸의 개체 — 빈 칸이 됐으면 null
const petAt = (slot: number | null): string | null => (slot == null ? null : (ui.view?.battle.slots[slot]?.pet?.id ?? null));

export const battleLink = createDeviceLink<BattleDeviceInput>({
  build: () => {
    if (shownSlot == null || !petAt(shownSlot)) return null;
    return { slot: shownSlot, notice: ui.notice, busy };
  },
  stamp: () => ui.view,
  open: (input, gen) => api.battleOpen(input, gen),
  afterClosed: () => {
    if (shownSlot == null) return false;
    shownSlot = null;
    return true;
  },
  redraw: () => redrawBody(),
});

// 기기 창에 떠 있는 칸 — 그 카드를 옅은 바탕으로
export const battleShown = (): number | null => shownSlot;

export function openBattleDevice(slot: number): void {
  shownSlot = slot;
  redrawBody();
}

// 탭을 떠나면 닫는다 — 다음 그리기의 syncBattleDevice 가 닫으라고 보낸다
export function leaveBattle(): void {
  shownSlot = null;
}

export function syncBattleDevice(): void {
  if (shownSlot != null && !petAt(shownSlot)) shownSlot = null; // 그 칸을 비웠다
  battleLink.sync();
}

// 이전·다음 — 개체가 든 칸 순서로 돈다
export function stepBattle(delta: -1 | 1): void {
  if (shownSlot == null || !ui.view) return;
  const filled = ui.view.battle.slots.filter((s) => s.pet).map((s) => s.index);
  if (filled.length < 2) return;
  const at = filled.indexOf(shownSlot);
  shownSlot = filled[(at + delta + filled.length) % filled.length] ?? shownSlot;
  redrawBody();
}

// 기기 창에서 누른 단추 — 기술 순서 바꾸기. 기기 창이 다른 개체를 보이던 때 누른 것은 버린다
export function onBattleAction(action: BattleDeviceAction): void {
  const id = petAt(shownSlot);
  if (!id || action.petId !== id) return;
  void swapSend(action, id);
}

async function swapSend(action: BattleDeviceAction, id: string): Promise<void> {
  const settle = whenSlow(() => {
    busy = battleBusyKey(action);
    battleLink.sync(true);
  });
  await sendCommand("battle.moves", id);
  settle();
  busy = null;
  battleLink.sync();
}
