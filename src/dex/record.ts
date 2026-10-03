// 도감 기록 — 만난 종과 이로치를 남긴다. 저장의 dex 만 바꾼다
import type { SaveV3 } from "../shared/save-v3";

// 얻은 종 — 해금 기록이 없으면 함께 남긴다(조건으로 나온 종은 해금 기록이 없을 수 있다). 이로치면 이로치 기록도
export function recordDex(save: Pick<SaveV3, "dex">, species: string, shiny: boolean): void {
  if (!save.dex.unlocked.includes(species)) save.dex.unlocked.push(species);
  if (!save.dex.obtained.includes(species)) save.dex.obtained.push(species);
  if (shiny) recordShiny(save, species);
}

// 이로치로 얻은 종
export function recordShiny(save: Pick<SaveV3, "dex">, species: string): void {
  if (!save.dex.shinyObtained.includes(species)) save.dex.shinyObtained.push(species);
}
