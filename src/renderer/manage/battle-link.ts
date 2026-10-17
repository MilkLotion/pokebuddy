// 설정창의 배틀 파티 상세 기기 창 연결 — 고른 칸, 이전·다음, 메가스톤 표식·기술 칸 (docs/specs/adventure.md "배틀 파티 상세 기기 창")
// 여기서는 칸 번호만 보내고 무엇을 보일지는 메인이 정한다 (src/view/device-battle.ts). 세대 번호·보낸 값은 device-link.ts 가 든다
import type { BattleDeviceAction, BattleDeviceInput } from "../../shared/model/devices.js";
import { api } from "./api.js";
import { battleTarget, deviceClosed, kindsOf } from "./device-kind.js";
import { createDeviceLink } from "./device-link.js";
import { leavePet, openAnyDialog } from "./dialog.js";
import { fromLayer } from "./layers.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";

let shownSlot: number | null = null; // 모험 탭에서 고른 배틀 파티 칸 — 띄울 칸은 device-kind.ts battleTarget 이 정한다(다른 탭에서 머리 탭으로 바꾼 개체의 칸)

// 지금 칸의 개체 — 빈 칸이 됐으면 null
const petAt = (slot: number | null): string | null => (slot == null ? null : (ui.view?.battle.slots[slot]?.pet?.id ?? null));

export const battleLink = createDeviceLink<BattleDeviceInput>({
  build: () => {
    const slot = battleTarget();
    if (slot == null || !petAt(slot)) return null;
    return { slot, notice: ui.notice, kinds: kindsOf() };
  },
  stamp: () => ui.view,
  open: (input, gen) => api.battleOpen(input, gen),
  layer: "device:battle",
  afterClosed: () => deviceClosed("battle"), // 머리 탭으로 바꿔 닫혔으면 고른 칸을 그대로 둔다
  redraw: () => redrawBody(),
});

// 모험 탭에서 고른 칸 — 그 카드를 옅은 바탕으로. 기기 종류 탭의 대상이기도 하다
export const battleShown = (): number | null => shownSlot;

// 기기 창을 닫았다 — 고른 칸을 비운다 (device-kind.ts closeSubject)
export function clearBattlePick(): void {
  shownSlot = null;
}

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
  const next = petAt(shownSlot);
  if (next) leavePet(next);
  redrawBody();
}

// 기기 창에서 누른 단추 — 메가스톤 표식·기술 칸. 기기 창이 다른 개체를 보이던 때 누른 것은 버린다
export function onBattleAction(action: BattleDeviceAction): void {
  const id = petAt(battleTarget());
  if (!id || action.petId !== id) return;
  // 이 기기 창에서 연 모달 — 기기 창을 닫으면 같이 닫힌다(layers.ts)
  fromLayer("device:battle", () => {
    if (action.kind === "mega") openAnyDialog({ kind: "mega", petId: id, battle: true }); // 바탕화면 파티 상세와 같은 메가진화 창 — 배틀 파티의 메가 상태를 바꾼다
    else openAnyDialog({ kind: "move-pick", petId: id, slot: action.slot }); // 기술 바꾸기 모달 — 고른 칸 없이 열고, 상세 칸에 누른 칸의 기술을 보인다
  });
}
