// 서버 저장 검증 규칙 자체 확인 — npm run build 뒤 node dist/tools/selftest-verify.js
//
// src/verify/save-rules.ts 를 손으로 만든 저장 쌍으로 본다. 정상 진행은 위반 0, 조작은 해당 규칙 위반.
// supabase/functions/_shared 의 복사본·데이터가 지금 규칙과 같은지도 본다(scripts/build-verify.cjs --check).
// 설계는 worklog/records/cloud-authority/record.md "P4 서버 검증", 검수 사례는 evidence/2026-09-30-review-p4a-code.md
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expForLevel } from "../dex/growth";
import { open } from "../egg/open";
import { newPet } from "../party/create";
import { empty } from "../save/v3";
import type { EggV3, PetV3, SaveV3 } from "../shared/save-v3";
import { rollEgg, seededRand, verifySave, type VerifyContext, type VerifyData } from "../verify/save-rules";

const ROOT = path.resolve(__dirname, "..", "..");
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime();
const HOUR = 3_600_000;
const out = (line: string): void => void process.stdout.write(`${line}\n`);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/verify-data.json"), "utf8")) as VerifyData;
const ctx = (gapMs: number, extra: Partial<VerifyContext> = {}): VerifyContext => ({ gapMs, margin: 1.1, letters: {}, received: [], receivedBefore: {}, seed: null, ...extra });
const pet = (id: string, species: string, over: Partial<PetV3> = {}): PetV3 => ({
  ...newPet({ id, species, shiny: false, nature: "hardy", gender: "male", now: T0 }),
  ...over,
});
const egg = (id: string, over: Partial<EggV3> = {}): EggV3 => ({ id, kind: "random", boughtAt: T0, remainMs: 0, ready: true, candidates: ["pichu"], careCooldownMs: 0, actions: { pat: 0, song: 0 }, ...over });
const base = (): SaveV3 => {
  const s = empty(T0);
  s.pets.push(pet("p1", "bulbasaur"));
  s.points.balance = 100;
  return s;
};
const clone = (s: SaveV3): SaveV3 => structuredClone(s);
const rules = (prev: SaveV3, next: SaveV3, c: VerifyContext): string[] => [...new Set(verifySave(prev, next, c, data).map((v) => v.rule))].sort();
const broke = (prev: SaveV3, next: SaveV3, c: VerifyContext): SaveV3 => {
  prev.points.balance = 0; // 잔액이 없어야 "살 수 있었던" 여유가 가리지 않는다
  next.points.balance = 0;
  void c;
  return next;
};

// 0. 복사본·데이터가 최신이다
execFileSync(process.execPath, [path.join(ROOT, "scripts/build-verify.cjs"), "--check"], { stdio: "inherit" });
out("0 supabase/functions/_shared 가 최신");

// 1. 정상 진행 — 한 시간, 포인트 +300, 작업 30분, 친밀도 +10
{
  const prev = base();
  const next = clone(prev);
  next.points.balance += 300;
  next.totals.workMs += 30 * 60_000;
  next.pets[0]!.affinity += 10;
  assert.deepEqual(rules(prev, next, ctx(HOUR)), [], "정상 진행은 위반 없음");
  assert.deepEqual(verifySave(null, next, ctx(HOUR), data), [], "첫 저장은 보지 않는다");
  out("1 정상 진행 — 위반 없음");
}

// 2. 포인트 — 한 시간 2,016P(6마리 × 친밀도 2 × 작업 2 × 돌봄 보너스 2.8), 짧은 틈의 지연 여유, 99999, 우편, 72시간
{
  const prev = base();
  const ok = clone(prev);
  ok.points.balance += 2200;
  assert.deepEqual(rules(prev, ok, ctx(HOUR)), [], "한 시간 2,200P 는 상한 안(지연 여유 포함)");
  const tooFast = clone(prev);
  tooFast.points.balance += 2400;
  assert.deepEqual(rules(prev, tooFast, ctx(HOUR)), ["points"], "한 시간 2,400P 는 위반");
  const quick = clone(prev);
  quick.points.balance += 30; // 파일 쓰기 지연 — 서버 틈은 1초인데 저장은 15초 뒤진 상태에서 온다
  assert.deepEqual(rules(prev, quick, ctx(1_000)), [], "짧은 틈의 지연 여유");
  const over = clone(prev);
  over.points.balance = 99_999;
  assert.deepEqual(rules(prev, over, ctx(HOUR)), ["points"], "99999 는 위반");
  const long = clone(prev);
  long.points.balance += 2016 * 72;
  assert.deepEqual(rules(prev, long, ctx(72 * HOUR)), [], "72시간 진행");
  out("2 포인트 — 상한·지연 여유·99999·72시간");
}

