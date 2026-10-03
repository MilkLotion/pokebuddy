// 전역 시계 — 앱 전체가 보는 1초 틱 (2026-09-29 사용자 결정 "앱 자체의 전역으로 타이머 기능 만들고, 그게 1초마다 갱신. 확률이나 시간 등등은 그 시간값 보게 해")
//
// 틱마다 그 순간의 시각 now 와 앞 틱과의 간격 gap 을 구독자에게 준다. 시간·확률 계산(게임 시간 적용·줍기·작업 시간)은 이 now·gap 을 쓴다.
// 틱 사이가 크게 벌어져도(절전 복귀·멈춤) gap 은 있는 그대로 준다. 자르는 규칙은 받는 쪽이 가진다(STATE_RULES.maxTickMs · TIME_RULES.maxElapsedMs).
// 예외 — 화면·입력용 틱은 이 시계를 쓰지 않는다. 무대 그리기 40ms(STAGE_RULES.tickMs)는 움직임이 1초로는 끊겨 보이고,
// 훅 상태 폴링 500ms(STAGE_RULES.statePollMs)는 에이전트 상태가 바뀐 것을 반 초 안에 보여 주려는 것이다. 둘 다 게임 값을 바꾸지 않는다.
// Electron 을 모른다. 시각과 타이머를 받아서 쓴다 — 자체 확인이 가짜 시각으로 틱을 돌린다
import { realClock, type Clock } from "../shared/clock.js";

export const CLOCK_RULES = {
  periodMs: 1000, // 틱 간격 1초. 2026-09-29 사용자 결정
};

export interface ClockTick {
  now: number; // 이 틱의 시각 ms
  gap: number; // 앞 틱과의 간격 ms. 첫 틱은 0
  seq: number; // 틱 번호 — 1 부터
}

export interface GameClock {
  start(): void;
  stop(): void;
  on(fn: (tick: ClockTick) => void): () => void; // 구독 — 푸는 함수를 돌려준다
  tick(): ClockTick; // 지금 한 번 틱을 낸다 — 타이머가 부르고, 자체 확인이 직접 부른다
  last(): ClockTick | null;
}

export interface ClockOptions {
  now?: Clock;
  periodMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (e: unknown) => void; // 구독자 하나가 던져도 다른 구독자와 다음 틱은 돈다
}

export function createClock(opts: ClockOptions = {}): GameClock {
  const now = opts.now ?? realClock;
  const periodMs = opts.periodMs ?? CLOCK_RULES.periodMs;
  const setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearInterval(h as NodeJS.Timeout));
  const subs = new Set<(tick: ClockTick) => void>();
  let handle: unknown = null;
  let prev: ClockTick | null = null;

  const tick = (): ClockTick => {
    const at = now();
    const next: ClockTick = { now: at, gap: prev ? Math.max(0, at - prev.now) : 0, seq: (prev?.seq ?? 0) + 1 };
    prev = next;
    for (const fn of [...subs]) {
      try {
        fn(next);
      } catch (e) {
        opts.onError?.(e);
      }
    }
    return next;
  };

  return {
    start() {
      if (handle != null) return;
      handle = setTimer(tick, periodMs);
    },
    stop() {
      if (handle != null) clearTimer(handle);
      handle = null;
    },
    on(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    tick,
    last: () => prev,
  };
}
