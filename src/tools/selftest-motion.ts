// 움직임 모듈 자체 확인 — npm run build 뒤 node dist/tools/selftest-motion.js (npm run selftest 가 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. 파일·Electron 없이 고정 rng 와 가짜 caps 로 시간을 돌린다.
// 가짜 caps: Idle · Walk · Sleep · Wake · Nod · Hurt · Hop (작업 동작 시험에는 Attack(once) · Charge(loop) 를 더한다), durOf 고정
// 확인하는 것 (s2-plan §4.B)
//   (1) 한가: 일정 시간 안에 walk 가 나오고 roam 은 box 안      (2) 300초 입력 없음 → sleep, click → wake → rest
//   (3) running → work 리듬, 잠 안 듦, Walk 만 있으면 걷기만     (4) pickup → held · drag 누적 6px → heldRow · drop → roam 0 + 반응
//   (5) 신호 상태(waiting) → yield, act null                     (6) paceScale 2 → 같은 거리 walk.dur 절반 · sleepScale 0.5 → 150초에 잔다
//   (7) 두 인스턴스(씨앗 다름)가 다른 자리로 간다
//   + NEUTRAL_PARAMS 면 규칙표 숫자가 옛 것과 같다 · rowOf 방향 · body.js 의 활동 bump 규칙 · 숨어 있으면 걷지 않는다 · capsOf
// 끝에 "통과 (N건)". 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { createBrain } from "../motion/brain";
import { NEUTRAL_PARAMS, applyParams } from "../motion/params";
import { capsOf, createPetMotion } from "../motion/pet-motion";
import { MOTION_RULES } from "../motion/rules";
import type { MotionRules } from "../motion/rules";
import type { MotionCaps, MotionOut, MotionParams, PetMotion, PetMotionOptions, Phase, RoamBox } from "../motion/types";
import type { StageState } from "../shared/stage";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// 고정 rng — mulberry32. 씨앗이 같으면 같은 수열
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 가짜 동작 길이 (ms) — 실제 PMD 와 비슷한 자릿수
const DUR: Record<string, number> = {
  Idle: 800, Walk: 600, Sleep: 1000, Wake: 500, Nod: 300, Hurt: 400, Hop: 500, Attack: 330, Charge: 700,
};
const BASIC = ["Idle", "Walk", "Sleep", "Wake", "Nod", "Hurt", "Hop"];
function fakeCaps(names: readonly string[], work: Record<string, "once" | "loop"> = {}, workOnly: readonly string[] = []): MotionCaps {
  return { have: new Set(names), durOf: (a) => DUR[a] ?? 0, work, workOnly: new Set(workOnly), zoom: 2 };
}

const TICK = MOTION_RULES.TICK_MS;
const BOX: RoamBox = { minX: -200, maxX: 200, minY: -100, maxY: 100 };
const T = MOTION_RULES.TIMES;

interface Trace {
  now: number;
  out: MotionOut;
}

// from 부터 to 까지(포함) TICK 간격으로 틱 — 각 틱의 출력을 모아 돌려준다. stop 이 true 면 그 틱에서 멈춘다
function run(
  m: PetMotion,
  from: number,
  to: number,
  agent: StageState,
  opts: { box?: RoamBox | null; visible?: boolean } = {},
  stop?: (t: Trace) => boolean,
): Trace[] {
  const box = opts.box === undefined ? BOX : opts.box;
  const visible = opts.visible ?? true;
  const traces: Trace[] = [];
  for (let now = from; now <= to; now += TICK) {
    const t = { now, out: m.tick({ now, agent, box, visible }) };
    traces.push(t);
    if (stop && stop(t)) break;
  }
  return traces;
}
const last = (traces: Trace[]): Trace => {
  const t = traces[traces.length - 1];
  assert.ok(t, "틱이 하나도 없다");
  return t;
};
const inBox = (p: { x: number; y: number }, box: RoamBox): boolean =>
  p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
const phases = (traces: Trace[]): Set<Phase> => new Set(traces.map((t) => t.out.phase));
// 단계가 바뀌어 들어간 틱들 — walk 시작 시각 등
const entries = (traces: Trace[], phase: Phase): Trace[] =>
  traces.filter((t, i) => t.out.phase === phase && (i === 0 || traces[i - 1]?.out.phase !== phase));
