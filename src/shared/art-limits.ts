// 그림 요청 한 번의 개수 상한 — 메인이 받는 상한(src/main/windows/input.ts INPUT_LIMITS)이고, 설정창은 이 크기로 나눠 보낸다(src/renderer/manage/art-cache.ts).
// 상점처럼 칸이 많은 화면이 한 번에 다 보내면 넘친 그림은 답에 없어 다시 그릴 때마다 또 청했다 (worklog/records/perf-refactor 4-3, G43-1)
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다
export const ART_ASK_LIMITS = {
  portraits: 300, // 초상 — 도감 한 화면 분량
  icons: 200, // 도구·알·타입 그림
} as const;
