// 튜토리얼 id 의 원본
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다

// 대기열에 서는 튜토리얼 — 순서가 규칙이다. 같은 순간에 생긴 조건은 이 순서로 보여 준다 (src/tutorial/core.ts TUTORIALS)
export const TUTORIAL_IDS = ["first-care", "playground", "shop", "hatch", "achievement", "growth", "points", "party", "preset", "bag", "evolution"] as const;

export type QueuedTutorialId = (typeof TUTORIAL_IDS)[number];

// 화면을 처음 열 때 띄우는 튜토리얼 — 대기열 밖
export const SCREEN_TUTORIAL_IDS = ["area", "dex", "trade", "user", "box"] as const;

export type ScreenTutorialId = (typeof SCREEN_TUTORIAL_IDS)[number];

// 개체 상세 튜토리얼 — 파티 개체 상세를 처음 열 때. 어느 목록에도 없다
export const DETAIL_TUTORIAL_ID = "detail";

export type TutorialId = QueuedTutorialId | ScreenTutorialId | typeof DETAIL_TUTORIAL_ID;
