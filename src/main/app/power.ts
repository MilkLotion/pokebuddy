// 잠금·절전·세션 종료 → 쓰기와 클라우드 알림 (worklog/records/code-structure/design/10-main.md 1.1절 app/power.ts, 4.1절 3단계)
//
// 잠금·절전은 연결 끊김이 아니다 — 올리고 잠듦을 서버에 알린다. 그동안 다른 PC 는 경고 없이 넘겨받는다(D21)
// 화면이 잠겨 있는 동안은 게임 틱을 돌리지 않는다. 풀리면 다음 틱이 그 틈을 버린다(game.tick 은 틈을 TIME_RULES.maxElapsedMs 로 자른다 — src/state/time.ts elapsedSince).
// 절전은 폴링이 멈춰 저절로 같은 결과가 된다. 잠금만 하고 절전하지 않으면 폴링이 계속 돌아 따로 막는다 (2026-09-27)
import { app, powerMonitor } from "electron";
import type { DebugLog } from "./log";

export interface PowerDeps {
  flushLocal(): void; // 메모리에만 있는 1초 틱 진행을 쓴다 — 부르는 쪽이 멈춤·writer 를 본다
  sleep(): void; // 클라우드에 잠듦을 알린다
  wake(): void; // 아직 활성인지 본다 — 넘겨받혔으면 밀려남 안내 뒤 종료
  announceRelease(): void; // 세션 종료 직전 — 올리고 released 를 알린다
  log: DebugLog;
}

export interface Power {
  start(): void; // 구독을 건다 — whenReady 뒤 한 번
  isLocked(): boolean;
}

export function createPower(deps: PowerDeps): Power {
  let screenLocked = false;
  return {
    isLocked: () => screenLocked,
    start() {
      powerMonitor.on("lock-screen", () => {
        deps.flushLocal();
        deps.sleep();
        screenLocked = true;
        deps.log?.({ screen: "locked" });
      });
      powerMonitor.on("unlock-screen", () => {
        screenLocked = false;
        deps.wake();
        deps.log?.({ screen: "unlocked" });
      });
      // 절전은 기다리지 않는다 — 알림이 못 가면 다른 PC 가 연결 끊김 경고를 한 번 본다(허용 오탐, design-p1.md 3절 한계)
      powerMonitor.on("suspend", () => {
        deps.flushLocal();
        deps.sleep();
      });
      // 잠긴 채 깨어났으면 잠금 해제 때 깨운다
      powerMonitor.on("resume", () => {
        if (!screenLocked) deps.wake();
      });
      // Windows 로그오프·종료 — before-quit 이 오지 않을 수 있다. 창의 이벤트라 만들어지는 창마다 건다.
      //   query-session-end  끝내기 직전 — 로컬을 쓰고 올린 뒤 released 를 보낸다. 기다리지 않고 막지도 않는다(preventDefault 없음)
      //   session-end        끝난다 — 로컬만 쓴다
      // mac 의 끄기는 powerMonitor shutdown — 같은 일을 한다. 이어서 오는 before-quit 은 기다리지 않는다
      // 클라우드는 멈추지 않는다 — 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다
      const endSession = (): void => {
        deps.flushLocal();
        deps.announceRelease();
      };
      app.on("browser-window-created", (_e, w) => {
        w.on("query-session-end", endSession);
        w.on("session-end", deps.flushLocal);
      });
      powerMonitor.on("shutdown", endSession);
    },
  };
}
