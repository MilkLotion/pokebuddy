// 모험(배틀 파티) 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-adventure.js
//
// 테스트 프레임워크 없이 assert 만. 계약은 docs/specs/adventure.md "배틀 파티", "출전 제한", "실제 능력치"
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { moveOptions, petMoves, speciesMoves } from "../../battle/moves";
import { applyBattleReward, battleMegaOf, battleSlots, battleSpeciesOf, blockedSlots, canStartBattle, dropMissingBattlePets, importPreset, isInBattle, setBattleSlot, setMoves } from "../../battle/party";
import { battleData } from "../../battle/fighter";
import { lookOfSource, partyOf } from "../../battle/fighter-core";
import { realStat, realStatsOf } from "../../battle/stats";
import { tierOf } from "../../battle/tier";
import { emptySave as empty, normalizeSave as normalize } from "../../save/normalize";
import { sellablePet } from "../../shop/sell-pet";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { createExecutor } from "../../tx/executor";
import { HANDLERS } from "../../tx/command-table";
import { snapshotView } from "../../view/snapshot";
import { moveMeta } from "../../view/battle";
import { testPet } from "../harness/fixtures";

const T0 = new Date(2026, 9, 8, 10, 0, 0).getTime();

// 개체를 박스 첫 칸부터 넣는다 — 배틀 파티는 개체를 옮기지 않으므로 자리는 아무 데나 된다
function seed(species: string[]): SaveV3 {
  const s = empty(T0);
  s.pets = species.map((sp, i) => testPet({ id: `p${i + 1}`, species: sp }, T0));
  s.pets.forEach((p, i) => (s.boxes[0]!.slots[i] = p.id));
  s.petSeq = s.pets.length;
  return s;
}

// ── 출전 제한의 칸 ──
const tiers: [string, string | null][] = [
  ["mewtwo", "legendary"],
  ["arceus", "legendary"], // 알 후보에 없어 따로 넣는다
  ["mew", "sub"], // 알 후보에 없는 업적 보상 — 준전설 칸
  ["giratina-origin", "legendary"], // 모습은 같은 도감 번호
  ["cosmog", "legendary"],
  ["cosmoem", "legendary"], // 진화 가족
  ["solgaleo", "legendary"],
  ["type-null", "sub"],
  ["silvally", "sub"],
  ["poipole", "sub"],
  ["naganadel", "sub"],
  ["meltan", "sub"],
  ["melmetal", "sub"],
  ["kubfu", "sub"],
  ["celebi", "sub"], // 환상
  ["nihilego", "sub"], // 울트라비스트
  ["great-tusk", "sub"], // 패러독스
  ["articuno-galar", "sub"],
  ["pikachu", null],
  ["dragonite", null],
];
for (const [slug, want] of tiers) assert.equal(tierOf(slug), want, `${slug} 의 칸`);

// ── 실제 능력치 (50레벨·6V·노력치 0·성격 보정 없음) ──
assert.deepEqual(realStatsOf("pikachu"), [110, 75, 60, 70, 70, 110], "피카츄");
assert.deepEqual(realStatsOf("mewtwo"), [181, 130, 110, 174, 110, 150], "뮤츠");
assert.equal(realStat(1, 0), 1, "HP 종족값 1(껍질몬)은 HP 1");
assert.equal(realStat(35, 0, { level: 100, iv: 31, ev: 252 }), 274, "탐험용 — 레벨·노력치를 받는다");

// ── 기술 ──
const volt = speciesMoves("pikachu");
assert.equal(volt.length, 2);
assert.equal(volt[0]!.name, "볼트태클");
assert.ok(volt[0]!.text && volt[0]!.text.includes("돌진"), "기술 설명");
assert.equal(moveMeta(volt[0]!), "물리 · 위력 120 · 명중 100 · 쿨타임 8초");
assert.equal(speciesMoves("kadabra")[0]!.class, "special", "객체 칸은 기본값을 덮는다");
assert.equal(speciesMoves("miraidon")[0]!.text, null, "설명 없는 기술은 null");

