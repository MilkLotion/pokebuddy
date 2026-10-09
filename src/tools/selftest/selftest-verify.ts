// 서버 저장 검증 규칙 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-verify.js
//
// src/verify/save-rules.ts 를 손으로 만든 저장 쌍으로 본다. 정상 진행은 위반 0, 조작은 해당 규칙 위반.
// supabase/functions/_shared 의 복사본·데이터가 지금 규칙과 같은지도 본다(dist/tools/data/build-verify.js --check).
// 설계는 worklog/records/cloud-authority/cloud-authority.md "P4 서버 검증", 검수 사례는 evidence/2026-09-30-review-p4a-code.md
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expForLevel } from "../../dex/growth";
import { MEGA_RULES } from "../../dex/rules";
import { openEgg } from "../../egg/open";
import { newPet } from "../../party/create";
import { emptySave as empty } from "../../save/normalize";
import type { EggV3, PetV3, SaveV3 } from "../../shared/save-v3";
import { rollEgg, seededRand, verifySave, type VerifyContext, type VerifyData } from "../../verify/save-rules";
import { printLine as out } from "../harness/report";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime();
const HOUR = 3_600_000;

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
execFileSync(process.execPath, [path.join(ROOT, "dist/tools/data/build-verify.js"), "--check"], { stdio: "inherit" });
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

// 2. 포인트 — 한 시간 1,080P(적용한 프리셋 6마리 × 친밀도 2 × 적립 배율 2.2 + 다른 프리셋 24마리 × 친밀도 2 × 0.2. 2026-10-05 돌봄 개편, 그 전 1,296P),
//    짧은 틈의 지연 여유, 99999, 우편, 72시간
{
  const prev = base();
  assert.equal(data.rules.otherPresetEarn, 9.6, "다른 프리셋 24마리 × 친밀도 2 × 0.2");
  const ok = clone(prev);
  ok.points.balance += 1150;
  assert.deepEqual(rules(prev, ok, ctx(HOUR)), [], "한 시간 1,150P 는 상한 안(지연 여유 포함)");
  const tooFast = clone(prev);
  tooFast.points.balance += 1250;
  assert.deepEqual(rules(prev, tooFast, ctx(HOUR)), ["points"], "한 시간 1,250P 는 위반");
  const quick = clone(prev);
  quick.points.balance += 15; // 파일 쓰기 지연(시간당 1,080P 의 61초 몫 약 18P 안) — 서버 틈은 1초인데 저장은 15초 뒤진 상태에서 온다
  assert.deepEqual(rules(prev, quick, ctx(1_000)), [], "짧은 틈의 지연 여유");
  const over = clone(prev);
  over.points.balance = 99_999;
  assert.deepEqual(rules(prev, over, ctx(HOUR)), ["points"], "99999 는 위반");
  const long = clone(prev);
  long.points.balance += 1080 * 72;
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
  assert.equal(verifySave(prev, food, ctx(60_000), data).find((v) => v.rule === "bag")?.pet, "basic-food", "bag 위반에 도구 id");
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
  moth.pets[0] = { ...moth.pets[0]!, species: "wormadam-sandy" }; // 2026-10-09 모습별 간선 — 모래땅도롱은 모래땅도롱으로 진화한다
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
  // 제안의 친밀도는 40 — 장난감(+5)·프리미엄먹이(+8)로 메울 수 있는 몫보다 크게 부풀린다 (2026-10-05 돌봄 개편 뒤 장난감 하나가 +5)
  assert.deepEqual(rules(prev, inflated, ctx(1_000, { received: [{ ...offer, affinity: 40 }] })), ["affinity", "exp"], "받은 개체의 경험치·친밀도를 부풀림"); // 틈 1초 — 장난감(20P)을 열 개 살 수 없는 틈이다
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
  assert.equal(verifySave(prev, fake, ctx(60_000), data).find((v) => v.rule === "achievement")?.pet, "fake-1", "achievement 위반에 업적 키");
  const real = clone(prev);
  real.achievements["party-three"] = { achievedAt: T0, claimedAt: T0 };
  real.pets.push(pet("p2", "ditto"));
  assert.deepEqual(rules(prev, real, ctx(60_000)), [], "업적 보상 메타몽");
  // 업적 보상 — 포인트·알·도구 (2026-10-03 업적 개선). 받은 업적이 있으면 그 몫은 출처가 있다. 같은 변화가 업적 없이 생기면 걸린다
  const paid = clone(prev);
  paid.points.balance += 1000;
  assert.ok(rules(prev, paid, ctx(60_000)).includes("points"), "출처 없는 1000P");
  paid.achievements["dex-hoenn"] = { achievedAt: T0, claimedAt: T0 };
  assert.deepEqual(rules(prev, paid, ctx(60_000)), [], "업적 보상 1000P");
  const gift = clone(prev);
  gift.bag["shiny-potion"] = (gift.bag["shiny-potion"] ?? 0) + 1;
  assert.ok(rules(prev, gift, ctx(60_000)).length > 0, "출처 없는 모습이 바뀌는 약");
  gift.achievements["shiny-10"] = { achievedAt: T0, claimedAt: T0 };
  assert.deepEqual(rules(prev, gift, ctx(60_000)), [], "업적 보상 도구");
  const egged = clone(prev);
  egged.eggs.push({ ...egg(`e${(egged.eggSeq ?? 0) + 1}`), kind: "sub-legendary", candidates: ["articuno"] });
  egged.eggSeq = (egged.eggSeq ?? 0) + 1;
  assert.ok(rules(prev, egged, ctx(60_000)).includes("spend"), "출처 없는 준전설알");
  egged.achievements["dex-300"] = { achievedAt: T0, claimedAt: T0 };
  assert.deepEqual(rules(prev, egged, ctx(60_000)), [], "업적 보상 알");
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
    ["random", ["basculin"]], // 모습 추첨(적색근·청색근·백색근)도 앱과 서버가 같다
  ];
  const basculins = new Set<string>();
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
    const got = openEgg(s, "e1", T0, seededRand(seed, "egg:e1"));
    assert.ok(got.ok && expected, `열기 ${n}`);
    if (got.egg) {
      bonus += 1;
      assert.deepEqual(expected, { egg: got.egg.kind }, `보너스 알 ${n}`);
    } else if (got.allCaught) {
      assert.deepEqual(expected, got.allCaught, `다 모은 알 ${n}`);
    } else {
      assert.deepEqual(expected, { species: got.species, shiny: got.shiny }, `종·이로치 ${n}`);
      if (got.species?.startsWith("basculin")) basculins.add(got.species);
    }
    checked += 1;
  }
  assert.ok(bonus > 0, "보너스 알도 대조했다");
  assert.ok(basculins.size >= 2, "배쓰나이의 모습이 둘 이상 나왔다");
  // 같은 알은 몇 번 열어도 같다
  const a = seededRand("s", "egg:e9");
  const b = seededRand("s", "egg:e9");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()], "같은 시드·키는 같은 수");
  assert.notEqual(seededRand("s", "egg:e1")(), seededRand("s", "egg:e2")(), "알마다 다른 수");
  out(`10 계정 시드 — 앱과 서버 계산 일치 ${checked}건(보너스 알 ${bonus})`);
}

