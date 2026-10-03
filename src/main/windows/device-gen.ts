// 기기 창 세대 번호 — 파티 상세·도감 기기 창을 닫을 때마다 하나 올린다 (worklog/records/review-0929/record.md B7)
//
// 관리 창은 닫힘 알림으로 받은 마지막 세대 번호를 여는 요청(petOpen·dexOpen)에 싣는다.
// 닫힘을 알기 전에 보낸 요청(1초 새로 고침이 다시 보낸 것)은 낡은 번호라 버린다 — 닫은 창이 다시 떠 초점을 가져가지 않게.
// 사용자가 닫힘 뒤에 누른 요청은 새 번호를 싣고 있어 바로 열린다. 렌더러가 보낸 번호는 믿지 않고 정수인지와 지금 번호인지만 본다.
// Electron 을 모른다 — 자체 확인이 직접 부른다
export interface GenGate {
  bump(): number; // 창이 닫혔다 — 새 번호를 돌려준다
  accepts(gen: unknown): boolean; // 지금 번호를 실은 요청인가
  reset(): void; // 관리 창 문서를 새로 읽었다 — 렌더러도 0 에서 다시 센다
}

export function createGenGate(): GenGate {
  let gen = 0;
  return {
    bump: () => ++gen,
    accepts: (g) => typeof g === "number" && Number.isSafeInteger(g) && g === gen,
    reset: () => {
      gen = 0;
    },
  };
}
