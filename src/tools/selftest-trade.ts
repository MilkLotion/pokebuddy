// 친구 교환 로컬 규칙 자체 확인 — npm run build 뒤 node dist/tools/selftest-trade.js
//
// 순수 함수(src/trade/core.ts)와 거래 명령(trade.lock · trade.unlock · trade.apply)을 본다. 서버와 파일은 쓰지 않는다.
// 설계는 docs/work/trade/record.md "교환 규칙", "개체에서 옮기는 값", "검사", "로컬 저장과 복구"
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { apply, isLocked, isSinglePet, lock, offerable, snapshot, unlock, validateReceived, type TradePet } from "../trade/core";
import { newPet } from "../party/create";
import { empty, normalize } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";
import { createExecutor } from "../tx/executor";
import { HANDLERS } from "../tx/handlers";

const T0 = new Date(2026, 8, 27, 12, 0, 0).getTime();

// p1 은 파티 첫 칸(숨김), p2 는 박스 1 의 세 번째 칸, p3 은 전설(mewtwo)
function seed(): SaveV3 {
  const s = empty(T0);
  const p1 = newPet({ id: "p1", species: "charmander", shiny: false, nature: "hardy", now: T0 });
  p1.level = 30; p1.affinity = 70;
  const p2 = newPet({ id: "p2", species: "squirtle", shiny: true, nature: "bold", now: T0 });
  const p3 = newPet({ id: "p3", species: "mewtwo", shiny: false, nature: "hardy", now: T0 });
  s.pets.push(p1, p2, p3);
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  s.boxes[0]!.slots[2] = "p2";
  s.boxes[0]!.slots[3] = "p3";
  s.starterPetId = "p1";
  return s;
}

const eevee: TradePet = {
  species: "eevee", shiny: false, nature: "calm", size: 1.5, level: 52, exp: 0,
  affinity: 40, fullness: 80, mood: 60, stage: 0, evolved: [],
};

// (1) 올릴 값과 단일 포켓몬
{
  const s = seed();
  const snap = snapshot(s.pets[0]!);
  assert.equal(snap.species, "charmander");
  assert.equal(snap.level, 30);
  assert.ok(!("id" in snap) && !("buffs" in snap) && !("home" in snap), "개체 ID·버프·위치는 옮기지 않는다");
  assert.equal(offerable(s, "p1").ok, true);
  assert.deepStrictEqual(offerable(s, "p3"), { ok: false, reason: "single" }, "전설은 올리지 못한다");
  assert.deepStrictEqual(offerable(s, "zz"), { ok: false, reason: "no-pet" });
  assert.equal(isSinglePet({ species: "solgaleo", evolved: ["cosmog", "cosmoem"] }), true, "공유 sid 계열도 단일 포켓몬");
  process.stdout.write("(1) 올릴 값·단일 포켓몬  ok\n");
}

// (2) 받은 값 검사
{
  const ok = validateReceived(eevee);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.ok(ok.pet.exp > 0, "레벨과 어긋난 경험치는 그 레벨의 시작으로 맞춘다");
  assert.deepStrictEqual(validateReceived({ ...eevee, species: "notamon" }), { ok: false, reason: "unknown-species" });
  assert.deepStrictEqual(validateReceived({ ...eevee, species: "mewtwo" }), { ok: false, reason: "single" }, "조작한 앱이 전설을 보내도 받는 쪽이 막는다");
  assert.deepStrictEqual(validateReceived({ ...eevee, level: 101 }), { ok: false, reason: "bad-level" });
  assert.deepStrictEqual(validateReceived({ ...eevee, nature: "angry" }), { ok: false, reason: "bad-nature" });
  const big = validateReceived({ ...eevee, size: 9 });
  assert.equal(big.ok && big.pet.size, 3, "크기(도트 배율)는 가장 가까운 단계로 맞춘다");
  assert.deepStrictEqual(validateReceived({ ...eevee, size: "x" }), { ok: false, reason: "bad-value" });
  assert.deepStrictEqual(validateReceived({ ...eevee, affinity: 150 }), { ok: false, reason: "bad-value" });
  assert.deepStrictEqual(validateReceived("x"), { ok: false, reason: "not-object" });
  process.stdout.write("(2) 받은 값 검사  ok\n");
}

// (3) 잠그기·풀기
{
  const s = seed();
  assert.deepStrictEqual(lock(s, "ch1", "p1", 3), { ok: true });
  assert.equal(isLocked(s, "p1"), true);
  assert.deepStrictEqual(lock(s, "ch1", "p1", 4), { ok: true }, "같은 채널은 판 번호만 바꾼다");
  assert.equal(s.trade?.pending?.offerRev, 4);
  assert.deepStrictEqual(lock(s, "ch2", "p2", 1), { ok: false, reason: "busy" }, "다른 채널은 잠그지 못한다");
  assert.equal(unlock(s, "ch2"), false, "다른 채널의 잠금은 풀지 않는다");
  assert.equal(unlock(s, "ch1"), true);
  assert.equal(isLocked(s, "p1"), false);
  process.stdout.write("(3) 잠그기·풀기  ok\n");
}

