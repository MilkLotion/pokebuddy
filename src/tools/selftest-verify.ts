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
import { newPet } from "../party/create";
import { empty } from "../save/v3";
import type { EggV3, PetV3, SaveV3 } from "../shared/save-v3";
import { verifySave, type VerifyContext, type VerifyData } from "../verify/save-rules";

const ROOT = path.resolve(__dirname, "..", "..");
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime();
const HOUR = 3_600_000;
const out = (line: string): void => void process.stdout.write(`${line}\n`);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/verify-data.json"), "utf8")) as VerifyData;
const ctx = (gapMs: number, extra: Partial<VerifyContext> = {}): VerifyContext => ({ gapMs, margin: 1.1, letters: {}, trades: 0, tradesBefore: [], ...extra });
const pet = (id: string, species: string, over: Partial<PetV3> = {}): PetV3 => ({
  ...newPet({ id, species, shiny: false, nature: "hardy", gender: "male", now: T0 }),
  ...over,
});
const egg = (id: string, over: Partial<EggV3> = {}): EggV3 => ({ id, kind: "random", boughtAt: T0, remainMs: 0, ready: true, candidates: ["pikachu"], careCooldownMs: 0, actions: { pat: 0, song: 0 }, ...over });
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

// 2. 포인트 — 한 시간 720P, 짧은 틈의 지연 여유, 99999, 우편, 72시간
{
  const prev = base();
  const ok = clone(prev);
  ok.points.balance += 800;
  assert.deepEqual(rules(prev, ok, ctx(HOUR)), [], "한 시간 800P 는 상한 안(지연 여유 포함)");
  const quick = clone(prev);
  quick.points.balance += 12; // 파일 쓰기 지연 — 서버 틈은 1초인데 저장은 15초 뒤진 상태에서 온다
  assert.deepEqual(rules(prev, quick, ctx(1_000)), [], "짧은 틈의 지연 여유");
  const over = clone(prev);
  over.points.balance = 99_999;
  assert.deepEqual(rules(prev, over, ctx(HOUR)), ["points"], "99999 는 위반");
  const long = clone(prev);
  long.points.balance += 720 * 72;
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
  // 교환 — 받은 개체는 상대 값 그대로. 서버가 센 끝난 교환
  const tradedNext = clone(prev);
  tradedNext.pets = [pet("p2", "pikachu", { shiny: true, level: 40, exp: expForLevel("medium-fast", 40), affinity: 80 })];
  assert.deepEqual(rules(prev, tradedNext, ctx(60_000)), ["affinity", "exp", "new-pets", "shiny"], "교환 기록 없이는 위반");
  assert.deepEqual(rules(prev, tradedNext, ctx(60_000, { trades: 1 })), [], "끝난 교환 하나");
  // 걸려 있던 교환이 풀렸다 — 서버가 아는 끝난 채널이어야 한다
  const held = clone(prev);
  held.trade = { pending: { channelId: "c1", petId: "p1", offerRev: 1, received: null } };
  assert.deepEqual(rules(held, tradedNext, ctx(60_000, { tradesBefore: ["c1"] })), [], "직전 저장 전에 끝난 교환");
  assert.ok(rules(held, tradedNext, ctx(60_000)).includes("new-pets"), "끝나지 않은 채널로는 인정하지 않는다");
  out("7 새 개체 — 출처·시작값·교환");
}

// 8. 알·업적 — 알 후보 조작, 가짜 업적
{
  const prev = base();
  prev.points.balance = 0;
  const eggs = clone(prev);
  for (let i = 0; i < 6; i++) eggs.eggs.push(egg(`e${i}`, { candidates: ["mewtwo"] }));
  assert.deepEqual(rules(prev, eggs, ctx(60_000)), ["spend"], "살 포인트 없이 알 6개");
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
  assert.ok(rules(prev, reused, ctx(HOUR, { trades: 1 })).includes("pet-id"), "같은 번호 다른 since");
  const aff = base();
  aff.pets[0]!.affinity = 50;
  const down = clone(aff);
  down.pets[0]!.affinity = 40;
  assert.deepEqual(rules(aff, down, ctx(HOUR)), ["affinity"], "친밀도 감소");
  const care = clone(aff);
  care.pets[0]!.affinity = 55;
  broke(aff, care, ctx(0));
  assert.deepEqual(rules(aff, care, ctx(1_000)), [], "짧은 틈에 밥·놀기 한 번씩");
  const fast = clone(aff);
  fast.pets[0]!.affinity = 100;
  assert.deepEqual(rules(aff, fast, ctx(10 * 60_000)), ["affinity"], "10분에 +50");
  const work = base();
  const worked = clone(work);
  worked.totals.workMs += 5 * HOUR;
  assert.deepEqual(rules(work, worked, ctx(HOUR)), ["work"], "한 시간에 작업 5시간");
  const many = base();
  many.points.balance = 10_000;
  const seven = clone(many);
  for (let i = 0; i < 7; i++) seven.eggs.push(egg(`e${i}`, { ready: false }));
  seven.points.balance -= 7 * 120;
  assert.ok(rules(many, seven, ctx(HOUR)).includes("eggs"), "알 7개");
  out("9 id·친밀도·작업 시간·알 수");
}

out("selftest-verify: 통과");