// 3. 우편 — 새로 넣은 편지 id 를 서버에서 받은 편지와 대조
{
  const prev = base();
  const next = clone(prev);
  next.points.balance += 100_000 + 300;
  next.mail = { applied: ["L1"], read: [] };
  next.pets.push(pet("p2", "dratini"));
  const letters = { L1: [{ kind: "points", count: 100_000 }, { kind: "item", id: "mint", count: 3 }, { kind: "pokemon", species: "dratini", count: 1 }] };
  assert.deepEqual(rules(prev, next, ctx(60_000, { letters })), [], "받은 편지의 포인트·민트 환불·포켓몬");
  assert.deepEqual(rules(prev, next, ctx(60_000)), ["mail", "new-pets", "points"], "받지 않은 편지");
  out("3 우편 — 편지 id 대조·민트 환불");
}

// 4. 가방·판매 — 판 만큼은 포인트, 출처 없이 늘면 산 값, 두 번 올려 약 999개 → 판매 우회를 막는다
{
  const prev = base();
  prev.bag["shiny-potion"] = 2;
  const sold = clone(prev);
  sold.bag["shiny-potion"] = 0;
  sold.points.balance += 2 * Math.floor(1200 * 0.6);
  assert.deepEqual(rules(prev, sold, ctx(60_000)), [], "판 만큼 포인트");
  const stuffed = clone(prev);
  stuffed.bag["shiny-potion"] = 999;
  assert.deepEqual(rules(prev, stuffed, ctx(60_000)), ["spend"], "살 포인트 없이 약 999개");
  const food = clone(prev);
  food.bag["basic-food"] = 50;
  assert.deepEqual(rules(prev, food, ctx(60_000)), ["bag"], "팔지 않는 도구가 늘었다");
  const bought = clone(prev);
  bought.bag["toy"] = 2;
  bought.points.balance -= 80;
  assert.deepEqual(rules(prev, bought, ctx(60_000)), [], "장난감 두 개 샀다");
  out("4 가방 — 판매·spend·bag");
}

// 5. 레벨·경험치 — 레벨만 올리기, 사탕 없이 경험치, 사탕 사용, 높은 레벨의 이상한사탕
{
  const prev = base();
  const levelOnly = clone(prev);
  levelOnly.pets[0] = { ...levelOnly.pets[0]!, level: 100 };
  assert.deepEqual(rules(prev, levelOnly, ctx(HOUR)), ["level"], "경험치 그대로 레벨 100");
  const cheat = clone(prev);
  cheat.pets[0] = { ...cheat.pets[0]!, level: 100, exp: expForLevel("medium-slow", 100) };
  assert.deepEqual(rules(prev, cheat, ctx(HOUR)), ["exp"], "사탕 없이 경험치");
  const candyPrev = base();
  candyPrev.bag["exp-candy-l"] = 3;
  const candyNext = clone(candyPrev);
  candyNext.bag["exp-candy-l"] = 0;
  candyNext.pets[0] = { ...candyNext.pets[0]!, exp: 30_000, level: 30 };
  broke(candyPrev, candyNext, ctx(0));
  assert.deepEqual(rules(candyPrev, candyNext, ctx(60_000)), [], "사탕 3개");
  const rarePrev = base();
  rarePrev.pets[0] = { ...rarePrev.pets[0]!, species: "venusaur", level: 99, exp: expForLevel("medium-slow", 99) };
  rarePrev.bag["rare-candy"] = 1;
  const rareNext = clone(rarePrev);
  rareNext.bag["rare-candy"] = 0;
  rareNext.pets[0] = { ...rareNext.pets[0]!, level: 100, exp: expForLevel("medium-slow", 100) };
  broke(rarePrev, rareNext, ctx(0));
  assert.deepEqual(rules(rarePrev, rareNext, ctx(60_000)), [], "레벨 99 에서 이상한사탕");
  out("5 레벨·경험치 — 레벨만·사탕·이상한사탕");
}

