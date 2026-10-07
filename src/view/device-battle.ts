// 배틀 파티 상세 기기 창 모델 — 배틀 파티 칸 하나 (docs/specs/adventure.md "배틀 파티 상세 기기 창").
// 설정창은 칸 번호(BattleDeviceInput)만 보내고, 메인의 처리기(src/main/manage/devices.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 초상·흰 타입 아이콘은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts battleDeviceOf)
import { BATTLE_RULES } from "../battle/rules.js";
import type { BattleDeviceInput, BattleDeviceOpen } from "../shared/model/devices.js";
import type { Snapshot } from "../shared/model/snapshot.js";
import { itemArtKey, portraitArtKey, typeArtKey, type DeviceResult } from "./device-art.js";

// ? 말풍선 — 배틀 능력치의 기준 (2026-10-07 사용자 결정 네 줄)
const BATTLE_BASIS_LINES: readonly string[] = [`${BATTLE_RULES.level}레벨 기준`, "노력치 없음", `개체값 6V(${BATTLE_RULES.iv})`, "도구 없음"];

// 빈 칸이거나 없는 칸이면 null — 기기 창을 닫는다
export function battleDeviceModel(v: Snapshot, input: BattleDeviceInput): DeviceResult<BattleDeviceOpen, BattleDeviceInput> | null {
  const slot = v.battle.slots[input.slot];
  const pet = slot?.pet;
  if (!slot || !pet) return null;
  const typeArt: Record<string, string> = {};
  for (const m of slot.moves) typeArt[m.typeId] = typeArtKey(m.typeId);
  return {
    model: {
      slot,
      caption: `배틀 파티 ${slot.index + 1}번`,
      notice: input.notice,
      busy: input.busy,
      art: portraitArtKey(pet.look, pet.shiny),
      typeArt,
      megaArt: pet.mega ? itemArtKey("key-stone") : null, // 메가스톤을 지닌 개체 — 파티 상세 기기 창과 같은 표식(키스톤)
      basis: [...BATTLE_BASIS_LINES],
    },
    input,
  };
}
