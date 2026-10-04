// 틱 — 에이전트 상태 폴링(500ms)과 전역 시계의 1초 틱이 부르는 일 (worklog/records/code-structure/design/10-main.md 4.6절)
//
// 상태 폴링은 화면·입력용이라 전역 시계를 쓰지 않는다 — 상태가 바뀐 것을 반 초 안에 무대에 보인다. 게임 값은 바꾸지 않는다
// 1초 틱 — 게임 시간 적용·줍기·작업 시간·배고픔 말풍선·배너를 이 틱의 now·gap 으로 한다 (2026-09-29 사용자 결정 "전역 타이머 1초").
// 쓰기는 거래 실행기 하나가 하므로 writer 일 때만 돈다. 틈이 TIME_RULES.maxGapMs 를 넘는 틱(절전 복귀·멈춤)은 작업·줍기로 세지 않는다.
// 게임 시간의 큰 틈은 `game.tick` 이 TIME_RULES.maxElapsedMs 로 자른다(src/state/time.ts elapsedSince) (docs/specs/game.md "복귀할 때 중단 기간을 소급 진행하지 않는다").
// 에이전트가 작업하는 동안 적립이 2배다. 작업 판정은 무대의 에이전트 상태 running 이다 (docs/specs/balance.md "에이전트 작업 보너스").
// 무거운 일(놀이공간·점프 목록·트레이 다시 읽기, 남은 안내)은 slowEvery 틱(15초)마다 — 1초로 당길 까닭이 없고 OS 호출이 섞여 있다
import { rollHits } from "../../find/roll";
import { TIME_RULES } from "../../state/rules";
import type { Anchor } from "../anchor";
import { CLOCK_RULES, type ClockTick } from "../clock";
import type { GameV3 } from "../../tx/game";
import type { SaveParty } from "../../save/save-party";
import type { Bubbles } from "../stage/bubbles";
import type { StageGroup } from "../stage-group";
import { devNumber } from "./dev-run";
import type { DebugLog } from "./log";

export const TICK_RULES = { slowEvery: Math.max(1, Math.round(CLOCK_RULES.saveMs / CLOCK_RULES.periodMs)) } as const;

export interface TicksDeps {
  sendClock(now: number): void; // 관리 창·기기 창이 이 틱에 스냅샷을 다시 읽는다 (manage:clock)
  frozen(): boolean; // 두 PC 규칙 멈춤·새로 시작하는 중
  locked(): boolean; // 화면 잠김
  anchor(): Anchor | null;
  stages(): StageGroup | null;
  worker(): SaveParty | null;
  game(): GameV3 | null;
  hidden(): boolean; // 직접 숨김 — 무대에 아무도 없는 것으로 본다
  bubbles: Bubbles;
  notifierTick(): void; // 부화 준비·진화 가능·업적 미수령·줍기를 배너 줄에 세운다
  syncCoach(): void;
  slow(): void; // slowEvery 틱마다 — 저장 감시를 다시 읽은 뒤
  log: DebugLog;
}

export interface Ticks {
  state(): void; // 에이전트 상태 폴링
  clock(tick: ClockTick): void; // 전역 시계의 1초 틱
  resetWork(): void; // 쌓아 둔 작업 시간을 버린다
}

export function createTicks(deps: TicksDeps): Ticks {
  // 에이전트 작업 시간 — 1초 틱마다 running 이던 만큼 쌓아 두고, 게임 틱에 넘기고 비운다
  let workMs = 0;
  let lastState: string | null = null;
  // 줍기 확률 배율 — 개발 실행에서만 POKEBUDDY_FIND_RATE(양의 정수). 100 이면 초당 100/2000. 마리마다 독립은 그대로다. 실기 확인용 (src/find/rules.ts perSecond)
  let findRateMemo: number | null | undefined;
  const findRate = (): number | null => {
    if (findRateMemo === undefined) findRateMemo = devNumber("POKEBUDDY_FIND_RATE") ?? null;
    return findRateMemo;
  };

  return {
    state() {
      const anchor = deps.anchor();
      const stages = deps.stages();
      if (!anchor || !stages) return;
      const { state, promptAt } = anchor.currentInfo();
      stages.setState(state, promptAt);
      if (state !== lastState) {
        lastState = state;
        deps.log?.({ state });
      }
    },

    clock({ now, gap, seq }) {
      deps.sendClock(now);
      // 두 PC 규칙으로 멈췄거나 새로 시작하는 중이다 — 시간·줍기·작업 시간을 쌓지 않는다. 다시 돌면 game.tick 이 그 틈을 자른다
      if (deps.frozen()) {
        workMs = 0;
        return;
      }
      const anchor = deps.anchor();
      const stages = deps.stages();
      if (!anchor || !stages) return;
      const worker = deps.worker();
      const game = deps.game();
      if (!worker?.isWriter() || !game || deps.locked()) {
        workMs = 0; // writer 가 아니거나 화면이 잠겼으면 쌓지 않는다. 다시 돌면 새로 센다
        return;
      }
      const counted = gap > 0 && gap <= TIME_RULES.maxGapMs;
      if (counted && anchor.currentInfo().state === "running") workMs += gap;

      // 줍기 — 깨어 있는 마리 각각을 이 틱의 간격으로 따로 굴린다. 주우면 그 틱에 저장하고 말풍선·배너를 띄운다.
      // 직접 숨긴 동안은 무대에 아무도 없는 것으로 본다 (src/find/core.ts rollHits)
      if (counted && !deps.hidden()) {
        const hits = rollHits(Object.fromEntries(stages.awakeIds().map((id) => [id, gap])), Math.random, findRate() ?? 1);
        const found = hits.length ? game.find(hits) : null; // 쓰지 못하면 null — 그 건은 버린다
        if (found?.length) {
          worker.refresh();
          deps.bubbles.found(found, game.read());
        }
      }

      // 게임 시간 — 1초마다 메모리에 적용하고 파일은 CLOCK_RULES.saveMs 마다 쓴다 (src/tx/game.ts flushMs)
      const events = game.tick({ workMs });
      if (events) workMs = 0; // 쓰지 못했으면 다음 틱에 흐른 시간과 함께 다시 넘긴다

      // 배고픔 말풍선 — 무대에 나와 있는 포켓몬만, 직접 숨긴 동안은 띄우지 않는다 (src/main/stage/bubbles.ts onTick)
      if (!deps.hidden()) deps.bubbles.onTick(now, game.read()?.pets ?? []);
      deps.notifierTick(); // 1초 안에 뜬다 (src/notify)
      deps.syncCoach();

      if (seq % TICK_RULES.slowEvery !== 0) return;
      worker.refresh();
      deps.slow();
    },

    resetWork() {
      workMs = 0;
    },
  };
}