// 6. 종 — 진화 간선·모습 슬러그는 통과, 건너뛰기·성격 바꾸기는 위반
{
  const prev = base();
  const evo = clone(prev);
  evo.pets[0] = { ...evo.pets[0]!, species: "venusaur", evolved: ["bulbasaur", "ivysaur"], stage: 2 };
  assert.deepEqual(rules(prev, evo, ctx(HOUR)), [], "두 단계 진화");
  const burmy = base();
  burmy.pets[0] = { ...burmy.pets[0]!, species: "burmy-sandy" };
  const moth = clone(burmy);
  moth.pets[0] = { ...moth.pets[0]!, species: "wormadam" };
  assert.deepEqual(rules(burmy, moth, ctx(HOUR)).filter((r) => r !== "level"), [], "모습 슬러그의 진화");
  const jump = clone(prev);
  jump.pets[0] = { ...jump.pets[0]!, species: "mewtwo" };
  assert.deepEqual(rules(prev, jump, ctx(HOUR)), ["species"], "뮤츠로 바꾸기");
  const nat = clone(prev);
  nat.pets[0] = { ...nat.pets[0]!, nature: "adamant" };
  assert.deepEqual(rules(prev, nat, ctx(HOUR)), ["identity"], "성격 바꾸기");
  out("6 종·성격 — 모습 슬러그 포함");
}