const pet = (o: Partial<PetMotionOptions> & { seed: number }): PetMotion =>
  createPetMotion({ caps: fakeCaps(BASIC), rng: seeded(o.seed), now: 0, ...o });

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  out(`  ok  ${name}`);
}

// ── 규칙표 · 배율 ─────────────────────────────────────────────────────────────
out("규칙표 · 배율");
// 함수를 뺀 숫자 부분만 비교 — SCALED(Set) 는 JSON 으로 빈 객체가 되니 따로
const numbersOf = (r: MotionRules): string =>
  JSON.stringify({ TIMES: r.TIMES, RHYTHM: r.RHYTHM, WALK: r.WALK, MOVES: r.MOVES, MODES: r.MODES, FIDGET_ROWS: r.FIDGET_ROWS, WORK_ROWS: r.WORK_ROWS });

check("NEUTRAL_PARAMS 를 곱하면 숫자가 옛 규칙표와 같다", () => {
  const r = applyParams(NEUTRAL_PARAMS);
  assert.strictEqual(numbersOf(r), numbersOf(MOTION_RULES));
  assert.deepStrictEqual([...r.SCALED], [...MOTION_RULES.SCALED]);
  assert.strictEqual(r.rowOf, MOTION_RULES.rowOf);
  // 옛 brain.js 의 숫자 그대로인지 — 대표값
  assert.deepStrictEqual(r.TIMES, { quiet: 270_000, sleep: 300_000, reactMin: 1_200 });
  assert.deepStrictEqual(r.RHYTHM.idle.pause, [7_000, 20_000]);
  assert.deepStrictEqual(r.RHYTHM.work.pace, [1.3, 1.8]);
  assert.deepStrictEqual(r.MODES, { on: { pause: 1, fidget: 0.5 }, calm: { pause: 2.2, fidget: 0.25 } });
  assert.strictEqual(applyParams().TIMES.sleep, 300_000); // 인자 없이도 중립
});

check("배율은 정해진 자리에만 곱해진다", () => {
  const p = (over: Partial<MotionParams>): MotionRules => applyParams({ ...NEUTRAL_PARAMS, ...over });
  assert.deepStrictEqual(p({ sleepScale: 0.5 }).TIMES, { quiet: 135_000, sleep: 150_000, reactMin: 1_200 });
  assert.deepStrictEqual(p({ reactScale: 2 }).TIMES, { quiet: 270_000, sleep: 300_000, reactMin: 2_400 });
  const pause = p({ pauseScale: 2 });
  assert.deepStrictEqual(pause.RHYTHM.idle.pause, [14_000, 40_000]);
  assert.deepStrictEqual(pause.RHYTHM.work.pause, [1_000, 3_600]);
  assert.deepStrictEqual(pause.RHYTHM.idle.walk, [3_000, 7_000]); // walk 는 그대로
  const pace = p({ paceScale: 2 });
  assert.deepStrictEqual(pace.RHYTHM.idle.pace, [1.2, 2.0]);
  assert.deepStrictEqual(pace.RHYTHM.work.pace, [2.6, 3.6]);
  assert.deepStrictEqual(p({ fidgetScale: 0.5 }).MODES, { on: { pause: 1, fidget: 0.25 }, calm: { pause: 2.2, fidget: 0.125 } });
  // 끌림(socialPull · cursorPull)은 아직 어디에도 곱하지 않는다 — S3
  assert.strictEqual(numbersOf(p({ socialPull: 1, cursorPull: -1 })), numbersOf(MOTION_RULES));
  // 원본은 건드리지 않는다
  assert.strictEqual(MOTION_RULES.TIMES.sleep, 300_000);
});

check("rowOf — 아래 0 · 오른쪽 2 · 위 4 · 왼쪽 6, 사이는 대각선", () => {
  const { rowOf } = MOTION_RULES;
  assert.strictEqual(rowOf(0, 1), 0);
  assert.strictEqual(rowOf(1, 1), 1);
  assert.strictEqual(rowOf(1, 0), 2);
  assert.strictEqual(rowOf(1, -1), 3);
  assert.strictEqual(rowOf(0, -1), 4);
  assert.strictEqual(rowOf(-1, -1), 5);
  assert.strictEqual(rowOf(-1, 0), 6);
  assert.strictEqual(rowOf(-1, 1), 7);
  assert.ok(MOTION_RULES.isSignal("waiting") && MOTION_RULES.isSignal("failed") && MOTION_RULES.isSignal("waving"));
  assert.ok(!MOTION_RULES.isSignal("idle") && !MOTION_RULES.isSignal("running"));
});

