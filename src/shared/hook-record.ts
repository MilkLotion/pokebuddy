// 훅이 상태 기록에 적는 값의 모양

// ── 에이전트 사용량 ────────────────────────────────────────────────────────────
// 훅이 턴 끝(Stop)에 대화 기록에서 읽어 상태 기록에 누적해 적는 값. 상태 모듈은 증분만 본다
export interface Usage {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}