// 7. 새 개체 — 출처·시작값
{
  const prev = base();
  prev.points.balance = 0;
  const free = clone(prev);
  free.pets.push(pet("p2", "mewtwo"));
  assert.deepEqual(rules(prev, free, ctx(60_000)), ["new-pets"], "출처 없는 개체");
  const eggPrev = clone(prev);
  eggPrev.eggs.push(egg("e1", { candidates: ["mewtwo"] }));
  const hatched = clone(eggPrev);
  hatched.eggs = [];
  hatched.pets.push(pet("p2", "mewtwo", { shiny: true }));
  assert.deepEqual(rules(eggPrev, hatched, ctx(60_000)), [], "알에서 나온 이로치");
  const strong = clone(eggPrev);
  strong.eggs = [];
  strong.pets.push(pet("p2", "mewtwo", { level: 100, exp: expForLevel("slow", 100), affinity: 100 }));
  assert.deepEqual(rules(eggPrev, strong, ctx(60_000)), ["affinity", "exp"], "알에서 레벨 100·친밀도 100");
  // 교환 — 받은 개체는 서버 제안(P5: 서버 저장에서 만든 값)과 같아야 한다
  const offer = { species: "pikachu", shiny: true, nature: "hardy", gender: "male", size: 1.5, level: 40, exp: expForLevel("medium-fast", 40), affinity: 80, fullness: 100, mood: 60, stage: 0, evolved: [] };
  const tradedNext = clone(prev);
  tradedNext.pets = [pet("p2", "pikachu", { shiny: true, level: 40, exp: expForLevel("medium-fast", 40), affinity: 80 })];
  // 틈 1초 — 사라진 개체의 판매가(50P)와 그사이 적립으로 알(120P)을 살 수 없는 틈이다
  assert.deepEqual(rules(prev, tradedNext, ctx(1_000)), ["affinity", "exp", "new-pets", "shiny"], "교환 기록 없이는 위반");
  assert.deepEqual(rules(prev, tradedNext, ctx(60_000, { received: [offer] })), [], "받은 제안과 같은 개체");
  // 받은 개체를 부풀렸다 — 제안보다 경험치·친밀도가 큰 몫은 사탕·장난감 예산으로 센다
  const inflated = clone(prev);
  inflated.pets = [pet("p2", "pikachu", { shiny: true, level: 100, exp: expForLevel("medium-fast", 100), affinity: 100 })];
  assert.deepEqual(rules(prev, inflated, ctx(1_000, { received: [offer] })), ["affinity", "exp"], "받은 개체의 경험치·친밀도를 부풀림"); // 틈 1초 — 장난감(20P)을 다섯 개 살 수 없는 틈이다
  // 다른 종으로 바꿨다 — 제안과 맞지 않는다
  const swapped = clone(prev);
  swapped.pets = [pet("p2", "mewtwo", { shiny: true, level: 40, exp: expForLevel("slow", 40), affinity: 80 })];
  assert.ok(rules(prev, swapped, ctx(1_000, { received: [offer] })).includes("new-pets"), "받은 제안과 다른 종");
  // 받은 개체에 같은 틈에 이로치 약 — 약을 썼으면 통과, 약이 없으면 shiny(검수 P5 M1)
  const plainOffer = { ...offer, shiny: false };
  const potioned = clone(prev);
  potioned.bag["shiny-potion"] = 1;
  const potionedNext = clone(potioned);
  potionedNext.bag["shiny-potion"] = 0;
  potionedNext.pets = [pet("p2", "pikachu", { shiny: true, level: 40, exp: expForLevel("medium-fast", 40), affinity: 80 })];
  assert.deepEqual(rules(potioned, potionedNext, ctx(60_000, { received: [plainOffer] })), [], "받은 개체에 이로치 약");
  assert.ok(rules(prev, potionedNext, ctx(60_000, { received: [plainOffer] })).includes("shiny"), "약 없이 이로치");
  // 같은 종·성격 교환 둘(레벨 40·50) — 엇갈려 맞추지 않는다(검수 P5 M2)
  const two = clone(prev);
  two.pets = [pet("p2", "pikachu", { shiny: true, level: 50, exp: expForLevel("medium-fast", 50), affinity: 80 }), pet("p3", "pikachu", { shiny: true, level: 40, exp: expForLevel("medium-fast", 40), affinity: 80 })];
  const offer50 = { ...offer, level: 50, exp: expForLevel("medium-fast", 50) };
  assert.deepEqual(rules(prev, two, ctx(60_000, { received: [offer, offer50] })), [], "같은 종 교환 둘");
  // 걸려 있던 교환이 풀렸다 — 서버가 아는 끝난 채널의 제안이어야 한다
  const held = clone(prev);
  held.trade = { pending: { channelId: "c1", petId: "p1", offerRev: 1, received: null } };
  assert.deepEqual(rules(held, tradedNext, ctx(60_000, { receivedBefore: { c1: offer } })), [], "직전 저장 전에 끝난 교환");
  assert.ok(rules(held, tradedNext, ctx(1_000)).includes("new-pets"), "끝나지 않은 채널로는 인정하지 않는다");
  out("7 새 개체 — 출처·시작값·교환");
}

// 8. 알·업적 — 알 후보 조작, 가짜 업적
{
  const prev = base();
  prev.points.balance = 0;
  const eggs = clone(prev);
  for (let i = 1; i <= 6; i++) eggs.eggs.push(egg(`e${i}`));
  eggs.eggSeq = 6;
  assert.deepEqual(rules(prev, eggs, ctx(60_000)), ["spend"], "살 포인트 없이 알 6개");
  // 알 고치기(검수 P4b H3) — 랜덤알 후보에 뮤츠, 이미 있는 알의 종류를 전설알로, 이전 번호의 알, eggSeq 되돌리기
  const bad = clone(prev);
  bad.points.balance = 1000;
  const badPrev = clone(bad);
  badPrev.eggs.push(egg("e1"));
  badPrev.eggSeq = 1;
  const mew = clone(badPrev);
  mew.eggs.push(egg("e2", { candidates: ["mewtwo"] }));
  mew.eggSeq = 2;
  mew.points.balance -= 120;
  assert.deepEqual(rules(badPrev, mew, ctx(60_000)), ["egg"], "랜덤알 후보에 뮤츠");
  const relabel = clone(badPrev);
  relabel.eggs[0] = { ...relabel.eggs[0]!, kind: "legendary", candidates: ["mewtwo"] };
  assert.deepEqual(rules(badPrev, relabel, ctx(60_000)), ["egg"], "이미 있는 알을 전설알로");
  const old = clone(badPrev);
  old.eggs.push(egg("e1x"));
  old.points.balance -= 120;
  assert.ok(rules(badPrev, old, ctx(60_000)).includes("egg"), "번호 규칙 밖의 알 id");
  const back = clone(badPrev);
  back.eggSeq = 0;
  assert.ok(rules(badPrev, back, ctx(60_000)).includes("egg"), "eggSeq 되돌리기");
  const fake = clone(prev);
  fake.achievements["fake-1"] = { achievedAt: T0, claimedAt: T0 };
  fake.pets.push(pet("p2", "mew"));
  assert.deepEqual(rules(prev, fake, ctx(60_000)), ["achievement", "new-pets"], "없는 업적");
  const real = clone(prev);
  real.achievements["party-three"] = { achievedAt: T0, claimedAt: T0 };
  real.pets.push(pet("p2", "ditto"));
  assert.deepEqual(rules(prev, real, ctx(60_000)), [], "업적 보상 메타몽");
  out("8 알·업적");
}

