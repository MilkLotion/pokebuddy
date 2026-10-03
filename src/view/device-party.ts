// 파티 기기 창 모델 — 교체 화면에서 지금 프리셋의 파티 칸과 프리셋 칩 (Figma 05 `Party / Swap · Open` `1248:2567`, 2026-10-02 사용자 결정).
// 지금은 설정창(src/renderer/manage/manage.ts partyDeviceModel)이 같은 모델을 만든다 — 기기 창 모델을 메인으로 옮기는 단계(D10b)에서 이 함수로 바꾼다
import type { PartyDeviceOpen } from "../shared/model/devices.js";
import type { Snapshot } from "../shared/model/snapshot.js";
import { portraitArtKey, type DeviceResult } from "./device-art.js";

// 고른 값 — 설정창이 든다
export interface PartyDeviceInput {
  heldPetId: string | null; // 파티 기기 창에서 든 파티 개체. 파티에서 빠졌으면 놓는다
  heldFromBox: boolean; // 박스 개체를 들었다 — 빈 칸이 놓을 칸이 된다
  notice: string; // 마지막 교체 실패 — 머리 줄의 이름 옆 자리
}

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
