// 파티 상세 기기 창 모델 — 고른 개체 하나 (Figma 05 `Party / Detail Device` `908:23772`).
// 설정창은 고른 값(PetDeviceInput, src/shared/model/devices.ts)만 보내고, 메인의 처리기(src/main/manage/window.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 초상·메가스톤 표식 그림은 메인의 기기 창 틀이 붙인다 (src/main/windows/devices.ts petDeviceOf)
import type { PetDeviceInput, PetDeviceOpen } from "../shared/model/devices.js";
import type { PetView, Snapshot } from "../shared/model/snapshot.js";
import type { DeviceResult } from "./device-art.js";
import { snapshotPet } from "./result-lines.js";


// `포인트 적립` 줄 — 적립 배율을 보인다. 줄은 늘 있고 글자만 바뀐다 (Figma 03 `Party Detail Device` `row/포인트 적립`, 2026-10-02 사용자 결정 A안)
//   박스 개체          적립하지 않는다
//   버프·손해 없음     기본 속도. 놀아주면 빨라지고 배고프거나 심심하면 느려진다고 알린다
//   그 밖              합(+30%, −50%)과 내역(버프 +, 배고픔·심심함 −). 2026-10-05 돌봄 개편 — 친밀도와 상관없다
function careLineOf(pet: PetView, inParty: boolean): PetDeviceOpen["careLine"] {
  const care = pet.care;
  // 다른 프리셋도 0.2배로 쌓으므로 "파티나 프리셋" 이다 (2026-10-05, Figma 05 `Party / Detail Device / Box Pokemon`)
  if (!inParty) return { title: "포인트 적립 없음", desc: "파티나 프리셋에 있을 때만 포인트가 쌓여요" };
  // 제목은 합, 설명은 내역 — 버프는 +, 손해는 − (2026-10-05 사용자 결정 "-30% -60%로 보기편하게", 2026-10-04 "+% 하나")
  if (!care.parts.length) return { title: "포인트 적립 기본", desc: "배고프거나 심심하면 느리게 쌓여요" };
  const signed = (n: number): string => (n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "±0%");
  const parts = care.parts.map((p) => `${p.name} ${signed(p.bonus)}`);
  return { title: care.bonus === 0 ? "포인트 적립 기본" : `포인트 적립 ${signed(care.bonus)}`, desc: parts.join(" · ") };
}

// 막대 글자 — 친밀도 · 만복도(구간) · 심심함(단계)
const barsOf = (pet: PetView): PetDeviceOpen["bars"] => ({ affinity: `${pet.affinity}`, fullness: `${pet.fullness} · ${pet.zoneText}`, boredom: `${pet.boredom} · ${pet.boredWord}` });

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
    model: { pet, where, inParty, slotIndex: slot, sizeLevels: v.sizeLevels ?? 5, notice: input.notice, tutorial: inParty && v.detailTutorial, dexOpen: input.dexOpen, busy: input.busy, careLine: careLineOf(pet, inParty), bars: barsOf(pet) },
  };
}
