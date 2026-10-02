// 움직임의 규칙표 — 옛 buddy/brain.js 의 TIMES · RHYTHM · WALK · MOVES · MODES · FIDGET_ROWS · WORK_ROWS · rowOf 를 한 객체로.
// 숫자와 실측 근거는 옛 파일 그대로 옮겼다. 성격 배율은 params.ts applyParams 가 이 표 위에 곱한다 — 여기는 중립값
//
// 두 모드로 움직인다 — CLI 가 일하는 중(running)인지로 가른다
//   한가  한참 서 있다가 가끔 천천히 걷고, 두리번·앉기 같은 조용한 동작을 한다. 오래 조용하면 잔다
//   작업  거의 서 있지 않는다. 빠르게 걷고 공격·기 모으기 같은 작업 동작을 이어 간다. 자지 않는다
// 작업 동작은 한가할 때 쓰지 않는다 — 보기만 해도 일하는 중인지 갈리게.
// 승인 대기·턴 끝·실패 같은 신호 상태는 어느 모드도 아니다 — 멈춰서 상태 동작에 맡긴다
import type { StageState } from "../shared/model/stage";

// [최소, 최대] — 그 사이에서 고르게 뽑는다
export type Range = readonly [number, number];

export type MotionMode = "on" | "calm";

export interface MotionRules {
  // 모드와 무관한 시간 (ms). timeScale 로 한꺼번에 줄일 수 있다 — 시험용
  TIMES: {
    quiet: number; // 입력이 이만큼 없으면 새 행동을 시작하지 않는다 — 곧 잔다
    sleep: number; // 입력이 이만큼 없으면 그 자리에서 잔다
    reactMin: number; // 반응 최소 길이 — 짧은 동작은 이 길이가 될 때까지 반복한다
  };
  // 모드별 리듬. ms 값만 timeScale 을 받는다 (SCALED)
  RHYTHM: {
    idle: {
      pause: Range; // 걷기 사이 쉬는 시간 (걸어온 쪽 보기 포함)
      walk: Range; // 한 번 걷는 시간 — 거리가 아니라 시간으로 정한다
      pace: Range; // 걷는 속도 배율 — 걸을 때마다 뽑는다
      fidget: Range; // 쉬는 틈의 제자리 동작 길이
      lookBack: Range; // 걷기를 마친 뒤 걸어온 방향을 보고 서 있는 시간
    };
    work: {
      pause: Range; // 작업 동작 묶음 사이 숨 고르기
      walk: Range;
      pace: Range;
      move: Range; // 반복하는 작업 동작(loop) 하나의 길이
      settle: Range; // 한 번 내지르는 작업 동작(once) 뒤에 서 있는 시간
      moves: Range; // 한 묶음에 이어서 하는 작업 동작 수 (정수 범위)
      walkChance: number; // 묶음 앞에 걷기를 넣을 확률
    };
  };
  // RHYTHM 중 시간(ms)이라 timeScale 을 받는 항목 — pace·moves·walkChance 는 배율·개수·확률이라 그대로 둔다
  SCALED: ReadonlySet<string>;
  WALK: {
    turn: number; // 한가할 때 걷는 도중 한 번 방향을 트는 확률
    turnMinMs: number; // 방향을 틀고 남은 시간이 이보다 짧으면 틀지 않고 선다
    minStepPx: number; // 이보다 짧으면 걷지 않고 제자리 동작으로 대신한다
    dragTurnPx: number; // 끄는 방향을 바꾸는 누적 이동
    speedPxPerZoom: number; // 도트 배율 1 당 걷는 속도 (px/s) — 옛 body.js 의 18 * art.zoom
  };
  // 반응별 후보 — 보유한 것 중에서 고른다. 작업 중에 하는 동작은 art/pmd.js 의 WORK_PLAY 가 정한다
  MOVES: {
    walk: readonly string[];
    fidget: readonly string[];
    sleep: readonly string[];
    wake: readonly string[];
    pickup: readonly string[];
    held: readonly string[];
    drop: readonly string[];
    click: readonly string[];
    reactFallback: readonly string[];
  };
  // mode 별 — pause 는 쉬는 시간 배율, fidget 은 한가할 때 쉬는 틈의 칸마다 제자리 동작을 할 확률
  MODES: Record<MotionMode, { pause: number; fidget: number }>;
  LOOK_AROUND: string; // 제자리 동작 후보에 섞는 두리번 — Idle 을 방향만 바꿔 쓴다
  FIDGET_ROWS: readonly number[]; // 제자리 동작의 방향
  WORK_ROWS: readonly number[]; // 작업 동작의 방향
  TICK_MS: number; // 무대 틱 간격 — 옛 body.js TICK_MS. 걷는 동안 자리를 옮기는 간격 (25fps)
  rowOf(dx: number, dy: number): number;
  isSignal(agent: StageState): boolean;
}