check("capsOf — art 에서 보유 동작 · 길이 · 작업 동작을 뽑는다", () => {
  const caps = capsOf({
    anims: { Idle: { frames: [{ ms: 200 }, { ms: 300 }] }, Charge: { frames: [{ ms: 100 }] } },
    work: { Charge: "loop" },
    workOnly: ["Charge"],
    zoom: 3,
  });
  assert.deepStrictEqual([...caps.have].sort(), ["Charge", "Idle"]);
  assert.strictEqual(caps.durOf("Idle"), 500);
  assert.strictEqual(caps.durOf("없음"), 0);
  assert.deepStrictEqual(caps.work, { Charge: "loop" });
  assert.ok(caps.workOnly.has("Charge"));
  assert.strictEqual(caps.zoom, 3);
});

// ── (1) 한가 ──────────────────────────────────────────────────────────────────
out("(1) 한가");
check("60초 안에 걷고, roam 은 늘 box 안, 첫 걷기는 최소 쉬는 시간(7초) 뒤", () => {
  const m = pet({ seed: 1 });
  const tr = run(m, 0, 60_000, "idle");
  const walks = entries(tr, "walk");
  assert.ok(walks.length >= 1, "60초 안에 걷기가 없다");
  assert.ok(walks[0]!.now >= MOTION_RULES.RHYTHM.idle.pause[0], `첫 걷기 ${walks[0]!.now}ms — 7초 전에 걸었다`);
  for (const t of tr) assert.ok(inBox(t.out.roam, BOX), `roam ${JSON.stringify(t.out.roam)} 이 box 밖`);
  for (const t of tr) {
    assert.strictEqual(t.out.rhythm, "idle");
    if (t.out.phase === "walk") {
      const a = t.out.act;
      assert.ok(a && a.anim === "Walk" && a.mode === "loop", "걷는 중 act 는 Walk loop");
      assert.ok(a.rate >= 0.6 && a.rate <= 1.0, `한가 걷기 속도 ${a.rate} 가 0.6~1.0 밖`);
    }
    if (t.out.act) assert.ok(t.out.act.anim !== "Sleep", "한가 60초 안에 자면 안 된다");
  }
  // 걸어서 자리가 옮겨졌다 · 도착 뒤 걸어온 쪽 보기(look, Idle)
  assert.ok(tr.some((t) => t.out.roam.x !== 0 || t.out.roam.y !== 0), "걸었는데 roam 이 0 그대로");
  const looks = entries(tr, "look");
  assert.ok(looks.length >= 1, "도착 뒤 look 이 없다");
  assert.ok(looks.every((t) => t.out.act?.anim === "Idle"), "look 은 Idle 로 걸어온 쪽을 본다");
  // 쉬는 틈의 act 는 null — 상태 동작에 맡긴다
  assert.ok(tr.filter((t) => t.out.phase === "rest").every((t) => t.out.act === null), "한가 rest 의 act 는 null");
});

check("숨어 있으면 걷지 않고 자리도 그대로 — 자는 시계는 간다", () => {
  const m = pet({ seed: 3 });
  const tr = run(m, 0, 299_960, "idle", { visible: false });
  assert.ok(!phases(tr).has("walk"), "안 보이는데 걸었다");
  assert.ok(tr.every((t) => t.out.roam.x === 0 && t.out.roam.y === 0));
  const asleep = last(run(m, 300_000, 300_000, "idle", { visible: false }));
  assert.strictEqual(asleep.out.phase, "sleep");
  assert.strictEqual(asleep.out.act?.anim, "Sleep");
});

