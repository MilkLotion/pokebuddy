// 배틀 엔진 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-battle.js
//
// 테스트 프레임워크 없이 assert 만. 계약은 docs/specs/moves.md "전투 규칙", docs/specs/adventure.md "배틀 엔진"
// 작은 판은 손으로 만든 전투 개체로, 실제 종은 buildFighter 로 본다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_RULES, rangeOfMoves, rollObstacles, speedCooldownMul, runBattle, startPos, type BattleEvent, type BattleInput, type EngineFighter, type EngineMove, type Pos } from "../../battle/engine";
import { battleTypeChart, buildFighter, petFighter } from "../../battle/fighter";

const chart = battleTypeChart();
// 엔진 파일은 import 가 없어야 서버로 복사된다
const engineSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "battle", "engine.ts"), "utf8");
assert.ok(!/^\s*import\s/m.test(engineSrc), "engine.ts 에 import 가 없다");

const mv = (id: string, over: Partial<EngineMove> = {}): EngineMove => ({
  id, type: "normal", class: "physical", power: 50, accuracy: null, priority: 0, cooldownMs: 4000, hits: null, traits: [], effects: {}, ...over,
});
const unit = (over: Partial<EngineFighter> = {}): EngineFighter => ({
  species: "test", types: ["normal"], level: 50, stats: [100, 100, 100, 100, 100, 95], moves: [], ability: null, special: null, range: 1, ...over,
});
const of = <K extends BattleEvent["kind"]>(evs: BattleEvent[], kind: K): Extract<BattleEvent, { kind: K }>[] =>
  evs.filter((e): e is Extract<BattleEvent, { kind: K }> => e.kind === kind);
// 작은 판은 장애물 없이 돌린다 — 장애물은 아래 "전장" 에서 따로 본다
const run = (a: (EngineFighter | null)[], b: (EngineFighter | null)[], seed = 1, maxMs?: number, extra: Partial<BattleInput> = {}) =>
  runBattle({ seed, sides: [a, b], typeChart: chart, obstacles: [], ...(maxMs ? { maxMs } : {}), ...extra });
const at = (x: number, y: number): Pos => ({ x, y });

// ── 평타는 1초 고정 (아래 시험), 스피드는 기술 쿨타임 ──
// ── 기술 쿨타임의 스피드 배율 — 기준 95, 0.8~1.2 ──
assert.strictEqual(speedCooldownMul(95), 1);
assert.strictEqual(speedCooldownMul(190), 0.8, "빠르면 ×0.8 에서 자른다");
assert.strictEqual(speedCooldownMul(10), 1.2, "느리면 ×1.2 에서 자른다");
assert.ok(Math.abs(speedCooldownMul(100) - 0.95) < 1e-9);

// ── 빈 쪽 ──
assert.strictEqual(run([unit()], [null]).winner, 0, "상대가 비면 바로 이긴다");
assert.strictEqual(run([null], [null]).winner, null, "둘 다 비면 무승부");

// ── 전투 HP 는 실제 HP × 3 ──
{
  const r = run([unit()], [unit()], 1, 100);
  assert.strictEqual(r.maxHp[0][0], 100 * ENGINE_RULES.hpScale);
}

// ── 같은 시드 같은 결과 ──
{
  const a = [unit({ moves: [mv("tackle"), mv("slam", { power: 80, cooldownMs: 6000, accuracy: 75 })] })];
  const b = [unit({ moves: [mv("cut", { accuracy: 95 }), mv("strength", { power: 80 })] })];
  assert.deepStrictEqual(run(a, b, 42), run(a, b, 42), "같은 시드");
  const lens = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => JSON.stringify(run(a, b, s).events)));
  assert.ok(lens.size > 1, "시드가 다르면 다른 판이 나온다");
}

// ── 1번 → 2번 → 1번 번갈아 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("one", { power: 1 }), mv("two", { power: 1, cooldownMs: 6000 })] })];
  const b = [unit({ stats: [999, 1, 999, 1, 999, 95] })];
  const r = run(a, b, 1, 30_000);
  const used = of(r.events, "move").filter((e) => e.side === 0);
  assert.deepStrictEqual(used.map((e) => e.move).slice(0, 4), ["one", "two", "one", "two"]);
  assert.deepStrictEqual(used.map((e) => e.t).slice(0, 4), [4000, 10000, 14000, 20000], "다음 차례 기술의 쿨타임이 돈다");
}

// ── 상성 0 은 피해 0, 평타는 상성을 타지 않는다 ──
{
  const a = [unit({ moves: [mv("tackle")] })];
  const b = [unit({ types: ["ghost"] })];
  const r = run(a, b, 1, 5000);
  const dmg = of(r.events, "damage").filter((e) => e.side === 0);
  assert.ok(dmg.some((e) => e.source === "tackle" && e.amount === 0 && e.mult === 0), "노말 기술은 고스트에 0");
  assert.ok(dmg.some((e) => e.source === "basic" && e.amount > 0), "평타는 고스트에도 들어간다");
}