export const MOTION_RULES: MotionRules = {
  TIMES: {
    quiet: 270_000, // 입력이 이만큼 없으면 새 행동을 시작하지 않는다 — 곧 잔다
    sleep: 300_000, // 입력이 이만큼 없으면 그 자리에서 잔다. 3분은 잠깐 읽는 사이에도 잠들었다
    reactMin: 1_200, // 반응 최소 길이 — 끄덕임 한 번이 0.3초라 한 번만 틀면 안 보인다. 이만큼 반복한다
  },

  RHYTHM: {
    idle: {
      // 걷기 사이 쉬는 시간 (걸어온 쪽 보기 포함) — 숨었다 다시 보일 때도 최소만큼은 가만히 있는다.
      // 지수분포(평균 70→120→45→30초)로 뽑던 때는 한참 서 있다 몰아 걸어, 걷는 모습을 캡처하려 하면 멈췄다.
      // 고르게 뽑는 범위로 바꾸고, 5~6초 걷기·10~15초 쉬기에서 폭을 넓혔다 (2026-09-17)
      pause: [7_000, 20_000],
      // 한 번 걷는 시간 — 거리가 아니라 시간으로 정한다.
      // 창을 가로지르는 질주가 되지 않게 한 번에 이만큼만 걷고, 여러 번에 걸쳐 무대 전체를 돌아다닌다
      walk: [3_000, 7_000],
      // 걷는 속도 배율 — 걸을 때마다 뽑는다. 작업 중보다 확실히 느리게 둔다
      pace: [0.6, 1.0],
      fidget: [1_200, 3_000], // 쉬는 틈의 제자리 동작 길이 — 짧은 동작은 이 길이가 될 때까지 반복한다
      lookBack: [800, 2_500], // 걷기를 마친 뒤 걸어온 방향을 보고 서 있는 시간
    },
    work: {
      // 작업 동작 묶음 사이 숨 고르기 — 이보다 길게 서 있으면 일이 멈춘 것처럼 보인다
      pause: [500, 1_800],
      walk: [1_500, 4_000],
      pace: [1.3, 1.8],
      move: [1_200, 2_600], // 반복하는 작업 동작(loop) 하나의 길이 — 한 바퀴 단위로 끊는다
      // 한 번 내지르는 작업 동작(once) 뒤에 서 있는 시간 — 공격은 0.3초 안팎이라 곧바로 다음 공격을 이으면 떤다
      settle: [300, 800],
      moves: [1, 3], // 한 묶음에 이어서 하는 작업 동작 수
      walkChance: 0.55, // 묶음 앞에 걷기를 넣을 확률 — 나머지는 그 자리에서 작업 동작만
    },
  },

  SCALED: new Set(["pause", "walk", "move", "settle", "fidget", "lookBack"]),

  WALK: {
    turn: 0.35, // 한가할 때 걷는 도중 한 번 방향을 트는 확률 — 서지 않고 남은 시간만큼 다른 쪽으로 이어 걷는다
    turnMinMs: 1_000, // 방향을 틀고 남은 시간이 이보다 짧으면 틀지 않고 선다
    minStepPx: 24, // 이보다 짧으면 걷지 않고 제자리 동작으로 대신한다
    dragTurnPx: 6, // 끄는 방향을 바꾸는 누적 이동 — 천천히 끌어도 쌓이면 돌아본다
    speedPxPerZoom: 18, // 걷는 속도는 도트 배율에 비례 — 큰 펫이 같은 속도로 걸으면 제자리걸음처럼 보인다
  },

  MOVES: {
    walk: ["Walk"],
    // 한가할 때 쉬는 틈의 제자리 동작 — 조용한 것만. 작업 동작(Charge 등)은 넣지 않는다
    fidget: ["LookUp", "Rotate", "Nod", "Sit", "DeepBreath"],
    sleep: ["Sleep", "EventSleep", "Laying"],
    wake: ["Wake"],
    pickup: ["Hurt", "Cringe"],
    held: ["Walk", "Idle"], // 들린 채 버둥거림 — 끄는 방향을 본다
    drop: ["Hop", "Nod", "Pose"],
    click: ["Nod", "Pose", "Hop", "LookUp"], // 여러 개 중 무작위
    // drop·click 후보가 하나도 없는 펫의 대신 반응 — 원래 후보가 하나라도 있으면 쓰지 않는다.
    // 썬더는 Nod·Pose·LookUp 이 없고 Hop 은 몸 칸보다 커서 빠져 만져도 아무 반응이 없었다.
    // 반응 후보는 작업 동작으로만 담긴 것(workOnly)을 쓰지 않는다 — Charge 는 상태 동작(waving)으로 담긴 펫에만 있다
    reactFallback: ["Rotate", "Charge"],
  },

  // calm 은 덜 돌아다니고 제자리 동작도 덜 한다 (작업 중에도 숨 고르기가 길어진다)
  MODES: {
    on: { pause: 1, fidget: 0.5 },
    calm: { pause: 2.2, fidget: 0.25 },
  },

  LOOK_AROUND: "look-around", // 서서 아무 쪽이나 본다 (Idle 을 방향만 바꿔 쓴다)
  FIDGET_ROWS: [0, 1, 7], // 정면과 양 옆 대각선. 뒤를 보고 하면 무슨 동작인지 안 보인다
  WORK_ROWS: [0, 1, 2, 6, 7], // 옆모습까지. 공격은 옆에서 봐야 내지르는 게 보인다
  TICK_MS: 40,

  // 화면 좌표(y 아래가 +)의 이동 방향 → PMD 행 (0 아래 · 2 오른쪽 · 4 위 · 6 왼쪽, 사이는 대각선)
  rowOf(dx, dy) {
    const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // 오른쪽 0, 아래 2, 왼쪽 ±4, 위 -2
    return (((2 - octant) % 8) + 8) % 8;
  },

  // 사용자가 봐야 하는 신호 상태 — 기다림·턴 끝·실패 등. 이때는 돌아다니지 않고 상태 동작에 맡긴다.
  // running(작업 중)은 신호가 아니다 — 오래 이어지는 상태라 그동안 멈춰 있으면 대기만 하는 것처럼 보인다
  isSignal(agent) {
    return agent !== "idle" && agent !== "running";
  },
};

// 성격의 축 하나가 움직임 배율을 바꾸는 폭 — params.ts paramsFor 가 읽는다
export const NATURE_MOTION_RULES = { pace: 0.2, pause: 0.2, fidget: 0.2, sleep: 0.2, react: 0.25, pull: 0.65 };
