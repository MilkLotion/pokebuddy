// 멈추기 절차 — 두 PC 규칙 멈춤·이용 정지·저장 계정 분실·새로 시작과 끄기 전 클라우드 정리
// (worklog/records/code-structure/design/10-main.md 3.13절 app/halt.ts, 4.4절)
//
// 두 PC 규칙 (worklog-mac/records/cloud-authority/design-p1.md 3절), 분실(D29)과 새로 시작(D12) (design-p2.md 2절·5절·15절)
// 멈춤 상태 값은 ./freeze.ts 가 가진다. 여기는 멈추고 묻고 되살리고 끝내는 순서만 가진다
import { app } from "electron";
import type { HaltInfo, HaltReason, OwnerKind } from "../../online/cloud-state.js";
import type { ManageRoute } from "../../shared/model/route";
import { askBlocked, askConfirm, askHeld, askKicked, askLost } from "../halt-dialog";
import type { Services } from "../services/registry";
import type { Freeze } from "./freeze";
import type { DebugLog } from "./log";

export interface HaltDeps {
  freeze: Freeze;
  services: Services;
  quitting(): boolean;
  isWriter(): boolean;
  flush(): void; // 메모리에만 있는 1초 틱 진행을 쓴다 — 부르는 쪽이 writer·멈춤을 먼저 본다
  resetWork(): void; // 쌓아 둔 작업 시간을 버린다
  setWriter(on: boolean): void; // 명령 통로의 쓰기 — 멈춘 동안 mailbox 명령을 돌리지 않는다
  sendAccount(): void; // 계정 화면을 설정창에 다시 보낸다
  openManage(route: ManageRoute): void;
  log: DebugLog;
}

export interface Halt {
  onHalt(reason: HaltReason, info: HaltInfo): void; // 클라우드가 멈추라고 알렸다 (src/online/cloud.ts onHalt)
  onLost(kind: OwnerKind, synced: boolean): Promise<void>; // 저장 계정 분실 — 게임은 멈추지 않는다
  freezeForRestart(): void;
  thawRestart(): void;
  relaunchFresh(): void;
  announceRelease(): Promise<void>; // 세션 종료 직전 — 올리고 released 만 알린다
  releaseOnce(): Promise<void>; // 일반 종료 전 — 올리고 released 뒤 클라우드를 멈춘다. 한 번만
  releaseStarted(): boolean; // releaseOnce 를 이미 불렀다
  sessionEnding(): boolean;
  pauseOnlineWork(): void; // 교환·우편·mailbox 명령을 멈춘다. 온라인은 남긴다 — 확인·다시 시도에 쓴다
}

