// 도감의 규칙표 — 메가진화 조건, 성격의 변덕 주기, 해금 정리 판. 가져오는 것이 없는 파일이다

// 메가진화 조건 — 수치는 docs/specs/balance.md "메가진화". 모두 채우면 그 개체에 메가스톤이 생긴다 (src/dex/mega.ts)
// 항목은 2026-10-02 사용자 결정(친밀도 100, 레벨 60 이상, 파티에서 보낸 시간, 돌봄 누적 횟수). 시간과 횟수의 값은 제안이다
export const MEGA_RULES = {
  affinity: 100,
  level: 60,
  bondMs: 24 * 60 * 60_000, // 친밀도 100 뒤 파티에서 보낸 시간 24시간
  care: 100, // 친밀도 100 뒤 밥 주기와 놀아주기 합 100회
};

// 변덕 — 마리별로 어긋난 주기에 한 축이 잠깐 바뀐다 (src/dex/natures.ts)
export const QUIRK_RULES = { periodMs: 90_000, durationMs: 10_000 };

// 해금 정리
export const UNLOCK_RULES = {
  rev: 1, // 해금 정리 판 — src/dex/unlocks.ts pruneUnlocks. 판을 올리면 옛 저장에서 한 번 정리가 돈다
};