// 9. id·친밀도·작업 시간·알 수
{
  const prev = base();
  prev.pets.push(pet("p2", "pikachu"));
  const reused = clone(prev);
  reused.pets = reused.pets.filter((p) => p.id !== "p2");
  reused.pets.push(pet("p2", "pikachu", { since: T0 + 5 }));
  assert.ok(rules(prev, reused, ctx(HOUR, { received: [{ species: "pikachu", shiny: false, nature: "hardy", level: 1, exp: 0, affinity: 0 }] })).includes("pet-id"), "같은 번호 다른 since");
  const aff = base();
  aff.pets[0]!.affinity = 50;
  const down = clone(aff);
  down.pets[0]!.affinity = 40;
  assert.deepEqual(rules(aff, down, ctx(HOUR)), ["affinity"], "친밀도 감소");
  const care = clone(aff);
  care.pets[0]!.affinity = 55;
  broke(aff, care, ctx(0));
  assert.deepEqual(rules(aff, care, ctx(1_000)), [], "짧은 틈에 밥·놀기 한 번씩");
  // 장난감(20P, 친밀도 +3)을 살 포인트가 없는 틈 — 포인트 0 에서 1분
  const poor = clone(aff);
  poor.points.balance = 0;
  const fast = clone(poor);
  fast.pets[0]!.affinity = 100;
  assert.deepEqual(rules(poor, fast, ctx(60_000)), ["affinity"], "1분에 +50");
  const work = base();
  const worked = clone(work);
  worked.totals.workMs += 5 * HOUR;
  assert.deepEqual(rules(work, worked, ctx(HOUR)), ["work"], "한 시간에 작업 5시간");
  const many = base();
  many.points.balance = 10_000;
  const seven = clone(many);
  for (let i = 1; i <= 7; i++) seven.eggs.push(egg(`e${i}`, { ready: false }));
  seven.eggSeq = 7;
  seven.points.balance -= 7 * 120;
  assert.ok(rules(many, seven, ctx(HOUR)).includes("eggs"), "알 7개");
  out("9 id·친밀도·작업 시간·알 수");
}

// 10. 계정 시드(P4b) — 앱의 알 열기(open)와 서버의 재계산(rollEgg)이 같은 결과를 낸다
{
  const kinds: [string, string[]][] = [
    ["random", ["bulbasaur", "charmander", "squirtle", "dratini", "larvitar", "eevee", "pikachu"]],
    ["ancient-stone", ["omanyte", "kabuto", "aerodactyl"]],
    ["legendary", ["mewtwo", "lugia", "ho-oh"]],
  ];
  let checked = 0;
  let bonus = 0;
  for (let n = 0; n < 400; n++) {
    const seed = `seed-${n}`;
    const s = empty(T0);
    s.pets.push(pet("p1", "bulbasaur"));
    const [kind, candidates] = kinds[n % kinds.length]!;
    s.eggs.push(egg("e1", { kind, candidates }));
    if (n % 5 === 0) s.dex.obtained.push("mewtwo", "sub-legendary-dummy");
    const expected = rollEgg({ id: "e1", kind, candidates }, s.eggs, [...s.dex.obtained], seededRand(seed, "egg:e1"), data);
    const got = open(s, "e1", T0, seededRand(seed, "egg:e1"));
    assert.ok(got.ok && expected, `열기 ${n}`);
    if (got.egg) {
      bonus += 1;
      assert.deepEqual(expected, { egg: got.egg.kind }, `보너스 알 ${n}`);
    } else {
      assert.deepEqual(expected, { species: got.species, shiny: got.shiny }, `종·이로치 ${n}`);
    }
    checked += 1;
  }
  assert.ok(bonus > 0, "보너스 알도 대조했다");
  // 같은 알은 몇 번 열어도 같다
  const a = seededRand("s", "egg:e9");
  const b = seededRand("s", "egg:e9");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()], "같은 시드·키는 같은 수");
  assert.notEqual(seededRand("s", "egg:e1")(), seededRand("s", "egg:e2")(), "알마다 다른 수");
  out(`10 계정 시드 — 앱과 서버 계산 일치 ${checked}건(보너스 알 ${bonus})`);
}

