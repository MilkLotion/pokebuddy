// 성별 — 원작 성비(data/species.defaults.json 의 genderRate, src/tools/data/build-species.ts)를 따른다 (2026-09-30 사용자 결정)
//
//   얻을 때   성비대로 무작위. 무성 종은 none, 한 성별뿐인 종(럭키·루주라·엘레이드)은 그 성별
//   옛 개체   성별이 없는 저장은 반반으로 정한다. 무성·한 성별 종은 그 성별이다.
//             성별 조건으로 진화한 종(염뉴트·눈여아·엘레이드 등)은 전부 한 성별 종이라 여기서 함께 맞는다
//   진화      data/evo.json 의 gender 가 있으면 그 성별만 진화한다 (src/dex/evolve.ts checkNeed)
import type { Gender } from "../shared/species";
import type { DexOptions } from "./data";
import { profileOf } from "./species.js";

// 성비 분모 — genderRate 는 암컷 비율을 8 분의 몇으로 적는다. -1 은 무성
export const GENDER_RATE_MAX = 8;

export const GENDERS: readonly Gender[] = ["male", "female", "none"];
export const isGender = (v: unknown): v is Gender => typeof v === "string" && (GENDERS as readonly string[]).includes(v);

// 종이 가질 수 있는 성별이 하나뿐이면 그것 — 무성·수컷만·암컷만. 둘 다 가능하면 null
export function fixedGender(species: string, opts?: DexOptions): Gender | null {
  const rate = profileOf(species, opts).genderRate;
  if (rate < 0) return "none";
  if (rate === 0) return "male";
  if (rate >= GENDER_RATE_MAX) return "female";
  return null;
}

// 새로 얻은 개체의 성별 — 성비대로. 한 성별 종도 난수를 하나 쓴다 (앞뒤 뽑기의 순서가 종에 따라 달라지지 않게)
export function rollGender(species: string, rng: () => number, opts?: DexOptions): Gender {
  const roll = rng();
  const fixed = fixedGender(species, opts);
  if (fixed) return fixed;
  return roll * GENDER_RATE_MAX < profileOf(species, opts).genderRate ? "female" : "male";
}

// 문자열 해시 (FNV-1a 32비트) — 옛 개체의 반반 뽑기를 열 때마다 같게 한다
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 성별이 없는 옛 개체의 성별 — 한 성별 종이면 그것, 아니면 반반 (2026-09-30 사용자 결정 "이미 있는 포켓몬들은 1/2확률").
// 저장을 다시 쓰기 전에 여러 번 열어도 같은 값이 나오게 식별자와 얻은 시각으로 정한다
export function legacyGender(pet: { id: string; species: string; since: number }, opts?: DexOptions): Gender {
  return fixedGender(pet.species, opts) ?? (hash32(`${pet.id}:${pet.since}`) % 2 === 0 ? "male" : "female");
}
