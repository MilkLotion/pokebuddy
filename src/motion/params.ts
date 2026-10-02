// 성격 배율 — MotionParams 를 규칙표(rules.ts) 위에 곱해 마리별 규칙표를 만든다.
// 중립·세션 샌드박스는 NEUTRAL_PARAMS — applyParams 결과는 기존 규칙표와 동치 (selftest-motion).
// S3 paramsFor가 성격의 다섯 축을 마리별 배율로 변환
import { MOTION_RULES, NATURE_MOTION_RULES } from "./rules";
import type { MotionRules, Range } from "./rules";
import type { MotionParams } from "./types";
import type { Axis, AxisValue } from "../shared/species";

export function paramsFor(axes: Readonly<Record<Axis, AxisValue>>): MotionParams {
  const r = NATURE_MOTION_RULES;
  return {
    paceScale: 1 + axes.activity * r.pace,
    pauseScale: 1 - axes.activity * r.pause,
    fidgetScale: 1 + axes.activity * r.fidget,
    sleepScale: 1 - axes.steadiness * r.sleep,
    reactScale: 1 + axes.boldness * r.react,
    socialPull: axes.sociability * r.pull,
    cursorPull: axes.boldness * r.pull,
  };
}

// 전부 1 · 0 — 배율은 곱해도 그대로, 끌림은 없음
export const NEUTRAL_PARAMS: MotionParams = {
  paceScale: 1,
  pauseScale: 1,
  fidgetScale: 1,
  sleepScale: 1,
  reactScale: 1,
  socialPull: 0, // S3 에서 — 다른 마리에게 다가감/멀어짐
  cursorPull: 0, // S3 에서 — 커서를 쫓음/피함
};

// 설정 `잠들기 기준`(save.settings.sleepAfterMin, 분)을 규칙표의 수면 시각에 넣는다 (docs/specs/game.md "설정과 연결")
//   null·undefined  설정을 모른다 — 규칙표 기본값(TIMES.sleep 5분) 그대로
//   0               잠들지 않음 — sleep·quiet 를 Infinity 로. 입력 유휴로 잠들지 않고, 이미 잠든 마리는 brain 의 깨기 경로로 깬다
//   그 밖           분 × 60초. quiet 는 규칙표의 quiet/sleep 비율(270/300)을 유지한다
// 성격·종 배율(sleepScale)은 이 결과 위에 applyParams 가 곱한다
export function withSleepAfter(min: number | null | undefined, rules: MotionRules = MOTION_RULES): MotionRules {
  if (min == null || !Number.isFinite(min) || min < 0) return rules;
  const sleep = min > 0 ? min * 60_000 : Infinity;
  const quiet = sleep * (rules.TIMES.quiet / rules.TIMES.sleep);
  return { ...rules, TIMES: { ...rules.TIMES, quiet, sleep } };
}

const scaleRange = ([lo, hi]: Range, k: number): Range => [lo * k, hi * k];

// 배율이 곱해지는 자리
//   TIMES.quiet · TIMES.sleep      × sleepScale   (안정성 — 잠들기까지 시간)
//   TIMES.reactMin                 × reactScale   (대담함 — 만지기 반응 길이)
//   RHYTHM.idle.pause · work.pause × pauseScale   (활동성 반대 — 쉬는 시간)
//   RHYTHM.idle.pace · work.pace   × paceScale    (활동성 — 걷는 속도)
//   MODES.on.fidget · calm.fidget  × fidgetScale  (제자리 동작 확률)
// socialPull · cursorPull 은 규칙표에 곱할 자리가 없다 — S3 의 brain 이 목표 고르기(wanderTarget)에서 직접 읽는다
export function applyParams(params: MotionParams = NEUTRAL_PARAMS, rules: MotionRules = MOTION_RULES): MotionRules {
  return {
    ...rules,
    TIMES: {
      quiet: rules.TIMES.quiet * params.sleepScale,
      sleep: rules.TIMES.sleep * params.sleepScale,
      reactMin: rules.TIMES.reactMin * params.reactScale,
    },
    RHYTHM: {
      idle: {
        ...rules.RHYTHM.idle,
        pause: scaleRange(rules.RHYTHM.idle.pause, params.pauseScale),
        pace: scaleRange(rules.RHYTHM.idle.pace, params.paceScale),
      },
      work: {
        ...rules.RHYTHM.work,
        pause: scaleRange(rules.RHYTHM.work.pause, params.pauseScale),
        pace: scaleRange(rules.RHYTHM.work.pace, params.paceScale),
      },
    },
    MODES: {
      on: { ...rules.MODES.on, fidget: rules.MODES.on.fidget * params.fidgetScale },
      calm: { ...rules.MODES.calm, fidget: rules.MODES.calm.fidget * params.fidgetScale },
    },
  };
}
