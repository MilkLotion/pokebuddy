// 새 개체 하나 만들기 — 알에서 나오든 첫 선택으로 오든 시작 값은 같다 (docs/specs/game.md "개체")
//
// 시작 값을 두 곳에 적지 않는다. 레벨·친밀도·만복도는 규칙표 하나에서 온다.
// 종과 이로치와 성격과 성별만 부르는 쪽이 정한다 — 그것이 두 경로의 차이 전부다.
import { boxRoom, addToBox } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { rollGender } from "../dex/gender.js";
import { randomNature } from "../dex/natures.js";
import { recordDex } from "../dex/record.js";
import type { Rand } from "../shared/rand.js";
import type { Check } from "../shared/names/reasons.js";
import { PET_RULES } from "./rules.js";
import { localDate } from "../shared/clock.js";
import type { Gender, NatureId } from "../shared/species";
import type { PetV3, SaveV3 } from "../shared/save-v3";

// 지금 있는 개체의 `p숫자` 중 가장 큰 수. 없으면 0
export function maxPetNo(pets: readonly { id: string }[]): number {
  let max = 0;
  for (const p of pets) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// 다음 개체 식별자 — 기존 `p숫자` 와 지금까지 쓴 번호(petSeq) 중 가장 큰 수 다음. 판 개체의 번호를 다시 쓰지 않는다
export function nextPetId(save: SaveV3): string {
  return `p${Math.max(maxPetNo(save.pets), save.petSeq ?? 0) + 1}`;
}

export interface NewPetOptions {
  id: string;
  species: string;
  shiny: boolean;
  nature: NatureId;
  gender: Gender; // 얻을 때 성비대로 정한다 (src/dex/gender.ts rollGender)
  now: number;
}

export function newPet({ id, species, shiny, nature, gender, now }: NewPetOptions): PetV3 {
  return {
    id,
    species,
    shiny,
    nature,
    gender,
    size: PET_RULES.size,
    level: PET_RULES.level,
    exp: PET_RULES.exp,
    affinity: PET_RULES.affinity,
    affinityProgressMs: 0,
    fullness: PET_RULES.fullness,
    fullnessProgressMs: 0,
    mood: PET_RULES.mood,
    moodProgressMs: 0,
    feedCooldownMs: 0,
    playCooldownMs: 0,
    playWindowMs: 0,
    playStreak: 0,
    buffs: [],
    home: { ...PET_RULES.home },
    since: now,
    stage: 0,
    evolved: [],
    daily: { date: localDate(now), gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  };
}


// 새 개체를 둘 곳 — 상점·알·줍기·업적은 파티 먼저, 우편은 박스에만, 첫 선택은 파티에만
//   party-first  적용한 프리셋의 첫 빈 칸에 꺼낸 상태로, 없으면 박스
//   box-only     박스에만
//   party-only   파티 빈 칸에만
export type NewPetPlace = "party-first" | "box-only" | "party-only";

// 새 개체를 둘 곳이 있는가 — 무작위를 쓰기 전에 본다
export function checkNewPetRoom(save: SaveV3, place: NewPetPlace): Check<"box-full" | "no-slot"> {
  const party = save.party.slots.some((s) => s.state === "empty");
  if (place === "party-only") return party ? { ok: true } : { ok: false, reason: "no-slot" };
  if (place === "box-only") return boxRoom(save.boxes) > 0 ? { ok: true } : { ok: false, reason: "box-full" };
  return party || boxRoom(save.boxes) > 0 ? { ok: true } : { ok: false, reason: "box-full" };
}

export interface NewPetSpec {
  species: string;
  shiny: boolean;
  now: number;
  rand: Rand;
  place: NewPetPlace;
  opts?: DexOptions;
}

export interface NewPetResult {
  pet: PetV3;
  slotIndex?: number; // 파티에 넣었으면 칸 번호
  toBox: boolean;
}

// 새 개체 하나를 만들어 저장에 넣는다 — 식별자 → 성격 → 성별 → 개체 → 도감 기록 → 배치.
// 난수는 성격 한 번, 성별 한 번, 이 순서다. 알은 종·이로치·모습을 먼저 뽑은 뒤 부른다 — 서버 재계산(src/verify/save-rules.ts rollEgg)과 같은 순서.
// 둘 곳이 없으면 난수를 쓰지 않고 저장을 바꾸지 않은 채 null
export function addNewPet(save: SaveV3, spec: NewPetSpec): NewPetResult | null {
  if (!checkNewPetRoom(save, spec.place).ok) return null;
  const { species, shiny, now, rand, opts } = spec;
  const id = nextPetId(save);
  const pet = newPet({ id, species, shiny, nature: randomNature(rand, opts).id, gender: rollGender(species, rand, opts), now });
  save.pets.push(pet);
  recordDex(save, species, shiny);
  const i = spec.place === "box-only" ? -1 : save.party.slots.findIndex((s) => s.state === "empty");
  if (i >= 0) {
    save.party.slots[i] = { state: "pokemon", petId: id, hidden: false };
    return { pet, slotIndex: i, toBox: false };
  }
  addToBox(save.boxes, id);
  return { pet, toBox: true };
}