// (4) 반영 — 파티 칸: 같은 칸, 숨김 유지, 새 ID, 도감 기록, 첫 선택 기록 지움
{
  const s = seed();
  lock(s, "ch1", "p1", 3);
  const res = apply(s, "ch1", eevee, T0 + 5000);
  assert.equal(res.ok && res.applied, true);
  if (!res.ok || !res.applied) throw new Error("반영 실패");
  assert.equal(res.newPetId, "p4", "지금 가장 큰 번호 다음 — 보낸 개체의 번호를 다시 쓰지 않는다");
  assert.deepStrictEqual(res.where, { party: 0 });
  assert.deepStrictEqual(s.party.slots[0], { state: "pokemon", petId: "p4", hidden: true }, "받은 개체가 같은 칸에, 숨김 그대로");
  assert.equal(s.pets.some((p) => p.id === "p1"), false, "보낸 개체는 빠진다");
  assert.equal(s.pets.length, 3, "개체 수는 그대로");
  const got = s.pets.find((p) => p.id === "p4")!;
  assert.equal(got.level, 52);
  assert.equal(got.since, T0 + 5000, "만난 때는 받은 시각");
  assert.deepStrictEqual(got.buffs, []);
  assert.equal(got.feedCooldownMs, 0);
  assert.ok(s.dex.obtained.includes("eevee"), "도감에 획득을 기록한다");
  assert.equal(s.starterPetId, null, "첫 선택 개체를 보냈으면 기록을 지운다");
  assert.equal(s.trade?.pending, null, "pending 을 지운다");
  assert.deepStrictEqual(apply(s, "ch1", eevee, T0 + 6000), { ok: true, applied: false }, "같은 완료를 두 번 받아도 한 번만 반영한다");
  process.stdout.write("(4) 파티 칸 반영  ok\n");
}

// (5) 반영 — 박스 칸, 이로치 기록
{
  const s = seed();
  lock(s, "ch9", "p2", 1);
  const res = apply(s, "ch9", { ...eevee, shiny: true }, T0);
  assert.equal(res.ok && res.applied, true);
  if (res.ok && res.applied) assert.deepStrictEqual(res.where, { box: 0, slot: 2 });
  assert.equal(s.boxes[0]!.slots[2], "p4");
  assert.ok(s.dex.shinyObtained.includes("eevee"));
  assert.deepStrictEqual(apply(seed(), "ch9", eevee, T0), { ok: true, applied: false }, "pending 이 없으면 아무것도 하지 않는다");
  const bad = seed();
  lock(bad, "ch9", "p2", 1);
  assert.deepStrictEqual(apply(bad, "ch9", { ...eevee, species: "mewtwo" }, T0), { ok: false, reason: "bad-received" });
  assert.equal(bad.trade?.pending?.channelId, "ch9", "반영하지 못하면 pending 을 남긴다");
  process.stdout.write("(5) 박스 칸 반영  ok\n");
}

// (6) 저장 읽기 — 깨진 pending 은 비운다
{
  const s = seed();
  lock(s, "ch1", "p1", 2);
  const back = normalize(JSON.parse(JSON.stringify(s)), T0);
  assert.equal(back?.trade?.pending?.petId, "p1", "pending 을 보존한다");
  const broken = JSON.parse(JSON.stringify(s));
  broken.trade.pending.petId = "p99";
  assert.equal(normalize(broken, T0)?.trade?.pending, null, "없는 개체의 pending 은 비운다");
  const old = JSON.parse(JSON.stringify(s));
  delete old.trade;
  assert.deepStrictEqual(normalize(old, T0)?.trade, { pending: null }, "옛 저장은 빈 값으로 읽는다");
  process.stdout.write("(6) 저장 읽기  ok\n");
}

// (7) 거래 명령 — 잠금·반영·중복 요청, 걸린 개체의 값 바꾸기 거절
{
  let disk = seed();
  disk.bag["rare-candy"] = 2;
  const tx = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0 }, HANDLERS);
  assert.equal(tx.run({ id: "l1", name: "trade.lock", args: { channelId: "ch1", petId: "p1", offerRev: 2 } }).ok, true);
  const blocked = tx.run({ id: "b1", name: "bag.use", args: { itemId: "rare-candy", petId: "p1" } });
  assert.deepStrictEqual(blocked, { ok: false, reason: "trade-locked" }, "걸린 개체에 사탕을 쓰지 못한다");
  assert.deepStrictEqual(tx.run({ id: "e1", name: "evolve", args: { petId: "p1" } }), { ok: false, reason: "trade-locked" }, "걸린 개체는 진화하지 못한다");
  assert.equal(tx.run({ id: "b2", name: "bag.use", args: { itemId: "rare-candy", petId: "p2" } }).ok, true, "다른 개체는 쓸 수 있다");
  assert.equal(tx.run({ id: "k1", name: "party.show", args: { petId: "p1" } }).ok, true, "표시·숨기기는 막지 않는다");
  const done = tx.run({ id: "a1", name: "trade.apply", args: { channelId: "ch1", received: eevee } });
  assert.equal(done.ok, true);
  if (done.ok) assert.equal((done.result as { applied: boolean }).applied, true);
  const again = tx.run({ id: "a2", name: "trade.apply", args: { channelId: "ch1", received: eevee } });
  if (again.ok) assert.equal((again.result as { applied: boolean }).applied, false, "다른 요청 ID 로 다시 와도 한 번만 반영");
  assert.equal(disk.pets.length, 3);
  assert.equal(tx.run({ id: "u1", name: "trade.unlock", args: { channelId: "ch1" } }).ok, true);
  process.stdout.write("(7) 거래 명령  ok\n");
}

process.stdout.write("selftest-trade: 통과 (올리기·받기 검사·잠금·반영·저장 읽기·거래 명령)\n");
