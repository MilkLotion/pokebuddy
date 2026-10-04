// 실행 단계와 끄기 순서 — before-quit · will-quit · window-all-closed · 신호
// (worklog/records/code-structure/design/10-main.md 3.13절 app/quit.ts, 4.5절)
//
// 끝내는 중 — 창이 파괴되는 사이에 주기 작업·감시·헬퍼가 그 창을 건드리지 않게 before-quit 에서 멈춘다.
// 파괴된 창을 건드려 예외가 나면 Electron 기본 처리기가 모달을 띄워 메인이 멈추고, 확인을 누르면 밀린 폴링이
// 또 던진다 — 대화상자가 끝없이 이어지고 프로세스가 끝나지 못한다
import { app } from "electron";

export interface QuitDeps {
  // 메모리에만 있는 1초 틱 진행을 먼저 쓴다 — 클라우드 올리기가 그 값을 보게 (src/tx/game.ts flush). 부르는 쪽이 멈춤·writer 를 본다
  flush(): void;
  // 끄기 전에 클라우드 정리를 기다려야 하는가 — 멈춤·세션 종료 중이 아니고 클라우드를 쓰고 있다
  shouldRelease(): boolean;
  release(): Promise<void>; // 올리고 released 를 알린 뒤 클라우드를 멈춘다(최대 3초). 한 번만
  stop(): void; // 핸들 정리 — 주기 작업 뒤. 시계·헬퍼·수명 감시·트레이·업데이트·명령·서비스·창·저장 잠금
  dropLock(): void; // will-quit — 동반자 lock 을 지운다
}

export interface Run {
  install(): void; // 신호·before-quit·will-quit·window-all-closed 를 건다
  quitting(): boolean;
  setPicking(on: boolean): void; // 첫 실행 선택 창이 열려 있다 — 그 창이 닫혀도 앱을 끝내지 않는다
  markStaged(): void; // 무대 창을 만들었다 — 그 전에 닫힌 창(선택 창)으로는 끝내지 않는다
  markReady(): void; // 그림·명령·수명 잠금 준비 끝 — 그 뒤에만 CLI 에 성공을 알린다
  isReady(): boolean;
  every(fn: () => void, ms: number): void; // 주기 작업 — 끌 때 먼저 멈춘다
  keep(timer: NodeJS.Timeout): void; // 밖에서 만든 주기 작업도 같이 멈춘다
}

export function createRun(deps: QuitDeps): Run {
  let quitting = false;
  let picking = false;
  let staged = false;
  let bootReady = false;
  let quitWaited = false; // 끄기 전 클라우드 정리를 한 번 기다렸다
  let releasing = false; // 그 정리를 기다리는 중 — 이 동안 다시 온 끄기 요청은 버린다
  const intervals: NodeJS.Timeout[] = [];

  return {
    install() {
      // 밖에서 끝내라는 신호 (kill 등) — 정리하고 끝낸다
      process.on("SIGTERM", () => app.quit());
      process.on("SIGINT", () => app.quit());

      // 창을 닫기 전에 온다 — 주기 작업·감시·헬퍼를 먼저 멈춘다.
      // 창이 따로 닫혀 끝나는 경로(window-all-closed → app.quit)도 이곳을 지난다
      app.on("before-quit", (e) => {
        deps.flush();
        // 끄기 전에 올리고 released 를 알린다 — 최대 3초. 다른 PC 가 경고 없이 넘겨받는다. 실패해도 끄기를 막지 않는다(다음 실행에서 올린다).
        // 밀려났거나 확인·막힘으로 멈췄으면 건너뛴다. 세션 종료(Windows 로그오프·mac 끄기·업데이트)가 진행 중이면 이미 알렸다 —
        // 시스템 종료를 늦추지 않게 기다리지 않고 끝낸다
        // companion stop 은 lock 이 사라진 것을 주기 확인과 폴더 감시가 각각 보고 quit() 을 거듭 부른다 — 기다리는 중의 요청은 버리고 기다림이 끝나면 한 번 끝낸다
        if (releasing) {
          e.preventDefault();
          return;
        }
        if (!quitWaited && deps.shouldRelease()) {
          e.preventDefault();
          quitWaited = true;
          releasing = true;
          void deps.release().finally(() => {
            releasing = false;
            app.quit();
          });
          return;
        }
        quitting = true;
        for (const id of intervals) clearInterval(id);
        deps.stop();
      });

      app.on("will-quit", () => deps.dropLock());

      // 첫 실행 선택 창은 무대 창보다 먼저 열리고 닫힌다 — 그때는 끝내지 않는다 (부팅이 이어서 무대 창을 만든다)
      app.on("window-all-closed", () => {
        if (!picking && staged) app.quit();
      });
    },
    quitting: () => quitting,
    setPicking(on) {
      picking = on;
    },
    markStaged() {
      staged = true;
    },
    markReady() {
      bootReady = true;
    },
    isReady: () => bootReady,
    every(fn, ms) {
      intervals.push(setInterval(fn, ms));
    },
    keep(timer) {
      intervals.push(timer);
    },
  };
}