// ── 충전 — 처음 차면 충전, 다시 차면 나간다 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("solar", { power: 1, effects: { charge: true } }), mv("x", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 10_000);
  assert.deepStrictEqual(of(r.events, "charge").map((e) => e.t), [4000]);
  assert.strictEqual(of(r.events, "move").find((e) => e.side === 0)?.t, 8000);
}

// ── 반동으로 쉼 — 다음 기술 쿨타임 2배 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("hyper", { power: 1, effects: { recharge: true } }), mv("x", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 20_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [4000, 12000]);
}

// ── 난동 — 쓴 뒤 2초 동안 행동하지 않는다 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("outrage", { power: 1, effects: { rampage: true } }), mv("x", { power: 1, cooldownMs: 1000 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 10_000);
  const t = of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t);
  assert.deepStrictEqual(t.slice(0, 2), [4000, 6000], "1초 쿨타임 기술도 난동 2초 뒤");
  assert.ok(!of(r.events, "attack").some((e) => e.side === 0 && e.t > 4000 && e.t < 6000), "난동 중 평타 없음");
}

// ── 연속기 — 쓰러지면 남은 타는 가까운 상대에게 ──
{
  const a = [unit({ stats: [999, 300, 999, 1, 999, 95], moves: [mv("triple", { power: 60, hits: [3, 3], cooldownMs: 1000 })] })];
  const weak = unit({ stats: [1, 1, 1, 1, 1, 1] });
  // 둘 다 사거리 안 — 같은 줄의 약한 상대를 먼저 노리고, 쓰러지면 남은 타는 사거리 안의 다른 상대
  const positions = [[at(6, 4)], [at(9, 4), at(9, 6)]] as const;
  const r = run(a, [weak, unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 1500, { positions });
  const hits = of(r.events, "damage").filter((e) => e.source === "triple");
  assert.deepStrictEqual(hits.map((e) => e.target), [0, 1, 1]);
}

// ── 처음 자리 — 1 2 / 3 4 / 5 6, 상대는 거울, 가운데 3줄 ──
assert.deepStrictEqual(startPos(0, 0), at(0, 2));
assert.deepStrictEqual(startPos(0, 1), at(2, 2), "2번은 앞 열");
assert.deepStrictEqual(startPos(0, 5), at(2, 6));
assert.deepStrictEqual(startPos(1, 0), at(14, 2), "상대 1번은 오른쪽 끝");
assert.deepStrictEqual(startPos(1, 1), at(12, 2), "상대 2번도 앞 열");

// ── 대상 — 걸음 수로 가장 가까운 상대, 같으면 같은 줄, 그다음 번호 ──
{
  const me = unit({ stats: [999, 1, 999, 1, 999, 100] }); // 평타 2초
  const foe = unit({ stats: [999, 1, 999, 1, 999, 95] });
  const first = (b: (EngineFighter | null)[], pos: Pos[], obstacles: BattleInput["obstacles"] = []) =>
    of(run([me], b, 1, 8000, { positions: [[at(2, 4)], pos], obstacles }).events, "damage").find((e) => e.side === 0)?.target;
  assert.strictEqual(first([foe, foe], [at(12, 2), at(8, 4)]), 1, "걸음 수가 적은 쪽");
  assert.strictEqual(first([foe, foe], [at(12, 2), at(12, 4)]), 1, "걸음 수가 같으면 같은 줄");
  assert.strictEqual(first([foe, foe], [at(12, 2), at(12, 6)]), 0, "줄 차이도 같으면 번호가 작은 쪽");
  // 가로막는 벽 — 직선으로 가까운 상대가 길로는 멀다
  const wall = [0, 2, 4, 6].map((y) => ({ x: 6, y, size: 2 as const }));
  assert.strictEqual(first([foe, foe], [at(10, 4), at(10, 8)], wall), 1, "벽을 돌아가는 걸음 수로 고른다");
}

// ── 길이 없으면 싸우지 못한다 ──
{
  const wall = [0, 2, 4, 6, 8].map((y) => ({ x: 6, y, size: 2 as const }));
  const r = run([unit({ moves: [mv("tackle")] })], [unit()], 1, 5000, { obstacles: wall });
  assert.strictEqual(of(r.events, "damage").length, 0);
}

// ── 사거리 밖에서는 쿨타임이 차도 기다린다 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("one", { power: 1, cooldownMs: 100 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 5000);
  const firstMove = of(r.events, "move").find((e) => e.side === 0)!;
  const lastStep = of(r.events, "step").filter((e) => e.side === 0 && e.t <= firstMove.t).pop()!;
  assert.ok(firstMove.t > 100 && firstMove.t >= lastStep.t, "걸어서 닿은 뒤에 쓴다");
  assert.ok(of(r.events, "step").every((e, i, list) => list.findIndex((x) => x.side === e.side && x.slot === e.slot && x.t === e.t) === i), "한 틱에 한 걸음");
}