// ── 출전 불가 — 칸 순서가 뒤인 개체 ──
{
  const s = seed(["mewtwo", "celebi", "lugia", "nihilego", "buzzwole", "pikachu"]);
  s.battle = { slots: ["p1", "p2", "p3", "p4", "p5", "p6"] };
  assert.deepEqual(blockedSlots(s), [null, null, "legendary", null, "sub", null]);
  assert.equal(canStartBattle(s), false);
  s.battle.slots[2] = null;
  s.battle.slots[4] = null;
  assert.equal(canStartBattle(s), true);
  const view = snapshotView(s, T0);
  assert.equal(view.battle.slots[0]!.blocked, null);
  s.battle.slots[2] = "p3";
  const blocked = snapshotView(s, T0).battle.slots[2]!;
  assert.equal(blocked.blocked, "출전 불가 · 초전설 1마리까지");
}

// ── 화면 값 ──
{
  const s = seed(["pikachu"]);
  s.battle = { slots: ["p1", null, null, null, null, null] };
  const slot = snapshotView(s, T0).battle.slots[0]!;
  assert.deepEqual(slot.stats.map((x) => `${x.label} ${x.value}`), ["HP 110", "공격 75", "방어 60", "스피드 110", "특수방어 70", "특수공격 70"], "그래프 꼭짓점 순서");
  assert.equal(slot.ability, "정전기");
  assert.deepEqual(slot.moves.map((m) => m.name), ["볼트태클", "10만볼트"]);
  assert.equal(snapshotView(s, T0).battle.slots[1]!.pet, undefined, "빈 칸");
}

// ── 명령 ──
{
  let save = seed(["pikachu", "eevee", "mewtwo"]);
  let n = 0;
  const ex = createExecutor({ read: () => save, write: (next) => ((save = next), true), now: () => T0, rand: Math.random }, HANDLERS);
  const run = (name: string, args: unknown) => ex.run({ id: `t${(n += 1)}`, name, args });
  const why = (name: string, args: unknown): string | null => { const r = run(name, args); return r.ok ? null : r.reason; };
  assert.ok(run("battle.set", { slotIndex: 0, petId: "p1" }).ok);
  assert.equal(why("battle.set", { slotIndex: 1, petId: "p1" }), "already", "같은 개체는 한 칸에만");
  assert.equal(why("battle.set", { slotIndex: 6, petId: "p2" }), "bad-slot");
  assert.equal(why("battle.set", { slotIndex: 1, petId: "p9" }), "no-pet");
  assert.ok(run("battle.set", { slotIndex: 1, petId: "p2" }).ok);
  assert.deepEqual(battleSlots(save).slice(0, 2), ["p1", "p2"]);
  assert.equal(save.boxes[0]!.slots[0], "p1", "개체의 자리는 그대로");
  assert.ok(run("battle.clear", { slotIndex: 1 }).ok);
  assert.equal(battleSlots(save)[1], null);
  assert.equal(why("battle.clear", { slotIndex: 1 }), "already");
  // 칸 옮기기 — 빈 칸이면 옮기고, 개체 칸이면 맞바꾼다 (끌어 놓기)
  assert.ok(run("battle.move", { slotIndex: 0, toSlot: 3 }).ok);
  assert.deepEqual(battleSlots(save).slice(0, 4), [null, null, null, "p1"], "빈 칸으로 옮긴다");
  assert.ok(run("battle.set", { slotIndex: 0, petId: "p2" }).ok);
  assert.ok(run("battle.move", { slotIndex: 3, toSlot: 0 }).ok);
  assert.deepEqual(battleSlots(save).slice(0, 4), ["p1", null, null, "p2"], "개체 칸이면 맞바꾼다");
  assert.equal(why("battle.move", { slotIndex: 1, toSlot: 2 }), "no-pet", "빈 칸은 끌지 못한다");
  assert.equal(why("battle.move", { slotIndex: 0, toSlot: 0 }), "already");
  assert.equal(why("battle.move", { slotIndex: 0, toSlot: 6 }), "bad-slot");
  assert.ok(run("battle.clear", { slotIndex: 3 }).ok);

  // 기술 순서 — 개체에 저장한다
  assert.ok(run("battle.moves", { petId: "p1" }).ok);
  assert.equal(save.pets[0]!.moveSwap, true);
  assert.deepEqual(petMoves(save.pets[0]!).map((m) => m.name), ["10만볼트", "볼트태클"]);
  assert.ok(run("battle.moves", { petId: "p1" }).ok);
  assert.equal(save.pets[0]!.moveSwap, undefined);

  // 기술 고르기 — 진화 전 종(피카츄)은 기본 2개뿐이라 순서만 고를 수 있다 (기술 바꾸기 모달, 2026-10-10)
  assert.ok(run("battle.pick", { petId: "p1", moves: ["thunderbolt", "volt-tackle"] }).ok);
  assert.deepEqual(save.pets[0]!.moves, ["thunderbolt", "volt-tackle"]);
  assert.deepEqual(petMoves(save.pets[0]!).map((m) => m.name), ["10만볼트", "볼트태클"]);
  assert.equal(why("battle.pick", { petId: "p1", moves: ["thunder", "volt-tackle"] }), "bad-args", "후보가 없는 종은 기본 2개 밖을 고르지 못한다");
  assert.equal(why("battle.pick", { petId: "p1", moves: ["thunderbolt", "thunderbolt"] }), "bad-args", "같은 기술 두 번");
  assert.equal(why("battle.pick", { petId: "p1", moves: ["thunderbolt"] }), "bad-args");
  assert.ok(run("battle.moves", { petId: "p1" }).ok);
  assert.deepEqual(save.pets[0]!.moves, ["volt-tackle", "thunderbolt"], "고른 기술이 있으면 그 둘을 맞바꾼다");
  delete save.pets[0]!.moves;

  // 판매 — 배틀 파티에 든 개체는 팔지 않는다
  const sale = sellablePet(save, "p1");
  assert.equal(sale.ok, false);
  assert.equal(sale.ok ? null : sale.reason, "in-battle");
  assert.equal(why("pet.sell", { petId: "p1" }), "in-battle");
}