// ── (2) 잠 · 깨기 ─────────────────────────────────────────────────────────────
out("(2) 잠 · 깨기");
check("입력 없이 300초 → sleep(Sleep), 270초 뒤에는 새 걷기 없음, click → wake(hold) → rest", () => {
  const m = pet({ seed: 2 });
  const tr = run(m, 0, 299_960, "idle");
  assert.ok(!phases(tr).has("sleep"), "300초 전에 잤다");
  for (const w of entries(tr, "walk")) assert.ok(w.now < T.quiet, `조용 270초 뒤 ${w.now}ms 에 걷기를 시작했다`);
  assert.ok(entries(tr, "walk").length >= 3, "300초 동안 걷기가 3번도 안 나왔다");
  const asleep = last(run(m, 300_000, 300_000, "idle"));
  assert.strictEqual(asleep.out.phase, "sleep");
  assert.deepStrictEqual(asleep.out.act, { anim: "Sleep", row: 0, mode: "loop", rate: 1 });
  // 자는 중엔 그대로
  assert.strictEqual(last(run(m, 300_040, 310_000, "idle")).out.phase, "sleep");
  // 콕 → 깬다 (Wake 를 한 번 재생하고 멈춤) → 끝나면 쉰다. 만진 게 활동이라 다시 잠들지 않는다
  m.click(310_040);
  const waking = last(run(m, 310_080, 310_080, "idle"));
  assert.strictEqual(waking.out.phase, "wake");
  assert.deepStrictEqual(waking.out.act, { anim: "Wake", row: 0, mode: "hold", rate: 1 });
  const after = run(m, 310_120, 320_000, "idle");
  assert.ok(after.some((t) => t.out.phase === "rest"), "깬 뒤 rest 로 가지 않았다");
  assert.ok(!phases(after).has("sleep"), "만졌는데 곧 다시 잤다");
  const woke = after.find((t) => t.out.phase !== "wake");
  assert.ok(woke && woke.now >= 310_040 + DUR.Wake!, "Wake 재생 길이보다 먼저 깨어났다");
});

// ── (3) 작업 ──────────────────────────────────────────────────────────────────
out("(3) 작업");
check("running → work 리듬 · 자지 않는다 · 작업 동작이 없으면 걷기와 Idle 만 · 빠른 걷기", () => {
  const m = pet({ seed: 4 });
  const tr = run(m, 0, 400_000, "running"); // 400초 — 입력 없이도 잠들지 않는다
  assert.ok(tr.every((t) => t.out.rhythm === "work"), "running 인데 idle 리듬");
  assert.ok(!phases(tr).has("sleep"), "작업 중에 잤다");
  for (const p of phases(tr)) assert.ok(p === "rest" || p === "walk", `작업 동작이 없는 펫의 단계 ${p}`);
  const walks = entries(tr, "walk");
  assert.ok(walks.length >= 10, "작업 중 400초에 걷기 10번도 안 나왔다");
  // 첫 행동 전의 rest 는 옛 brain 그대로 act null(상태 동작) — 그 뒤의 숨 고르기는 Idle 로 향하던 쪽을 본다
  const firstWalk = walks[0]!.now;
  assert.ok(firstWalk <= MOTION_RULES.RHYTHM.work.pause[1] + TICK, `작업 첫 걷기가 ${firstWalk}ms — 숨 고르기 최대(1.8초)보다 늦다`);
  for (const t of tr) {
    if (t.now < firstWalk) {
      assert.strictEqual(t.out.phase, "rest");
      assert.strictEqual(t.out.act, null);
      continue;
    }
    assert.ok(t.out.act, "작업 리듬의 rest 는 Idle 로 향하던 쪽을 본다 (act null 아님)");
    assert.ok(t.out.act.anim === "Walk" || t.out.act.anim === "Idle", `작업 동작 없는 펫이 ${t.out.act.anim} 을 했다`);
    if (t.out.phase === "rest") {
      assert.strictEqual(t.out.act.anim, "Idle");
      assert.ok(MOTION_RULES.WORK_ROWS.includes(t.out.act.row), "숨 고를 때 향하는 방향은 WORK_ROWS 안");
    }
    if (t.out.phase === "walk") assert.ok(t.out.act.rate >= 1.3 && t.out.act.rate <= 1.8, `작업 걷기 속도 ${t.out.act.rate}`);
  }
});

