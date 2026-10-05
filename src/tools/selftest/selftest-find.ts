// 줍기 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-find.js
//
// 테스트 프레임워크 없이 assert 만. 무작위는 정한 값을 차례로 준다.
// 네 결과·가방 상한을 보지 않음·후보 없음·박스로 보냄·마리별 독립 판정(잠·숨김·박스 제외)·초 누적 확률·틱 상한·저장 반영·배너 문구를 본다.
// 저장은 임시 폴더에만 쓴다. 계약은 docs/specs/game.md "줍기", 수치는 docs/specs/balance.md "줍기".
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { MINT_RETIRED } from "../../bag/mint";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { setLang } from "../../view/text";
import { bannerOf } from "../../view/banner";
import { refreshQueue } from "../../notify/queue";
import { newPet } from "../../party/create";
import * as store from "../../save/save-file";
import { emptySave as empty, normalizeSave as normalize } from "../../save/normalize";
import { josa } from "../../shared/josa";
import type { SaveV3 } from "../../shared/save-v3";
import { makeTmp } from "../harness/tmp-dir";
import { BAG_RULES } from "../../bag/rules";
import { applyFind, eligiblePetIds, findOne, itemCandidates } from "../../find/pickup";
import { chanceFor, isCaredFor, rollHits, shareOf } from "../../find/roll";
import { FIND_RULES } from "../../find/rules";
import { pendingOf } from "../../notify/pending";
import { TIME_RULES } from "../../state/rules";

setLang("ko");

const T0 = new Date(2026, 8, 29, 10, 0, 0).getTime();
const SEC = 1000;

// 항목을 고르는 무작위 값 — 가중치 100·50·20·1(합 171)의 구간
const K_POINTS = 0; // [0, 100/171)
const K_ITEM = 0.7; // [100/171, 150/171)
const K_EVO = 0.93; // [150/171, 170/171)
const K_POKEMON = 0.999; // [170/171, 1)
const HIT = 0; // 주울지 굴리는 값 — 0 이면 확률과 관계없이 줍는다
const MISS = 0.9999; // 1 에 가까우면 줍지 않는다

// 정한 값을 차례로 주는 무작위. 다 쓰면 MISS
function seq(...vals: number[]): () => number {
  const list = [...vals];
  return () => (list.length ? (list.shift() as number) : MISS);
}

