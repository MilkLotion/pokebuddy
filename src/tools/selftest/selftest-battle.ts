// 배틀 엔진 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-battle.js
//
// 테스트 프레임워크 없이 assert 만. 계약은 docs/specs/moves.md "전투 규칙", docs/specs/adventure.md "배틀 엔진"
// 작은 판은 손으로 만든 전투 개체로, 실제 종은 buildFighter 로 본다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_RULES, basicIntervalMs, rollObstacles, runBattle, startPos, type BattleEvent, type BattleInput, type EngineFighter, type EngineMove, type Pos } from "../../battle/engine";
import { battleTypeChart, buildFighter, petFighter } from "../../battle/fighter";

const chart = battleTypeChart();
// 엔진 파일은 import 가 없어야 서버로 복사된다
const engineSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "battle", "engine.ts"), "utf8");
assert.ok(!/^\s*import\s/m.test(engineSrc), "engine.ts 에 import 가 없다");

const mv = (id: string, over: Partial<EngineMove> = {}): EngineMove => ({
  id, type: "normal", class: "physical", power: 50, accuracy: null, priority: 0, cooldownMs: 4000, hits: null, traits: [], effects: {}, ...over,
});
const unit = (over: Partial<EngineFighter> = {}): EngineFighter => ({
  species: "test", types: ["normal"], level: 50, stats: [100, 100, 100, 100, 100, 100], moves: [], ability: null, special: null, range: 1, ...over,
});
const of = <K extends BattleEvent["kind"]>(evs: BattleEvent[], kind: K): Extract<BattleEvent, { kind: K }>[] =>
  evs.filter((e): e is Extract<BattleEvent, { kind: K }> => e.kind === kind);
// 작은 판은 장애물 없이 돌린다 — 장애물은 아래 "전장" 에서 따로 본다
const run = (a: (EngineFighter | null)[], b: (EngineFighter | null)[], seed = 1, maxMs?: number, extra: Partial<BattleInput> = {}) =>
  runBattle({ seed, sides: [a, b], typeChart: chart, obstacles: [], ...(maxMs ? { maxMs } : {}), ...extra });
const at = (x: number, y: number): Pos => ({ x, y });

// ── 평타 간격 ──
assert.strictEqual(basicIntervalMs(25), 4000);
assert.strictEqual(basicIntervalMs(50), 3000);
assert.strictEqual(basicIntervalMs(100), 2000);
assert.strictEqual(basicIntervalMs(200), 1200);

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
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("one", { power: 1 }), mv("two", { power: 1, cooldownMs: 6000 })] })];
  const b = [unit({ stats: [999, 1, 999, 1, 999, 1] })];
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
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("solar", { power: 1, effects: { charge: true } }), mv("x", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 10_000);
  assert.deepStrictEqual(of(r.events, "charge").map((e) => e.t), [4000]);
  assert.strictEqual(of(r.events, "move").find((e) => e.side === 0)?.t, 8000);
}

// ── 반동으로 쉼 — 다음 기술 쿨타임 2배 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("hyper", { power: 1, effects: { recharge: true } }), mv("x", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 20_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [4000, 12000]);
}

// ── 난동 — 쓴 뒤 2초 동안 행동하지 않는다 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("outrage", { power: 1, effects: { rampage: true } }), mv("x", { power: 1, cooldownMs: 1000 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 10_000);
  const t = of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t);
  assert.deepStrictEqual(t.slice(0, 2), [4000, 6000], "1초 쿨타임 기술도 난동 2초 뒤");
  assert.ok(!of(r.events, "attack").some((e) => e.side === 0 && e.t > 4000 && e.t < 6000), "난동 중 평타 없음");
}