// ── 사거리 — 특수공격이 공격보다 높으면 원거리(6), 아니면 근접(1). 원거리는 사거리 안에서 멈춰 쏜다 ──
{
  assert.strictEqual(buildFighter({ species: "machamp" })!.range, 1, "접촉 기술");
  assert.strictEqual(buildFighter({ species: "garchomp" })!.range, 2, "접촉 없는 물리(지진)");
  assert.strictEqual(buildFighter({ species: "alakazam" })!.range, 3, "특수");
  assert.strictEqual(buildFighter({ species: "spectrier" })!.range, 3, "두 기술 중 짧은 쪽 — 섀도볼 5, 병상첨병 3");
  assert.strictEqual(buildFighter({ species: "lucario" })!.range, 1, "파동탄 5 와 코멧펀치 1 → 1");
  assert.strictEqual(rangeOfMoves([mv("aura", { class: "special", traits: ["pulse"] })]), 5, "파동·탄환·소리 특수");
  assert.strictEqual(rangeOfMoves([]), 1, "공격기가 없으면 1");
  const shooter = unit({ range: 6, stats: [999, 1, 999, 1, 999, 100] });
  const still = unit({ stats: [999, 1, 999, 1, 999, 95] });
  const r = run([shooter], [still], 1, 6000, { positions: [[at(0, 4)], [at(14, 4)]] });
  const hit = of(r.events, "damage").find((e) => e.side === 0)!;
  const start = of(r.events, "start")[0]!;
  let me = start.pos[0][0]!, foe = start.pos[1][0]!;
  for (const e of r.events) {
    if (e.t >= hit.t) break;
    if (e.kind === "step") e.side === 0 ? (me = e) : (foe = e);
  }
  const gap = Math.max(0, Math.abs(foe.x - me.x) - ENGINE_RULES.body);
  assert.ok(gap > 1 && gap <= 6, `원거리는 떨어져서 쏜다 (틈 ${gap})`);
}

// ── 능력 변화 — 단계당 25%, 최대 ±6, 쌓임 ──
{
  // 위협 둘 — 상대 공격 −2
  const intim = unit({ ability: "intimidate", stats: [999, 1, 999, 1, 999, 95] });
  const r = run([intim, intim], [unit()], 1, 100);
  const st = of(r.events, "stat").filter((e) => e.side === 1 && e.stat === 1);
  assert.deepStrictEqual(st.map((e) => e.stage), [-1, -2], "위협은 상대 전체 공격 −1, 쌓인다");
  // 플라워베일 — 풀 아군은 상대가 건 하락을 막는다
  const veil = unit({ ability: "flower-veil", types: ["grass"], stats: [999, 1, 999, 1, 999, 95] });
  assert.strictEqual(of(run([intim], [veil], 1, 100).events, "stat").length, 0, "플라워베일");
  // 공격기 능력 변화 — 맞힌 뒤 target 은 맞은 첫 대상
  const drop = mv("crunch", { power: 1, cooldownMs: 1000, effects: { stats: [{ who: "target", stat: "def", change: -1, chance: 100 }, { who: "self", stat: "atk", change: 3, chance: 100 }] } });
  const r2 = run([unit({ moves: [drop], stats: [999, 1, 999, 1, 999, 95] })], [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 6000, { positions: [[at(6, 4)], [at(8, 4)]] });
  const s2 = of(r2.events, "stat");
  assert.ok(s2.some((e) => e.side === 1 && e.stat === 2 && e.stage === -1), "상대 방어 −1");
  assert.ok(s2.some((e) => e.side === 0 && e.stat === 1 && e.stage === 3), "자기 공격 +3");
  assert.ok(!s2.some((e) => Math.abs(e.stage) > 6), "최대 ±6");
}

// ── 프레셔 — 상대 기술 쿨타임 +10%, 평타는 그대로 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("a", { power: 1 })] })];
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] as Pos[][] } as unknown as Partial<BattleInput>;
  const plain = of(run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 6000, pos).events, "move").find((e) => e.side === 0)!.t;
  const pressed = of(run(a, [unit({ ability: "pressure", stats: [999, 1, 999, 1, 999, 95] })], 1, 6000, pos).events, "move").find((e) => e.side === 0)!.t;
  assert.deepStrictEqual([plain, pressed], [4000, 4400]);
}

// ── 프렌드가드 — 자기 쪽 아군 전체가 받는 피해 ×0.75 ──
{
  const hitter = unit({ stats: [999, 200, 999, 1, 999, 100], moves: [mv("x", { power: 80, cooldownMs: 1000 })] });
  const target = unit({ stats: [999, 1, 100, 1, 100, 1] });
  const guard = unit({ ability: "friend-guard", stats: [999, 1, 999, 1, 999, 95] });
  const pos = (n: number) => ({ positions: [[at(6, 4)], [at(8, 4), ...(n ? [at(14, 8)] : [])]] as Pos[][] }) as unknown as Partial<BattleInput>;
  const dmg = (b: EngineFighter[], n: number) => of(run([hitter], b, 3, 1100, pos(n)).events, "damage").find((e) => e.source === "x")!.amount;
  const plain = dmg([target], 0), guarded = dmg([target, guard], 1);
  assert.ok(guarded < plain, `프렌드가드 ${plain} → ${guarded}`); // 난수 순서가 달라 정확히 0.75 배는 아니다
}

