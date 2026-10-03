// 저장의 규칙표 — save.json 의 판, 거래 기록과 기록의 보관, 저장 실패 안내, 명령 통로의 시간. "숫자는 모듈마다 규칙표 하나" (design.md 모듈 규칙)
//
// 게임 숫자(친밀도·기분·쿨다운·가격)는 여기 없다 — 주인 모듈의 rules.ts 에 있다. 저장 v2 의 값은 ./v2/rules.ts,
// 원자적 쓰기의 재시도는 src/platform/atomic-write.ts IO_RULES 다
export const SAVE_RULES = {
  version: 3 as const, // save.json 스키마 판 (v). 1·2 는 읽어서 옮긴다 (./v2/)
  tx: { keep: 200, ttlMs: 24 * 60 * 60_000 }, // 완료한 요청 기록 — 최근 200건 또는 24시간 중 큰 쪽을 남긴다
  logKeep: 200, // 기록(log) — 최근 건수만 남긴다. v2 를 읽을 때도 같다
  saveFailNotifyAfter: 3, // 이만큼 이어서 실패하면 설정창 상태 안내에 남긴다
  // 명령 통로 (./command-channel.ts — 1판 economy RULES.io 에서 옮김)
  channel: {
    pollMs: 5_000, // fs.watch 보강 폴링
    resultTtlMs: 60_000, // 안 가져간 .result.json 청소
    requestTtlMs: 60_000, // 이보다 오래된 요청은 처리하지 않고 지운다 — 죽은 writer 가 남긴 며칠 전 밥을 주지 않게
    sendTimeoutMs: 2_000, // 보낸 쪽이 결과를 기다리는 시간 (CLI 가 2초 기다려 출력)
    sendSlowTimeoutMs: 45_000, // 그림을 받거나 서버를 타는 명령(COMMANDS 의 slow)을 기다리는 시간
    sendPollMs: 100,
  },
};

// [임시] 설정창의 크기 — 메인(src/main/manage-window.ts)의 값이다. 메인 레인이 창 파일을 옮길 때 그쪽 규칙표로 간다
// docs/specs/game.md "관리 창". Figma 의 640 px 를 DIP 로 그대로 쓴다
export const WINDOW_V3_RULES = {
  width: 640, // 폭은 고정이다. 박스 6열과 도감 5열 격자가 이 폭에 맞춰져 있다
  // 기본 세로 — 파티 탭이 스크롤 없이 딱 맞는 높이다(2026-09-26 사용자 결정 "화면은 파티창을 기준으로 높이가 정해져야해").
  // 헤더 40 + 탭 40 + 본문 위 여백 16 + 파티 머리와 칸 3줄(마지막 칸이 창 위에서 650) + 본문 아래 여백 32. 파티 칸 모양이 바뀌면 다시 잰다
  height: 682,
  minHeight: 560, // 본문이 스크롤이라 이만큼까지 줄일 수 있다
};
