// 무대가 보는 마리 — 저장 v3 의 파티 칸을 무대가 읽을 모양(PartyPet)으로 바꾼다. 무대(src/main/stage/stage.ts)는 이것 하나만 본다
// 저장 읽기·명령 보내기는 저장 쪽이 한다 (src/save/save-party.ts)
// (예전 src/main/save-party.ts 안에 있었다. 메인 레인 M8-8 에서 화면 값으로 옮겼다)
import { appearanceOf } from "../dex/look.js";
import type { HomePoint } from "../party/home.js";
import type { NatureId } from "../shared/species";
import type { SaveV3, ScreenRefV3 } from "../shared/save-v3";

// 무대가 보는 마리 하나 — 무대에 필요한 것만
export interface PartyPet {
  id: string;
  species: string;
  look: string; // 그릴 그림 — 종(이로치면 ":shiny" 를 붙인다)
  size: number; // 도트 배율 (zoomOf 로 가둔다)
  nature: NatureId | null;
  home: HomePoint;
  screen: ScreenRefV3 | null; // 모든 화면 방식에서 사는 화면 — 없으면 무대 묶음이 개체가 가장 적은 화면에 둔다 (src/main/stage/stage-group.ts)
  shown: boolean;
}

// 실제 종의 이름과 그림을 보인다. v2 에서 옮겨 온 별명·모습은 legacy 에 보존만 하고 쓰지 않는다
// (docs/specs/game.md "별명 입력과 모습 선택을 제공하지 않는다. 실제 종의 이름과 그림을 표시한다")
function partyPetOf(save: SaveV3, petId: string, hidden: boolean): PartyPet | null {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return null;
  return {
    id: pet.id,
    species: pet.species,
    look: appearanceOf(pet), // 메가 모습이 켜져 있으면 그 그림이다 (src/dex/mega.ts)
    size: pet.size,
    nature: pet.nature,
    home: { ...pet.home },
    screen: pet.screen ? { ...pet.screen } : null,
    shown: !hidden,
  };
}

// 파티 칸의 마리 — onlyShown 이면 꺼내 놓은 것만(무대에 나올 마리), 아니면 숨긴 것도. 저장이 없으면 빈 목록
export function partyPetsOf(save: SaveV3 | null, onlyShown: boolean): PartyPet[] {
  if (!save) return [];
  const out: PartyPet[] = [];
  for (const slot of save.party.slots) {
    if (slot.state !== "pokemon" || !slot.petId) continue;
    if (onlyShown && slot.hidden === true) continue;
    const view = partyPetOf(save, slot.petId, slot.hidden === true);
    if (view) out.push(view);
  }
  return out;
}
