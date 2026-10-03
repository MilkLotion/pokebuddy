// 멈춤 상태 — 게임이 저장을 쓰면 안 되는 때 (worklog/records/code-structure/design/10-main.md 3.13절 app/freeze.ts)
//
// 두 PC 규칙으로 게임을 멈췄다 (worklog-mac/records/cloud-authority/design-p1.md 3절)
//   superseded  다른 PC 에 밀려났다 — 안내 뒤 종료. 로그아웃하지 않는다(D19)
//   confirm     연결 끊긴 다른 PC 를 넘겨받을지 묻는 중(G2) — 창이 떠 있는 동안 진행을 멈춘다(D22)
//   blocked     교환이 걸려 넘겨받지 못했다 — 다시 시도하거나 종료
//   held        이용 정지(P4c, D35) — 정지 창 뒤 종료
// 로그아웃·계정 삭제·분실 창 [처음부터]로 새로 시작하는 중 (worklog-mac/records/cloud-authority/design-p2.md 2절 D12)
//   저장을 백업으로 옮기기 전에 쓰기·교환·우편·명령을 멈춘다. 서버 처리가 실패하면 풀고, 성공하면 앱을 다시 켠다
// 멈춘 동안 저장을 쓰지 않고(canWrite), 시계 틱·교환·우편·mailbox 명령을 돌리지 않는다. 읽는 곳이 많아 가장 먼저 만든다
import type { HaltReason } from "../../online/cloud-state.js";

export interface Freeze {
  frozen(): boolean; // 두 PC 규칙 멈춤이나 새로 시작하는 중
  reason(): HaltReason | null;
  restarting(): boolean;
  set(reason: HaltReason | null): void;
  setRestarting(on: boolean): void;
}

export function createFreeze(): Freeze {
  let halted: HaltReason | null = null;
  let restarting = false;
  return {
    frozen: () => halted != null || restarting,
    reason: () => halted,
    restarting: () => restarting,
    set(reason) {
      halted = reason;
    },
    setRestarting(on) {
      restarting = on;
    },
  };
}