// 11. egg-roll — 시드로 연 결과는 통과, 종·이로치를 바꾸면 위반
{
  const prev = base();
  prev.points.balance = 0;
  prev.eggs.push(egg("e1", { candidates: ["bulbasaur", "charmander", "squirtle", "dratini"] }));
  // 개체가 나오는 시드를 고른다 — 랜덤알은 낮은 확률로 보너스 알을 준다
  let seed = "x";
  let next = clone(prev);
  let res = open(next, "e1", T0, seededRand(seed, "egg:e1"));
  for (let n = 0; n < 50 && !res.petId; n++) {
    seed = `acct-${n}`;
    next = clone(prev);
    res = open(next, "e1", T0, seededRand(seed, "egg:e1"));
  }
  assert.ok(res.ok && res.petId, "개체가 나오는 시드");
  assert.deepEqual(rules(prev, next, ctx(60_000, { seed })), [], "시드로 연 결과");
  const swapped = clone(next);
  const hatched = swapped.pets.find((p) => p.id === res.petId);
  if (hatched) hatched.species = hatched.species === "dratini" ? "squirtle" : "dratini";
  assert.deepEqual(rules(prev, swapped, ctx(60_000, { seed })), ["egg-roll"], "다른 종으로 바꿈");
  const shiny = clone(next);
  const s2 = shiny.pets.find((p) => p.id === res.petId);
  if (s2) s2.shiny = !s2.shiny;
  assert.deepEqual(rules(prev, shiny, ctx(60_000, { seed })), ["egg-roll"], "이로치 바꿈");
  assert.deepEqual(rules(prev, swapped, ctx(60_000)), [], "시드가 없으면 대조하지 않는다");
  out("11 egg-roll — 시드 결과 통과, 종·이로치 바꾸면 위반");
}