check("작업 동작(Attack once · Charge loop) → work 단계, once 는 hold · loop 는 loop, 한가로 돌아오면 쓰지 않는다", () => {
  const caps = fakeCaps([...BASIC, "Attack", "Charge"], { Attack: "once", Charge: "loop" }, ["Attack", "Charge"]);
  const m = createPetMotion({ caps, rng: seeded(5), now: 0 });
  const tr = run(m, 0, 120_000, "running");
  const works = tr.filter((t) => t.out.phase === "work");
  assert.ok(works.length > 0, "작업 동작을 한 번도 안 했다");
  const seen = new Set<string>();
  for (const t of works) {
    const a = t.out.act;
    assert.ok(a, "work 단계의 act 가 없다");
    if (a.anim === "Attack") assert.strictEqual(a.mode, "hold");
    if (a.anim === "Charge") assert.strictEqual(a.mode, "loop");
    if (a.anim !== "Idle") assert.ok(MOTION_RULES.WORK_ROWS.includes(a.row), `작업 동작 방향 ${a.row}`);
    seen.add(a.anim);
  }
  assert.ok(seen.has("Attack") && seen.has("Charge"), `두 작업 동작이 다 나와야 한다: ${[...seen].join(",")}`);
  // 한 번 내지른 뒤 서서 숨 고르기 — Attack(hold) 다음 틱들에 Idle 이 온다
  assert.ok(seen.has("Idle"), "once 동작 뒤 서 있는 Idle 이 없다");
  // 한가로 돌아오면 작업 동작을 접고, 반응에도 workOnly 는 쓰지 않는다
  const idle = run(m, 120_040, 200_000, "idle");
  assert.ok(idle.every((t) => t.out.act?.anim !== "Attack" && t.out.act?.anim !== "Charge"), "한가할 때 작업 동작이 보였다");
  assert.ok(entries(idle, "walk").length >= 1);
  m.click(200_040);
  const reacted = last(run(m, 200_080, 200_080, "idle"));
  assert.strictEqual(reacted.out.phase, "react");
  assert.ok(["Nod", "Hop"].includes(reacted.out.act?.anim ?? ""), `클릭 반응 ${reacted.out.act?.anim}`);
});

// ── (4) 집어 들기 · 끌기 · 놓기 ─────────────────────────────────────────────
out("(4) 집어 들기 · 끌기 · 놓기");
check("걷다가 pickup → held(Hurt) · drag 누적 6px 넘으면 heldRow · drop → roam 0 + Hop 반응 → rest", () => {
  const m = pet({ seed: 6 });
  const walking = last(run(m, 0, 60_000, "idle", {}, (t) => t.out.phase === "walk" && (t.out.roam.x !== 0 || t.out.roam.y !== 0)));
  assert.strictEqual(walking.out.phase, "walk");
  const t0 = walking.now + TICK;
  m.pickup(t0);
  const held = last(run(m, t0, t0, "idle"));
  assert.strictEqual(held.out.phase, "held");
  assert.deepStrictEqual(held.out.act, { anim: "Hurt", row: 0, mode: "loop", rate: 1 });
  // 아파하는 동안(repeatMs(Hurt) = 400 × 3) 은 끌어도 그대로
  m.drag(2, 0);
  m.drag(2, 0);
  const still = last(run(m, t0 + TICK, t0 + 1_160, "idle"));
  assert.strictEqual(still.out.act?.anim, "Hurt");
  // 끝나면 버둥거림(Walk) — 4px 는 dragTurnPx(6) 미만이라 방향 0 그대로
  const wiggle = last(run(m, t0 + 1_200, t0 + 1_240, "idle"));
  assert.deepStrictEqual(wiggle.out.act, { anim: "Walk", row: 0, mode: "loop", rate: 1 });
  m.drag(3, 0); // 누적 7px → 오른쪽(2)
  assert.strictEqual(last(run(m, t0 + 1_280, t0 + 1_280, "idle")).out.act?.row, 2);
  m.drag(0, -10); // 위(4)
  assert.strictEqual(last(run(m, t0 + 1_320, t0 + 1_320, "idle")).out.act?.row, 4);
  // 들린 동안 roam 은 안 바뀐다 · 클릭은 무시
  assert.deepStrictEqual(last(run(m, t0 + 1_360, t0 + 1_360, "idle")).out.roam, held.out.roam);
  m.click(t0 + 1_400);
  assert.strictEqual(last(run(m, t0 + 1_400, t0 + 1_400, "idle")).out.phase, "held");
  // 놓기 — 놓은 자리가 새 집(roam 0), 첫 drop 후보 Hop 으로 반응
  const t1 = t0 + 2_000;
  m.drop(t1);
  const dropped = last(run(m, t1, t1, "idle"));
  assert.strictEqual(dropped.out.phase, "react");
  assert.deepStrictEqual(dropped.out.roam, { x: 0, y: 0 });
  assert.deepStrictEqual(dropped.out.act, { anim: "Hop", row: 0, mode: "loop", rate: 1 });
  // 반응 길이 = 500 × ceil(1200/500) = 1500 → 그 뒤 rest
  assert.strictEqual(last(run(m, t1 + TICK, t1 + 1_480, "idle")).out.phase, "react");
  const rested = last(run(m, t1 + 1_520, t1 + 1_520, "idle"));
  assert.strictEqual(rested.out.phase, "rest");
  assert.strictEqual(rested.out.act, null);
});

