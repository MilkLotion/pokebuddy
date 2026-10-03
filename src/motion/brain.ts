// 마리 하나의 판단 — 언제 걷고, 어디로 가고, 언제 자고, 건드리면 어떻게 반응할지. 옛 buddy/brain.js 를 1:1 로 옮겼다.
//
// 창·Electron·파일을 모른다. 시각과 입력을 받아 "지금 산책 오프셋"과 "지금 보여줄 동작"만 돌려준다.
// 그래서 node 만으로 시간을 돌려 가며 시험할 수 있다. Date.now 를 부르지 않는다 — now 는 늘 입력
//
// 두 모드로 움직인다 — CLI 가 일하는 중(running)인지로 가른다 (규칙표 rules.ts 머리 주석)
// 동작 고르기는 늘 후보 목록에서 보유한 것 — 없으면 조용히 건너뛴다 (동작이 적은 펫도 오류 없이 돈다)
//
// 옛 brain.js 와 다른 점 (판단 로직은 같다)
//   규칙표를 밖에서 받는다 — params.ts applyParams 가 성격 배율을 곱한 것. 안 주면 MOTION_RULES(중립)
//   act 에 rate 를 늘 채운다 (걷기 외에는 1) — 렌더러가 rate 없음을 1 로 봤던 것을 계약(Play.rate)으로 고정
import type { Play } from "../shared/model/stage";
import type { AgentState } from "../shared/names/agents";
import { MOTION_RULES } from "./rules";
import type { MotionMode, MotionRules, Range } from "./rules";
import type { MotionInput, MotionOut, Phase, RoamBox, MotionParams } from "./types";

export interface BrainOptions {
  have: Set<string>; // 보유 동작 이름
  durOf(anim: string): number; // 동작 한 번 재생 길이 (ms)
  work?: Record<string, "once" | "loop">; // 작업 동작 이름 → 재생 방식 (art/pmd.js WORK_PLAY 중 가진 것)
  workOnly?: Set<string>; // 작업 동작으로만 담긴 이름 — 만지기 반응에는 쓰지 않는다
  mode?: MotionMode;
  speedPx?: number; // 걷는 속도 (px/s, pace 1 기준)
  timeScale?: number; // 시간을 한꺼번에 줄인다 — 시험용 (POKEBUDDY_BUDDY_TIMESCALE)
  rng?: () => number; // [0, 1) — 시험에서 고정한다
  rules?: MotionRules; // 배율이 곱해진 규칙표
  pulls?: Pick<MotionParams, "socialPull" | "cursorPull">;
}

// brain 의 tick 입력 — PetMotion 입력에 마지막 사용자 활동 시각을 더한 것 (pet-motion 이 관리)
export interface BrainInput extends MotionInput {
  activeAt: number;
}

export interface Brain {
  tune(rules: MotionRules, pulls: Pick<MotionParams, "socialPull" | "cursorPull">): void;
  tick(input: BrainInput): MotionOut;
  pickup(now: number): void;
  drag(dx: number, dy: number): void;
  drop(now: number, agent: AgentState): void;
  rehome(now: number): void;
  click(now: number, agent: AgentState): void;
}

interface Walk {
  from: { x: number; y: number };
  to: { x: number; y: number };
  startAt: number;
  dur: number;
  pace: number;
  restMs: number; // 방향을 틀어 더 걸을 시간
}

