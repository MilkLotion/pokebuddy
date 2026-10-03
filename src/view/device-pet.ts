// 파티 상세 기기 창 모델 — 고른 개체 하나 (Figma 05 `Party / Detail Device` `908:23772`).
// 지금은 설정창(src/renderer/manage/manage.ts petDeviceBuild)이 같은 모델을 만든다 — 기기 창 모델을 메인으로 옮기는 단계(D10b)에서 이 함수로 바꾼다.
// 초상·메가스톤 표식 그림은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts petDeviceOf)
import type { PetDeviceOpen } from "../shared/model/devices.js";
import type { PetView, Snapshot } from "../shared/model/snapshot.js";
import type { DeviceResult } from "./device-art.js";

// 고른 값 — 설정창이 든다
export interface PetDeviceInput {
  petId: string;
  notice: string; // 마지막 실패 문구
  dexOpen: boolean; // 옆에 이 종의 도감 기기 창이 떠 있다
}

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
