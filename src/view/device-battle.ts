// 배틀 파티 상세 기기 창 모델 — 배틀 파티 칸 하나 (docs/specs/adventure.md "배틀 파티 상세 기기 창").
// 설정창은 칸 번호(BattleDeviceInput)만 보내고, 메인의 처리기(src/main/manage/devices.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 초상·흰 타입 아이콘은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts battleDeviceOf)
import type { BattleDeviceInput, BattleDeviceOpen } from "../shared/model/devices.js";
import type { Snapshot } from "../shared/model/snapshot.js";
import { attackRows, defenseRows } from "../battle/matchup.js";
import { typeChartTable } from "../dex/tables.js";
import { itemArtKey, portraitArtKey, typeArtKey, type DeviceResult } from "./device-art.js";

// 빈 칸이거나 없는 칸이면 null — 기기 창을 닫는다
export function battleDeviceModel(v: Snapshot, input: BattleDeviceInput): DeviceResult<BattleDeviceOpen, BattleDeviceInput> | null {
  const slot = v.battle.slots[input.slot];
  const pet = slot?.pet;
  if (!slot || !pet) return null;
  const typeArt: Record<string, string> = {};
  for (const m of slot.moves) typeArt[m.typeId] = typeArtKey(m.typeId);
  // 배틀 창이 읽는 값만 싣는다 — 시간으로 바뀌는 개체 값이 빠져 시간이 흘러도 모델이 같다 (src/shared/model/devices.ts BattleDevicePet)
  const { id, species, name, nameParts, gender, shiny, types, typeIds, mega } = pet;
  const { index, moves, blocked, stats, ability, fixedFirst } = slot;
  // 타입 상성 — 방어(두 타입 곱)와 공격(자기 타입마다). 메가 모습을 켰으면 메가 모습의 타입이다(typeIds)
  const chart = typeChartTable();
  const matchup = { defense: defenseRows(chart, typeIds), attack: typeIds.map((t, i) => ({ typeId: t, name: types[i] ?? t, rows: attackRows(chart, t) })) };
  for (const line of [...matchup.defense, ...matchup.attack.flatMap((a) => a.rows)]) for (const t of line.types) typeArt[t] = typeArtKey(t);
  return {
    model: {
      slot: { index, moves, blocked, stats, ability, ...(fixedFirst ? { fixedFirst } : {}), pet: { id, species, name, nameParts, gender, shiny, types, typeIds, ...(mega ? { mega } : {}) } },
      caption: `배틀 파티 ${slot.index + 1}번`,
      notice: input.notice,
      art: portraitArtKey(pet.look, pet.shiny),
      typeArt,
      megaArt: pet.mega ? itemArtKey("key-stone") : null, // 메가스톤을 지닌 개체 — 파티 상세 기기 창과 같은 표식(키스톤)
      matchup,
    },
    input,
  };
}
