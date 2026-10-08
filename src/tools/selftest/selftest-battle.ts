// 배틀 엔진 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-battle.js
//
// 테스트 프레임워크 없이 assert 만. 계약은 docs/specs/moves.md "전투 규칙", docs/specs/adventure.md "배틀 엔진"
// 작은 판은 손으로 만든 전투 개체로, 실제 종은 buildFighter 로 본다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_RULES, rangeOfMoves, speedCooldownMul, runBattle, startPos, type BattleEvent, type BattleInput, type EngineFighter, type EngineMove, type Pos, type StatusKind } from "../../battle/engine";
import { battleTypeChart, buildFighter, petFighter } from "../../battle/fighter";
import { BATTLE_BASIS, BATTLE_LIMITS, partyOf } from "../../battle/fighter-core";
import { battleData } from "../../battle/fighter";
import { blockedSlots, canStartBattle } from "../../battle/party";
import { emptySave } from "../../save/normalize";
import type { SaveV3 } from "../../shared/save-v3";
import { testPet } from "../harness/fixtures";
import { BATTLE_RULES } from "../../battle/rules";
import { BATTLE_OUT, buildBattleFiles } from "../data/build-battle";

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
// 판에는 장애물이 없다. 벽(obstacles)은 개체를 떼어 놓는 자체 검사에만 쓴다
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
assert.deepStrictEqual(startPos(0, 0), at(0, 3), "세 줄은 세로 가운데");
assert.deepStrictEqual(startPos(0, 1), at(2, 3), "2번은 앞 열");
assert.deepStrictEqual(startPos(0, 5), at(2, 7));
assert.deepStrictEqual(startPos(1, 0), at(18, 3), "상대 1번은 오른쪽 끝");
assert.deepStrictEqual(startPos(1, 1), at(16, 3), "상대 2번도 앞 열");

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
  const wall = [0, 2, 4, 6, 8, 10].map((y) => ({ x: 6, y, size: 2 as const }));
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

  // 쾌청 — 불꽃 ×1.3, 물 ×0.5. 같은 시드에서 날씨만 바꿔 견준다
  const pos = { positions: [[at(6, 4), at(0, 8)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const firstHit = (move: EngineMove, setter: string | null) =>
    of(run([unit({ types: ["normal"], stats: [999, 1, 999, 100, 999, 95], moves: [move] }), quiet({ ability: setter })], [quiet({ ability: "battle-armor", stats: [999, 1, 999, 1, 100, 95] })], 5, 1100, pos).events, "damage").find((e) => e.source === move.id)!.amount;
  const flame = mv("flame", { type: "fire", class: "special", power: 90, cooldownMs: 1000 });
  const surf = mv("surf", { type: "water", class: "special", power: 90, cooldownMs: 1000 });
  // 급소를 막고(전투무장) 피해 폭 0.85~1 을 넣어 범위로 본다
  const f0 = firstHit(flame, null), fSun = firstHit(flame, "drought"), wSun = firstHit(surf, "drought");
  assert.ok(fSun / f0 > 1.15 && fSun / f0 < 1.5, `쾌청 불꽃 ${f0}→${fSun}`);
  assert.ok(wSun / f0 > 0.4 && wSun / f0 < 0.6, `쾌청 물 ${f0}→${wSun}`);
  // 끝의대지 — 물 기술은 실패(피해 0)
  assert.strictEqual(firstHit(surf, "desolate-land"), 0, "끝의대지에서 물 실패");

  // 모래바람 — 5초마다 바위·땅·강철이 아니면 1/16
  const r3 = run([quiet({ ability: "sand-stream", types: ["rock"] }), quiet()], [quiet()], 1, 10_000, { positions: [[at(0, 0), at(0, 8)], [at(14, 0)]], obstacles: [0, 2, 4, 6, 8, 10].map((y) => ({ x: 6, y, size: 2 as const })) });
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
  const sb = run([wall({ ability: "speed-boost" })], [wall()], 1, 10_000, { obstacles: [0, 2, 4, 6, 8, 10].map((y) => ({ x: 6, y, size: 2 as const })) });
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

// ── 상태 이상 — 걸림·면역·지속·5초 피해·얼음 멈춤·혼란·풀죽음·특성 ──
{
  const wall = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const sure = (kind: StatusKind | StatusKind[], extra: Partial<EngineMove> = {}) =>
    mv("sure", { power: 1, cooldownMs: 1000, effects: { status: { kind, chance: 100 } }, ...extra });
  const st = (r: ReturnType<typeof run>, side: 0 | 1) => of(r.events, "status").filter((e) => e.side === side);
  // 화상 — 걸리고 10초 뒤 풀린다. 5초마다 1/16
  const r1 = run([unit({ moves: [sure("burn")] })], [wall()], 1, 12_000, pos);
  const on = st(r1, 1).find((e) => e.status === "burn" && e.on)!;
  assert.strictEqual(on.until, on.t + 10_000);
  assert.ok(st(r1, 1).some((e) => e.status === "burn" && !e.on && e.t === on.until), "10초 뒤 풀림");
  assert.ok(of(r1.events, "status-hp").some((e) => e.cause === "burn" && e.amount === Math.floor((999 * 3) / 16)), "화상 1/16");
  // 타입 면역 — 불꽃은 화상에 걸리지 않는다
  assert.strictEqual(st(run([unit({ moves: [sure("burn")] })], [wall({ types: ["fire"] })], 1, 2000, pos), 1).length, 0);
  // 한 번에 하나 — 이미 화상이면 마비가 걸리지 않는다
  const r2 = run([unit({ moves: [sure("burn"), sure("paralysis")] })], [wall()], 1, 6000, pos);
  assert.ok(!st(r2, 1).some((e) => e.status === "paralysis"), "주된 상태 이상은 하나");
  // 얼음 — 3초 동안 평타·기술·이동이 없다
  const r3 = run([unit({ moves: [sure("freeze")] })], [wall({ stats: [999, 1, 999, 1, 999, 95], moves: [mv("x", { power: 1, cooldownMs: 1000 })] })], 1, 6000, pos);
  const fz = st(r3, 1).find((e) => e.status === "freeze" && e.on)!;
  assert.ok(!r3.events.some((e) => (e.kind === "attack" || e.kind === "move" || e.kind === "step") && "side" in e && e.side === 1 && e.t > fz.t && e.t < fz.until!), "얼음 동안 멈춤");
  // 풀죽음 — 다음 기술 쿨타임 +1초, 정신력은 받지 않는다
  const flinchMove = mv("bite2", { power: 1, cooldownMs: 1000, effects: { flinch: 100 } });
  const foeMove = mv("f", { power: 1, cooldownMs: 2000 });
  const fr = run([unit({ moves: [flinchMove] })], [wall({ moves: [foeMove] })], 1, 6000, pos);
  assert.ok(st(fr, 1).some((e) => e.status === "flinch" && e.on), "풀죽음");
  assert.strictEqual(st(run([unit({ moves: [flinchMove] })], [wall({ ability: "inner-focus", moves: [foeMove] })], 1, 3000, pos), 1).length, 0, "정신력");
  // 정전기 — 접촉 기술에 맞으면 30% 로 때린 상대를 마비(여러 판에서 한 번은)
  const touch = mv("touch", { power: 1, cooldownMs: 1000, traits: ["contact"] });
  const statics = [1, 2, 3, 4, 5, 6, 7, 8].filter((sd) => st(run([unit({ moves: [touch] })], [wall({ ability: "static" })], sd, 8000, pos), 0).some((e) => e.status === "paralysis"));
  assert.ok(statics.length > 0, "정전기");
  // 매직가드 — 상태 이상 피해 없음, 포이즌힐 — 독이면 회복
  assert.ok(!of(run([unit({ moves: [sure("poison")] })], [wall({ ability: "magic-guard" })], 1, 8000, pos).events, "status-hp").length, "매직가드");
  // 미스트필드 — 땅에 있는 포켓몬은 걸리지 않는다
  const misty = run([unit({ moves: [sure("burn")] }), wall({ ability: "misty-surge" })], [wall()], 1, 3000, { positions: [[at(6, 4), at(0, 8)], [at(8, 4)]] } as unknown as Partial<BattleInput>);
  assert.strictEqual(st(misty, 1).length, 0, "미스트필드");
  // 막음(status-blocked) — 확률을 통과한 뒤 막혔을 때만. 특성이 막으면 그 특성 ability 가 먼저
  const blockedOf = (r: ReturnType<typeof run>) => of(r.events, "status-blocked").filter((e) => e.side === 1);
  assert.deepStrictEqual(blockedOf(misty).map((e) => [e.status, e.cause]).slice(0, 1), [["burn", "misty"]], "미스트필드 막음");
  assert.deepStrictEqual(blockedOf(run([unit({ moves: [sure("burn")] })], [wall({ types: ["fire"] })], 1, 1100, pos)).map((e) => e.cause), ["type"], "타입 면역 막음");
  const limber = run([unit({ moves: [sure("paralysis")] })], [wall({ ability: "limber" })], 1, 1100, pos);
  const li = limber.events.findIndex((e) => e.kind === "ability" && e.ability === "limber");
  const lb = limber.events.findIndex((e) => e.kind === "status-blocked");
  assert.ok(li >= 0 && lb > li && blockedOf(limber)[0]!.cause === "ability", "특성 막음 — ability 다음 status-blocked");
  assert.strictEqual(blockedOf(r2).length, 0, "이미 다른 주된 상태 이상이면 막음이 아니다");
  assert.strictEqual(blockedOf(run([unit({ moves: [flinchMove] })], [wall({ ability: "inner-focus", moves: [foeMove] })], 1, 1100, pos))[0]!.status, "flinch", "정신력 막음");
  // 기분파 — 비면 물 타입
  const cast = run([wall({ ability: "forecast" }), wall({ ability: "drizzle" })], [wall({ moves: [mv("bolt", { type: "electric", class: "special", power: 40, cooldownMs: 1000 })] })], 1, 1100, { positions: [[at(6, 4), at(0, 8)], [at(8, 4)]] } as unknown as Partial<BattleInput>);
  assert.strictEqual(of(cast.events, "damage").find((e) => e.source === "bolt")!.mult, 2, "기분파 — 비에서 물 타입");
}

// ── 서버 복사본 — supabase/functions/_shared/battle 이 지금 엔진·코어·데이터와 같다 (npm run battle:build) ──
{
  const files = buildBattleFiles();
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(BATTLE_OUT, name);
    assert.ok(fs.existsSync(file) && fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") === text, `서버 복사본이 낡았다: ${name} — npm run battle:build`);
  }
  assert.deepStrictEqual({ ...BATTLE_BASIS }, { level: BATTLE_RULES.level, iv: BATTLE_RULES.iv, ev: BATTLE_RULES.ev }, "코어의 능력치 기준이 배틀 규칙과 같다");
}

// ── 서버의 배틀 파티 읽기(partyOf) — 앱의 출전 불가 판정과 같다 ──
{
  assert.deepStrictEqual({ ...BATTLE_LIMITS }, { ...BATTLE_RULES.limits }, "코어의 출전 제한이 배틀 규칙과 같다");
  const data = battleData();
  const T = Date.now();
  const make = (species: string[]): SaveV3 => {
    const s = emptySave(T);
    s.pets = species.map((sp, i) => testPet({ id: `p${i + 1}`, species: sp }, T));
    s.battle = { slots: Array.from({ length: 6 }, (_, i) => s.pets[i]?.id ?? null) };
    return s;
  };
  for (const team of [["garchomp", "lucario"], ["mewtwo", "lugia"], ["mewtwo", "celebi", "jirachi", "pikachu"], ["celebi", "jirachi", "mew"], []]) {
    const s = make(team);
    const read = partyOf(JSON.parse(JSON.stringify(s)), data);
    assert.strictEqual(read.blocked, blockedSlots(s).some((b) => b !== null), `출전 불가 판정이 같다: ${team.join(",")}`);
    assert.strictEqual(read.count > 0 && !read.blocked, canStartBattle(s), `배틀 시작 가능이 같다: ${team.join(",")}`);
  }
}

// ── 대상 주위가 막히면 지금 닿는 다른 상대로 바꾼다 (2026-10-09 사용자 "A+B로 진행해") ──
{
  // 상대 T(오른쪽 위 구석)는 내 쪽 셋에게 둘러싸여 빈 자리가 없다. 같은 걸음 수의 F 보다 같은 줄이라 처음 대상은 T
  const sturdy = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const r = run(
    [unit({ stats: [999, 100, 999, 1, 999, 95] }), sturdy(), sturdy(), sturdy()],
    [sturdy(), sturdy()],
    1,
    8000,
    { positions: [[at(0, 0), at(16, 0), at(16, 2), at(18, 2)], [at(18, 0), at(18, 10)]] } as unknown as Partial<BattleInput>,
  );
  assert.ok(of(r.events, "damage").some((e) => e.side === 0 && e.slot === 0 && e.target === 1), "막힌 대상 대신 F 를 때린다");
}

// ── 전장 — 장애물 없음(2026-10-09 사용자 "장애물 제거") ──
{
  const r = runBattle({ seed: 3, sides: [[unit()], [unit()]], typeChart: chart, maxMs: 100 });
  assert.deepStrictEqual(r.obstacles, [], "판에 장애물이 없다");
}

// ── 90초 판정 — 남은 HP 비율 합 ──
{
  const wall = (atk: number) => unit({ stats: [999, atk, 999, 1, 999, 1] });
  const r = run([wall(1), wall(1)], [wall(1), wall(999)], 1);
  assert.strictEqual(r.timeout, true);
  assert.strictEqual(r.endMs, ENGINE_RULES.maxMs);
  assert.strictEqual(r.winner, 1, "남은 HP 비율 합이 큰 쪽이 이긴다");
  // 서로 닿지 못하면 둘 다 가득 — 비율 합이 같아 무승부
  const block = [0, 2, 4, 6, 8, 10].map((y) => ({ x: 6, y, size: 2 as const }));
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

// ── 게으름 — 한 번 쓴 뒤 쿨타임 ×1.5 ──
{
  const a = [unit({ ability: "truant", stats: [999, 1, 999, 1, 999, 95], moves: [mv("a", { power: 1 }), mv("b", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 95] })], 1, 20_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [4000, 10000]);
}

// ── 특성 이벤트·능력 변화의 until·2026-10-09 값 (moves.md "특성", "엔진에서 정한 세부") ──
{
  const wall = (over: Partial<EngineFighter> = {}) => unit({ stats: [999, 1, 999, 1, 999, 95], ...over });
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] } as unknown as Partial<BattleInput>;
  const hitWith = (move: EngineMove, me: Partial<EngineFighter>, foe: Partial<EngineFighter>, ms = 1100) =>
    run([unit({ stats: [999, 100, 999, 100, 999, 95], moves: [move], ...me })], [wall({ ability: "battle-armor", stats: [200, 1, 100, 1, 100, 95], ...foe })], 5, ms, pos);
  const abil = (r: ReturnType<typeof run>, side: 0 | 1) => of(r.events, "ability").filter((e) => e.side === side).map((e) => e.ability);
  const idx = (r: ReturnType<typeof run>, pred: (e: BattleEvent) => boolean) => r.events.findIndex(pred);
  // 10초짜리 변화는 until = 건 시각 + 10초
  const crunch = mv("crunch3", { power: 1, cooldownMs: 1000, effects: { stats: [{ who: "target", stat: "def", change: -1, chance: 100 }] } });
  const down = of(hitWith(crunch, {}, {}).events, "stat").find((e) => e.side === 1)!;
  assert.strictEqual(down.until, down.t + ENGINE_RULES.stageMs, "stat until");
  // 오기 — ability 가 결과 stat 보다 먼저
  const df = hitWith(crunch, {}, { ability: "defiant" });
  assert.ok(idx(df, (e) => e.kind === "ability" && e.ability === "defiant") < idx(df, (e) => e.kind === "stat" && e.side === 1 && e.stat === 1), "오기 ability 먼저");
  assert.deepStrictEqual(abil(hitWith(crunch, {}, { ability: "clear-body" }), 1), ["clear-body"], "클리어바디 막음도 ability");
  // 판 끝까지 단계 — until 없음. 위협(10초)과 겹치면 10초 뒤 판 끝까지 단계만 until 없이 다시 낸다
  const sw = run([wall({ ability: "intimidate" })], [wall({ ability: "intrepid-sword" })], 1, 10_100);
  assert.deepStrictEqual(abil(sw, 0), ["intimidate"]);
  assert.deepStrictEqual(abil(sw, 1), ["intrepid-sword"]);
  const atk1 = of(sw.events, "stat").filter((e) => e.side === 1 && e.stat === 1).map((e) => [e.t, e.stage, e.until ?? null]);
  assert.deepStrictEqual(atk1, [[0, -1, 10_000], [0, 0, 10_000], [10_000, 1, null]], "위협 −1 + 불요의검 +1 → 10초 뒤 +1");
  assert.ok(!of(run([wall({ ability: "intrepid-sword" })], [wall()], 1, 100).events, "stat").some((e) => e.until !== undefined), "불요의검만이면 until 없음");
  // 깨어진갑옷 — 물리에 맞으면 방어 −1, 스피드 +2
  const wa = of(hitWith(mv("hit", { power: 1, cooldownMs: 1000 }), {}, { ability: "weak-armor" }).events, "stat").filter((e) => e.side === 1);
  assert.deepStrictEqual(wa.map((e) => [e.stat, e.stage]), [[2, -1], [5, 2]], "깨어진갑옷");
  // 재생력 — 최대 HP 의 1/4
  const rg = hitWith(mv("half", { power: 120, cooldownMs: 1000 }), { stats: [999, 200, 999, 1, 999, 95] }, { ability: "regenerator", stats: [200, 1, 60, 1, 60, 95] }, 5000);
  assert.ok(of(rg.events, "self").some((e) => e.side === 1 && e.amount === -Math.floor((200 * ENGINE_RULES.hpScale) / 4)), "재생력 1/4");
  assert.ok(abil(rg, 1).includes("regenerator"));
  // 변색 — 맞은 기술의 타입이 되고 받는 상성에만 쓴다. 같은 타입이면 다시 내지 않는다
  const ember = mv("ember2", { type: "fire", class: "special", power: 40, cooldownMs: 1000 });
  const cc = hitWith(ember, {}, { ability: "color-change" }, 2100);
  assert.deepStrictEqual(of(cc.events, "damage").filter((e) => e.source === "ember2").map((e) => e.mult), [1, 0.5], "변색 — 두 번째는 불꽃이 받는 상성");
  assert.deepStrictEqual(abil(cc, 1), ["color-change"]);
  // 변색은 자속을 바꾸지 않는다 — 불꽃에 맞아 바뀐 뒤에도 노말 기술 피해가 변색 없는 판과 같은 크기(자속을 잃으면 ×0.67)
  const ccHit = (ability: string | null) =>
    run([wall({ ability, stats: [999, 100, 999, 1, 999, 95], moves: [mv("tackle2", { power: 60, cooldownMs: 1000 })] })], [unit({ ability: "battle-armor", stats: [999, 1, 100, 100, 999, 95], moves: [mv("ember3", { type: "fire", class: "special", power: 1, cooldownMs: 500 })] })], 5, 1100, pos);
  const tk = (r: ReturnType<typeof run>) => of(r.events, "damage").find((e) => e.source === "tackle2")!.amount;
  const withCc = ccHit("color-change");
  assert.ok(abil(withCc, 0).includes("color-change") && tk(withCc) / tk(ccHit(null)) > 0.8, `변색 뒤에도 노말 자속 ${tk(ccHit(null))}→${tk(withCc)}`);
  // 협연 — 자기 쪽 아군의 능력이 처음 오르면 그 변화를 복사, 판에 한 번
  const swords = mv("sd", { power: 1, cooldownMs: 1000, effects: { stats: [{ who: "self", stat: "atk", change: 2, chance: 100 }] } });
  const co = run([unit({ stats: [999, 100, 999, 100, 999, 95], moves: [swords] }), wall({ ability: "costar" })], [wall()], 1, 3100, { positions: [[at(6, 4), at(0, 8)], [at(8, 4)]] } as unknown as Partial<BattleInput>);
  const copied = of(co.events, "stat").filter((e) => e.side === 0 && e.slot === 1);
  assert.deepStrictEqual(copied.map((e) => [e.t, e.stat, e.stage]), [[1000, 1, 2]], "협연 — 처음 한 번만 +2 복사");
  assert.deepStrictEqual(abil(co, 0), ["costar"]);
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