export function createBrain({
  have,
  durOf,
  work = {},
  workOnly = new Set<string>(),
  mode = "on",
  speedPx = 54,
  timeScale = 1,
  rng = Math.random,
  rules = MOTION_RULES,
  pulls = { socialPull: 0, cursorPull: 0 },
}: BrainOptions): Brain {
  const { WALK, MOVES, FIDGET_ROWS, WORK_ROWS, LOOK_AROUND, SCALED, rowOf, isSignal } = rules;
  const T = {
    quiet: rules.TIMES.quiet * timeScale,
    sleep: rules.TIMES.sleep * timeScale,
    reactMin: rules.TIMES.reactMin * timeScale,
  };
  // RHYTHM 중 시간(ms) 항목만 timeScale — SCALED 에 든 키
  const scaled = (key: string, r: Range): Range => (SCALED.has(key) ? [r[0] * timeScale, r[1] * timeScale] : r);
  const RH = {
    idle: {
      pause: scaled("pause", rules.RHYTHM.idle.pause),
      walk: scaled("walk", rules.RHYTHM.idle.walk),
      pace: scaled("pace", rules.RHYTHM.idle.pace),
      fidget: scaled("fidget", rules.RHYTHM.idle.fidget),
      lookBack: scaled("lookBack", rules.RHYTHM.idle.lookBack),
    },
    work: {
      pause: scaled("pause", rules.RHYTHM.work.pause),
      walk: scaled("walk", rules.RHYTHM.work.walk),
      pace: scaled("pace", rules.RHYTHM.work.pace),
      move: scaled("move", rules.RHYTHM.work.move),
      settle: scaled("settle", rules.RHYTHM.work.settle),
      moves: rules.RHYTHM.work.moves,
      walkChance: rules.RHYTHM.work.walkChance,
    },
  };
  let M = rules.MODES[mode] ?? rules.MODES.on;
  const between = ([lo, hi]: Range): number => lo + rng() * (hi - lo);
  const first = (list: readonly string[]): string | null => list.find((a) => have.has(a)) ?? null;
  // 부르는 쪽이 비어 있지 않은 목록만 준다
  const pickOf = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
  // 만지기 반응 후보 — 작업 동작으로만 담긴 것은 뺀다 (한가할 때 작업 동작이 보이지 않게)
  const reactable = (list: readonly string[]): string[] => list.filter((a) => have.has(a) && !workOnly.has(a));
  const firstReact = (list: readonly string[]): string | null => reactable(list)[0] ?? null;
  const anyReact = (list: readonly string[]): string | null => {
    const got = reactable(list);
    return got.length ? pickOf(got) : null;
  };
  const workMoves = Object.keys(work).filter((a) => have.has(a));
  // 한 번 재생 길이 — 반응이 끝나는 시각을 메인이 스스로 계산한다 (렌더러에 되묻지 않는다)
  const once = (anim: string): number => Math.max(100, durOf(anim));
  // 반응 길이 — 짧은 동작은 최소 길이가 될 때까지 반복한다 (최대 4번)
  const repeatMs = (anim: string): number => once(anim) * Math.min(4, Math.max(1, Math.ceil(T.reactMin / once(anim))));
  // 걷는 그림이 없는 펫은 산책하지 않는다 — 순간이동은 보기 싫다. 제자리 동작만 한다
  const walkAnim = first(MOVES.walk);
  const play = (anim: string, row: number, playMode: Play["mode"], rate = 1): Play => ({ anim, row, mode: playMode, rate });

  // rest · walk · look · fidget · work · sleep · wake · react · react-yield(신호 상태 중 반응) · held · yield
  // look·fidget 은 한가할 때 쉬는 틈 안의 동작 — 끝나도 쉬는 시계(nextAt)는 그대로 간다
  // work 는 작업 중의 동작 하나 — 끝나면 묶음의 다음 동작이나 숨 고르기로 간다
  let phase: Phase = "rest";
  let rhythm: "idle" | "work" = "idle"; // 마지막으로 본 CLI 상태가 정한다
  let roam = { x: 0, y: 0 };
  let act: Play | null = null; // 보여줄 동작. null 이면 상태 동작
  let begun = false; // 첫 틱에서 쉬는 틈을 연다 (옛 nextAt == null 검사)
  let nextAt = 0; // 쉬는 틈이 끝나고 다음 행동을 시작할 시각
  let fidgets: number[] = []; // 쉬는 틈 안에서 제자리 동작을 할 시각들 (오름차순). 비면 남은 틈은 서 있기만 한다
  let until = 0; // look·fidget·work·wake·react 가 끝나는 시각
  let walk: Walk | null = null;
  let movesLeft = 0; // 이번 묶음에 남은 작업 동작 수
  let settleAt: number | null = null; // 한 번 내지른 작업 동작이 끝나 서 있기로 바꿀 시각 (once)
  let lastRow = 0; // 마지막으로 향한 방향 — 걸어간 쪽을 보고 작업 동작을 이어 간다
  let heldRow = 0;
  let heldUntil = 0; // 집어 든 직후 아파하는 동작이 끝나는 시각
  let dragAcc = { x: 0, y: 0 }; // 마지막으로 방향을 바꾼 뒤 끈 거리
  let wasVisible = true;
  let surroundings: Pick<MotionInput, "company" | "cursor"> = {};

  // 쉬는 틈을 연다 — 다음 행동 시각과, 한가할 때는 그 사이 제자리 동작 시각들.
  // 걸어온 쪽 보기가 끝난 뒤를 칸(동작 최대 길이 + 여유)으로 나눠, 칸마다 할지 말지와 칸 안의 시각을 뽑는다.
  // 긴 틈에는 여러 번, 짧은 틈에는 한 번도 안 할 수 있다. 작업 중의 숨 고르기는 짧아 끼우지 않는다
  function startPause(now: number): void {
    const r = RH[rhythm];
    nextAt = now + between(r.pause) * M.pause;
    fidgets = [];
    if (rhythm !== "idle") return;
    const slot = RH.idle.fidget[1] + T.reactMin;
    for (let at = now + RH.idle.lookBack[1]; at + slot <= nextAt; at += slot) {
      if (rng() < M.fidget) fidgets.push(at + rng() * slot);
    }
  }

  // 쉰다 — 한가할 때는 상태 동작(대기)에 맡기고, 작업 중에는 향하던 쪽을 보고 숨을 고른다.
  // 작업 중에 상태 동작으로 돌리면 제자리걸음이 나와 일하는 동작과 섞인다
  function toRest(now: number): void {
    phase = "rest";
    walk = null;
    movesLeft = 0;
    const facing = WORK_ROWS.includes(lastRow) ? lastRow : 0;
    act = rhythm === "work" && have.has("Idle") ? play("Idle", facing, "loop") : null;
    startPause(now);
  }

  // 목표는 무대 안 아무 데나 고르게 — 한 번은 want 만큼만 걸으므로, 여러 번에 걸쳐 무대 전체를 돌아다닌다.
  // 집 중심으로 뽑으면 집 근처만 맴돈다 (1540px 창에서 왼쪽 절반에 머문 시간 0% 실측).
  // 뽑은 곳이 want 보다 가까우면 몇 번 다시 뽑는다 — 끝내 가까우면 그중 가장 먼 곳까지만 걷는다
  function wanderTarget(box: RoamBox, want: number): { x: number; y: number } {
    const goals: { x: number; y: number; pull: number }[] = [];
    if (pulls.socialPull && surroundings.company?.length) {
      const near = [...surroundings.company].sort((a, b) => Math.hypot(a.x - roam.x, a.y - roam.y) - Math.hypot(b.x - roam.x, b.y - roam.y))[0]!;
      goals.push({ ...near, pull: pulls.socialPull });
    }
    if (pulls.cursorPull && surroundings.cursor) goals.push({ ...surroundings.cursor, pull: pulls.cursorPull });
    if (goals.length && rng() < Math.max(...goals.map((g) => Math.abs(g.pull)))) {
      const goal = goals[Math.floor(rng() * goals.length)]!;
      const sign = Math.sign(goal.pull);
      const dx = (goal.x - roam.x) * sign;
      const dy = (goal.y - roam.y) * sign;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        const k = Math.min(want, sign > 0 ? Math.max(0, length - 24) : want) / length;
        return { x: Math.max(box.minX, Math.min(box.maxX, roam.x + dx * k)), y: Math.max(box.minY, Math.min(box.maxY, roam.y + dy * k)) };
      }
    }
    let best = { gx: roam.x, gy: roam.y, len: -1 }; // 첫 표본이 늘 이긴다 (옛 코드의 null 시작과 같다)
    for (let i = 0; i < 4; i++) {
      const gx = box.minX + rng() * (box.maxX - box.minX);
      const gy = box.minY + rng() * (box.maxY - box.minY);
      const len = Math.hypot(gx - roam.x, gy - roam.y);
      if (len > best.len) best = { gx, gy, len };
      if (len >= want) break;
    }
    const k = best.len > want ? want / best.len : 1;
    return { x: Math.round(roam.x + (best.gx - roam.x) * k), y: Math.round(roam.y + (best.gy - roam.y) * k) };
  }

  // 한 구간 걷기 — budgetMs 동안 pace 배율로 걷는다. turns 면 그중 일부만 걷고 나머지는 방향을 틀어 걷는다.
  // 걷는 그림이 없거나 갈 데가 너무 가까우면 아무것도 바꾸지 않고 false
  function startWalk(now: number, box: RoamBox, pace: number, budgetMs: number, turns: boolean): boolean {
    if (!walkAnim) return false;
    const speed = speedPx * pace;
    const legMs = turns ? budgetMs * between([0.35, 0.65]) : budgetMs;
    const to = wanderTarget(box, (speed * legMs) / 1000);
    const dx = to.x - roam.x;
    const dy = to.y - roam.y;
    const len = Math.hypot(dx, dy);
    if (len < WALK.minStepPx) return false;
    const dur = (len / speed) * 1000;
    phase = "walk";
    walk = { from: { ...roam }, to, startAt: now, dur, pace, restMs: turns ? budgetMs - dur : 0 };
    lastRow = rowOf(dx, dy);
    act = play(walkAnim, lastRow, "loop", Math.round(pace * 100) / 100);
    return true;
  }

  // 한가할 때의 제자리 동작 하나 — 가진 동작과 두리번 중 무작위, 방향·길이도 무작위. 할 게 없으면 false
  function startFidget(now: number): boolean {
    const pool = MOVES.fidget.filter((a) => have.has(a));
    if (have.has("Idle")) pool.push(LOOK_AROUND);
    if (!pool.length) return false;
    const pick = pickOf(pool);
    const len = between(RH.idle.fidget);
    phase = "fidget";
    if (pick === LOOK_AROUND) {
      act = play("Idle", Math.floor(rng() * 8), "loop");
      until = now + len;
    } else {
      act = play(pick, pickOf(FIDGET_ROWS), "loop");
      until = now + once(pick) * Math.max(1, Math.round(len / once(pick))); // 한 바퀴 단위로 끊는다
    }
    return true;
  }

  // 작업 동작 하나 — 반은 걸어간 쪽을 보고, 반은 앞쪽 아무 방향으로. 할 동작이 없으면 false
  //   loop  move 길이만큼 한 바퀴 단위로 반복한다
  //   once  한 번 재생하고 마지막 자세로 멈춘 뒤(hold) settle 만큼 선 채로 숨을 고른다 — 공격을 연달아 이으면 떤다
  function startWork(now: number): boolean {
    if (!workMoves.length) return false;
    const pick = pickOf(workMoves);
    phase = "work";
    walk = null;
    const row = WORK_ROWS.includes(lastRow) && rng() < 0.5 ? lastRow : pickOf(WORK_ROWS);
    lastRow = row;
    if (work[pick] === "loop") {
      act = play(pick, row, "loop");
      settleAt = null;
      until = now + once(pick) * Math.max(1, Math.round(between(RH.work.move) / once(pick)));
    } else {
      act = play(pick, row, "hold");
      settleAt = now + once(pick);
      until = settleAt + between(RH.work.settle);
    }
    return true;
  }

  // 묶음의 다음 작업 동작 — 남은 게 없거나 할 동작이 없으면 false
  function nextMove(now: number): boolean {
    if (movesLeft <= 0 || !startWork(now)) return false;
    movesLeft -= 1;
    return true;
  }

  // 작업 중 쉬는 틈이 끝났다 — 가끔 먼저 걸어가고, 도착하거나 걷지 않으면 작업 동작을 이어 한다
  function startBurst(now: number, box: RoamBox | null): boolean {
    const [lo, hi] = RH.work.moves;
    movesLeft = lo + Math.floor(rng() * (hi - lo + 1));
    if (box && rng() < RH.work.walkChance && startWalk(now, box, between(RH.work.pace), between(RH.work.walk), false)) {
      return true;
    }
    return nextMove(now);
  }

  // 반응 — 없는 동작이면 아무것도 바꾸지 않고 false. 부른 쪽이 걷던 중이어도 망가지지 않는다
  function react(now: number, anim: string | null, next: "rest" | "yield" = "rest"): boolean {
    if (!anim) return false;
    phase = next === "yield" ? "react-yield" : "react";
    walk = null;
    act = play(anim, 0, "loop");
    until = now + repeatMs(anim);
    return true;
  }

  function fallAsleep(): void {
    phase = "sleep";
    walk = null;
    const anim = first(MOVES.sleep);
    act = anim ? play(anim, 0, "loop") : null; // 자는 그림이 없으면 서서 가만히 있는다
  }

  // 범위 안으로 — 범위 값이 망가져 들어와도(NaN) 오프셋이 NaN 으로 눌어붙지 않게 0 으로 둔다
  const clampIn = (p: { x: number; y: number }, box: RoamBox): { x: number; y: number } => {
    const fit = (v: number, lo: number, hi: number): number => {
      const r = Math.min(Math.max(v, lo), hi);
      return Number.isFinite(r) ? r : 0;
    };
    return { x: fit(p.x, box.minX, box.maxX), y: fit(p.y, box.minY, box.maxY) };
  };

  const out = (): MotionOut => ({ roam: { ...roam }, act, phase, rhythm });

  // 한 틱 — 입력: 시각, CLI 상태, 마지막 사용자 활동 시각, 산책 범위(없으면 null), 보이는지
  function tick({ now, agent, activeAt, box, visible, company, cursor }: BrainInput): MotionOut {
    surroundings = { company, cursor };
    const working = agent === "running";
    const want: "idle" | "work" = working ? "work" : "idle";
    if (!begun) {
      begun = true;
      rhythm = want;
      startPause(now);
    }
    const idle = now - activeAt;
    // 숨어 있다 다시 보이는 순간 밀린 행동이 튀어나오지 않게 — 나타나자마자 걸어가면 어색하다
    if (visible && !wasVisible) nextAt = Math.max(nextAt, now + RH[rhythm].pause[0]);
    wasVisible = visible;

    // 들려 있는 동안은 사용자 손에 맡긴다 — 아파하는 동작이 끝나면 끄는 방향을 보며 버둥거린다
    if (phase === "held") {
      if (now >= heldUntil) {
        const anim = first(MOVES.held);
        act = anim ? play(anim, heldRow, "loop") : null;
      }
      return out();
    }

    // 신호 상태 — 상태 동작에 맡긴다. 걷던 자리에 멈추고, 자고 있었으면 깬 것으로 친다.
    // 그 사이 만진 반응은 끝까지 보여 준 뒤 돌려준다
    if (isSignal(agent)) {
      if ((phase === "react" || phase === "react-yield") && now < until) return out();
      if (phase !== "yield") {
        phase = "yield";
        act = null;
        walk = null;
      }
      return out();
    }
    if (phase === "react-yield") phase = "react"; // 신호가 먼저 끝났다 — 반응은 마저 보여 주고 쉰다
    if (phase === "yield") {
      rhythm = want;
      toRest(now);
      if (working) nextAt = now; // 실패 표시가 끝나 일로 돌아왔다 — 바로 움직인다
    }

    // 모드가 바뀌었다. 일을 시작하면 쉬던 것·둘러보던 것을 접고 곧바로 움직이고, 일이 끝나면 작업 동작을 접고 쉰다.
    // 걷기·깨기·만진 반응은 끝까지 보여 준다 — 끝난 뒤 새 모드로 이어 간다
    if (want !== rhythm) {
      rhythm = want;
      if (phase === "rest" || phase === "look" || phase === "fidget" || phase === "work") {
        toRest(now);
        if (working) nextAt = now;
      }
    }

    // 무대 크기가 바뀌어 범위가 줄었으면 안으로 들인다. 걷는 중이면 목적지를 줄인다 —
    // 안 줄이면 가두기에 막혀 걷는 그림만 나오고 제자리다
    if (box) {
      if (phase === "walk" && walk) walk.to = clampIn(walk.to, box);
      else roam = clampIn(roam, box);
    }

    // 자는 중 — 입력이 들어오거나 CLI 가 일을 시작하면 깬다
    if (phase === "sleep") {
      if (idle >= T.sleep && !working) return out();
      const anim = first(MOVES.wake);
      if (anim && visible) {
        phase = "wake";
        act = play(anim, 0, "hold");
        until = now + once(anim);
      } else {
        toRest(now);
        if (working) nextAt = now;
      }
      return out();
    }

    // 걷는 중 — 시간 비율로 위치를 옮긴다
    if (phase === "walk" && walk) {
      const t = Math.min(1, (now - walk.startAt) / walk.dur);
      roam = {
        x: Math.round(walk.from.x + (walk.to.x - walk.from.x) * t),
        y: Math.round(walk.from.y + (walk.to.y - walk.from.y) * t),
      };
      if (t < 1) return out();
      // 방향을 틀 시간이 남았다 — 서지 않고 같은 속도로 다른 쪽으로 이어 걷는다. 못 틀면 여기서 선다
      const { pace, restMs } = walk;
      if (restMs >= WALK.turnMinMs && visible && box && startWalk(now, box, pace, restMs, false)) return out();
      // 작업 중 — 걸어간 자리에서 곧바로 작업 동작. 서 있는 그림이 끼면 일이 멈춘 것처럼 보인다
      if (rhythm === "work") {
        if (!(visible && nextMove(now))) toRest(now);
        return out();
      }
      // 도착 — 쉬는 틈을 열고, 걸어온 쪽을 잠깐 보고 서 있다가 정면으로
      toRest(now);
      phase = "look";
      act = have.has("Idle") ? play("Idle", lastRow, "loop") : null;
      until = now + between(RH.idle.lookBack);
      return out();
    }

    // 작업 동작 중 — 한 번 내지른 동작은 끝나면 서서 숨을 고르고, 다 끝나면 묶음의 다음 동작이나 숨 고르기
    if (phase === "work") {
      if (settleAt != null && now >= settleAt) {
        settleAt = null;
        if (have.has("Idle")) act = play("Idle", act ? act.row : lastRow, "loop");
      }
      if (now < until) return out();
      if (visible && nextMove(now)) return out();
      toRest(now);
      return out();
    }

    if ((phase === "look" || phase === "fidget" || phase === "wake" || phase === "react") && now < until) {
      return out();
    }
    if (phase === "look" || phase === "fidget") {
      // 쉬는 틈 안의 동작이 끝났다 — 남은 쉬는 시간은 서 있는다
      phase = "rest";
      act = null;
    } else if (phase !== "rest") {
      // 깨기·만진 반응을 마쳤다 — 일하는 중이면 숨 고르기 없이 곧바로 움직인다
      toRest(now);
      if (working) nextAt = now;
    }

    if (rhythm === "work") {
      // 자율 행동 — 보일 때만. 아무도 못 보는 곳에서 움직일 이유가 없다
      if (now < nextAt || !visible) return out();
      if (startBurst(now, box)) return out();
      toRest(now); // 할 게 없다(작업 동작도 걷기도 없음) — 다시 쉰다
      return out();
    }

    // 한가 — 오래 조용하면 그 자리에서 잔다. 잠들기 직전에는 새로 움직이지 않는다
    if (idle >= T.sleep) {
      fallAsleep();
      return out();
    }
    if (idle >= T.quiet) return out();

    // 쉬는 틈의 제자리 동작 — 지난 시각은 한꺼번에 버린다(안 보이던 사이 밀린 것을 몰아서 하지 않게)
    const head = fidgets[0];
    if (head !== undefined && now >= head) {
      fidgets = fidgets.filter((at) => at > now);
      if (visible && startFidget(now)) return out();
    }
    if (now < nextAt || !visible || !box) return out();
    if (startWalk(now, box, between(RH.idle.pace), between(RH.idle.walk), rng() < WALK.turn)) return out();
    // 걸을 수 없다(걷는 그림이 없거나 갈 데가 가깝다) — 제자리 동작으로 대신하고 다시 쉰다
    toRest(now);
    // 방금 한 동작이 끝나기 전 시각은 버린다 — 끝나자마자 또 하지 않게
    if (startFidget(now)) fidgets = fidgets.filter((at) => at > until + T.reactMin);
    return out();
  }

  return {
    tick,
    tune(next, nextPulls) {
      T.quiet = next.TIMES.quiet * timeScale;
      T.sleep = next.TIMES.sleep * timeScale;
      T.reactMin = next.TIMES.reactMin * timeScale;
      for (const key of ["idle", "work"] as const) {
        RH[key].pause = scaled("pause", next.RHYTHM[key].pause);
        RH[key].pace = scaled("pace", next.RHYTHM[key].pace);
      }
      M = next.MODES[mode] ?? next.MODES.on;
      pulls = nextPulls;
    },
    // 사용자가 집어 들었다 — 걷기·수면 무엇이든 멈추고 아파한다
    pickup(now) {
      phase = "held";
      walk = null;
      heldRow = 0;
      dragAcc = { x: 0, y: 0 };
      const anim = first(MOVES.pickup);
      act = anim ? play(anim, 0, "loop") : null;
      heldUntil = anim ? now + repeatMs(anim) : now;
    },
    // 끄는 방향 — 이동을 쌓아 두었다가 충분히 끌었을 때 돌아본다. 손 떨림에 휙휙 돌지 않고, 천천히 끌어도 결국 돈다
    drag(dx, dy) {
      dragAcc = { x: dragAcc.x + dx, y: dragAcc.y + dy };
      if (Math.hypot(dragAcc.x, dragAcc.y) < WALK.dragTurnPx) return;
      heldRow = rowOf(dragAcc.x, dragAcc.y);
      dragAcc = { x: 0, y: 0 };
    },
    // 내려놓았다 — 놓은 자리가 새 집이다. CLI 가 일하는 중이어도 반응은 보여 준다
    drop(now, agent) {
      roam = { x: 0, y: 0 };
      const anim = firstReact(MOVES.drop) ?? firstReact(MOVES.reactFallback);
      if (!react(now, anim, isSignal(agent) ? "yield" : "rest")) toRest(now);
    },
    // 사용자가 자리를 직접 옮겼거나 들고 있던 게 풀렸다 — 반응 없이 쉰다
    rehome(now) {
      roam = { x: 0, y: 0 };
      toRest(now);
    },
    // 콕 찔렀다 — 자고 있었으면 먼저 깬다. 걷던 중이면 그 자리에 선다. 반응할 동작이 없으면 아무것도 안 바꾼다
    click(now, agent) {
      if (phase === "held") return;
      if (phase === "sleep") {
        const wake = first(MOVES.wake);
        if (wake) {
          walk = null;
          phase = "wake";
          act = play(wake, 0, "hold");
          until = now + once(wake);
          return;
        }
      }
      react(now, anyReact(MOVES.click) ?? anyReact(MOVES.reactFallback), isSignal(agent) ? "yield" : "rest");
    },
  };
}
