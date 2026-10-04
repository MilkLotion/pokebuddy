// 파티 상세 기기 창 모델 — 고른 개체 하나 (Figma 05 `Party / Detail Device` `908:23772`).
// 설정창은 고른 값(PetDeviceInput, src/shared/model/devices.ts)만 보내고, 메인의 처리기(src/main/manage-window.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 초상·메가스톤 표식 그림은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts petDeviceOf)
import type { PetDeviceInput, PetDeviceOpen } from "../shared/model/devices.js";
import type { PetView, Snapshot } from "../shared/model/snapshot.js";
import type { DeviceResult } from "./device-art.js";
import { snapshotPet } from "./result-lines.js";


// `포인트 적립` 줄 — 돌봄 보너스를 보인다. 줄은 늘 있고 글자만 바뀐다 (Figma 03 `Party Detail Device` `row/포인트 적립`, 2026-10-02 사용자 결정 A안)
//   박스 개체          적립하지 않는다
//   친밀도 100 전      기본 속도. 친밀도가 가득이면 보너스가 붙는다고 알린다
//   친밀도 100         보너스 합과 내역(기분 단계 · 버프). 보너스가 없으면 기본 속도
function careLineOf(pet: PetView, inParty: boolean): PetDeviceOpen["careLine"] {
  const care = pet.care;
  if (!inParty) return { title: "포인트 적립 없음", desc: "파티에 있을 때만 포인트가 쌓여요" };
  if (!care) return { title: "포인트 적립 기본", desc: "친밀도가 가득이면 돌봄으로 더 빨리 쌓여요" };
  if (care.bonus <= 0) return { title: "포인트 적립 기본", desc: "기분이 좋거나 버프가 켜지면 더 빨리 쌓여요" };
  const parts = care.parts.map((p) => `${p.kind === "mood" ? `기분 ${p.name}` : p.name} +${p.bonus}%`);
  return { title: `포인트 적립 +${care.bonus}%`, desc: parts.join(" · ") };
}

// 막대 글자 — 친밀도 · 만복도(구간) · 기분(말)
const barsOf = (pet: PetView): PetDeviceOpen["bars"] => ({ affinity: `${pet.affinity}`, fullness: `${pet.fullness} · ${pet.zoneText}`, mood: `${pet.mood} · ${pet.moodWord}` });

// 고른 개체가 파티와 박스에 없으면 null(기기 창을 닫는다)
export function petDeviceModel(v: Snapshot, given: PetDeviceInput): DeviceResult<PetDeviceOpen, PetDeviceInput> | null {
  const input = { ...given };
  const partyPet = v.party.slots.find((s) => s.pet?.id === input.petId);
  const box = v.boxes.find((b) => b.slots.some((p) => p?.id === input.petId));
  const pet: PetView | null = snapshotPet(v, input.petId);
  if (!pet) return null;
  const slot = partyPet ? partyPet.index : null;
  const inParty = slot != null;
  const where = inParty ? `파티 ${slot + 1}번 · ${pet.hidden ? "볼 안" : "나와 있음"}` : `${box?.name ?? "박스"} · 보관 중`;
  return {
    input,
    model: { pet, where, inParty, slotIndex: slot, sizeLevels: v.sizeLevels ?? 5, notice: input.notice, tutorial: inParty && v.detailTutorial, dexOpen: input.dexOpen, careLine: careLineOf(pet, inParty), bars: barsOf(pet) },
  };
}
