// 해금 사슬 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-unlocks.js
//
// 지금 데이터로도 반드시 참이어야 하는 것만 막는다. 얻을 수 없는 종 목록(전설·환상 등)은 check-unlocks 가 알리기만 한다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { reach } from "../../dex/reach";
import { starters, unlockByRules, unlockRules } from "../../dex/unlocks";
import { begin } from "../../party/starter";
import { speciesPrice } from "../../shop/catalog";
import { empty } from "../../save/v3";
import { dexList } from "../../tx/lists";
import { evolve } from "../../dex/evolve";
import { newPet } from "../../party/create";
import { inRandomEgg } from "../../dex/obtain";
import { randomPool } from "../../egg/pool";

const r = reach();
const rules = unlockRules();
const dexSlugs = new Set(dexList(empty(0)).map((e) => e.slug));

// (1) 첫 선택 후보는 모두 얻을 수 있다 — 첫 실행 선택과 랜덤알
for (const s of starters(rules)) assert.ok(r.obtainable.has(s), `첫 선택 후보 ${s}`);
process.stdout.write(`(1) 첫 선택 후보 ${starters(rules).length}종 도달  ok\n`);

// (2) 진화 규칙의 출발 종과 대상 종은 도감에 있는 종이다 — 오타·옛 이름이 사슬을 끊지 않게
for (const [slug, rule] of Object.entries(rules)) {
  if (slug.startsWith("_")) continue;
  assert.ok(dexSlugs.has(slug) || slug.includes("-"), `규칙의 종 ${slug}`);
  if (rule.evolve) assert.ok(dexSlugs.has(rule.evolve.from) || rule.evolve.from.includes("-"), `${slug} 의 출발 종 ${rule.evolve.from}`);
}
process.stdout.write("(2) 규칙의 종 이름  ok\n");

// (3) 첫 선택 후보에서 이어지는 진화 사슬은 끝까지 얻을 수 있다 (파이리 → 리자드 → 리자몽)
for (const s of ["charmander", "charmeleon", "charizard", "pikachu", "raichu", "eevee", "umbreon"]) assert.ok(r.obtainable.has(s), s);
process.stdout.write("(3) 첫 선택 후보의 진화 사슬  ok\n");

// (4) 첫 선택 직후 — 다른 후보와 기본형이 해금되고, 진화·조건·전설 종은 아직이다 (2026-09-25 사용자 결정 "처음부터 해금")
const save = empty(0);
assert.ok(begin(save, "charmander", 0, () => 0.5).ok);
const fresh = unlockByRules(save, 0);
for (const s of ["bulbasaur", "pichu", "rattata", "munchlax"]) assert.ok(save.dex.unlocked.includes(s), `해금 ${s}`);
for (const s of ["pikachu", "charmeleon", "snorlax", "ditto", "lapras", "chansey", "mewtwo"]) assert.ok(!save.dex.unlocked.includes(s), `아직 ${s}`);
assert.ok(fresh.length > 400 && !fresh.includes("charmander"), "고른 종은 이미 해금돼 있어 새 목록에 없다");
assert.deepStrictEqual(unlockByRules(save, 0), [], "두 번 불러도 더하지 않는다");
process.stdout.write(`(4) 첫 선택 직후 해금 ${save.dex.unlocked.length}종  ok\n`);

// (5) 랜덤알 후보 — 진화형(잠만보)·진화 전용 종·화석·울트라비스트는 빠진다
// 울트라비스트는 규칙이 없어 해금되지 않는다. 옛 규칙으로 이미 해금된 저장이어도 후보에서 빠진다
// 화석·패러독스는 알에서 나와야 해금된다 (2026-09-27 사용자 결정)
for (const s of ["nihilego", "omanyte", "aerodactyl", "great-tusk", "iron-crown"]) assert.ok(!save.dex.unlocked.includes(s), `미해금 ${s}`);
const pool = randomPool({ ...save, dex: { ...save.dex, unlocked: [...save.dex.unlocked, "nihilego", "poipole"] } });
assert.ok(pool.includes("rattata") && !pool.includes("snorlax") && !pool.includes("charmeleon"));
for (const s of ["omanyte", "kabuto", "aerodactyl", "nihilego", "poipole"]) assert.ok(!pool.includes(s), `후보 밖 ${s}`);
process.stdout.write(`(5) 랜덤알 후보 ${pool.length}종  ok\n`);

// (5b) 해금 정리 — 옛 저장(판 0)에서 규칙 없고 얻지 않은 종만 한 번 지운다. 얻은 종은 남는다
const old = empty(0);
old.dex.rulesRev = 0;
old.dex.unlocked = ["pikachu", "omanyte", "kabuto", "great-tusk", "mewtwo"];
old.dex.obtained = ["pikachu", "kabuto"];
unlockByRules(old, 0);
for (const s of ["omanyte", "great-tusk", "mewtwo"]) assert.ok(!old.dex.unlocked.includes(s), `정리 ${s}`);
for (const s of ["pikachu", "kabuto"]) assert.ok(old.dex.unlocked.includes(s), `남김 ${s}`);
assert.ok(old.dex.rulesRev >= 1);
old.dex.unlocked.push("omanyte"); // 정리를 마친 뒤 부화로 해금한 종은 다시 지우지 않는다
unlockByRules(old, 0);
assert.ok(old.dex.unlocked.includes("omanyte"), "정리는 한 번만");
process.stdout.write("(5b) 옛 저장 해금 정리  ok\n");

