// 온라인 호출의 시간 값 — 요청 제한, 주기, 다시 시도, 기다림. 게임 규칙이 아니라 서버·플랫폼과 맞춘 값이다
// 다시 시도는 모두 고정 간격이다(백오프 없음)
export const ONLINE_TIMING = {
  fetchTimeoutMs: 15_000, // 모든 서버 요청의 상한 (client.ts)
  heartbeatMs: 60_000, // 활성 기기 하트비트 간격
  uploadThrottleMs: 120_000, // 주기 저장 올리기의 최소 간격
  eventDelayMs: 1_000, // 사건 저장을 모으는 시간
  retryMs: 60_000, // 오프라인일 때 다시 연결을 시도하는 간격. 세션 확인·익명 발급의 다시 시도도 같다
  subscribeWaitMs: 5_000, // 밀려남 신호 구독을 기다리는 시간
  releaseWaitMs: 3_000, // 끄기 전 올리기와 released 알림을 기다리는 시간
  githubWaitMs: 5 * 60_000, // 브라우저 로그인을 기다리는 시간
  handoffTicketMs: 10 * 60_000, // 익명 저장 이관 티켓의 수명. 서버 만료와 같다(begin_handoff)
} as const;