// ── 프리셋 가져오기 — 칸 순서대로 덮어쓴다. 빈 칸·잠긴 칸은 빈 칸 ──
{
  const s = seed(["pikachu", "eevee", "mewtwo", "lugia"]);
  s.boxes[0]!.slots = s.boxes[0]!.slots.map(() => null);
  s.party.slots = [
    { state: "pokemon", petId: "p3" },
    { state: "empty" },
    { state: "pokemon", petId: "p4" },
    { state: "locked", unlockBy: "shop" },
  ];
  s.battle = { slots: ["p1", "p2", null, null, null, null] };
  assert.ok(importPreset(s, 0).ok);
  assert.deepEqual(s.battle.slots, ["p3", null, "p4", null, null, null]);
  assert.deepEqual(blockedSlots(s), [null, null, "legendary", null, null, null], "제한을 넘어도 그대로 넣는다");
  assert.equal(importPreset(s, 9).ok, false);
}

// ── 정규화 — 없는 개체·같은 개체 두 번은 빈 칸. 옛 저장은 빈 6칸 ──
{
  const s = seed(["pikachu", "eevee"]);
  const raw = JSON.parse(JSON.stringify({ ...s, battle: { slots: ["p1", "p9", "p1", "p2"] } })) as Record<string, unknown>;
  (raw.pets as PetV3[])[0]!.moveSwap = true;
  const back = normalize(raw, T0)!;
  assert.deepEqual(back.battle?.slots, ["p1", null, null, "p2", null, null]);
  assert.equal(back.pets[0]!.moveSwap, true);
  delete raw.battle;
  assert.deepEqual(normalize(raw, T0)!.battle?.slots, [null, null, null, null, null, null]);
}

// ── 기술 고르기 — 마지막 진화체는 기본 2개 + 후보 4개 가운데 2개. 배틀 파티 판정·정규화·진화까지 ──
{
  const s = seed(["raichu"]);
  s.battle = { slots: ["p1", null, null, null, null, null] };
  const pet = s.pets[0]!;
  assert.equal(moveOptions("raichu").length, 6, "기본 2개 + 후보 4개");
  assert.equal(moveOptions("pikachu").length, 2, "진화 전 종은 기본 2개");
  assert.ok(setMoves(s, "p1", ["thunder", "surf"]).ok);
  assert.deepEqual(petMoves(pet).map((m) => m.id), ["thunder", "surf"]);
  assert.equal(setMoves(s, "p1", ["thunder", "flamethrower"]).ok, false, "그 종의 6개 밖");
  pet.moveSwap = true;
  assert.deepEqual(petMoves(pet).map((m) => m.id), ["thunder", "surf"], "고른 기술이 있으면 moveSwap 은 보지 않는다");
  delete pet.moveSwap;
  assert.deepEqual(snapshotView(s, T0).battle.slots[0]!.options?.map((m) => m.id), moveOptions("raichu").map((m) => m.id), "화면 값의 고를 수 있는 기술");
  // 서버가 읽는 배틀 파티 — 고른 기술을 싣고, 쓸 수 없는 값이면 싣지 않는다(기본 2개로 싸운다)
  const data = battleData();
  assert.deepEqual(partyOf(JSON.parse(JSON.stringify(s)), data).party[0]?.moves, ["thunder", "surf"]);
  const bad = JSON.parse(JSON.stringify(s)) as SaveV3;
  bad.pets[0]!.moves = ["thunder", "flamethrower"];
  assert.equal(partyOf(bad, data).party[0]?.moves, undefined, "쓸 수 없는 기술은 버린다");
  // 정규화 — 모양이 맞으면 남기고, 같은 기술 두 번은 버린다
  const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  assert.deepEqual(normalize(raw, T0)!.pets[0]!.moves, ["thunder", "surf"]);
  (raw.pets as PetV3[])[0]!.moves = ["thunder", "thunder"];
  assert.equal(normalize(raw, T0)!.pets[0]!.moves, undefined);
  // 쓸 수 없는 값이면 기본 2개 — 저장에 남은 낡은 값(다른 종의 기술)
  pet.moves = ["flamethrower", "surf"];
  assert.deepEqual(petMoves(pet).map((m) => m.id), speciesMoves("raichu").map((m) => m.id));
}

