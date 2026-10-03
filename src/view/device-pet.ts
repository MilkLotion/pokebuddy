// 파티 상세 기기 창 모델 — 고른 개체 하나 (Figma 05 `Party / Detail Device` `908:23772`).
// 설정창은 고른 값(PetDeviceInput, src/shared/model/devices.ts)만 보내고, 메인의 처리기(src/main/manage-window.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 초상·메가스톤 표식 그림은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts petDeviceOf)
import type { PetDeviceInput, PetDeviceOpen } from "../shared/model/devices.js";
import type { PetView, Snapshot } from "../shared/model/snapshot.js";
import type { DeviceResult } from "./device-art.js";


// 고른 개체가 파티와 박스에 없으면 null(기기 창을 닫는다)
export function petDeviceModel(v: Snapshot, given: PetDeviceInput): DeviceResult<PetDeviceOpen, PetDeviceInput> | null {
  const input = { ...given };
  const partyPet = v.party.slots.find((s) => s.pet?.id === input.petId);
  const box = v.boxes.find((b) => b.slots.some((p) => p?.id === input.petId));
  const pet: PetView | null = partyPet?.pet ?? box?.slots.find((p): p is PetView => p?.id === input.petId) ?? null;
  if (!pet) return null;
  const slot = partyPet ? partyPet.index : null;
  const inParty = slot != null;
  const where = inParty ? `파티 ${slot + 1}번 · ${pet.hidden ? "볼 안" : "나와 있음"}` : `${box?.name ?? "박스"} · 보관 중`;
  return {
    input,
    model: { pet, where, inParty, slotIndex: slot, sizeLevels: v.sizeLevels ?? 5, notice: input.notice, tutorial: inParty && v.detailTutorial, dexOpen: input.dexOpen },
  };
}