// 파티에 피카츄(p1, 꺼냄) · 이상해씨(p2, 숨김) · 꼬부기(p4, 꺼냄) · 빈 칸 하나, 박스에 파이리(p3). 해금은 이브이·피카츄
function seed(): SaveV3 {
  const s = empty(T0);
  s.pets.push(newPet({ id: "p1", species: "pikachu", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  s.pets.push(newPet({ id: "p2", species: "bulbasaur", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  s.pets.push(newPet({ id: "p3", species: "charmander", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  s.pets.push(newPet({ id: "p4", species: "squirtle", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  s.party.slots[2] = { state: "pokemon", petId: "p4", hidden: false };
  s.party.slots[3] = { state: "empty" };
  s.boxes[0]!.slots[0] = "p3";
  s.dex.unlocked = ["pikachu", "eevee"];
  s.dex.obtained = ["pikachu", "bulbasaur", "charmander", "squirtle"];
  s.points.balance = 100;
  return s;
}

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) < eps;

const root = makeTmp("selftest-find");

try {
  // (1) 수치 — 마리마다 1초에 1/3000, 잘 돌본 마리는 1/2000 (2026-10-05 사용자 결정). 항목 가중치 100·50·20·1, 포인트 5~10P (2026-09-29 사용자 결정)
  {
    assert.equal(FIND_RULES.perSecond, 1 / 3000);
    assert.equal(FIND_RULES.caredPerSecond, 1 / 2000);
    assert.ok(near(chanceFor(SEC), 1 / 3000, 1e-12), "기본 1초에 1/3000");
    assert.equal(isCaredFor({ fullness: 40, boredom: 49 }), true, "만복도 40 이상 · 심심함 50 미만이면 잘 돌봄");
    assert.equal(isCaredFor({ fullness: 39, boredom: 0 }), false, "배고프면 아니다");
    assert.equal(isCaredFor({ fullness: 100, boredom: 50 }), false, "심심하면 아니다");
    assert.deepEqual(rollHits({ a: SEC, b: SEC }, () => 0.0004, 1, new Set(["a"])), ["a"], "같은 굴림 값에서 잘 돌본 마리만 줍는다 — 0.0004 는 1/3000 과 1/2000 사이");
    assert.deepEqual(FIND_RULES.weights, { points: 100, item: 50, evo: 20, pokemon: 1 });
    assert.deepEqual(FIND_RULES.points, { min: 5, max: 10 });
    assert.ok(near(shareOf("pokemon"), 1 / 171, 1e-12));
    assert.equal(chanceFor(0), 0, "조건을 채운 시간이 없으면 0");
    assert.ok(near(chanceFor(SEC, 1, true), 1 / 2000, 1e-12), "잘 돌본 마리 1초에 1/2000");
    assert.ok(near(chanceFor(30 * 60 * SEC, 1, true), 1 - (1 - 1 / 2000) ** 1800, 1e-12), "초 누적 → 1 − (1 − 1/2000)^초");
    assert.ok(near(chanceFor(30 * 60 * SEC, 1, true), 0.593, 0.001), "30분에 약 59%");
    assert.ok(near(chanceFor(SEC, 100, true), 100 / 2000, 1e-12), "개발용 배율 100 이면 초당 100/2000");
    assert.equal(chanceFor(SEC, 5000), 1, "배율을 올려도 1 을 넘지 않는다");
    const perDay = 28_800 / 2000; // 잘 돌본 마리 하루 활동 8시간의 기대 건수 약 14.4
    assert.ok(near(perDay * shareOf("points"), 8.42, 0.01) && near(perDay * shareOf("item"), 4.21, 0.01) && near(perDay * shareOf("evo"), 1.68, 0.01));
    assert.ok(near(1 / (perDay * shareOf("pokemon")), 11.9, 0.1), "1마리 포켓몬 약 12일에 1번");
    const ids = itemCandidates().map((c) => c.id);
    // 성격민트는 2026-09-30 은퇴해 후보에서 빠진다 (src/bag/mint.ts MINT_RETIRED)
    const base = ["premium-food", "toy", "exp-candy-xs", "exp-candy-s", "exp-candy-m", "exp-candy-l", "rare-candy"];
    assert.deepEqual(ids, MINT_RETIRED ? base : [...base, "mint"], "상점가 0 초과 200 이하. 민트는 한 종류");
    if (!MINT_RETIRED) assert.ok(near(itemCandidates().find((c) => c.id === "mint")?.weight ?? 0, 1 / 100, 1e-12), "민트 가중치 1/100");
    process.stdout.write("(1) 수치와 도구 후보  ok\n");
  }

  // (2) 포인트 — 양은 5~10 균등
  {
    const s = seed();
    const rec = findOne(s, "p1", T0, seq(K_POINTS, 0.999));
    assert.equal(rec?.kind, "points");
    assert.equal(rec?.amount, 10);
    assert.equal(s.points.balance, 110);
    assert.equal(rec?.id, "f1");
    assert.equal(rec?.petId, "p1");
    const low = findOne(s, "p1", T0, seq(K_POINTS, 0));
    assert.equal(low?.amount, 5);
    assert.equal(low?.id, "f2", "기록 식별자는 이어서 센다");
    assert.equal(s.find?.log.length, 2);
    process.stdout.write("(2) 포인트  ok\n");
  }

  // (3) 도구 — 1/가격 가중치, 민트는 도구 하나. 사지 않고 받는 것이라 가방 상한(999)으로 막지 않는다
  {
    const s = seed();
    const rec = findOne(s, "p1", T0, seq(K_ITEM, 0));
    assert.equal(rec?.kind, "item");
    assert.equal(rec?.ref, "premium-food");
    assert.equal(s.bag["premium-food"], 1);
    assert.equal(findOne(s, "p1", T0, seq(K_ITEM, 0.99999))?.ref, MINT_RETIRED ? "rare-candy" : "mint", "마지막 후보");
    s.bag["premium-food"] = BAG_RULES.max;
    assert.equal(findOne(s, "p1", T0, seq(K_ITEM, 0))?.ref, "premium-food", "가방 상한이어도 줍는다");
    assert.equal(s.bag["premium-food"], BAG_RULES.max + 1, "상한을 넘어 1개 더한다");
    process.stdout.write("(3) 도구  ok\n");
  }

  // (4) 진화용 도구 — data/evo-items.json 에서 균등
  {
    const s = seed();
    const rec = findOne(s, "p1", T0, seq(K_EVO, 0));
    assert.equal(rec?.kind, "evo");
    assert.equal(rec?.ref, "auspicious-armor");
    assert.equal(s.bag["auspicious-armor"], 1);
    process.stdout.write("(4) 진화용 도구  ok\n");
  }

  // (5) 포켓몬 — 랜덤알 후보(해금 ∩ 랜덤알). 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 후보가 없으면 없음
  {
    const s = seed();
    const rec = findOne(s, "p1", T0, seq(K_POKEMON, 0, 0.9, 0));
    assert.equal(rec?.kind, "pokemon");
    assert.equal(rec?.ref, "eevee", "피카츄는 진화형이라 랜덤알 후보가 아니다");
    const pet = s.pets.find((p) => p.id === rec?.newPetId);
    assert.ok(pet, "새 개체");
    assert.equal(pet?.shiny, false);
    assert.equal(pet?.level, 1);
    assert.deepEqual(s.party.slots[3], { state: "pokemon", petId: rec?.newPetId, hidden: false }, "빈 파티 칸에 꺼낸 상태");
    assert.ok(s.dex.obtained.includes("eevee"), "도감 얻음 기록");

    const full = seed();
    full.party.slots = full.party.slots.map((slot) => (slot.state === "empty" ? { state: "locked", unlockBy: "shop" } : slot));
    const boxed = findOne(full, "p1", T0, seq(K_POKEMON, 0, 0.9, 0));
    assert.ok(boxed?.newPetId && full.boxes[0]!.slots.includes(boxed.newPetId), "빈 파티 칸이 없으면 박스로");

    const none = seed();
    none.dex.unlocked = ["pikachu"];
    const before = JSON.stringify(none);
    assert.equal(findOne(none, "p1", T0, seq(K_POKEMON, 0, 0.9, 0)), null);
    assert.equal(JSON.stringify(none), before, "후보가 없으면 아무것도 바꾸지 않는다");
    process.stdout.write("(5) 포켓몬  ok\n");
  }

  // (6) 마리별 독립 판정 — 조건을 채운 마리마다 따로 굴린다. 잠든 마리(시간을 넘기지 않음)·숨김·박스는 판정하지 않는다
  {
    const s = seed();
    assert.deepEqual(eligiblePetIds(s, ["p1", "p2", "p3", "p4", "p9"]), ["p1", "p4"], "꺼낸 파티 개체만");

    // 한 마리만 깨어 있으면 그 마리만 굴린다
    const only = applyFind(s, { activeMs: { p1: 3 * SEC } }, T0, () => 0);
    assert.deepEqual(only.map((r) => r.petId), ["p1"]);
    // 숨긴 마리·박스 마리는 시간이 있어도 굴리지 않는다
    assert.deepEqual(applyFind(s, { activeMs: { p2: 3 * SEC, p3: 3 * SEC } }, T0, () => 0), []);
    // 두 마리는 각자 굴린다 — p1 은 못 줍고 p4 는 줍는다
    const each = applyFind(s, { activeMs: { p1: 3 * SEC, p4: 3 * SEC } }, T0, seq(MISS, HIT, K_ITEM, 0));
    assert.deepEqual(each.map((r) => [r.petId, r.kind]), [["p4", "item"]], "마리끼리 독립");
    // 굴리는 값은 조건을 채운 시간으로 정한 확률과 견준다 — 3초 확률 바로 아래면 줍고, 바로 위면 못 줍는다
    const p3 = chanceFor(3 * SEC, 1, true); // 시험 개체는 배부르고 심심하지 않다 — 잘 돌본 마리의 확률
    assert.equal(applyFind(seed(), { activeMs: { p1: 3 * SEC } }, T0, seq(p3 * 0.99, K_POINTS, 0)).length, 1);
    assert.equal(applyFind(seed(), { activeMs: { p1: 3 * SEC } }, T0, seq(p3 * 1.01)).length, 0);
    // 시간이 0 이면 굴리지 않는다
    assert.deepEqual(applyFind(seed(), { activeMs: { p1: 0 } }, T0, () => 0), []);
    process.stdout.write("(6) 마리별 독립 판정  ok\n");
  }

  // (7) 틱 상한 — 5초를 넘는 틈은 굴리지 않고, 한 틱에 마리마다 최대 1건이다
  {
    assert.equal(applyFind(seed(), { activeMs: { p1: 10 * 60 * SEC } }, T0, () => 0).length, 0, "10분 틈은 굴리지 않는다");
    assert.equal(applyFind(seed(), { activeMs: { p1: TIME_RULES.maxGapMs } }, T0, () => 0).length, 1, "5초 틈까지는 굴린다");
    const s = seed();
    const one = applyFind(s, { activeMs: { p1: 3 * SEC, p4: 3 * SEC } }, T0, () => 0);
    assert.equal(one.length, 2, "마리마다 최대 1건");
    process.stdout.write("(7) 틱 상한  ok\n");
  }

  // (8) 기록 수 제한과 정규화 — 옛 저장은 빈 값, 깨진 기록은 버린다, 옛 activeMs 는 버린다
  {
    const s = seed();
    for (let n = 0; n < FIND_RULES.keep + 5; n++) findOne(s, "p1", T0 + n, seq(K_POINTS, 0));
    assert.equal(s.find?.log.length, FIND_RULES.keep);
    assert.equal(s.find?.log[0]?.id, "f6");
    assert.equal(s.find?.seq, FIND_RULES.keep + 5);

    const old = normalize(JSON.parse(JSON.stringify({ ...seed(), find: undefined })), T0);
    assert.deepEqual(old?.find, { seq: 0, log: [] }, "옛 저장은 빈 줍기");
    const broken = normalize(JSON.parse(JSON.stringify({ ...seed(), find: { activeMs: 12.4, seq: 1, log: [{ id: "f7", petId: "p1", kind: "item", ref: "toy", amount: 1, at: T0, species: "pikachu" }, { id: "x", kind: "bad" }, null] } })), T0);
    assert.equal(broken?.find?.log.length, 1, "깨진 기록은 버린다");
    assert.equal(broken?.find?.seq, 7, "순번은 남은 기록의 가장 큰 번호보다 작지 않다");
    assert.equal("activeMs" in (broken?.find ?? {}), false, "옛 판의 activeMs 는 버린다");
    process.stdout.write("(8) 기록 수와 정규화  ok\n");
  }

  // (9) 저장 경로 — 1초 틱의 굴림(rollHits)에서 주운 마리만 game.find 가 그 자리에서 저장한다. 쓰지 못하면 아무것도 반영하지 않는다
  {
    const file = path.join(root, "save.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    let writable = true;
    let next: number[] = [];
    const game = createGame({ petName, file, now: () => now, rand: () => (next.length ? (next.shift() as number) : MISS), canWrite: () => writable });

    // 1초 틱 — 깨어 있는 마리마다 1초분으로 따로 굴린다. 1초 확률 바로 아래면 줍고, 바로 위면 못 줍는다
    const p1s = chanceFor(SEC);
    assert.deepEqual(rollHits({ p1: SEC, p4: SEC }, seq(p1s * 0.99, p1s * 1.01)), ["p1"], "마리끼리 독립 — p1 만 줍는다");
    assert.deepEqual(rollHits({ p1: 0 }, () => 0), [], "시간이 0 이면 굴리지 않는다");
    assert.deepEqual(rollHits({ p1: 10 * 60 * SEC }, () => 0), [], "큰 틈은 굴리지 않는다");
    assert.deepEqual(rollHits({ p1: SEC }, seq(0.03), 100), ["p1"], "개발 배율 100 이면 초당 약 3.3% — 0.03 은 줍는다");

    now += SEC;
    next = [K_POINTS, 0, K_POINTS, 0];
    const found = game.find(["p1", "p4", "p2", "p3"]);
    assert.deepEqual(found?.map((r) => r.petId), ["p1", "p4"], "숨긴 마리·박스 마리는 반영하지 않는다");
    const saved = store.readSave(file, { repair: false }).state!;
    assert.equal(saved.find?.log.length, 2, "그 자리에서 저장에 남는다");
    assert.equal(saved.points.balance, 100 + 2 * FIND_RULES.points.min, "포인트가 저장에 들어간다");
    assert.deepEqual(game.find([]), [], "주운 마리가 없으면 쓰지 않는다");

    // 쓰기에 실패하면 줍기도 반영하지 않는다 — 그 건은 버린다
    writable = false;
    now += SEC;
    next = [K_POINTS, 0];
    assert.equal(game.find(["p1"]), null);
    const after = store.readSave(file, { repair: false }).state!;
    assert.equal(after.find?.log.length, 2, "실패한 줍기는 없다");
    assert.equal(after.points.balance, saved.points.balance);
    process.stdout.write("(9) 1초 굴림과 그 자리 저장  ok\n");
  }

  // (10) 알림 배너 — 줍기 기록마다 한 번. 문구는 "<주운 마리>가 <것>을 주웠어요"
  {
    const s = seed();
    const pts = findOne(s, "p1", T0, seq(K_POINTS, 0.999))!;
    const item = findOne(s, "p1", T0, seq(K_ITEM, 0.2))!;
    const mon = findOne(s, "p1", T0, seq(K_POKEMON, 0, 0.9, 0))!;
    assert.deepEqual(
      pendingOf(s, T0).filter((p) => p.kind === "find").map((p) => p.key),
      ["find:f1", "find:f2", "find:f3"],
      "주운 순서",
    );
    const b1 = bannerOf(s, `find:${pts.id}`);
    assert.equal(b1?.title, "줍기");
    assert.equal(b1?.target, "피카츄가 10P를 주웠어요");
    pts.amount = 1500;
    assert.equal(bannerOf(s, `find:${pts.id}`)?.target, "피카츄가 1,500P를 주웠어요", "천 단위 쉼표 (94 항목 9-2-5)");
    pts.amount = 10;
    assert.equal(b1?.route, undefined, "포인트 줍기는 바로가기가 없다 (2026-10-05)");
    const b2 = bannerOf(s, `find:${item.id}`);
    assert.equal(b2?.target, "피카츄가 장난감을 주웠어요");
    assert.equal(b2?.route, undefined, "도구 줍기는 바로가기가 없다");
    const b3 = bannerOf(s, `find:${mon.id}`);
    assert.equal(b3?.target, "피카츄가 이브이를 데려왔어요");
    assert.deepEqual(b3?.route, { to: "pet", petId: mon.newPetId }, "포켓몬을 데려오면 바로가기로 상세를 연다");

    // 한 번 띄운 기록은 다시 줄에 서지 않는다. 처음 켤 때 있던 기록은 띄운 것으로 둔다
    const first = refreshQueue(null, s, T0);
    assert.ok(first.shown.includes("find:f1") && first.queue.length === 0);
    const next = refreshQueue({ v: 1, shown: first.shown, queue: [] }, s, T0);
    assert.equal(next.queue.length, 0);
    findOne(s, "p1", T0, seq(K_POINTS, 0));
    const later = refreshQueue(next, s, T0 + 1);
    assert.deepEqual(later.queue.map((q) => q.key), ["find:f4"], "새로 주운 것만 줄에 선다");

    // 라틴 글자로 끝나는 이름의 조사 — M·N 은 받침 있음, L·R 은 ㄹ 받침 (검수 C7)
    // 경험사탕M 자리 — 민트가 은퇴해 후보에서 빠지면 누적 가중치가 바뀐다(M 구간 약 0.83~0.92)
    const candyM = findOne(s, "p1", T0, seq(K_ITEM, MINT_RETIRED ? 0.87 : 0.8))!;
    assert.equal(candyM.ref, "exp-candy-m");
    assert.equal(bannerOf(s, `find:${candyM.id}`)?.target, "피카츄가 경험사탕M을 주웠어요");
    assert.deepEqual(["경험사탕M", "경험사탕S", "경험사탕XL", "경험사탕L", "N", "r"].map((w) => josa(w, "을/를")), ["을", "를", "을", "을", "을", "을"]);
    assert.deepEqual(["경험사탕L", "R", "경험사탕M", "경험사탕S"].map((w) => josa(w, "으로/로")), ["로", "로", "으로", "로"]);
    // 데려온 포켓몬이 사라졌으면 배너를 건너뛴다
    s.pets = s.pets.filter((p) => p.id !== mon.newPetId);
    assert.equal(bannerOf(s, `find:${mon.id}`), null);
    process.stdout.write("(10) 알림 배너  ok\n");
  }

  process.stdout.write("통과\n");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