export function createHalt(deps: HaltDeps): Halt {
  const { freeze, services } = deps;
  let haltNext: { reason: "confirm" | "blocked"; info: HaltInfo } | null = null; // 다음에 물을 확인·막힘
  let haltAsking = false; // 확인·막힘 창을 묻는 흐름이 돌고 있다
  let haltAbort: AbortController | null = null; // 떠 있는 확인·막힘 창 — 밀려나면 닫는다
  let lostAsking = false; // 분실 창(D29)이 떠 있다 — 겹쳐 띄우지 않는다
  // 끄기 전 클라우드 정리 — 올리고 released 를 알린 뒤 클라우드를 멈춘다. 사용자가 끄는 일반 종료(before-quit)만 부른다
  let onlineReleased: Promise<void> | null = null;
  // 세션 종료(Windows 로그오프·mac 끄기·업데이트 설치) 직전의 알림 — 올리고 released 만 알린다. 클라우드는 멈추지 않는다.
  // 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다. 진행 중인 약속만 들고 있다 — 다음 세션 종료는 다시 알린다
  let onlineAnnounce: Promise<void> | null = null;

  function pauseOnlineWork(): void {
    deps.setWriter(false);
    services.pause();
  }

  // 넘겨받았다(또는 오프라인으로 이어 간다) — 게임·명령·교환을 다시 돌린다. 우편함은 다음에 부를 때 만든다
  function resumeFromHalt(): void {
    freeze.set(null);
    deps.log?.({ cloud: "resume" });
    if (deps.quitting() || !deps.isWriter()) return;
    deps.setWriter(true);
    services.trade();
    services.flushTradeLink();
    deps.sendAccount();
  }

  // 확인·막힘 창을 차례로 묻는다. [여기서 시작]·[다시 시도] 면 다시 넘겨받고, 그 결과로 또 멈추면 다시 묻는다.
  // [취소]·[종료] 면 클라우드를 멈추고 앱을 끝낸다(D22). 창이 떠 있는 동안 게임은 멈춰 있다
  async function askHalt(): Promise<void> {
    // 창을 기다리는 사이 onHalt 가 멈춤 사유를 바꾼다 — 좁혀진 타입을 믿지 않게 함수로 다시 읽는다
    const kicked = (): boolean => freeze.reason() === "superseded" || freeze.reason() === "held"; // 정지도 끝내는 흐름이다(검수 P4c M1)
    haltAsking = true;
    try {
      while (haltNext && !deps.quitting() && !kicked()) {
        const { reason, info } = haltNext;
        haltNext = null;
        const abort = new AbortController();
        haltAbort = abort;
        const answer = reason === "confirm" ? await askConfirm(info, abort.signal) : await askBlocked(info, abort.signal);
        if (haltAbort === abort) haltAbort = null;
        if (deps.quitting() || kicked()) return; // 창을 띄운 사이 밀려났다 — 밀려남 흐름이 종료한다
        const on = services.current();
        if (answer !== "go" || !on) {
          await on?.confirm(false);
          app.quit();
          return;
        }
        await on.confirm(true); // 또 멈추면 onHalt 가 haltNext 를 채운다
        if (haltNext || kicked() || deps.quitting()) continue;
        resumeFromHalt();
      }
    } finally {
      haltAsking = false;
    }
  }

  // 밀려남·정지 — 떠 있는 확인·막힘 창을 닫고, 교환·우편·온라인을 닫은 뒤 안내하고 끝낸다.
  // 로그아웃하지 않는다 — 다시 켜면 같은 세션으로 서버 저장을 받아 넘겨받는다(D19). 끄기 경로는 올리기·released 를 건너뛴다
  function endGame(reason: "superseded" | "held"): void {
    freeze.set(reason);
    haltNext = null;
    haltAbort?.abort();
    haltAbort = null;
    deps.resetWork();
    pauseOnlineWork();
    deps.sendAccount();
    services.dispose();
  }

  // 다른 PC 에 밀려났다
  function supersede(info: HaltInfo): void {
    endGame("superseded");
    deps.log?.({ cloud: "superseded", other: info.other?.label ?? null });
    void askKicked(info).finally(() => app.quit());
  }

  // 이용 정지(P4c, D35) — 다시 켜도 cloud.json 의 정지로 같은 창이 뜬다
  function holdAccount(): void {
    if (freeze.reason() === "held") return;
    endGame("held");
    deps.log?.({ cloud: "held" });
    void askHeld().finally(() => app.quit());
  }

  return {
    pauseOnlineWork,
    // superseded        밀려남 — 안내 창 뒤 종료
    // confirm · blocked 메모리 진행을 쓰고 멈춘 뒤 창으로 묻는다. 답을 받아 다시 넘겨받으면 또 올 수 있다
    onHalt(reason, info) {
      if (deps.quitting() || freeze.reason() === "superseded") return;
      if (reason === "superseded") {
        supersede(info);
        return;
      }
      if (reason === "held") {
        holdAccount();
        return;
      }
      // 멈추기 전에 1초 틱 진행을 쓴다 — 멈춘 동안은 쓰지 않는다. 쓴 진행은 넘겨받은 뒤 올린다.
      // 새로 시작하는 중(저장을 이미 백업으로 옮겼다)에도 쓰지 않는다 — 다른 쓰기 자리와 같은 조건 (94 문서 5-11)
      if (!freeze.frozen() && deps.isWriter()) deps.flush();
      freeze.set(reason);
      deps.resetWork();
      pauseOnlineWork();
      haltNext = { reason, info };
      deps.log?.({ cloud: "halt", reason, code: info.code });
      if (!haltAsking) void askHalt();
    },

    // 저장 계정을 잃었다 — 게임은 계속, 클라우드만 꺼져 있다. 창의 답으로 로그인(계정 탭)·이 PC 저장으로 계속·처음부터
    async onLost(kind, synced) {
      if (lostAsking || deps.quitting()) return;
      lostAsking = true;
      try {
        const answer = await askLost(kind, synced);
        const on = services.current();
        if (deps.quitting() || freeze.restarting() || !on) return;
        if (answer === "login") deps.openManage({ to: "account" });
        else if (answer === "local") await on.continueLocal();
        else if (answer === "fresh") await on.fresh();
      } catch (e) {
        console.error("분실 창 처리에 실패했다 — 게임은 계속한다", e);
      } finally {
        lostAsking = false;
      }
    },

    // 새로 시작하기 직전 — 메모리 진행을 쓰고(백업에 담기게) 저장 쓰기·명령·교환·우편을 멈춘다
    freezeForRestart() {
      if (!freeze.frozen() && deps.isWriter()) deps.flush();
      freeze.setRestarting(true);
      deps.resetWork();
      pauseOnlineWork();
    },

    // 서버 처리가 실패해 새로 시작하지 않는다 — 멈춘 것을 되돌린다
    thawRestart() {
      freeze.setRestarting(false);
      if (deps.quitting() || freeze.reason() || !deps.isWriter()) return;
      deps.setWriter(true);
      services.trade();
    },

    // 저장을 백업했고 cloud.json 을 비웠다 — 앱을 다시 켠다. 다시 켜면 저장이 없어 선택 창이 뜬다(Q5).
    // 끄기는 일반 종료 경로(before-quit → 저장 잠금 해제, will-quit → 동반자 lock 삭제)를 그대로 지난다. 새 프로세스는 이 프로세스가 끝난 뒤 뜬다.
    // 명령으로 준 스타터(POKEBUDDY_SLUG)와 교환·계정 링크 인자는 넘기지 않는다 — 선택 창을 건너뛰거나 옛 링크로 참가하지 않게
    relaunchFresh() {
      delete process.env.POKEBUDDY_SLUG;
      deps.log?.({ cloud: "restart" });
      app.relaunch({ args: process.argv.slice(1).filter((a) => !a.startsWith("pokebuddy://")) });
      app.quit();
    },

    // 세션 종료 직전 — 올리고 released 를 알린다(최대 3초). 클라우드를 멈추지 않는다.
    // 멈춘 동안(halted)이나 클라우드를 쓰지 않으면 하지 않는다. 겹쳐 부르면 진행 중인 약속을 돌려준다
    announceRelease() {
      if (!onlineAnnounce) {
        const on = services.current();
        const run = !freeze.reason() && on && on.cloud.view().status !== "off"
          ? on.cloud.announceRelease(3_000).catch((e) => {
              console.error("세션 종료 전 클라우드 알림에 실패했다 — 다음 실행에서 올린다", e);
            })
          : Promise.resolve();
        onlineAnnounce = run.finally(() => {
          onlineAnnounce = null;
        });
      }
      return onlineAnnounce;
    },

    // 일반 종료 전 클라우드 정리 — 올리고 released 를 알린 뒤 클라우드를 멈춘다(최대 3초). 한 번만 한다.
    // 멈춘 동안(halted)이나 클라우드를 쓰지 않으면 하지 않는다
    releaseOnce() {
      if (!onlineReleased) {
        const on = services.current();
        onlineReleased = !freeze.reason() && on && on.cloud.view().status !== "off"
          ? on.release(3_000).catch((e) => {
              console.error("끄기 전 클라우드 정리에 실패했다 — 다음 실행에서 올린다", e);
            })
          : Promise.resolve();
      }
      return onlineReleased;
    },
    releaseStarted: () => onlineReleased != null,

    // 세션 종료가 진행 중이다 — 알리는 중이거나 released 를 알린 뒤 아직 active 로 되돌리지 않았다.
    // 그때 오는 before-quit 은 시스템 종료를 늦추지 않게 기다리지 않는다
    sessionEnding: () => onlineAnnounce != null || (services.current()?.cloud.released() ?? false),
  };
}
