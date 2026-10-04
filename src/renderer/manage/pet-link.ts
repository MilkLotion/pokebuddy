// 설정창의 파티 상세 기기 창 연결 — 고른 개체, 이전·다음, 기기 창 단추의 명령·대화상자, 처리 중 (P10u)
// 관리 창 옆에 붙는 창에 고른 개체를 띄운다 (src/main/pet-window.ts, Figma 05 `Party / Detail Device` `908:23772`(기기 `Party Detail Device` `1262:76637`)).
// 여기서는 고른 개체만 보내고 무엇을 보일지는 메인이 정한다 (src/view/device-pet.ts). 기기 창의 단추는 여기로 돌아와 명령·대화상자로 처리한다
import { petBusyKey } from "../../shared/device-busy.js";
import type { PetDeviceAction, PetDeviceInput } from "../../shared/model/devices.js";
import { api } from "./api.js";
import { boxUi } from "./box-state.js";
import { sendCommand, whenSlow } from "./command.js";
import { closeDexBeside, syncDexBeside, toggleDexBeside } from "./dex-link.js";
import { createDeviceLink } from "./device-link.js";
import { openAnyDialog } from "./dialog.js";
import { redrawBody } from "./shell.js";
import { boxPets, findPartySlot, partyPets, petInView, ui } from "./state.js";

// 파티 상세 기기 창 연결 — 개체를 고른 동안 연다 (petDeviceBuild). 세대 번호·보낸 값은 device-link.ts 가 든다
export const petLink = createDeviceLink<PetDeviceInput>({
  build: petDeviceBuild,
  stamp: () => ui.view,
  open: (input, gen) => api.petOpen(input, gen),
  afterClosed: () => {
    if (!ui.detailPet) return false;
    ui.detailPet = null;
    return true;
  },
  redraw: () => redrawBody(),
});
let petBusy: string | null = null; // 0.3초 넘게 답이 없는 기기 창 단추의 열쇠 — 기기 창이 그것만 점 세 개로

// 파티 상세 기기 창에 보낼 고른 값 — 고른 개체가 없으면 null(닫는다). 옆 도감 기기 창이 켜 있으면 그 종을 먼저 보낸다
function petDeviceBuild(): PetDeviceInput | null {
  const pet = ui.detailPet ? petInView(ui.detailPet) : null;
  if (!pet || !ui.view) return null;
  const dexOpen = syncDexBeside(pet.species);
  return { petId: pet.id, notice: ui.notice, dexOpen, busy: petBusy };
}

export function syncPetDevice(): void {
  petLink.sync();
  if (!petLink.isOpen()) closeDexBeside(); // 파티 상세를 닫으면 옆 도감 기기 창도 닫는다
}

// 이전·다음 — 파티 개체는 파티 칸 순서, 박스 개체는 박스 순서로 돈다
export function stepPet(delta: -1 | 1): void {
  if (!ui.detailPet) return;
  const list = findPartySlot(ui.detailPet) != null ? partyPets() : boxPets();
  if (list.length < 2) return;
  const at = list.findIndex((p) => p.id === ui.detailPet);
  const next = list[(at + delta + list.length) % list.length];
  if (!next) return;
  ui.detailPet = next.id;
  // 다음 개체가 다른 박스에 있으면 박스 탭도 그 박스로 넘긴다 — 도감 넘기기가 쪽을 따라가는 것과 같다 (dex-tab.ts stepDex)
  const box = ui.view?.boxes.findIndex((b) => b.slots.some((p) => p?.id === next.id)) ?? -1;
  if (box >= 0) boxUi.page = box;
  redrawBody();
}

// 기기 창에서 누른 단추 — 명령은 그 개체에, 대화상자는 여기서 연다
export function onPetAction(action: PetDeviceAction): void {
  const id = ui.detailPet;
  if (!id || action.petId !== id) return; // 기기 창이 다른 개체를 보이던 때 누른 것 — 버린다
  if (action.kind === "cmd") {
    void petSend(action, id);
    return;
  }
  if (action.kind === "tutorial") {
    void sendCommand(action.action === "done" ? "tutorial.done" : "tutorial.skip", "detail");
    return;
  }
  if (action.kind === "dex") {
    toggleDexBeside();
    return;
  }
  if (action.dialog === "evolve") openAnyDialog({ kind: "evolve", petId: id });
  else if (action.dialog === "mega") openAnyDialog({ kind: "mega", petId: id });
  else openAnyDialog({ kind: "nature", petId: id });
}

// 기기 창 단추의 명령 — 답이 늦으면 누른 단추만 처리 중 (94 2-1)
async function petSend(action: PetDeviceAction & { kind: "cmd" }, id: string): Promise<void> {
  const settle = whenSlow(() => {
    petBusy = petBusyKey(action);
    syncPetDevice();
  });
  await sendCommand(action.cmd, id, action.args);
  settle();
  // 답이 빨라 처리 중을 보이지 않았어도 다시 보낸다 — 실패 문구(ui.notice)가 이 답에 실려야 한다(파티 기기 창 swapSend 와 같다)
  petBusy = null;
  syncPetDevice();
}