// (6) 옛 조건 규칙은 없다 (2026-09-29 사용자 결정) — 메타몽·라프라스는 업적 보상, 럭키는 핑복 진화
//     파티 3마리 · 작업 100시간 · 연속 14일을 채워도 규칙으로는 해금되지 않는다
save.party.slots.forEach((slot, i) => {
  if (i < 3) Object.assign(slot, { state: "pokemon", petId: `p${i}` });
});
save.totals.workMs = 100 * 3600_000;
save.daily.streak = 14;
const later = unlockByRules(save, 0);
for (const s of ["ditto", "lapras", "chansey"]) assert.ok(!later.includes(s), `규칙으로 해금하지 않는다 ${s}`);
assert.equal(rules.ditto, undefined);
assert.equal(rules.lapras, undefined);
assert.deepStrictEqual(rules.chansey, { evolve: { from: "happiny", affinity: 500, when: "day" } });
assert.ok(r.obtainable.has("chansey") && pool.includes("happiny"), "핑복은 랜덤알, 럭키는 진화");
// 업적 보상 종은 랜덤알·상점에서 빠진다 — 옛 규칙으로 해금된 저장이어도 (Claude 판단: 업적 전용)
for (const s of ["ditto", "lapras"]) {
  assert.equal(inRandomEgg(s), false, `랜덤알 밖 ${s}`);
  assert.equal(speciesPrice(s), null, `상점 밖 ${s}`);
}
assert.ok(r.obtainable.has("ditto") && r.obtainable.has("lapras"), "업적 보상으로 얻는다");
const oldPool = randomPool({ ...save, dex: { ...save.dex, unlocked: [...save.dex.unlocked, "ditto", "lapras"] } });
assert.ok(!oldPool.includes("ditto") && !oldPool.includes("lapras"), "옛 해금이 남아도 랜덤알 후보가 아니다");
process.stdout.write("(6) 옛 조건 규칙 없음 · 럭키 진화 · 메타몽·라프라스 알·상점 제외  ok\n");

// (7) 잠만보는 먹고자에서 진화해 얻는다 — 상점 전용 규칙은 없다 (2026-09-29 사용자 결정)
assert.deepStrictEqual(rules.snorlax, { evolve: { from: "munchlax", affinity: 500 } });
assert.ok(r.obtainable.has("snorlax") && pool.includes("munchlax") && !pool.includes("snorlax"), "먹고자는 랜덤알, 잠만보는 진화");
{
  const s = empty(0);
  s.dex.unlocked = ["munchlax"];
  const pet = newPet({ id: "m1", species: "munchlax", shiny: false, nature: "hardy", gender: "male", now: 0 });
  pet.affinity = 100;
  s.pets.push(pet);
  assert.ok(evolve(s, "m1", "day").ok, "친밀도로 진화");
  assert.equal(pet.species, "snorlax");
  assert.ok(s.dex.unlocked.includes("snorlax") && s.dex.obtained.includes("snorlax"), "진화하면 잠만보 해금·획득");
}
process.stdout.write("(7) 잠만보 · 먹고자 진화로 해금  ok\n");

// (8) 리전폼 (data/regional.json) — 진화 전 종은 다른 종처럼 처음부터 해금돼 랜덤알·상점 후보다. 진화 결과는 진화로만,
// 가라르 새 3종은 전설 규칙대로 랜덤준전설알에서만 얻는다 (2026-09-30 사용자 결정)
{
  for (const s of ["vulpix-alola", "meowth-galar", "tauros-paldea-aqua-breed", "stunfisk-galar"]) {
    assert.deepStrictEqual(rules[s], { base: true }, `기본형 규칙 ${s}`);
    assert.ok(save.dex.unlocked.includes(s), `첫 선택 직후 해금 ${s}`);
    assert.ok(inRandomEgg(s), `랜덤알 후보 ${s}`);
  }
  // 특수 폼 2종도 가라르 새처럼 규칙이 없고 랜덤준전설알에서만 얻는다 (2026-10-03 사용자 결정 "준전설알로.")
  for (const s of ["floette-eternal", "ursaluna-bloodmoon"]) {
    assert.equal(rules[s], undefined, `특수 폼은 규칙이 없다 ${s}`);
    assert.ok(r.obtainable.has(s), `얻을 수 있다 ${s}`);
  }
  for (const s of ["raichu-alola", "ninetales-alola", "articuno-galar", "floette-eternal", "ursaluna-bloodmoon"]) {
    assert.ok(!save.dex.unlocked.includes(s), `아직 ${s}`);
    assert.ok(!inRandomEgg(s), `랜덤알 후보 밖 ${s}`);
  }
  assert.deepStrictEqual(rules["raichu-alola"], { evolve: { from: "pikachu", affinity: 500 } }, "지도 진화 결과는 진화 규칙");
  assert.deepStrictEqual(rules["ninetales-alola"], { evolve: { from: "vulpix-alola", affinity: 500 } }, "리전폼 경로");
  assert.deepStrictEqual(rules["perrserker"], { evolve: { from: "meowth", affinity: 500 } }, "같은 결과면 기본형 출발 규칙");
  assert.equal(rules["articuno-galar"], undefined, "전설 리전폼은 규칙이 없다");
  for (const s of dexSlugs) if (s.includes("-alola") || s.includes("-galar") || s.includes("-hisui") || s.includes("-paldea")) assert.ok(r.obtainable.has(s), `얻을 수 있다 ${s}`);
}
process.stdout.write("(8) 리전폼 해금·랜덤알 후보  ok\n");

process.stdout.write(`selftest-unlocks: 통과 (첫 선택 후보·규칙 이름·진화 사슬·첫 선택 직후 해금·랜덤알 후보·해금 정리·옛 조건 규칙 없음·잠만보 진화·리전폼) — 참고: 얻을 수 있는 종 ${[...dexSlugs].filter((s) => r.obtainable.has(s)).length}/${dexSlugs.size}\n`);