// 10b. 다 모은 단일 포켓몬 알의 포인트 — 앱과 서버가 같은 값을 내고, points 규칙이 그 몫을 허락한다 (2026-10-07 사용자 결정)
{
  const legend = (data.eggKinds.legendary?.pool ?? []) as string[];
  // 첫 수가 전설알 구간(0.023 ~ 0.025)인 시드를 찾는다
  let seed = "";
  for (let n = 0; n < 20_000 && !seed; n++) {
    const r = seededRand(`all-${n}`, "egg:e1")();
    if (r >= 0.023 && r < 0.025) seed = `all-${n}`;
  }
  assert.ok(seed, "전설알 구간 시드");
  const prev = base();
  prev.points.balance = 0;
  prev.dex.obtained.push(...legend);
  prev.eggs.push(egg("e1", { candidates: ["bulbasaur", "charmander"] }));
  prev.eggSeq = 1;
  const expected = rollEgg({ id: "e1", kind: "random", candidates: ["bulbasaur", "charmander"] }, prev.eggs, [...prev.dex.obtained], seededRand(seed, "egg:e1"), data);
  assert.deepEqual(expected, { points: 2500, kind: "legendary" }, "서버 계산");
  const next = clone(prev);
  const got = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
  assert.deepEqual(got.allCaught, { kind: "legendary", points: 2500 }, "앱 계산");
  assert.equal(next.points.balance, 2500);
  assert.deepEqual(rules(prev, next, ctx(60_000, { seed })), [], "다 모은 알의 포인트는 통과");
  assert.deepEqual(rules(prev, next, ctx(60_000)), ["points"], "시드가 없으면 몫이 없다");
  const more = clone(next);
  more.points.balance += 2500;
  assert.deepEqual(rules(prev, more, ctx(60_000, { seed })), ["points"], "몫을 넘는 포인트는 위반");
  // 같은 틈에 사서 연 알 — 두 저장 어디에도 없고 번호만 늘었다
  const bought = base();
  bought.points.balance = 1000;
  bought.dex.obtained.push(...legend);
  const after = clone(bought);
  after.eggSeq = 1;
  after.points.balance = 1000 - 120 + 2500;
  assert.deepEqual(rules(bought, after, ctx(60_000, { seed })), [], "같은 틈에 사서 연 알의 포인트도 통과");
  // 첫 수가 전설알 구간이 아닌 알은 몫이 없다
  let plain = "";
  for (let n = 0; n < 200 && !plain; n++) if (seededRand(`no-${n}`, "egg:e1")() > 0.06) plain = `no-${n}`;
  const fake = clone(next);
  assert.deepEqual(rules(prev, fake, ctx(60_000, { seed: plain })).includes("points"), true, "구간이 아니면 포인트는 위반");
  out("10b 다 모은 알 — 앱·서버 2500P 일치, points 몫");
}