// ── 급소 — 확정급소는 늘, 전투무장은 막는다. 평타는 급소가 없다 ──
{
  const sure = unit({ stats: [999, 100, 999, 1, 999, 95], moves: [mv("flower", { power: 70, cooldownMs: 1000, effects: { crit: "always" } })] });
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const hit = (foe: EngineFighter) => of(run([sure], [foe], 1, 1100, pos).events, "damage").find((e) => e.source === "flower")!;
  assert.strictEqual(hit(unit({ stats: [999, 1, 100, 1, 100, 95] })).crit, true, "확정급소");
  assert.strictEqual(hit(unit({ ability: "battle-armor", stats: [999, 1, 100, 1, 100, 95] })).crit, undefined, "전투무장은 급소를 맞지 않는다");
  const basics = of(run([unit()], [unit()], 1, 20_000, pos).events, "damage").filter((e) => e.source === "basic");
  assert.ok(basics.length > 0 && basics.every((e) => !e.crit), "평타는 급소 없음");
}

// ── 평타는 1초마다, 스피드와 상관없다. 기술 쿨타임은 스피드로 ──
{
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const at1 = (spe: number) => {
    const r = run([unit({ stats: [999, 1, 999, 1, 999, spe], moves: [mv("a", { power: 1, cooldownMs: 4000 })] })], [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 6000, pos);
    return { basic: of(r.events, "attack").filter((e) => e.side === 0).map((e) => e.t).slice(0, 3), move: of(r.events, "move").find((e) => e.side === 0)?.t };
  };
  assert.deepStrictEqual(at1(10).basic, [1000, 2000, 3000]);
  assert.deepStrictEqual(at1(200).basic, [1000, 2000, 3000]);
  assert.strictEqual(at1(200).move, 3200, "빠르면 4초 × 0.8");
  assert.strictEqual(at1(10).move, 4800, "느리면 4초 × 1.2");
}

// ── 날씨·필드·오라 — 룰렛, 원시회귀 확정, 위력 배율, 5초 피해·회복, 실패 ──
{
  const quiet = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const startOf = (r: ReturnType<typeof run>) => of(r.events, "start")[0]!;
  // 룰렛 — 후보는 그 특성을 가진 칸, 뽑힌 칸은 후보 안
  const r1 = run([quiet({ ability: "drought" }), quiet({ ability: "drizzle" })], [quiet({ ability: "sand-stream" }), quiet({ ability: "electric-surge" })], 3, 100);
  const rl = startOf(r1).roulette!;
  assert.strictEqual(rl.weather!.candidates.length, 3, "날씨 후보 셋");
  assert.ok(rl.weather!.candidates.some((c) => c.side === rl.weather!.picked!.side && c.slot === rl.weather!.picked!.slot));
  assert.strictEqual(rl.field!.kind, "electric");
  assert.strictEqual(rl.aura, undefined, "후보가 없으면 룰렛 없음");
  // 원시회귀는 룰렛 없이 정해진다
  const r2 = run([quiet({ ability: "drought" }), quiet({ ability: "primordial-sea" })], [quiet({ ability: "drizzle" })], 1, 100);
  assert.deepStrictEqual([startOf(r2).roulette!.weather!.kind, startOf(r2).roulette!.weather!.fixed], ["heavy-rain", true]);
  assert.strictEqual(run([quiet()], [quiet()], 1, 100).events[0]!.kind === "start" && startOf(run([quiet()], [quiet()], 1, 100)).roulette, undefined, "특성이 없으면 roulette 칸 없음");

  // 쾌청 — 불꽃 ×1.5, 물 ×0.5. 같은 시드에서 날씨만 바꿔 견준다
  const pos = { positions: [[at(6, 4), at(0, 8)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const firstHit = (move: EngineMove, setter: string | null) =>
    of(run([unit({ types: ["normal"], stats: [999, 1, 999, 100, 999, 95], moves: [move] }), quiet({ ability: setter })], [quiet({ ability: "battle-armor", stats: [999, 1, 999, 1, 100, 95] })], 5, 1100, pos).events, "damage").find((e) => e.source === move.id)!.amount;
  const flame = mv("flame", { type: "fire", class: "special", power: 90, cooldownMs: 1000 });
  const surf = mv("surf", { type: "water", class: "special", power: 90, cooldownMs: 1000 });
  // 급소를 막고(전투무장) 피해 폭 0.85~1 을 넣어 범위로 본다
  const f0 = firstHit(flame, null), fSun = firstHit(flame, "drought"), wSun = firstHit(surf, "drought");
  assert.ok(fSun / f0 > 1.25 && fSun / f0 < 1.8, `쾌청 불꽃 ${f0}→${fSun}`);
  assert.ok(wSun / f0 > 0.4 && wSun / f0 < 0.6, `쾌청 물 ${f0}→${wSun}`);
  // 끝의대지 — 물 기술은 실패(피해 0)
  assert.strictEqual(firstHit(surf, "desolate-land"), 0, "끝의대지에서 물 실패");

  // 모래바람 — 5초마다 바위·땅·강철이 아니면 1/16
  const r3 = run([quiet({ ability: "sand-stream", types: ["rock"] }), quiet()], [quiet()], 1, 10_000, { positions: [[at(0, 0), at(0, 8)], [at(14, 0)]], obstacles: [0, 2, 4, 6, 8].map((y) => ({ x: 6, y, size: 2 as const })) });
  const sand = of(r3.events, "weather").filter((e) => e.cause === "sand");
  assert.deepStrictEqual([...new Set(sand.map((e) => e.t))], [5000, 10000]);
  assert.ok(!sand.some((e) => e.side === 0 && e.slot === 0), "바위는 모래바람 피해 없음");
  assert.strictEqual(sand[0]!.amount, Math.floor((999 * 3) / 16));

  // 사이코필드 — 땅에 있는 상대에게 선공기는 빗나감
  const quick = mv("quick", { power: 40, priority: 1, cooldownMs: 1000 });
  const r4 = run([unit({ moves: [quick] }), quiet({ ability: "psychic-surge" })], [quiet()], 1, 1100, pos);
  assert.ok(of(r4.events, "miss").some((e) => e.move === "quick"), "사이코필드 선공기 실패");
  assert.ok(!of(r4.events, "damage").some((e) => e.source === "quick"));
}

// ── 특성 묶음 — 무효·능력치·맞을 때·쓰러뜨릴 때·5초 턴·판 시작·틀깨기·화학변화가스 ──
{
  const wall = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const hitWith = (move: EngineMove, me: Partial<EngineFighter>, foe: Partial<EngineFighter>, ms = 1100, seed = 5) =>
    run([unit({ stats: [999, 100, 999, 100, 999, 95], moves: [move], ...me })], [wall({ ability: "battle-armor", stats: [999, 1, 100, 1, 100, 95], ...foe })], seed, ms, pos);
  const dmgOf = (r: ReturnType<typeof run>, id: string) => of(r.events, "damage").filter((e) => e.source === id);
  const quake = mv("quake", { type: "ground", power: 100, cooldownMs: 1000 });

  // 부유는 땅 무효, 틀깨기는 무시
  assert.strictEqual(dmgOf(hitWith(quake, {}, { ability: "levitate" }), "quake")[0]!.amount, 0, "부유");
  assert.ok(dmgOf(hitWith(quake, { ability: "mold-breaker" }, { ability: "levitate" }), "quake")[0]!.amount > 0, "틀깨기는 부유 무시");
  // 저수 — 물 무효·HP 1/4 회복 (먼저 깎인 상태가 아니면 회복 이벤트 없음)
  const splash = mv("splash", { type: "water", class: "special", power: 80, cooldownMs: 1000 });
  assert.strictEqual(dmgOf(hitWith(splash, {}, { ability: "water-absorb" }), "splash")[0]!.mult, 0, "저수 무효");
  // 천하장사 — 공격 ×2. 같은 시드로 견준다
  const tackle = mv("tackle", { power: 80, cooldownMs: 1000 });
  const a0 = dmgOf(hitWith(tackle, {}, {}), "tackle")[0]!.amount, a1 = dmgOf(hitWith(tackle, { ability: "huge-power" }, {}), "tackle")[0]!.amount;
  assert.ok(a1 / a0 > 1.6 && a1 / a0 < 2.4, `천하장사 ${a0}→${a1}`);
  // 멀티스케일 — HP 가득일 때 받는 피해 ×0.5
  const m1 = dmgOf(hitWith(tackle, {}, { ability: "multiscale" }), "tackle")[0]!.amount;
  assert.ok(m1 / a0 > 0.4 && m1 / a0 < 0.6, `멀티스케일 ${a0}→${m1}`);
  // 배짱 — 노말로 고스트를 맞힌다
  assert.strictEqual(dmgOf(hitWith(tackle, {}, { types: ["ghost"] }), "tackle")[0]!.amount, 0);
  assert.ok(dmgOf(hitWith(tackle, { ability: "scrappy" }, { types: ["ghost"] }), "tackle")[0]!.amount > 0, "배짱");
  // 옹골참 — HP 가득이면 한 방에 쓰러지지 않는다
  const nuke = mv("nuke", { power: 250, cooldownMs: 1000 });
  const st = hitWith(nuke, { stats: [999, 999, 999, 1, 999, 95] }, { ability: "sturdy", stats: [10, 1, 10, 1, 10, 95] });
  assert.strictEqual(dmgOf(st, "nuke")[0]!.hp, 1, "옹골참");
  // 부자유친 — 한 번 맞는 기술이 두 번
  assert.strictEqual(dmgOf(hitWith(tackle, { ability: "parental-bond" }, {}), "tackle").length, 2);
  // 우격다짐 — 상대 하락 기술 ×1.3, 그 하락은 없음
  const crunch = mv("crunch2", { power: 80, cooldownMs: 1000, effects: { stats: [{ who: "target", stat: "def", change: -1, chance: 100 }] } });
  const sf = hitWith(crunch, { ability: "sheer-force" }, {});
  assert.ok(!of(sf.events, "stat").some((e) => e.side === 1 && e.stat === 2), "우격다짐은 능력 변화 없음");
  // 청개구리 — 능력 변화 반대, 클리어바디 — 상대가 건 하락 막음
  assert.ok(of(hitWith(crunch, {}, { ability: "contrary" }).events, "stat").some((e) => e.side === 1 && e.stat === 2 && e.stage === 1), "청개구리");
  assert.ok(!of(hitWith(crunch, {}, { ability: "clear-body" }).events, "stat").some((e) => e.side === 1), "클리어바디");
  // 오기 — 상대가 내리면 공격 +2
  assert.ok(of(hitWith(crunch, {}, { ability: "defiant" }).events, "stat").some((e) => e.side === 1 && e.stat === 1 && e.stage === 2), "오기");
  // 까칠한피부 — 접촉 기술에 맞으면 쓴 쪽이 1/8
  const claw = mv("claw", { power: 40, cooldownMs: 1000, traits: ["contact"] });
  assert.ok(of(hitWith(claw, {}, { ability: "rough-skin" }).events, "reflect").some((e) => e.side === 1 && e.amount === Math.floor((999 * 3) / 8)), "까칠한피부");
  // 자기과신 — 쓰러뜨리면 공격 +1
  const kill = hitWith(nuke, { ability: "moxie", stats: [999, 999, 999, 1, 999, 95] }, { stats: [10, 1, 10, 1, 10, 95] });
  assert.ok(of(kill.events, "stat").some((e) => e.side === 0 && e.stat === 1 && e.stage === 1), "자기과신");
  // 재생력 — HP 50% 아래가 처음 되면 1/3 회복
  const half = mv("half", { power: 120, cooldownMs: 1000 });
  const rg = hitWith(half, { stats: [999, 200, 999, 1, 999, 95] }, { ability: "regenerator", stats: [200, 1, 60, 1, 60, 95] }, 5000);
  assert.ok(of(rg.events, "self").some((e) => e.side === 1 && e.amount < 0), "재생력");
  // 가속 — 5초마다 스피드 +1
  const sb = run([wall({ ability: "speed-boost" })], [wall()], 1, 10_000, { obstacles: [0, 2, 4, 6, 8].map((y) => ({ x: 6, y, size: 2 as const })) });
  assert.deepStrictEqual(of(sb.events, "stat").filter((e) => e.side === 0 && e.stat === 5).map((e) => [e.t, e.stage]), [[5000, 1], [10000, 2]]);
  // 불요의검 — 판 시작에 공격 +1, 판 끝까지
  const is = run([wall({ ability: "intrepid-sword" })], [wall()], 1, 100);
  assert.ok(of(is.events, "stat").some((e) => e.t === 0 && e.side === 0 && e.stat === 1 && e.stage === 1), "불요의검");
  // 화학변화가스 — 위협이 걸리지 않는다
  const gas = run([wall({ ability: "intimidate" })], [wall({ ability: "neutralizing-gas" })], 1, 100);
  assert.strictEqual(of(gas.events, "stat").length, 0, "화학변화가스");
  // 일루전 — 다른 대상이 있으면 고르지 않는다
  const me = unit({ stats: [999, 1, 999, 1, 999, 95] });
  const il = run([me], [wall({ ability: "illusion" }), wall()], 1, 4000, { positions: [[at(2, 4)], [at(8, 4), at(12, 4)]] } as unknown as Partial<BattleInput>);
  assert.strictEqual(of(il.events, "damage").find((e) => e.side === 0)?.target, 1, "일루전은 대상에서 빠진다");
}

// ── 특성 다섯 — 바람타기·풍력발전·달마모드·꼬르륵스위치·그대로꿀꺽미사일 ──
{
  const wall = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const gust = mv("gust", { type: "flying", class: "special", power: 40, cooldownMs: 1000, traits: ["wind"] });
  // 바람타기 — 바람 기술 무효, 공격 +1
  const wr = run([unit({ moves: [gust] })], [wall({ ability: "wind-rider" })], 1, 1100, pos);
  assert.strictEqual(of(wr.events, "damage").find((e) => e.source === "gust")!.mult, 0, "바람타기 무효");
  assert.ok(of(wr.events, "stat").some((e) => e.side === 1 && e.stat === 1 && e.stage === 1), "바람타기 공격 +1");
  // 달마모드 — HP 50% 이하면 얼음·불꽃 모습
  const zen = buildFighter({ species: "darmanitan-galar-standard" })!;
  assert.deepStrictEqual(zen.altForm?.types, ["ice", "fire"]);
  const hard = mv("hard", { power: 150, cooldownMs: 1000 });
  const zr = run([unit({ stats: [999, 300, 999, 1, 999, 95], moves: [hard] })], [zen], 1, 6000, pos);
  assert.ok(of(zr.events, "form").some((e) => e.side === 1 && e.species === "darmanitan-galar-zen"), "달마모드");
  // 꼬르륵스위치 — 5초 뒤 배고픈 모양이면 오라휠이 악
  const wheel = mv("aura-wheel", { type: "electric", power: 110, cooldownMs: 5500 });
  const mp = run([unit({ ability: "hunger-switch", moves: [wheel] })], [wall({ ability: "battle-armor", types: ["psychic"] })], 1, 6000, pos);
  assert.strictEqual(of(mp.events, "damage").find((e) => e.source === "aura-wheel")!.mult, 2, "배고픈 오라휠은 악 — 에스퍼에 2배");
  // 그대로꿀꺽미사일 — 파도타기 뒤 기술에 맞으면 때린 쪽이 1/4, 아리코면 방어 −1
  const surf = mv("surf", { type: "water", class: "special", power: 1, cooldownMs: 1000 });
  const poke = mv("poke", { power: 1, cooldownMs: 2000 });
  const gm = run([unit({ ability: "gulp-missile", stats: [999, 1, 999, 1, 999, 95], moves: [surf] })], [wall({ moves: [poke] })], 1, 2100, pos);
  const back = of(gm.events, "reflect").find((e) => e.side === 0);
  assert.strictEqual(back?.amount, Math.floor((999 * 3) / 4), "먹이를 뱉어 1/4");
  assert.ok(of(gm.events, "stat").some((e) => e.side === 1 && e.stat === 2 && e.stage === -1), "아리코면 방어 −1");
}

// ── 전장 — 장애물 뽑기 ──
{
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 300; i++) {
    const list = rollObstacles(rand);
    assert.ok(list.length === 0 || list.map((o) => o.size).sort().join() === "1,1,2", "1×1 둘과 2×2 하나");
    const cells = new Set<string>();
    for (const o of list) {
      assert.ok(o.size === 1 || o.size === 2);
      assert.ok(o.x >= ENGINE_RULES.obstacleX0 && o.x + o.size <= ENGINE_RULES.obstacleX1, "가운데 4열");
      assert.ok(o.y >= 0 && o.y + o.size <= ENGINE_RULES.fieldH);
      for (let dy = 0; dy < o.size; dy++) for (let dx = 0; dx < o.size; dx++) {
        const k = `${o.x + dx},${o.y + dy}`;
        assert.ok(!cells.has(k), "장애물끼리 겹치지 않는다");
        cells.add(k);
      }
    }
  }
}

// ── 90초 판정 — 남은 HP 비율 합 ──
{
  const wall = (atk: number) => unit({ stats: [999, atk, 999, 1, 999, 1] });
  const r = run([wall(1), wall(1)], [wall(1), wall(999)], 1);
  assert.strictEqual(r.timeout, true);
  assert.strictEqual(r.endMs, ENGINE_RULES.maxMs);
  assert.strictEqual(r.winner, 1, "남은 HP 비율 합이 큰 쪽이 이긴다");
  // 서로 닿지 못하면 둘 다 가득 — 비율 합이 같아 무승부
  const block = [0, 2, 4, 6, 8].map((y) => ({ x: 6, y, size: 2 as const }));
  assert.strictEqual(run([wall(1)], [wall(1)], 1, undefined, { obstacles: block }).winner, null, "비율 합이 같으면 무승부");
}

// ── 같은 틱에 둘 다 쓰러지면 무승부 ──
{
  // 앞 행동으로 쓰러지면 그 틱의 남은 행동은 없다 — 동시 쓰러짐은 반동 같은 자기 피해로만 생긴다
  const kamikaze = unit({ stats: [1, 200, 1, 1, 1, 1], moves: [mv("brave", { power: 100, cooldownMs: 1000, effects: { recoil: 100 } })] });
  const r = run([kamikaze], [unit({ stats: [1, 1, 1, 1, 1, 1] })], 7);
  assert.strictEqual(r.winner, null);
  assert.strictEqual(r.timeout, false);
}

// ── 게으름 — 한 번 쓴 뒤 쿨타임 2배 ──
{
  const a = [unit({ ability: "truant", stats: [999, 1, 999, 1, 999, 95], moves: [mv("a", { power: 1 }), mv("b", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 20_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [4000, 12000]);
}

// ── 슬로스타트 — 첫 기술 5배 ──
{
  const a = [unit({ ability: "slow-start", stats: [999, 1, 999, 1, 999, 95], moves: [mv("a", { power: 1 }), mv("b", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 30_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [20000, 24000]);
}

// ── 실제 종 ──
{
  const garchomp = buildFighter({ species: "garchomp" });
  assert.ok(garchomp);
  assert.strictEqual(garchomp.level, 50);
  assert.deepStrictEqual(garchomp.types, ["dragon", "ground"]);
  assert.strictEqual(garchomp.moves.length, 2);
  const swapped = buildFighter({ species: "garchomp", moveSwap: true })!;
  assert.deepStrictEqual(swapped.moves.map((m) => m.id), [...garchomp.moves.map((m) => m.id)].reverse(), "기술 순서 바꾸기");

  const mega = petFighter({ species: "garchomp", level: 60 }, "garchomp-mega")!;
  assert.strictEqual(mega.species, "garchomp-mega");
  assert.ok(mega.stats[1]! > garchomp.stats[1]!, "메가 모습 능력치");

  const aegislash = buildFighter({ species: "aegislash" })!;
  assert.strictEqual(aegislash.special, "stance");
  assert.ok(aegislash.altForm && aegislash.altForm.stats[1]! > aegislash.stats[1]!, "블레이드폼 공격이 높다");
  const r = run([aegislash], [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 15_000);
  const forms = of(r.events, "form").map((e) => e.species);
  assert.ok(forms.includes("aegislash-blade") && forms.includes("aegislash"), "킬가르도 폼이 바뀐다");
  const moveTimes = of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t);
  assert.deepStrictEqual(moveTimes.slice(0, 3), [6000, 9000, 12000], "킬가르도는 3초 어긋나게 번갈아");

  const wishiwashi = buildFighter({ species: "wishiwashi", level: 60 })!;
  assert.strictEqual(wishiwashi.schoolingReady, true);
  assert.strictEqual(buildFighter({ species: "wishiwashi", level: 59 })!.schoolingReady, false);

  // 메타몽 — 같은 칸 상대를 따라 하고, 칸이 비면 평타만
  const ditto = buildFighter({ species: "ditto" })!;
  const copy = run([ditto], [garchomp], 1, 100);
  assert.deepStrictEqual(of(copy.events, "copy")[0]?.moves, garchomp.moves.map((m) => m.id));
  const stop = run([null, ditto], [garchomp], 1, 100);
  assert.strictEqual(of(stop.events, "copy").length, 0, "같은 칸이 비면 기능 정지");

  // 루브도 — 상대 기술 칸에서 둘
  const smeargle = buildFighter({ species: "smeargle" })!;
  const sk = of(run([smeargle], [garchomp, aegislash], 3, 100).events, "copy")[0];
  assert.strictEqual(sk?.moves.length, 2);
  const pool = [...garchomp.moves, ...aegislash.moves].map((m) => m.id);
  assert.ok(sk.moves.every((id) => pool.includes(id)));

  // 병풍 — 기술 없이 평타만
  const magikarp = buildFighter({ species: "magikarp" })!;
  assert.strictEqual(magikarp.special, "wall");
  assert.strictEqual(magikarp.moves.length, 0);
}

// ── 재생 — 몸이 장애물·다른 개체와 겹치지 않고, 한 걸음은 8방향 1칸 ──
{
  const roster = ["garchomp", "snorlax", "gengar", "scizor", "alakazam", "dragonite", "blissey", "lucario"].map((sp) => buildFighter({ species: sp })!);
  const B = ENGINE_RULES.body;
  const overlap = (a: Pos, as: number, b: Pos, bs: number) => a.x < b.x + bs && b.x < a.x + as && a.y < b.y + bs && b.y < a.y + as;
  for (let seed = 1; seed <= 60; seed++) {
    const team = (k: number) => Array.from({ length: 6 }, (_, i) => roster[(i * 3 + k + seed) % roster.length]!);
    const r = runBattle({ seed, sides: [team(0), team(5)], typeChart: chart });
    const start = of(r.events, "start")[0]!;
    const pos = start.pos.map((row) => row.map((p) => (p ? { ...p } : null)));
    const alive = pos.map((row) => row.map((p) => p !== null));
    for (const e of r.events) {
      if (e.kind === "faint") alive[e.side]![e.slot] = false;
      if (e.kind !== "step") continue;
      const before = pos[e.side]![e.slot]!;
      assert.strictEqual(Math.max(Math.abs(e.x - before.x), Math.abs(e.y - before.y)), 1, "한 걸음은 1칸");
      const now = { x: e.x, y: e.y };
      for (const o of start.obstacles) assert.ok(!overlap(now, B, o, o.size), `seed ${seed}: 장애물에 들어갔다`);
      for (const side of [0, 1] as const)
        pos[side]!.forEach((p, slot) => {
          if (!p || !alive[side]![slot] || (side === e.side && slot === e.slot)) return;
          assert.ok(!overlap(now, B, p, B), `seed ${seed}: 몸이 겹친다`);
        });
      pos[e.side]![e.slot] = now;
    }
  }
}

process.stdout.write("배틀 엔진 자체 확인 통과\n");
