// 파티 기기 창 모델 — 교체 화면에서 지금 프리셋의 파티 칸과 프리셋 칩 (Figma 05 `Party / Swap · Open` `1248:2567`, 2026-10-02 사용자 결정).
// 설정창은 고른 값(PartyDeviceInput, src/shared/model/devices.ts)만 보내고, 메인의 처리기(src/main/manage/window.ts)가 지금 스냅샷으로 이 함수를 부른다
import type { PartyDeviceInput, PartyDeviceOpen } from "../shared/model/devices.js";
import type { Snapshot } from "../shared/model/snapshot.js";
import { portraitArtKey, type DeviceResult } from "./device-art.js";


export function partyDeviceModel(v: Snapshot, given: PartyDeviceInput): DeviceResult<PartyDeviceOpen, PartyDeviceInput> {
  const input = { ...given };
  if (input.heldPetId && !v.party.slots.some((s) => s.pet?.id === input.heldPetId)) input.heldPetId = null; // 든 개체가 파티에서 빠졌다
  const holding = input.heldFromBox || !!input.heldPetId;
  const slots = v.party.slots.map((s) => {
    const pet = s.pet ?? null;
    return {
      index: s.index,
      state: pet ? ("pokemon" as const) : s.state === "locked" ? ("locked" as const) : ("empty" as const),
      name: pet?.name ?? "",
      level: pet ? `Lv.${pet.level}` : "",
      art: pet ? portraitArtKey(pet.look, pet.shiny) : null,
      held: !!pet && pet.id === input.heldPetId,
      target: holding && !pet && s.state !== "locked", // 놓을 칸 — 든 것이 있을 때의 빈 칸. 개체 칸은 눌러서 맞바꾼다
    };
  });
  const p = v.party.preset;
  return {
    input,
    model: {
      name: p.name,
      slots,
      presets: Array.from({ length: p.max }, (_, i) => ({ index: i, owned: i < p.count, active: i === p.index })),
      notice: input.notice,
    },
  };
}