// 11. egg-roll — 시드로 연 결과는 통과, 종·이로치를 바꾸면 위반
{
  const prev = base();
  prev.points.balance = 0;
  prev.eggs.push(egg("e1", { candidates: ["bulbasaur", "charmander", "squirtle", "dratini"] }));
  // 개체가 나오는 시드를 고른다 — 랜덤알은 낮은 확률로 보너스 알을 준다
  let seed = "x";
  let next = clone(prev);
  let res = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
  for (let n = 0; n < 50 && !res.petId; n++) {
    seed = `acct-${n}`;
    next = clone(prev);
    res = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
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
    for (const id of ids) assert.ok(openEgg(next, id, T0, seededRand(seed, `egg:${id}`)).ok, `열기 ${id}`);
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
    const first = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
    if (!first.egg) continue;
    tried += 1;
    const bonusEgg = next.eggs.find((e) => e.id === first.egg!.id)!;
    bonusEgg.ready = true;
    assert.ok(openEgg(next, bonusEgg.id, T0, seededRand(seed, `egg:${bonusEgg.id}`)).ok);
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
  let res = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
  for (let n = 1; n < 50 && !res.petId; n++) {
    seed = `c-${n}`;
    next = clone(prev);
    res = openEgg(next, "e1", T0, seededRand(seed, "egg:e1"));
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

// 14. 로토무 모습 — 개체 작업 시간 2시간, 바꿀 때마다 로토무카탈로그 1개 (src/dex/rules.ts SHIFT_RULES, 2026-10-05 사용자 결정)
{
  const ROTOM = ["rotom", "rotom-heat", "rotom-wash", "rotom-frost", "rotom-fan", "rotom-mow"];
  // 로토무와 한 방향 묶음(플라엣테·다투곰 2026-10-08, 개굴닌자 2026-10-09)만 규칙이 있다
  assert.deepEqual(Object.keys(data.shiftRules ?? {}).sort(), [...ROTOM, "floette", "floette-eternal", "ursaluna", "ursaluna-bloodmoon", "greninja", "greninja-battle-bond"].sort(), "규칙이 있는 묶음");
  assert.deepEqual(data.shiftRules?.["floette-eternal"], { base: "floette", workMs: 0, item: "eternal-flower", oneWay: true });
  assert.deepEqual(data.shiftRules?.["rotom-heat"], { base: "rotom", workMs: 7_200_000, item: "rotom-catalog" });
  const at = (workMs: number, catalogs: number): { prev: SaveV3; next: SaveV3 } => {
    const prev = base();
    prev.pets.push(pet("p2", "rotom", { workMs }));
    prev.bag["rotom-catalog"] = catalogs;
    prev.totals.workMs = 100 * HOUR;
    const next = clone(prev);
    next.pets[1]!.species = "rotom-heat";
    next.pets[1]!.forms = [...ROTOM];
    next.bag["rotom-catalog"] = catalogs - 1;
    if (next.bag["rotom-catalog"] <= 0) delete next.bag["rotom-catalog"];
    return { prev, next };
  };
  const open = at(7_200_000, 1);
  assert.deepEqual(rules(open.prev, open.next, ctx(60_000)), [], "2시간이고 카탈로그를 썼으면 통과");
  const shut = at(7_200_000 - 1, 1);
  assert.deepEqual(rules(shut.prev, shut.next, ctx(60_000)), ["form-lock"], "개체 작업 시간이 모자라면 위반 — 계정 작업 시간은 보지 않는다");
  const free = at(7_200_000, 1);
  free.next.bag["rotom-catalog"] = 1;
  assert.deepEqual(rules(free.prev, free.next, ctx(60_000)), ["form-item"], "카탈로그를 쓰지 않고 바꿨으면 위반");
  const back = at(7_200_000, 1);
  back.prev.pets[1]!.species = "rotom-mow";
  back.next.pets[1]!.species = "rotom";
  back.next.bag["rotom-catalog"] = 1;
  assert.deepEqual(rules(back.prev, back.next, ctx(60_000)), [], "원래 모습으로 돌아갈 때는 카탈로그를 쓰지 않는다");
  const kept = at(0, 1);
  kept.prev.pets[1]!.species = "rotom-wash";
  kept.next.pets[1]!.species = "rotom-wash";
  kept.next.bag["rotom-catalog"] = 1;
  assert.deepEqual(rules(kept.prev, kept.next, ctx(60_000)), [], "직전 저장부터 그 모습이면 보지 않는다 — 옛 규칙(계정 50시간)으로 바꾼 개체");
  // 한 방향 모습 — 플라엣테 → 플라엣테(영원의 꽃)은 영원의 꽃 1개, 작업 시간 조건 없음. 되돌리면 종 위반 (2026-10-08)
  const flower = (items: number): { prev: SaveV3; next: SaveV3 } => {
    const prev = base();
    prev.pets.push(pet("p2", "floette"));
    prev.bag["eternal-flower"] = items;
    const next = clone(prev);
    next.pets[1]!.species = "floette-eternal";
    next.pets[1]!.forms = ["floette", "floette-eternal"];
    next.bag["eternal-flower"] = items - 1;
    if (next.bag["eternal-flower"] <= 0) delete next.bag["eternal-flower"];
    return { prev, next };
  };
  const fOk = flower(1);
  assert.deepEqual(rules(fOk.prev, fOk.next, ctx(60_000)), [], "영원의 꽃을 썼으면 통과 — 작업 시간 조건이 없다");
  const fFree = flower(1);
  fFree.next.bag["eternal-flower"] = 1;
  assert.deepEqual(rules(fFree.prev, fFree.next, ctx(60_000)), ["form-item"], "영원의 꽃을 쓰지 않고 바꾸면 위반");
  const fBack = flower(1);
  fBack.prev.pets[1]!.species = "floette-eternal";
  fBack.prev.pets[1]!.forms = ["floette", "floette-eternal"];
  fBack.next.pets[1]!.species = "floette";
  fBack.next.bag["eternal-flower"] = 1;
  assert.deepEqual(rules(fBack.prev, fBack.next, ctx(60_000)), ["species"], "플라엣테로 되돌리면 종 위반");
  // form-work — 개체 작업 시간은 계정 작업 시간보다 빨리 늘지 않고 2시간을 넘지 않는다
  const grow = at(0, 1);
  grow.next.pets[1]!.species = "rotom";
  grow.next.bag["rotom-catalog"] = 1;
  grow.next.pets[1]!.workMs = 2 * HOUR;
  assert.deepEqual(rules(grow.prev, grow.next, ctx(60_000)), ["form-work"], "계정 작업 시간이 늘지 않았는데 개체만 늘었다");
  grow.next.totals.workMs = grow.prev.totals.workMs + 2 * HOUR;
  assert.deepEqual(rules(grow.prev, grow.next, ctx(2 * HOUR)), [], "같이 늘었으면 통과");
  grow.next.pets[1]!.workMs = 3 * HOUR;
  grow.next.totals.workMs = grow.prev.totals.workMs + 3 * HOUR;
  assert.deepEqual(rules(grow.prev, grow.next, ctx(3 * HOUR)), ["form-work"], "2시간을 넘을 수 없다");
  out("14 로토무 모습 — 개체 작업 2시간·카탈로그");
}

// 15. 메가 — 파티 시간·돌봄 횟수의 증가 상한과 새 메가스톤 조건 (src/dex/rules.ts MEGA_RULES, 2026-10-05 사용자 결정 "메가스톤이랑 … 다 서버에서 검사")
{
  const mk = (bondMs: number, care: number, stone = false): PetV3 => pet("p2", "gengar", { level: 70, exp: expForLevel(data.growth.gengar as Parameters<typeof expForLevel>[0], 70), affinity: 100, mega: { bondMs, care, ...(stone ? { stone: true } : {}) } });
  const pair = (a: PetV3, b: PetV3): { prev: SaveV3; next: SaveV3 } => {
    const prev = base(); prev.pets.push(a);
    const next = clone(prev); next.pets[1] = b;
    return { prev, next };
  };
  const ok = pair(mk(0, 0), mk(HOUR, 20));
  assert.deepEqual(rules(ok.prev, ok.next, ctx(HOUR)), [], "한 시간 · 돌봄 12회 쿨타임 + 장난감 없이 20회까지(여유 포함)");
  const fast = pair(mk(0, 0), mk(5 * HOUR, 0));
  assert.deepEqual(rules(fast.prev, fast.next, ctx(HOUR)), ["mega-bond"], "파티 시간이 틈보다 빨리 늘었다");
  // 1분 틈·잔액 0 — 그사이 번 포인트로 장난감을 살 수 없다
  const care = pair(mk(0, 0), mk(0, 30));
  care.prev.points.balance = 0;
  care.next.points.balance = 0;
  assert.deepEqual(rules(care.prev, care.next, ctx(60_000)), ["mega-care"], "돌봄 횟수가 쿨타임·장난감보다 많다");
  care.prev.bag.toy = 40;
  delete care.next.bag.toy;
  assert.deepEqual(rules(care.prev, care.next, ctx(60_000)).includes("mega-care"), false, "장난감 40개를 썼으면 통과");
  const stone = pair(mk(24 * HOUR - HOUR, 99), mk(24 * HOUR, 100, true));
  assert.deepEqual(rules(stone.prev, stone.next, ctx(HOUR)), [], "조건을 채운 새 메가스톤");
  // 조건을 100 → 70 으로 내렸다(2026-10-08). 새 메가스톤은 70 에서 받고, 옛 앱·옛 저장이 센 71~100 은 상한(megaCareMax) 안이다
  assert.equal(data.rules.megaCare, MEGA_RULES.care);
  const at70 = pair(mk(24 * HOUR - HOUR, MEGA_RULES.care - 1), mk(24 * HOUR, MEGA_RULES.care, true));
  assert.deepEqual(rules(at70.prev, at70.next, ctx(HOUR)), [], "지금 조건 값에서 생긴 새 메가스톤");
  const legacy = pair(mk(HOUR, 85), mk(HOUR, 85));
  assert.deepEqual(rules(legacy.prev, legacy.next, ctx(HOUR)), [], "조건을 내리기 전에 센 85회는 상한 안");
  const over = pair(mk(HOUR, 100), mk(HOUR, 101));
  assert.deepEqual(rules(over.prev, over.next, ctx(HOUR)), ["mega-care"], "옛 조건 100 을 넘는 횟수는 위반");
  const early = pair(mk(10 * HOUR, 100), mk(10 * HOUR, 100, true));
  assert.deepEqual(rules(early.prev, early.next, ctx(HOUR)), ["mega"], "파티 24시간 전에 생긴 메가스톤은 위반");
  const old = pair(mk(0, 0, true), mk(0, 0, true));
  assert.deepEqual(rules(old.prev, old.next, ctx(HOUR)), [], "이미 있던 메가스톤은 보지 않는다");
  out("15 메가 — 파티 시간·돌봄 횟수·새 메가스톤");
}

// 15b. 개굴닌자 파티 시간 — 개체 파티 시간(partyMs)의 증가는 틈 이하, 값은 업적 기준(100시간) 이하. 지우의모자로 종이 바뀌어도 값은 남는다
{
  const mk = (partyMs: number, species = "greninja"): PetV3 => pet("p2", species, { partyMs });
  const pair = (a: PetV3, b: PetV3): { prev: SaveV3; next: SaveV3 } => {
    const prev = base(); prev.pets.push(a);
    const next = clone(prev); next.pets[1] = b;
    return { prev, next };
  };
  assert.equal(data.rules.petPartyMs, 100 * HOUR, "검증 데이터의 기준 — 업적표에서");
  const ok = pair(mk(0), mk(HOUR));
  assert.deepEqual(rules(ok.prev, ok.next, ctx(HOUR)), [], "한 시간 틈에 한 시간");
  const fast = pair(mk(0), mk(5 * HOUR));
  assert.deepEqual(rules(fast.prev, fast.next, ctx(HOUR)), ["pet-party"], "틈보다 빨리 늘었다");
  const over = pair(mk(100 * HOUR), mk(101 * HOUR));
  assert.deepEqual(rules(over.prev, over.next, ctx(HOUR)), ["pet-party"], "100시간을 넘을 수 없다");
  const kept = pair(mk(100 * HOUR), mk(100 * HOUR, "greninja-battle-bond"));
  kept.prev.bag["ash-cap"] = 1;
  assert.ok(!rules(kept.prev, kept.next, ctx(HOUR)).includes("pet-party"), "유대변화로 바뀌어도 값은 그대로");
  out("15b 개굴닌자 파티 시간");
}

// 16. 버드렉스의 말 — 유대의고삐로 부른 말은 쓴 고삐 수까지 새 개체 출처다. 백마·흑마 모습은 그 말이 있어야 한다 (data/regional.json riders, 2026-10-07 사용자 결정)
{
  const owner = base();
  owner.points.balance = 0;
  owner.pets.push(pet("p2", "calyrex", { gender: "none", forms: ["calyrex", "calyrex-ice", "calyrex-shadow"] }));
  owner.bag["reins-of-unity"] = 1;
  const called = clone(owner);
  delete called.bag["reins-of-unity"];
  called.pets.push(pet("p3", "glastrier", { gender: "none" }));
  assert.deepEqual(rules(owner, called, ctx(60_000)), [], "고삐 1개로 말 하나");
  // 고삐를 쓰지 않고 생긴 말 — 출처가 없다 (줄어든 고삐는 판 것으로도 보므로 같은 틈의 포인트 여유가 생긴다. 그래서 고삐가 그대로인 저장으로 본다)
  const free = clone(owner);
  free.pets.push(pet("p3", "spectrier", { gender: "none" }));
  assert.deepEqual(rules(owner, free, ctx(60_000)), ["new-pets"], "고삐를 쓰지 않은 말");
  const noOwner = base();
  noOwner.points.balance = 0;
  noOwner.bag["reins-of-unity"] = 1;
  const stray = clone(noOwner);
  delete stray.bag["reins-of-unity"];
  stray.pets.push(pet("p2", "glastrier", { gender: "none" }));
  assert.deepEqual(rules(noOwner, stray, ctx(60_000)), ["rider"], "버드렉스 없이 말");
  const ice = clone(called);
  ice.pets[1]!.species = "calyrex-ice";
  assert.deepEqual(rules(called, ice, ctx(60_000)), [], "블리자포스가 있으면 백마 탄 모습");
  const shadow = clone(called);
  shadow.pets[1]!.species = "calyrex-shadow";
  assert.deepEqual(rules(called, shadow, ctx(60_000)), ["rider"], "레이스포스 없이 흑마 탄 모습");
  // 줍기 기록에 유대의고삐를 적어도 주운 것으로 세지 않는다 — 출처 없이 늘어난 도구
  const findPrev = base();
  findPrev.points.balance = 0;
  const findNext = clone(findPrev);
  findNext.bag["reins-of-unity"] = 1;
  findNext.find = { ...(findNext.find ?? { seq: 0, log: [] }), seq: (findNext.find?.seq ?? 0) + 1, log: [{ id: "f1", at: T0, petId: "p1", species: "bulbasaur", kind: "evo", ref: "reins-of-unity", amount: 1 }] } as SaveV3["find"];
  assert.ok(rules(findPrev, findNext, ctx(60_000)).includes("spend"), "줍기로 얻은 유대의고삐는 출처가 아니다");
  out("16 버드렉스의 말 — 고삐 수만큼·버드렉스 없이·말 없는 모습·줍기 기록");
}

out("selftest-verify: 통과");
