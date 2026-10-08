// 배틀 창 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-battle-screen.js
//
// 테스트 프레임워크 없이 assert 만. 화면 규칙은 docs/specs/ui-components.md "배틀 창으로 더한 것"
// 엔진 판(실제 종) → 화면 모델(src/view/battle-screen.ts) → 재생 계산(src/shared/battle-timeline.ts)을 본다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { clockText, createTimeline, popKindOf, rowOf, spriteFrame } from "../../shared/battle-timeline";
import type { LookSheets, SpriteSheet } from "../../shared/model/stage";
import { battleScreenArtKeys, battleScreenModel, withBattleScreenArt } from "../../view/battle-screen";

const f = (species: string): EngineFighter => {
  const out = buildFighter({ species });
  assert.ok(out, `${species} 전투 개체`);
  return out;
};
const mine = [f("pikachu"), f("charizard"), f("garchomp"), f("lucario"), f("gengar"), f("gyarados")];
const opp = [f("dragonite"), f("metagross"), f("sylveon"), f("tyranitar"), f("snorlax"), f("umbreon")];
const sides = [mine, opp] as const;
const result = runBattle({ seed: 7, sides, typeChart: battleTypeChart() });
const view = battleScreenModel({ sides, result, opponentName: "상대 · 2번 파티", reward: { lead: "+50P", detail: "다음 랜덤 배틀은 5분 뒤에 할 수 있어요." } });

// ── 화면 모델 ──
assert.strictEqual(view.title, "랜덤 배틀");
assert.deepStrictEqual(view.sideNames, ["나", "상대 · 2번 파티"]);
assert.strictEqual(view.units[0][0]?.name, "피카츄", "이름은 한국어");
assert.strictEqual(view.units[1][3]?.species, "tyranitar");
assert.strictEqual(view.units[0][0]?.maxHp, result.maxHp[0][0], "최대 HP 는 엔진의 전투 HP");
for (const side of view.units)
  for (const u of side) {
    assert.ok(u, "6칸 모두 찬 판");
    assert.strictEqual(u.moves.length, 2, `${u.species} 기술 2개`);
    for (const m of u.moves) assert.match(m.meta, /^(물리|특수|변화) · .*쿨타임 \d+(\.\d+)?초$/, `${m.name} 수치 글자: ${m.meta}`);
  }
assert.strictEqual(view.units[0][0]?.moves[0]?.name, "볼트태클", "기술 이름은 표에서");
assert.strictEqual(view.events.length, result.events.length, "이벤트를 그대로 넘긴다");
assert.strictEqual(view.endMs, result.endMs);
assert.deepStrictEqual(view.field, { w: 16, h: 10, body: 2, stepMs: 300, stageMs: 10_000 });
assert.strictEqual(view.result.title, result.winner === null ? "비겼어요" : result.winner === 0 ? "이겼어요" : "졌어요");
assert.strictEqual(view.result.lead, "+50P");

// ── 그림 열쇠 ──
const keys = battleScreenArtKeys(view);
assert.ok(keys.includes("portrait:pikachu") && keys.includes("type:electric"), "초상·흰 타입 아이콘 열쇠");
const art = Object.fromEntries(keys.map((k) => [k, `data:${k}`]));
delete art["portrait:umbreon"];
const painted = withBattleScreenArt(view, art);
assert.strictEqual(painted.units[0][0]?.portrait, "data:portrait:pikachu");
assert.strictEqual(painted.units[1][5]?.portrait, null, "못 받은 그림은 null");
assert.strictEqual(painted.typeIcons.electric, "data:type:electric");

// ── 재생 계산 ──
const tl = createTimeline(view);
const s0 = tl.seek(0);
const start = view.events[0];
assert.ok(start && start.kind === "start", "첫 이벤트는 start");
assert.deepStrictEqual(tl.posOf(s0.units[0][0]!, 0), start.pos[0][0], "처음 자리");
assert.deepStrictEqual(s0.alive, [6, 6]);
assert.strictEqual(s0.units[1][2]?.hp, result.maxHp[1][2], "처음 HP 는 최대");

const end = tl.seek(view.endMs);
for (const side of [0, 1] as const)
  end.units[side].forEach((u, slot) => assert.strictEqual(u?.hp, result.hp[side][slot], `끝 HP ${side}:${slot}`));
