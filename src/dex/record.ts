// 도감 기록 — 만난 종과 이로치를 남긴다. 저장의 dex 만 바꾼다
// 종 이름은 normalizeSlug 로 맞춰 적고 맞춰 찾는다 — 해금 판정(src/dex/unlocks.ts)과 같은 기준이다 (94 항목 9-5-5)
import type { SaveV3 } from "../shared/save-v3";
import { normalizeSlug, type DexOptions } from "./data.js";
import { battleFormsOf, dexSlugOf } from "./regional.js";

type Dex = Pick<SaveV3, "dex">;

// 해금한 종인가 · 얻은 종인가 · 이로치로 얻은 종인가 — 찾는 이름만 맞춘다(적을 때 맞춰 적는다)
export const hasUnlocked = (save: Dex, slug: string): boolean => save.dex.unlocked.includes(normalizeSlug(slug));
export const hasObtained = (save: Dex, slug: string): boolean => save.dex.obtained.includes(normalizeSlug(slug));
export const hasShiny = (save: Dex, slug: string): boolean => save.dex.shinyObtained.includes(normalizeSlug(slug));

// 얻은 종 — 해금 기록이 없으면 함께 남긴다(조건으로 나온 종은 해금 기록이 없을 수 있다). 이로치면 이로치 기록도
// 도감 칸 없는 겉모습(안농 B)은 기본 종으로 적는다. 전투 중에만 바뀌는 모습(메로엣타(스텝폼))은 기본 종과 함께 적는다
// (2026-10-09 사용자 결정 "공식기준으로 하자", "메로엣타를 얻으면 같이", data/regional.json looks · get battle)
export function recordDex(save: Dex, species: string, shiny: boolean, opts?: DexOptions): void {
  const slug = dexSlugOf(species, opts);
  for (const one of [slug, ...battleFormsOf(slug, opts)]) {
    if (!save.dex.unlocked.includes(one)) save.dex.unlocked.push(one);
    if (!save.dex.obtained.includes(one)) save.dex.obtained.push(one);
    if (shiny) recordShiny(save, one);
  }
}

// 이로치로 얻은 종
export function recordShiny(save: Dex, species: string): void {
  const slug = normalizeSlug(species);
  if (!save.dex.shinyObtained.includes(slug)) save.dex.shinyObtained.push(slug);
}

// 해금했거나 얻은 종인가 — 아니면 화면이 이름을 숨긴다
export const isKnownSpecies = (save: Dex, slug: string): boolean => hasUnlocked(save, slug) || hasObtained(save, slug);
