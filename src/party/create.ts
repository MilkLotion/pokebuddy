// 새 개체 하나 만들기 — 알에서 나오든 첫 선택으로 오든 시작 값은 같다 (docs/specs/game.md "개체")
//
// 시작 값을 두 곳에 적지 않는다. 레벨·친밀도·만복도는 규칙표 하나에서 온다.
// 종과 이로치와 성격과 성별만 부르는 쪽이 정한다 — 그것이 두 경로의 차이 전부다.
import { SAVE_V3_RULES } from "../save/rules.js";
import { localDate } from "../shared/clock.js";
import type { Gender, NatureId } from "../shared/types";
import type { PetV3, SaveV3 } from "../shared/save-v3";

// 다음 개체 식별자 — 기존 `p숫자` 중 가장 큰 수 다음
export function nextPetId(save: SaveV3): string {
  let max = 0;
  for (const p of save.pets) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
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
    size: SAVE_V3_RULES.pet.size,
    level: SAVE_V3_RULES.pet.level,
    exp: SAVE_V3_RULES.pet.exp,
    affinity: SAVE_V3_RULES.pet.affinity,
    affinityProgressMs: 0,
    fullness: SAVE_V3_RULES.pet.fullness,
    fullnessProgressMs: 0,
    mood: SAVE_V3_RULES.pet.mood,
    moodProgressMs: 0,
    feedCooldownMs: 0,
    playCooldownMs: 0,
    playWindowMs: 0,
    playStreak: 0,
    buffs: [],
    home: { ...SAVE_V3_RULES.pet.home },
    since: now,
    stage: 0,
    evolved: [],
    daily: { date: localDate(now), gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  };
}

// 도감 기록 — 만난 종과 이로치를 남긴다. 조건으로 나온 종은 해금 기록이 없을 수 있다
export function recordDex(save: SaveV3, species: string, shiny: boolean): void {
  if (!save.dex.unlocked.includes(species)) save.dex.unlocked.push(species);
  if (!save.dex.obtained.includes(species)) save.dex.obtained.push(species);
  if (shiny && !save.dex.shinyObtained.includes(species)) save.dex.shinyObtained.push(species);
}