const faints = view.events.filter((e) => e.kind === "faint");
assert.strictEqual(end.alive[0] + end.alive[1], 12 - faints.length, "살아 있는 수 = 12 − 기절");
assert.ok(end.ended, "끝 이벤트를 지났다");
for (const side of end.units) for (const u of side) if (u) { const g = tl.gauge(u, view.endMs); assert.ok(g >= 0 && g <= 1, "쿨타임 바는 0~1"); }

// 뒤로 가면 처음부터 다시 적용한다
const back = tl.seek(0);
assert.deepStrictEqual(back.alive, [6, 6], "뒤로 감기");

// 걷기 보간 — 첫 걸음의 중간은 출발과 도착 사이
const step = view.events.find((e) => e.kind === "step");
if (step && step.kind === "step") {
  const st = tl.seek(step.t);
  const u = st.units[step.side][step.slot]!;
  const mid = tl.posOf(u, step.t + view.field.stepMs / 2);
  assert.ok(Math.abs(mid.x - (u.from.x + u.to.x) / 2) < 1e-9 && Math.abs(mid.y - (u.from.y + u.to.y) / 2) < 1e-9, "걸음 중간");
  assert.deepStrictEqual(tl.posOf(u, step.t + view.field.stepMs), { x: step.x, y: step.y }, "걸음 끝");
}

// 기술을 쓰면 다음 차례가 바뀌고, 알약이 잠깐 뜬다
const move = view.events.find((e) => e.kind === "move");
assert.ok(move && move.kind === "move", "기술 사용이 있는 판");
const sm = tl.seek(move.t);
assert.strictEqual(sm.units[move.side][move.slot]?.turn, 1, "첫 기술 뒤 다음 차례는 2번");
assert.ok(tl.casts(move.t).some((c) => c.side === move.side && c.slot === move.slot), "기술 알약");
assert.ok(!tl.casts(move.t + 2000).some((c) => c.t === move.t && c.side === move.side && c.slot === move.slot), "알약은 잠깐");

// 피해 숫자 — 맞은 쪽에 뜬다
const dmg = view.events.find((e) => e.kind === "damage");
assert.ok(dmg && dmg.kind === "damage");
assert.ok(tl.pops(dmg.t).some((p) => p.side !== dmg.side && p.slot === dmg.target), "피해 숫자는 맞은 포켓몬 위");
assert.strictEqual(popKindOf(2, false), "super");
assert.strictEqual(popKindOf(0.5, false), "weak");
assert.strictEqual(popKindOf(1, true), "super", "급소는 크게");
assert.strictEqual(popKindOf(0, false), "miss", "효과 없음");
assert.strictEqual(popKindOf(1, false), "normal");

// ── 포켓몬 그림 — 방향과 동작 ──
assert.strictEqual(rowOf(1, 0), 2, "오른쪽");
assert.strictEqual(rowOf(0, 1), 0, "아래");
assert.strictEqual(rowOf(-1, 0), 6, "왼쪽");
assert.strictEqual(rowOf(0, -1), 4, "위");
assert.strictEqual(rowOf(1, 1), 1, "오른쪽 아래");
const fresh = createTimeline(view).seek(0); // 상태 객체는 seek 마다 고쳐 쓰므로 새 재생으로 본다
assert.strictEqual(fresh.units[0][0]?.facing, 2, "처음에 내 쪽은 오른쪽을 본다");
assert.strictEqual(fresh.units[1][0]?.facing, 6, "상대 쪽은 왼쪽");
const sheet = (n: number, ms: number): SpriteSheet => ({ fw: 32, fh: 32, rows: 8, frames: Array.from({ length: n }, (_, i) => ({ x: i, ms })), dataUrl: "data:x" });
const look: LookSheets = { look: "t", cell: { w: 64, h: 64 }, body: { w: 32, h: 32 }, anims: { Idle: sheet(2, 200), Walk: sheet(4, 100), Attack: sheet(3, 50), Hurt: sheet(2, 100), Faint: sheet(3, 100) }, clips: {} };
const base = { ...fresh.units[0][0]!, stepAt: -10_000, hitAt: -10_000, swing: null, fainted: false, facing: 2 };
assert.strictEqual(spriteFrame(look, base, 1000, 300)?.anim, "Idle", "서 있으면 Idle");
assert.strictEqual(spriteFrame(look, { ...base, stepAt: 950 }, 1000, 300)?.anim, "Walk", "걷는 중이면 Walk");
assert.strictEqual(spriteFrame(look, { ...base, swing: { at: 960, kind: "physical" } }, 1000, 300)?.anim, "Attack", "공격 동작");
assert.strictEqual(spriteFrame(look, { ...base, swing: { at: 960, kind: "special" } }, 1000, 300)?.anim, "Attack", "Shoot 이 없으면 다음 후보");
assert.strictEqual(spriteFrame(look, { ...base, swing: { at: 800, kind: "physical" } }, 1000, 300)?.anim, "Idle", "공격 동작이 끝나면 돌아온다");
assert.strictEqual(spriteFrame(look, { ...base, hitAt: 950 }, 1000, 300)?.anim, "Hurt", "맞으면 Hurt");
const faint = spriteFrame(look, { ...base, fainted: true, faintAt: 0 }, 5000, 300);
assert.strictEqual(faint?.anim, "Faint");
assert.strictEqual(faint?.col, 2, "기절은 마지막 프레임에서 멈춘다");
assert.strictEqual(spriteFrame(look, { ...base, facing: 6 }, 0, 300)?.row, 6, "방향 행");
assert.strictEqual(spriteFrame({ ...look, anims: { Idle: { ...sheet(1, 100), rows: 1 } } }, { ...base, facing: 6 }, 0, 300)?.row, 0, "방향이 한 줄뿐인 시트");