// 12. 한 틈에 여러 일(검수 P4b H1) — 앱이 차례로 연 결과는 순서를 몰라도 통과한다
{
  const openAll = (prev: SaveV3, seed: string, ids: string[]): SaveV3 => {
    const next = clone(prev);
    for (const id of ids) assert.ok(open(next, id, T0, seededRand(seed, `egg:${id}`)).ok, `열기 ${id}`);
    return next;
  };
  // (b) 같은 종류의 단일 포켓몬 알 둘
  let bad = 0;
  for (let n = 0; n < 200; n++) {
    const prev = base();
    prev.points.balance = 0;
    const pool = ["mewtwo", "lugia", "ho-oh", "kyogre"];
    prev.eggs.push(egg("e1", { kind: "legendary", candidates: pool }), egg("e2", { kind: "legendary", candidates: pool }));
    prev.eggSeq = 2;
    const next = openAll(prev, `m-${n}`, n % 2 ? ["e1", "e2"] : ["e2", "e1"]);
    if (rules(prev, next, ctx(60_000, { seed: `m-${n}` })).length) bad += 1;
  }
  assert.equal(bad, 0, "단일 알 둘을 한 틈에");
  // (a) 보너스 알을 받고 같은 틈에 그 알까지 열기
  let tried = 0;
  for (let n = 0; n < 2000 && tried < 20; n++) {
    const seed = `b-${n}`;
    const prev = base();
    prev.points.balance = 0;
    prev.eggs.push(egg("e1", { candidates: ["bulbasaur", "charmander", "squirtle"] }));
    prev.eggSeq = 1;
    const next = clone(prev);
    const first = open(next, "e1", T0, seededRand(seed, "egg:e1"));
    if (!first.egg) continue;
    tried += 1;
    const bonusEgg = next.eggs.find((e) => e.id === first.egg!.id)!;
    bonusEgg.ready = true;
    assert.ok(open(next, bonusEgg.id, T0, seededRand(seed, `egg:${bonusEgg.id}`)).ok);
    assert.deepEqual(rules(prev, next, ctx(60_000, { seed })), [], `보너스 알까지 연 틈 ${seed}`);
  }
  assert.ok(tried > 0, "보너스 알 사례를 찾았다");
  // (c) 부화한 개체를 같은 틈에 진화
  const prev = base();
  prev.points.balance = 0;
  prev.eggs.push(egg("e1", { candidates: ["bulbasaur"] }));
  prev.eggSeq = 1;
  let seed = "c-0";
  let next = clone(prev);
  let res = open(next, "e1", T0, seededRand(seed, "egg:e1"));
  for (let n = 1; n < 50 && !res.petId; n++) {
    seed = `c-${n}`;
    next = clone(prev);
    res = open(next, "e1", T0, seededRand(seed, "egg:e1"));
  }
  const hatched = next.pets.find((p) => p.id === res.petId)!;
  hatched.species = "ivysaur";
  hatched.evolved = ["bulbasaur"];
  hatched.stage = 1;
  assert.deepEqual(rules(prev, next, ctx(60_000, { seed })), [], "부화 뒤 바로 진화");
  out(`12 한 틈에 여러 일 — 단일 알 둘·보너스 알 연쇄(${tried})·부화 뒤 진화`);
}

// 13. 포켓몬 판매 — 사라진 개체만큼 포인트, 같은 틈에 부화해서 판 개체, 판 번호를 다시 쓰지 않는다
{
  assert.equal(data.rules.petSellMax, 50, "가장 비싼 판매가는 태고의돌 종 50P");
  const prev = base();
  prev.pets.push(pet("p2", "pikachu"), pet("p3", "omanyte"));
  prev.petSeq = 3;
  prev.points.balance = 0;
  const sold = clone(prev);
  sold.pets = sold.pets.filter((p) => p.id !== "p2" && p.id !== "p3");
  sold.points.balance = 80; // 30P + 50P
  assert.deepEqual(rules(prev, sold, ctx(1_000)), [], "두 마리 판 포인트");
  const over = clone(sold);
  over.points.balance = 500;
  assert.deepEqual(rules(prev, over, ctx(1_000)), ["points"], "판 값보다 많이 늘면 위반");
  // 판 뒤 새 개체 — 번호는 p4 부터다. p3 을 다시 쓰면 위반
  const reused = clone(sold);
  reused.pets.push(pet("p3", "bulbasaur", { since: T0 + 5 }));
  assert.ok(rules(prev, reused, ctx(1_000)).includes("pet-id"), "판 번호를 다시 썼다");
  // 같은 틈에 알을 열어 나온 개체를 팔았다 — 번호만 늘고 개체는 없다
  const hatchPrev = base();
  hatchPrev.eggs.push(egg("e1"));
  hatchPrev.eggSeq = 1;
  hatchPrev.petSeq = 1;
  hatchPrev.points.balance = 0;
  const hatchSold = clone(hatchPrev);
  hatchSold.eggs = [];
  hatchSold.petSeq = 2;
  hatchSold.points.balance = 30;
  assert.deepEqual(rules(hatchPrev, hatchSold, ctx(1_000)), [], "부화해서 바로 판 개체");
  // 출처 없이 번호만 올려 판매 포인트를 만들 수 없다
  const fake = clone(prev);
  fake.petSeq = 103;
  fake.points.balance = 100 * 50;
  assert.ok(rules(prev, fake, ctx(1_000)).includes("new-pets"), "출처 없는 개체 100마리를 판 것처럼");
  out("13 포켓몬 판매 — 사라진 개체·부화 뒤 판매·번호 재사용·번호 부풀리기");
}

out("selftest-verify: 통과");