// ── 개체가 사라지면 칸에서 빠진다 (교환으로 보낸 개체) ──
{
  const s = seed(["pikachu", "eevee"]);
  s.battle = { slots: ["p1", "p2", null, null, null, null] };
  s.pets = s.pets.filter((p) => p.id !== "p1");
  dropMissingBattlePets(s);
  assert.equal(isInBattle(s, "p1"), false);
  assert.deepEqual(s.battle.slots.slice(0, 2), [null, "p2"]);
}

// ── 메가진화 — 배틀 파티에서 따로 켠다. 메가 칸 1마리를 넘으면 뒤 칸이 출전 불가 (다른 개체를 끄지 않는다) ──
{
  let save = seed(["charizard", "mewtwo", "rayquaza", "pikachu"]);
  for (const p of save.pets.slice(0, 3)) p.mega = { bondMs: 0, care: 0, stone: true };
  save.battle = { slots: ["p1", "p2", "p3", "p4", null, null] };
  let n = 0;
  const ex = createExecutor({ read: () => save, write: (next) => ((save = next), true), now: () => T0, rand: Math.random }, HANDLERS);
  const why = (args: unknown): string | null => {
    const r = ex.run({ id: `m${(n += 1)}`, name: "battle.mega", args });
    return r.ok ? null : r.reason;
  };
  assert.equal(why({ petId: "p4", form: "charizard-mega-x" }), "no-stone", "메가스톤이 없으면 못 켠다");
  assert.equal(why({ petId: "p1", form: "mewtwo-mega-x" }), "bad-form", "다른 종의 모습");
  assert.equal(why({ petId: "p1", form: "charizard-mega-x" }), null);
  assert.equal(battleMegaOf(save, "p1"), "charizard-mega-x");
  assert.equal(save.pets[0]!.mega?.on, undefined, "바탕화면 프리셋의 모습은 그대로");
  const slot = snapshotView(save, T0).battle.slots[0]!;
  assert.equal(slot.pet?.name, "메가리자몽X");
  assert.deepEqual(slot.pet?.typeIds, ["fire", "dragon"]);
  assert.deepEqual(slot.stats.map((x) => x.value), [153, 150, 131, 120, 105, 150], "메가 모습의 종족값");
  assert.equal(slot.pet?.mega?.on, "charizard-mega-x");
  assert.equal(slot.pet?.mega?.canChange, true);
  assert.equal(why({ petId: "p3", form: "rayquaza-mega" }), null, "둘째 메가도 켤 수 있다");
  assert.equal(battleMegaOf(save, "p1"), "charizard-mega-x", "앞 개체를 끄지 않는다");
  // 뮤츠는 초전설 첫째, 레쿠쟈는 초전설 둘째·메가 둘째 — 종의 칸을 먼저 알린다
  assert.deepEqual(blockedSlots(save), [null, null, "legendary", null, null, null]);
  assert.equal(why({ petId: "p2", form: "mewtwo-mega-y" }), null);
  assert.deepEqual(blockedSlots(save), [null, "mega", "legendary", null, null, null], "메가 칸은 칸 순서가 뒤인 개체가 넘는다");
  assert.equal(snapshotView(save, T0).battle.slots[1]!.blocked, "출전 불가 · 메가진화 1마리까지");
  assert.equal(why({ petId: "p1", form: null }), null, "원래 모습으로");
  assert.equal(battleMegaOf(save, "p1"), null);
  // 칸에서 빼면 메가 상태도 지운다
  assert.ok(ex.run({ id: "m-clear", name: "battle.clear", args: { slotIndex: 1 } }).ok);
  assert.equal(battleMegaOf(save, "p2"), null);
  // 정규화 — 칸에 없는 개체·메가스톤 없는 개체·틀린 모습은 버린다
  const raw = JSON.parse(JSON.stringify({ ...save, battle: { slots: save.battle!.slots, mega: { p3: "rayquaza-mega", p4: "charizard-mega-x", p9: "x", p1: "mewtwo-mega-x" } } })) as Record<string, unknown>;
  assert.deepEqual(normalize(raw, T0)!.battle?.mega, { p3: "rayquaza-mega" });
}