// ── 날씨·필드·오라 룰렛 ──
const rSides = [[f("pelipper"), f("pikachu")], [f("tyranitar"), f("tapu-lele")]] as const;
const rResult = runBattle({ seed: 3, sides: rSides, typeChart: battleTypeChart() });
const rView = battleScreenModel({ sides: rSides, result: rResult, opponentName: "상대", reward: { lead: "", detail: "" } });
assert.ok(rView.roulette, "룰렛을 준 판");
const [weather, field, aura] = rView.roulette!;
assert.deepStrictEqual([weather!.key, field!.key, aura!.key], ["weather", "field", "aura"], "릴 순서");
assert.deepStrictEqual([weather!.label, field!.label, aura!.label], ["날씨", "필드", "오라"]);
assert.strictEqual(weather!.candidates.length, 2, "날씨 후보 — 펠리퍼·마기라스");
assert.ok(weather!.picked && weather!.candidates.some((c) => c.side === weather!.picked!.side && c.slot === weather!.picked!.slot), "뽑힌 것은 후보 안");
assert.ok((weather!.name === "비" && weather!.type === "water") || (weather!.name === "모래바람" && weather!.type === "rock"), `날씨 이름·아이콘: ${weather!.name}`);
assert.strictEqual(field!.name, "사이코필드");
assert.strictEqual(field!.type, "psychic");
assert.strictEqual(field!.kind, "psychic", "엔진 kind — 전장 연출을 고른다");
assert.ok(weather!.kind === "rain" || weather!.kind === "sand", `날씨 kind: ${weather!.kind}`);
assert.deepStrictEqual(aura!.candidates, [], "오라 후보 없음");
assert.strictEqual(aura!.name, null);
assert.strictEqual(aura!.kind, null);
assert.ok(rView.typeIcons.psychic !== undefined, "룰렛 아이콘 타입도 열쇠에 든다");
assert.strictEqual(rView.units[0][0]?.ability, "잔비", "특성 이름");
const plain = battleScreenModel({ sides: [[f("pikachu")], [f("snorlax")]] as const, result: runBattle({ seed: 1, sides: [[f("pikachu")], [f("snorlax")]], typeChart: battleTypeChart() }), opponentName: "상대", reward: { lead: "", detail: "" } });
assert.strictEqual(plain.roulette, null, "후보가 하나도 없으면 룰렛 없이 시작");

// weather 이벤트 — HP 와 숫자
const wEvent = rView.events.find((e) => e.kind === "weather");
if (wEvent && wEvent.kind === "weather") {
  const wt = createTimeline(rView);
  assert.strictEqual(wt.seek(wEvent.t).units[wEvent.side][wEvent.slot]?.hp, wEvent.hp, "날씨 피해·회복 뒤 HP");
  assert.ok(wt.pops(wEvent.t).some((p) => p.side === wEvent.side && p.slot === wEvent.slot && p.text === (wEvent.amount < 0 ? `+${-wEvent.amount}` : `-${wEvent.amount}`)), "날씨 숫자");
}

// ── 남은 시간 ──
assert.strictEqual(clockText(90_000, 0), "1:30");
assert.strictEqual(clockText(90_000, 42_100), "0:48");
assert.strictEqual(clockText(90_000, 89_500), "0:01");
assert.strictEqual(clockText(90_000, 95_000), "0:00");

console.log("selftest-battle-screen 통과");
