// 상점의 규칙표 — 가격은 docs/specs/balance.md 가격표. 가져오는 것이 없는 파일이다
export const SHOP_RULES = {
  evoItemPrice: 150, // 진화용 도구는 종류와 무관하게 같은 값이다
  slotPrice: 500, // 파티 칸 하나 — 순서와 프리셋에 관계없이 같은 값이다 (2026-10-02 사용자 결정 "파티칸 가격은 500포인트 고정하자")
  boxPrice: 300, // 박스 하나 — 늘 같은 값이다 (2026-10-02 사용자 결정 "1개씩 300P")
  presetPrice: 1000, // 파티 프리셋 하나 — 가진 프리셋의 칸을 모두 열어야 산다 (2026-10-02 사용자 결정 "프리셋 가격은 1000포인트 고정하자")
  // 종 지정 구매 — 수집 난이도(rank)별 가격. 알에서 얻을 수 있는 종만 판다 (2026-09-29 사용자 결정, src/shop/catalog.ts speciesPrice)
  speciesPrices: { 1: 200, 2: 300, 3: 400, 4: 500, 5: 600 } as Readonly<Record<number, number>>,
  sellRate: 0.6, // 가방 판매가 = 구매가 × 0.6, 내림 (2026-09-30 사용자 결정 "판매가는 구매가의 60%". 내림은 제안). src/shop/sell.ts
  // 포켓몬 판매가 = 그 종이 나오는 알의 값 × petSellRate, petSellUnit 단위로 내림 (2026-10-01 사용자 결정 "가격은 알 1/4 가격으로. 대충 10단위로 떨어지게"). src/shop/sell-pet.ts
  petSellRate: 0.25,
  petSellUnit: 10,
};
