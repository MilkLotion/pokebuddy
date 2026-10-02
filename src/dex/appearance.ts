// 저장의 모습과 색을 그림 캐시 키로 변환
// 메가 모습(mega.on, src/dex/mega.ts)이 켜져 있으면 그 슬러그가 먼저다.
// 성별마다 그림이 다른 종(대쓰여너 암컷, data/regional.json 의 gender)은 그 성별의 그림 이름이 종보다 먼저다
import { genderLookOf } from "./regional.js";

export const appearanceOf = (pet: { species: string; look?: string; shiny: boolean; gender?: string; mega?: { on?: string } }): string =>
  `${pet.mega?.on ?? pet.look ?? genderLookOf(pet.species, pet.gender) ?? pet.species}${pet.shiny ? ":shiny" : ""}`;
