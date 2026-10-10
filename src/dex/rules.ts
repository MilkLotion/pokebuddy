// 도감의 규칙표 — 메가진화 조건, 성격의 변덕 주기, 모습 바꾸기 해금, 해금 정리 판. 가져오는 것이 없는 파일이다

// 메가진화 조건 — 수치는 docs/specs/balance.md "메가진화". 모두 채우면 그 개체에 메가스톤이 생긴다 (src/dex/mega.ts)
// 항목은 2026-10-02 사용자 결정(친밀도 100, 레벨 60 이상, 파티에서 보낸 시간, 돌봄 누적 횟수). 시간과 횟수의 값은 제안이다
export const MEGA_RULES = {
  affinity: 100,
  level: 60,
  bondMs: 24 * 60 * 60_000, // 친밀도 100 뒤 파티에서 보낸 시간 24시간
  care: 30, // 친밀도 100 뒤 놀아주기 30회 — 장난감도 센다. 밥 주기는 세지 않는다 (2026-10-11 사용자 "메가진화 조건 놀아주기30회로 변경". 그 전 2026-10-08 밥 주기·놀아주기 합 70, 처음 100)
  toyCare: 2, // 장난감 한 번이 세는 놀아주기 횟수 (2026-10-11 사용자 "장난감에 메가진화수치+1 추가해주고(2오르게)")
  careMax: 100, // 돌봄 횟수로 받는 가장 큰 값 — 옛 조건(100·70)에서 센 저장·교환 제안이 이 값까지 있다. 서버 검증 상한(megaCareMax)·교환 받기가 쓴다
};

// 변덕 — 마리별로 어긋난 주기에 한 축이 잠깐 바뀐다 (src/dex/natures.ts)
export const QUIRK_RULES = { periodMs: 90_000, durationMs: 10_000 };

// 모습 바꾸기 해금과 값 — 키는 data/regional.json shift 의 기본 종(로토무). 수치는 docs/specs/balance.md "로토무의 모습 바꾸기"
//   workMs  그 개체가 지금 파티에 있는 동안 받은 에이전트 작업 시간(PetV3.workMs)이 이 값 이상이면 모든 모습이 열린다
//   item    기본 종이 아닌 모습으로 바꿀 때마다 쓰는 도구. 기본 종으로 돌아갈 때는 쓰지 않는다
//   oneWay  한 방향 — 기본 종에서 모습으로 한 번 바꾸고 돌아가지 않는다. 바뀐 개체에는 모습 바꾸기가 없다
// (2026-10-05 사용자 결정 "누적말고, 구한 후 2시간으로(로토무가 파티에 있던채로 2시간)", "모습바꾸기때 카탈로그 필요하게", "원래모습 … 이때는 안들게".
//  그 전에는 계정 작업 시간 50시간이었다)
// 플라엣테·다투곰 — 영원의 꽃·붉은 달로 플라엣테(영원의 꽃)·다투곰(붉은 달)이 된다. 작업 시간 조건은 없다
// (2026-10-08 사용자 결정 "모습바꾸기인데, 이전으로 못돌아가는 모습바꾸기인거지. 영꽃이나 달투곰에는 모습바꾸기메뉴가없게")
export interface ShiftRule {
  workMs: number;
  item: string;
  oneWay?: true;
}
export const SHIFT_RULES: Readonly<Record<string, ShiftRule>> = {
  rotom: { workMs: 2 * 60 * 60_000, item: "rotom-catalog" },
  floette: { workMs: 0, item: "eternal-flower", oneWay: true },
  ursaluna: { workMs: 0, item: "red-moon", oneWay: true },
  // 개굴닌자 → 개굴닌자(유대변화) — 지우의모자 하나로 한 번, 특성만 유대변화가 된다 (2026-10-09 사용자 결정 "지우의모자 추가하고, 그걸 써야 특성이 유대변화로 되게. 기본은 급류", "모습 도구로 1회")
  greninja: { workMs: 0, item: "ash-cap", oneWay: true },
};

// 버드렉스의 말 부르기 도구 — 버드렉스가 있으면 가방 기기 창에서 하나 쓰고, 블리자포스·레이스포스 가운데 고른 말이 박스로 온다
// (2026-10-07 사용자 결정 "유대의고삐라는 아이템을 2천 원에 팔고, 버드렉스가 있으면 사용 가능하게 제한", src/party/riders.ts)
export const RIDER_ITEM = "reins-of-unity";

// 해금 정리
export const UNLOCK_RULES = {
  rev: 1, // 해금 정리 판 — src/dex/unlocks.ts pruneUnlocks. 판을 올리면 옛 저장에서 한 번 정리가 돈다
};
