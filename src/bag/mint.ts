// 민트 식별자 — 성격별 민트 21종을 민트 한 종류로 합쳤다 (2026-09-29 사용자 결정 "민트는 그냥 지금것도 한 종류로 통일")
// 가져오는 것이 없는 파일이다. 저장 정규화(src/save/v3.ts)·v2 변환·우편함이 함께 쓴다
export const MINT_ID = "mint";

// 옛 민트 식별자 — `<성격>-mint`(2026-09-25~2026-09-29)와 `mint-<성격>`(그 전)
export const isOldMint = (id: string): boolean => /^[a-z]+-mint$/.test(id) || /^mint-[a-z]+$/.test(id);

// 옛 도구 식별자 → 지금 식별자. 옛 민트는 모두 `mint` 다
export const currentItemId = (id: string): string => (isOldMint(id) ? MINT_ID : id);
