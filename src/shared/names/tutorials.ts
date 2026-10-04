// 튜토리얼 id 의 원본
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다

// 대기열에 서는 튜토리얼 — 순서가 규칙이다. 같은 순간에 생긴 조건은 이 순서로 보여 준다 (src/tutorial/conditions.ts TUTORIALS)
const TUTORIAL_IDS = ["first-care", "playground", "shop", "hatch", "achievement", "growth", "points", "party", "preset", "bag", "evolution"] as const;

export type QueuedTutorialId = (typeof TUTORIAL_IDS)[number];

// 화면을 처음 열 때 띄우는 튜토리얼 — 대기열 밖
export const SCREEN_TUTORIAL_IDS = ["area", "dex", "trade", "user", "box"] as const;

export type ScreenTutorialId = (typeof SCREEN_TUTORIAL_IDS)[number];

// 개체 상세 튜토리얼 — 파티 개체 상세를 처음 열 때. 어느 목록에도 없다
const DETAIL_TUTORIAL_ID = "detail";

export type TutorialId = QueuedTutorialId | ScreenTutorialId | typeof DETAIL_TUTORIAL_ID;

// 튜토리얼마다 안내 목록의 전체 길이 — 끝낼 때 저장의 steps 에 늘 이 값을 적는다 (2026-10-03 오케스트레이터 결정, 통합본 D9·K3).
// 읽는 곳은 없다(G19-03). 화면의 목록이 바뀌면 이 값도 바꾼다 — 근거 줄:
//   first-care 2   src/renderer/stage/stage.ts "튜토리얼 · 첫 돌봄 1 / 2"
//   playground 1   src/renderer/stage/stage.ts "놀이공간 1 / 1" (꺼 둔 튜토리얼)
//   shop·hatch·achievement 1   src/renderer/manage/tutorial.ts 의 말풍선 하나("한 단계뿐이면 … 확인")
//   growth·points·party·preset·bag·evolution·box·dex·trade·user   src/renderer/manage/tutorial-steps.ts GUIDES 의 steps 길이
//   area 6         src/renderer/manage/tutorial-steps.ts AREA_STEPS 길이 — 바탕화면 표시 줄이 있을 때의 전체 목록
//   detail 4       src/renderer/device/pet.ts DETAIL_STEPS 길이
export const TUTORIAL_STEPS = {
  "first-care": 2,
  playground: 1,
  shop: 1,
  hatch: 1,
  achievement: 1,
  growth: 3,
  points: 1,
  party: 2,
  preset: 3,
  bag: 2,
  evolution: 1,
  area: 6,
  dex: 1,
  trade: 1,
  user: 2,
  box: 3,
  detail: 4,
} as const satisfies Record<TutorialId, number>;

// 표에 있는 튜토리얼인가
export const isTutorialId = (v: string): v is TutorialId => Object.prototype.hasOwnProperty.call(TUTORIAL_STEPS, v);
