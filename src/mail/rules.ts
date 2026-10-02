// 우편의 규칙표 — 가져오는 것이 없는 파일이다
export const MAIL_RULES = {
  itemMax: 999, // 한 편지의 도구 한 종류 개수 상한
  pointsMax: 100_000,
  pokemonMax: 6, // 한 편지의 같은 종 마리 수 상한
  keep: 200, // applied · read 에 남기는 최근 id 수 — 서버 목록은 50개라 넉넉하다
} as const;
