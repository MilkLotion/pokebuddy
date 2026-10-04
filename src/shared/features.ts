// 기능 스위치 — 메인·렌더러가 같이 읽는 한 벌. 렌더러 빌드는 dist/web/shared/features.js(ESM)로 따로 낸다 (tsconfig.renderer.json)

// 성격을 화면에 보일지 — 2026-09-30 사용자 결정 "성격은 없앨거야 … 코드는 남겨두고 … 능력치나 민트, 성격변경 등 없애자".
// 성격 부여·저장·교환 검증·움직임 배율은 그대로다. 끄면 성격 글자를 빼는 곳:
//   관리 창(레벨 줄·파티 카드·진화·모습 확인·가이드북), 파티 상세 기기 창, 우클릭 메뉴 첫 줄
// 성격민트 은퇴는 따로다 — src/bag/mint.ts MINT_RETIRED
export const NATURE_SHOWN = false;