// ── 배틀 파티에 들어올 때의 모습만 옮겨 적는다 — 그 뒤 파티의 모습 바꾸기·메가는 배틀 파티에 닿지 않는다 (2026-10-09 사용자 "가져오기시에만 동기화였어") ──
{
  let save = seed(["rotom", "charizard", "pikachu"]);
  save.pets[0]!.species = "rotom-wash";
  save.pets[1]!.mega = { bondMs: 0, care: 0, stone: true, on: "charizard-mega-x" };
  save.battle = { slots: [null, null, null, null, null, null] };
  assert.ok(setBattleSlot(save, 0, "p1").ok && setBattleSlot(save, 1, "p2").ok && setBattleSlot(save, 2, "p3").ok);
  assert.deepEqual(save.battle.forms, { p1: "rotom-wash" }, "모습 바꾸기 종을 적는다 — 묶음이 없는 종(피카츄)은 적지 않는다");
  assert.equal(battleMegaOf(save, "p2"), "charizard-mega-x", "그때의 메가 모습을 옮겨 적는다");
  // 파티에서 모습을 바꿔도 배틀 파티는 그대로
  save.pets[0]!.species = "rotom-heat";
  delete save.pets[1]!.mega!.on;
  assert.equal(battleSpeciesOf(save, save.pets[0]!), "rotom-wash");
  assert.equal(battleMegaOf(save, "p2"), "charizard-mega-x");
  assert.equal(snapshotView(save, T0).battle.slots[0]!.pet?.species, "rotom-wash", "화면도 배틀 파티의 모습");
  assert.equal(partyOf(JSON.parse(JSON.stringify(save)), battleData()).party[0]?.species, "rotom-wash", "서버의 파티 읽기도 같다");
  assert.deepEqual(lookOfSource(partyOf(JSON.parse(JSON.stringify(save)), battleData()).party[0]!), { shiny: save.pets[0]!.shiny, gender: save.pets[0]!.gender }, "서버의 파티 읽기는 그림 값(이로치·성별)도 싣는다");
  // 배틀 파티의 모습 바꾸기(battle.form) — 개체의 종은 그대로
  let n = 0;
  const ex = createExecutor({ read: () => save, write: (next) => ((save = next), true), now: () => T0, rand: Math.random }, HANDLERS);
  const why = (args: unknown): string | null => {
    const r = ex.run({ id: `f${(n += 1)}`, name: "battle.form", args });
    return r.ok ? null : r.reason;
  };
  save.pets[0]!.workMs = 10 ** 12; // 로토무 모습 바꾸기 해금(작업 시간)
  assert.equal(why({ petId: "p1", species: "rotom-fan" }), null);
  assert.equal(battleSpeciesOf(save, save.pets[0]!), "rotom-fan");
  assert.equal(save.bag["rotom-catalog"] ?? 0, 0, "도구는 쓰지 않는다(없어도 된다)");
  assert.equal(save.pets[0]!.species, "rotom-heat", "개체의 종은 그대로");
  assert.equal(why({ petId: "p1", species: "rotom-fan" }), "already");
  assert.equal(why({ petId: "p1", species: "pikachu" }), "bad-form", "묶음 밖의 종");
  assert.equal(why({ petId: "p3", species: "raichu" }), "bad-form", "묶음이 없는 종");
  assert.equal(why({ petId: "p1" }), "bad-args");
  // 짝 — 큐레무 블랙은 제크로무 개체가 있어야 한다(원래 모습 바꾸기와 같다, 짝은 그대로 따로 쓰인다)
  const kyu = testPet({ id: "p9", species: "kyurem" }, T0);
  save.pets.push(kyu);
  assert.ok(setBattleSlot(save, 4, "p9").ok);
  assert.equal(why({ petId: "p9", species: "kyurem-black" }), "no-partner", "제크로무가 없으면");
  save.pets.push(testPet({ id: "p10", species: "zekrom" }, T0));
  assert.equal(why({ petId: "p9", species: "kyurem-black" }), null, "제크로무가 있으면");
  assert.ok(save.pets.some((p) => p.species === "zekrom"), "짝은 그대로");
  // 한 방향 묶음(도구로 한 번 얻는 모습) — 배틀 파티도 도구 없이 바꾸지 못한다. 들어올 때도 적지 않는다
  save.pets.push(testPet({ id: "p11", species: "floette" }, T0), testPet({ id: "p12", species: "floette-eternal" }, T0));
  assert.ok(setBattleSlot(save, 5, "p11").ok);
  assert.equal(why({ petId: "p11", species: "floette-eternal" }), "bad-form", "영원의 꽃은 도구로만");
  assert.equal(save.battle?.forms?.p11, undefined, "한 방향 묶음은 들어올 때 적지 않는다");
  assert.ok(setBattleSlot(save, 5, "p12").ok);
  assert.equal(why({ petId: "p12", species: "floette" }), "bad-form", "되돌리지도 못한다");
  const forged = JSON.parse(JSON.stringify(save)) as SaveV3;
  forged.battle!.forms = { ...(forged.battle!.forms ?? {}), p11: "floette-eternal" };
  forged.battle!.slots[5] = "p11";
  assert.equal(battleSpeciesOf(forged, forged.pets.find((p) => p.id === "p11")!), "floette", "저장을 고쳐도 지금 종");
  assert.equal(partyOf(forged, battleData()).party[5]?.species, "floette", "서버도 지금 종");
  // 해금 — 원래 모습 바꾸기와 같다. 로토무는 작업 시간이 모자라면 form-locked (2026-10-09 사용자 "기존에 해금했으면 되게")
  const rotomWork = save.pets[0]!.workMs;
  save.pets[0]!.workMs = 0;
  assert.equal(why({ petId: "p1", species: "rotom-mow" }), "form-locked");
  save.pets[0]!.workMs = rotomWork;
  // 다른 개체가 그 종으로 들어오면 — 묶음이 다르면 지금 종으로 본다
  const fake = JSON.parse(JSON.stringify(save)) as SaveV3;
  fake.battle!.forms = { p1: "rotom-fan", p3: "mewtwo" };
  assert.equal(partyOf(fake, battleData()).party[2]?.species, "pikachu", "서버는 묶음 밖의 값을 쓰지 않는다");
  // 정규화 — 칸에 든 개체이고 그 개체의 묶음 안의 종만 남긴다
  const raw = JSON.parse(JSON.stringify({ ...save, battle: { ...save.battle, forms: { p1: "rotom-mow", p3: "mewtwo", p9: "rotom" } } })) as Record<string, unknown>;
  assert.deepEqual(normalize(raw, T0)!.battle?.forms, { p1: "rotom-mow" });
}
// ── 랜덤 배틀 보상 — 포인트를 넣고 판 id 를 남긴다. 같은 판은 한 번, 값이 이상하면 거절, 최근 200개 ──
{
  const save = seed(["pikachu"]);
  save.points.balance = 100;
  assert.deepEqual(applyBattleReward(save, "b1", 500), { ok: true, applied: true });
  assert.equal(save.points.balance, 600);
  assert.deepEqual(applyBattleReward(save, "b1", 500), { ok: true, applied: false }, "같은 판은 한 번");
  assert.equal(save.points.balance, 600);
  assert.equal(applyBattleReward(save, "b2", 501).ok, false, "500 을 넘는 보상은 거절");
  assert.equal(applyBattleReward(save, "", 10).ok, false);
  for (let i = 0; i < 250; i++) applyBattleReward(save, `x${i}`, 10);
  assert.equal(save.battle!.applied!.length, 200, "최근 200개만");
  assert.equal(normalize(JSON.parse(JSON.stringify(save)), T0)!.battle?.applied?.length, 200, "정규화도 남긴다");
}

process.stdout.write("통과\n");
