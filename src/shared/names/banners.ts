// 알림 배너 종류의 원본
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다

//   hatch        부화 준비 완료
//   evolve       진화 가능
//   achievement  업적 달성
//   find         줍기 — 대상 그림 없이 문구 두 줄 (src/find/pickup.ts)
//   mega         메가스톤이 생겼다 (src/dex/mega.ts)
//   notice       대상 그림 없이 안내 문구 두 줄 (src/agents/notice.ts). 줄 밖에서 한 번 띄운다
export const BANNER_KINDS = ["hatch", "evolve", "achievement", "notice", "find", "mega"] as const;

export type BannerKind = (typeof BANNER_KINDS)[number];

// 알림 줄에 서는 종류 — notice 는 줄 밖이다 (src/notify/queue.ts)
export type QueuedBannerKind = Exclude<BannerKind, "notice">;