check("rehome → roam 0, 반응 없이 rest", () => {
  const m = pet({ seed: 8 });
  last(run(m, 0, 60_000, "idle", {}, (t) => t.out.roam.x !== 0 || t.out.roam.y !== 0));
  m.rehome(60_040);
  const o = last(run(m, 60_040, 60_040, "idle"));
  assert.deepStrictEqual(o.out.roam, { x: 0, y: 0 });
  assert.strictEqual(o.out.phase, "rest");
  assert.strictEqual(o.out.act, null);
});

// ── (5) 신호 상태 ─────────────────────────────────────────────────────────────
out("(5) 신호 상태");
check("waiting → yield · act null · 자리 그대로. 그 사이 클릭은 react-yield 로 짧게, 끝나면 다시 yield. idle 로 돌아오면 rest", () => {
  const m = pet({ seed: 9 });
  const walking = last(run(m, 0, 60_000, "idle", {}, (t) => t.out.phase === "walk" && (t.out.roam.x !== 0 || t.out.roam.y !== 0)));
  const t0 = walking.now + TICK;
  m.state("waiting", null, t0);
  const y = last(run(m, t0, t0 + 10_000, "waiting"));
  assert.strictEqual(y.out.phase, "yield");
  assert.strictEqual(y.out.act, null);
  assert.deepStrictEqual(y.out.roam, walking.out.roam, "신호 상태에서 걷던 자리에 멈춘다");
  m.click(t0 + 10_040);
  const r = last(run(m, t0 + 10_040, t0 + 10_040, "waiting"));
  assert.strictEqual(r.out.phase, "react-yield");
  assert.ok(["Nod", "Hop"].includes(r.out.act?.anim ?? ""));
  const back = last(run(m, t0 + 10_080, t0 + 13_000, "waiting"));
  assert.strictEqual(back.out.phase, "yield");
  assert.strictEqual(back.out.act, null);
  // 다른 신호 상태들도 마찬가지
  for (const s of ["waving", "failed"] as const) assert.strictEqual(last(run(m, t0 + 13_040, t0 + 13_040, s)).out.phase, "yield");
  m.state("idle", null, t0 + 14_000);
  const rest = last(run(m, t0 + 14_000, t0 + 14_000, "idle"));
  assert.strictEqual(rest.out.phase, "rest");
  // failed → running 은 바로 움직인다 (nextAt = now)
  const m2 = pet({ seed: 10 });
  run(m2, 0, 1_000, "failed");
  const work = run(m2, 1_040, 3_000, "running");
  assert.ok(work.some((t) => t.out.phase === "walk"), "실패 표시가 끝나 일로 돌아왔는데 곧바로 움직이지 않았다");
});

check("reactMs — 상태 변화를 마리마다 0~reactMs 뒤에 따른다. 활동 시각은 바로 잡는다", () => {
  const starts: number[] = [];
  for (let seed = 30; seed < 36; seed += 1) {
    const logs: Record<string, unknown>[] = [];
    const m = pet({ seed, reactMs: 1_500, log: (o) => logs.push(o) });
    run(m, 0, 100_000, "idle");
    m.state("waiting", null, 100_000);
    const ticks = run(m, 100_000, 102_000, "waiting");
    const first = ticks.find((t) => t.out.phase === "yield");
    assert.ok(first, "지연 뒤에도 신호 상태로 가지 않았다");
    assert.ok(first.now <= 100_000 + 1_500 + TICK, "reactMs 보다 늦게 반응했다");
    starts.push(first.now);
    // 되돌아온 상태가 아직 적용 전인 상태와 같으면 기다리지 않는다
    m.state("idle", null, 102_000);
    m.state("waiting", null, 102_000);
    assert.strictEqual(last(run(m, 102_000, 102_000, "waiting")).out.phase, "yield");
  }
  assert.ok(new Set(starts).size > 1, "여러 마리가 같은 틱에 반응했다");
  // 활동 시각은 지연 없이 — 반응 뒤 찍힌 idleSec 이 상태를 받은 때부터 센 값(반응 지연 이하)
  const logs: Record<string, unknown>[] = [];
  const b = pet({ seed: 40, reactMs: 1_500, log: (o) => logs.push(o) });
  run(b, 0, 100_000, "idle");
  const before = logs.length;
  b.state("running", null, 100_000);
  run(b, 100_000, 102_000, "running");
  assert.ok(logs.length > before, "반응한 기록이 없다");
  assert.ok(Number(logs[logs.length - 1]?.idleSec) <= 2, "idle→running 이 활동으로 바로 잡히지 않았다");
});