// ── 연속기 — 쓰러지면 남은 타는 가까운 상대에게 ──
{
  const a = [unit({ stats: [999, 300, 999, 1, 999, 1], moves: [mv("triple", { power: 60, hits: [3, 3], cooldownMs: 1000 })] })];
  const weak = unit({ stats: [1, 1, 1, 1, 1, 1] });
  // 둘 다 사거리 안 — 같은 줄의 약한 상대를 먼저 노리고, 쓰러지면 남은 타는 사거리 안의 다른 상대
  const positions = [[at(6, 4)], [at(9, 4), at(9, 6)]] as const;
  const r = run(a, [weak, unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 1500, { positions });
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
  const foe = unit({ stats: [999, 1, 999, 1, 999, 1] });
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
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("one", { power: 1, cooldownMs: 100 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 5000);
  const firstMove = of(r.events, "move").find((e) => e.side === 0)!;
  const lastStep = of(r.events, "step").filter((e) => e.side === 0 && e.t <= firstMove.t).pop()!;
  assert.ok(firstMove.t > 100 && firstMove.t >= lastStep.t, "걸어서 닿은 뒤에 쓴다");
  assert.ok(of(r.events, "step").every((e, i, list) => list.findIndex((x) => x.side === e.side && x.slot === e.slot && x.t === e.t) === i), "한 틱에 한 걸음");
}

// ── 사거리 — 특수공격이 공격보다 높으면 원거리(6), 아니면 근접(1). 원거리는 사거리 안에서 멈춰 쏜다 ──
{
  assert.strictEqual(buildFighter({ species: "alakazam" })!.range, ENGINE_RULES.rangedRange);
  assert.strictEqual(buildFighter({ species: "machamp" })!.range, ENGINE_RULES.meleeRange);
  assert.strictEqual(buildFighter({ species: "aegislash" })!.range, ENGINE_RULES.meleeRange, "같으면 근접");
  const shooter = unit({ range: 6, stats: [999, 1, 999, 1, 999, 100] });
  const still = unit({ stats: [999, 1, 999, 1, 999, 1] });
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

// ── 능력 변화 — 단계당 25%, 최대 ±3, 쌓임 ──
{
  // 위협 둘 — 상대 공격 −2
  const intim = unit({ ability: "intimidate", stats: [999, 1, 999, 1, 999, 1] });
  const r = run([intim, intim], [unit()], 1, 100);
  const st = of(r.events, "stat").filter((e) => e.side === 1 && e.stat === 1);
  assert.deepStrictEqual(st.map((e) => e.stage), [-1, -2], "위협은 상대 전체 공격 −1, 쌓인다");
  // 플라워베일 — 풀 아군은 상대가 건 하락을 막는다
  const veil = unit({ ability: "flower-veil", types: ["grass"], stats: [999, 1, 999, 1, 999, 1] });
  assert.strictEqual(of(run([intim], [veil], 1, 100).events, "stat").length, 0, "플라워베일");
  // 공격기 능력 변화 — 맞힌 뒤 target 은 맞은 첫 대상
  const drop = mv("crunch", { power: 1, cooldownMs: 1000, effects: { stats: [{ who: "target", stat: "def", change: -1, chance: 100 }, { who: "self", stat: "atk", change: 3, chance: 100 }] } });
  const r2 = run([unit({ moves: [drop], stats: [999, 1, 999, 1, 999, 1] })], [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 6000, { positions: [[at(6, 4)], [at(8, 4)]] });
  const s2 = of(r2.events, "stat");
  assert.ok(s2.some((e) => e.side === 1 && e.stat === 2 && e.stage === -1), "상대 방어 −1");
  assert.ok(s2.some((e) => e.side === 0 && e.stat === 1 && e.stage === 3), "자기 공격 +3");
  assert.ok(!s2.some((e) => Math.abs(e.stage) > 3), "최대 ±3");
}

// ── 프레셔 — 상대 기술 쿨타임 +10%, 평타는 그대로 ──
{
  const a = [unit({ stats: [999, 1, 999, 1, 999, 1], moves: [mv("a", { power: 1 })] })];
  const pos = { positions: [[at(6, 4)], [at(8, 4)]] as Pos[][] } as unknown as Partial<BattleInput>;
  const plain = of(run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 6000, pos).events, "move").find((e) => e.side === 0)!.t;
  const pressed = of(run(a, [unit({ ability: "pressure", stats: [999, 1, 999, 1, 999, 1] })], 1, 6000, pos).events, "move").find((e) => e.side === 0)!.t;
  assert.deepStrictEqual([plain, pressed], [4000, 4400]);
}

// ── 프렌드가드 — 자기 쪽 아군 전체가 받는 피해 ×0.75 ──
{
  const hitter = unit({ stats: [999, 200, 999, 1, 999, 100], moves: [mv("x", { power: 80, cooldownMs: 1000 })] });
  const target = unit({ stats: [999, 1, 100, 1, 100, 1] });
  const guard = unit({ ability: "friend-guard", stats: [999, 1, 999, 1, 999, 1] });
  const pos = (n: number) => ({ positions: [[at(6, 4)], [at(8, 4), ...(n ? [at(14, 8)] : [])]] as Pos[][] }) as unknown as Partial<BattleInput>;
  const dmg = (b: EngineFighter[], n: number) => of(run([hitter], b, 3, 1100, pos(n)).events, "damage").find((e) => e.source === "x")!.amount;
  const plain = dmg([target], 0), guarded = dmg([target, guard], 1);
  assert.ok(guarded < plain, `프렌드가드 ${plain} → ${guarded}`); // 난수 순서가 달라 정확히 0.75 배는 아니다
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
  const r = run([wall(1), wall(1)], [wall(1), wall(200)], 1);
  assert.strictEqual(r.timeout, true);
  assert.strictEqual(r.endMs, ENGINE_RULES.maxMs);
  assert.strictEqual(r.winner, 1, "남은 HP 비율 합이 큰 쪽이 이긴다");
  assert.strictEqual(run([wall(1)], [wall(1)], 1).winner, null, "비율 합이 같으면 무승부");
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
  const a = [unit({ ability: "truant", stats: [999, 1, 999, 1, 999, 1], moves: [mv("a", { power: 1 }), mv("b", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 20_000);
  assert.deepStrictEqual(of(r.events, "move").filter((e) => e.side === 0).map((e) => e.t).slice(0, 2), [4000, 12000]);
}

// ── 슬로스타트 — 첫 기술 5배 ──
{
  const a = [unit({ ability: "slow-start", stats: [999, 1, 999, 1, 999, 1], moves: [mv("a", { power: 1 }), mv("b", { power: 1 })] })];
  const r = run(a, [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 30_000);
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
  const r = run([aegislash], [unit({ stats: [999, 1, 999, 1, 999, 1] })], 1, 15_000);
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
