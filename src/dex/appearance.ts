// 저장의 모습과 색을 그림 캐시 키로 변환
// 메가 모습(mega.on, src/dex/mega.ts)이 켜져 있으면 그 슬러그가 먼저다
export const appearanceOf = (pet: { species: string; look?: string; shiny: boolean; mega?: { on?: string } }): string =>
  `${pet.mega?.on ?? pet.look ?? pet.species}${pet.shiny ? ":shiny" : ""}`;