// ── 활동 bump 규칙 (옛 body.js) ───────────────────────────────────────────────
out("활동 bump 규칙");
check("promptAt(초) · idle→running · →idle · failed→running(안 침) · focus 변화", () => {
  // promptAt 은 초 단위 — 285초 프롬프트면 585초에 잔다
  const a = pet({ seed: 21 });
  run(a, 0, 290_000, "idle");
  a.state("idle", 285, 290_000);
  assert.ok(!phases(run(a, 290_040, 584_960, "idle")).has("sleep"), "프롬프트 뒤 300초 안에 잤다");
  assert.strictEqual(last(run(a, 585_000, 585_000, "idle")).out.phase, "sleep");

  // idle→running 은 활동 — 그 뒤 idle 로 돌아와도 300초는 안 잔다. →idle 도 활동
  const logs: Record<string, unknown>[] = [];
  const b = pet({ seed: 22, log: (o) => logs.push(o) });
  run(b, 0, 100_000, "idle");
  b.state("running", null, 100_000);
  run(b, 100_040, 100_040, "running");
  assert.strictEqual(logs[logs.length - 1]?.idleSec, 0, "idle→running 이 활동으로 잡히지 않았다");
  b.state("waiting", null, 150_000); // running→waiting 은 활동이 아니다
  run(b, 150_000, 150_000, "waiting");
  assert.strictEqual(logs[logs.length - 1]?.idleSec, 50);
  b.state("idle", null, 200_000);
  run(b, 200_000, 200_000, "idle");
  assert.strictEqual(logs[logs.length - 1]?.idleSec, 0, "→idle 이 활동으로 잡히지 않았다");

  // failed→running 은 자동이라 활동이 아니다 — 200초 그대로
  const logs2: Record<string, unknown>[] = [];
  const c = pet({ seed: 23, log: (o) => logs2.push(o) });
  run(c, 0, 10_000, "idle");
  c.state("failed", null, 10_000);
  run(c, 10_000, 10_000, "failed");
  c.state("running", null, 200_000);
  run(c, 200_000, 200_000, "running");
  assert.strictEqual(logs2[logs2.length - 1]?.idleSec, 200, "failed→running 이 활동으로 잡혔다");

  // state() 없이 tick 의 agent 만 바뀌어도 같은 규칙
  const logs3: Record<string, unknown>[] = [];
  const d = pet({ seed: 24, log: (o) => logs3.push(o) });
  run(d, 0, 100_000, "idle");
  run(d, 100_040, 100_040, "running");
  assert.strictEqual(logs3[logs3.length - 1]?.idleSec, 0);

  // focus — 첫 값은 활동이 아니고, null 은 무시, 바뀌면 활동
  const e = pet({ seed: 25 });
  run(e, 0, 40, "idle");
  e.focus("a", 50_000);
  e.focus(null, 60_000);
  e.focus("a", 70_000);
  assert.strictEqual(last(run(e, 80, 300_000, "idle")).out.phase, "sleep", "첫 포커스·같은 값·null 이 활동으로 잡혔다");
  const f = pet({ seed: 26 });
  run(f, 0, 40, "idle");
  f.focus("a", 50_000);
  f.focus("b", 100_000);
  assert.ok(!phases(run(f, 80, 399_960, "idle")).has("sleep"), "포커스 변화 뒤 300초 안에 잤다");
  assert.strictEqual(last(run(f, 400_000, 400_000, "idle")).out.phase, "sleep");

  // now 를 안 준 state() 는 마지막 틱 시각으로 친다
  const g = pet({ seed: 27 });
  run(g, 0, 100_000, "idle");
  g.state("running", null);
  g.state("idle", null);
  assert.ok(!phases(run(g, 100_040, 399_960, "idle")).has("sleep"));
  assert.strictEqual(last(run(g, 400_000, 400_000, "idle")).out.phase, "sleep");
});

// ── (6) 배율이 동작에 미치는 것 ────────────────────────────────────────────────
out("(6) 배율");
check("sleepScale 0.5 → 150초에 잔다 (중립은 150초에 안 잔다)", () => {
  const neutral = pet({ seed: 31 });
  const sleepy = pet({ seed: 31, params: { ...NEUTRAL_PARAMS, sleepScale: 0.5 } });
  assert.ok(!phases(run(neutral, 0, 150_000, "idle")).has("sleep"));
  const tr = run(sleepy, 0, 150_000, "idle");
  assert.ok(!phases(tr.slice(0, -1)).has("sleep"), "150초 전에 잤다");
  assert.strictEqual(last(tr).out.phase, "sleep");
  // 조용 시간도 반 — 135초 뒤에는 새 걷기 없음
  for (const w of entries(tr, "walk")) assert.ok(w.now < 135_000, `sleepScale 0.5 인데 ${w.now}ms 에 걷기 시작`);
});

check("paceScale 2 → 같은 목표까지 걷는 시간이 절반 (turn 0 으로 한 구간만)", () => {
  // 작은 box 라 목표는 늘 표본 중 가장 먼 곳 — want 와 무관해 두 brain 의 목표가 같다. 시간만 속도로 갈린다
  const small: RoamBox = { minX: 0, maxX: 60, minY: 0, maxY: 60 };
  const noTurn: MotionRules = { ...MOTION_RULES, WALK: { ...MOTION_RULES.WALK, turn: 0 } };
  const brainWith = (params: MotionParams, seed: number) =>
    createBrain({ have: new Set(BASIC), durOf: (a) => DUR[a] ?? 0, speedPx: 54, rng: seeded(seed), rules: applyParams(params, noTurn) });
  const slow = brainWith(NEUTRAL_PARAMS, 41);
  const fast = brainWith({ ...NEUTRAL_PARAMS, paceScale: 2 }, 41);
  const legOf = (b: ReturnType<typeof createBrain>): { start: number; end: number; to: { x: number; y: number }; rate: number } => {
    let start = -1;
    let rate = 0;
    for (let now = 0; now <= 120_000; now += TICK) {
      const o = b.tick({ now, agent: "idle", activeAt: 0, box: small, visible: true });
      if (start < 0 && o.phase === "walk") {
        start = now;
        rate = o.act?.rate ?? 0;
      }
      if (start >= 0 && o.phase !== "walk") return { start, end: now, to: o.roam, rate };
    }
    assert.fail("120초 안에 걷기 한 구간이 끝나지 않았다");
  };
  const s = legOf(slow);
  const f = legOf(fast);
  assert.strictEqual(f.start, s.start, "같은 rng 인데 걷기 시작 시각이 다르다");
  assert.deepStrictEqual(f.to, s.to, "같은 rng 인데 목표가 다르다");
  assert.ok(Math.abs(f.rate - s.rate * 2) < 0.011, `걷는 그림 속도 ${s.rate} → ${f.rate}`);
  const sDur = s.end - s.start;
  const fDur = f.end - f.start;
  assert.ok(sDur >= 400, `구간이 너무 짧아 비교가 안 된다 (${sDur}ms)`);
  assert.ok(Math.abs(sDur - fDur * 2) <= 2 * TICK, `걷는 시간 ${sDur}ms → ${fDur}ms (절반이어야 한다)`);
});

// ── (7) 마리별 인스턴스 ───────────────────────────────────────────────────────
out("(7) 마리별 인스턴스");
check("씨앗이 다른 두 마리는 다른 때 다른 곳으로 걷는다 · 씨앗이 같으면 같다", () => {
  const a = run(pet({ seed: 51 }), 0, 90_000, "idle");
  const b = run(pet({ seed: 52 }), 0, 90_000, "idle");
  const path = (tr: Trace[]): string => JSON.stringify(tr.map((t) => t.out.roam));
  assert.notStrictEqual(path(a), path(b), "씨앗이 다른데 같은 길을 걸었다");
  assert.notDeepStrictEqual(entries(a, "walk").map((t) => t.now), entries(b, "walk").map((t) => t.now), "걷기 시작 시각이 전부 같다");
  assert.notDeepStrictEqual(last(a).out.roam, last(b).out.roam);
  assert.ok(a.every((t) => inBox(t.out.roam, BOX)) && b.every((t) => inBox(t.out.roam, BOX)));
  // 같은 씨앗·같은 입력이면 결정적 — 시험이 재현된다
  assert.strictEqual(path(run(pet({ seed: 51 }), 0, 90_000, "idle")), path(a));
});

out(`통과 (${passed}건)`);
