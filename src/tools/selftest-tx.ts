// 거래 실행기 자체 확인 — npm run build 뒤 node dist/tools/selftest-tx.js
//
// 테스트 프레임워크 없이 assert 만. 파일을 만들지 않는다 — 읽기·쓰기·시계를 가짜로 넣는다.
// 계약은 docs/specs/modules.md "거래 실행기"다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { SAVE_V3_RULES } from "../save/rules";
import { empty } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";
import { createDispatcher } from "../commands/dispatcher";
import type { CommandResult } from "../shared/types";
import { argsOf, registerV3, requestIdOf, V3_COMMANDS } from "../tx/bridge";
import { createExecutor, type TxHandler, type TxPorts } from "../tx/executor";
import { HANDLERS } from "../tx/handlers";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

// 개체 하나가 첫 칸에 보이는 상태로 시작한다
function seed(): SaveV3 {
  const s = empty(T0);
  s.pets.push({
    id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
    level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0, mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [],
    home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
    daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  });
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  return s;
}

interface Fake {
  ports: TxPorts;
  writes: number;
  fail: boolean;
  state: SaveV3;
}

function fake(state: SaveV3, now = T0): Fake {
  const f: Fake = {
    state,
    writes: 0,
    fail: false,
    ports: {
      read: () => f.state,
      write: (s) => {
        if (f.fail) return false;
        f.state = s;
        f.writes += 1;
        return true;
      },
      now: () => now,
    },
  };
  return f;
}

// (1) 성공하면 저장이 한 번 바뀌고 요청 기록이 남는다
{
  const f = fake(seed());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.hide", args: { petId: "p1" } });
  assert.equal(res.ok, true);
  assert.equal(f.writes, 1);
  assert.equal(f.state.party.slots[0]?.hidden, true);
  assert.equal(f.state.tx.length, 1);
  assert.equal(f.state.tx[0]?.id, "r1");
  assert.equal(f.state.savedAt, T0);
  process.stdout.write("(1) 성공 · 한 번 쓰고 요청을 기록한다  ok\n");
}

// (2) 같은 요청 ID 를 다시 보내도 한 번만 반영한다
{
  const f = fake(seed());
  const tx = createExecutor(f.ports, HANDLERS);
  const first = tx.run({ id: "r1", name: "party.hide", args: { petId: "p1" } });
  const again = tx.run({ id: "r1", name: "party.hide", args: { petId: "p1" } });
  assert.equal(first.ok, true);
  assert.ok(again.ok && again.replayed, "두 번째는 재생이다");
  assert.deepStrictEqual(again.ok && again.result, first.ok && first.result, "저장된 결과를 그대로 돌려준다");
  assert.equal(f.writes, 1, "쓰기는 한 번뿐");
  process.stdout.write("(2) 중복 요청 · 결과를 그대로 돌려준다  ok\n");
}

// (3) 규칙에 걸리면 아무 상태도 바꾸지 않는다
{
  const f = fake(seed());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.show", args: { petId: "p1" } });
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "already", "이미 보이는 개체");
  assert.equal(f.writes, 0);
  assert.equal(f.state.tx.length, 0, "실패한 요청은 기록하지 않는다");
  const gone = tx.run({ id: "r2", name: "party.hide", args: { petId: "없는개체" } });
  assert.equal(gone.ok === false && gone.reason, "no-slot");
  assert.equal(f.writes, 0);
  process.stdout.write("(3) 실패 · 상태를 그대로 둔다  ok\n");
}

// (4) 모르는 명령과 빈 저장
{
  const f = fake(seed());
  const tx = createExecutor(f.ports, HANDLERS);
  assert.equal(tx.run({ id: "r1", name: "없는명령" }).ok, false);
  const none = createExecutor({ read: () => null, write: () => true, now: () => T0 }, HANDLERS);
  const res = none.run({ id: "r1", name: "party.hide", args: { petId: "p1" } });
  assert.equal(res.ok === false && res.reason, "no-save");
  process.stdout.write("(4) 모르는 명령과 빈 저장  ok\n");
}

// (5) 저장 실패가 이어지면 안내 조건이 선다
{
  const f = fake(seed());
  f.fail = true;
  const tx = createExecutor(f.ports, HANDLERS);
  for (let i = 0; i < SAVE_V3_RULES.saveFailNotifyAfter; i++) {
    const res = tx.run({ id: `r${i}`, name: "party.hide", args: { petId: "p1" } });
    assert.equal(res.ok === false && res.reason, "save-failed");
  }
  assert.equal(tx.saveFailStreak(), SAVE_V3_RULES.saveFailNotifyAfter);
  assert.equal(tx.shouldNotifySaveFail(), true);
  f.fail = false;
  assert.equal(tx.run({ id: "ok", name: "party.hide", args: { petId: "p1" } }).ok, true);
  assert.equal(tx.saveFailStreak(), 0, "성공하면 이어진 실패가 풀린다");
  process.stdout.write("(5) 저장 실패 · 이어지면 안내 조건  ok\n");
}

// (6) 처리기가 사본만 고친다 — 실패해도 원본이 더럽혀지지 않는다
{
  const f = fake(seed());
  const dirty: TxHandler = (draft) => {
    draft.points.balance = 9999;
    return { ok: false, reason: "규칙실패" };
  };
  const tx = createExecutor(f.ports, { dirty });
  const res = tx.run({ id: "r1", name: "dirty" });
  assert.equal(res.ok, false);
  assert.equal(f.state.points.balance, 0, "원본은 그대로");
  process.stdout.write("(6) 사본 격리 · 실패가 원본을 건드리지 않는다  ok\n");
}

// (7) 요청 기록은 최근 건수를 넘지 않는다
{
  const s = seed();
  const { keep } = SAVE_V3_RULES.tx;
  for (let i = 0; i < keep + 20; i++) s.tx.push({ id: `old${i}`, at: T0 - SAVE_V3_RULES.tx.ttlMs - 1000, result: null });
  const f = fake(s);
  const tx = createExecutor(f.ports, HANDLERS);
  assert.equal(tx.run({ id: "new", name: "party.hide", args: { petId: "p1" } }).ok, true);
  assert.equal(f.state.tx.length, keep, "오래된 기록은 최근 건수까지만 남는다");
  assert.equal(f.state.tx.at(-1)?.id, "new");
  process.stdout.write("(7) 요청 기록 · 최근 건수까지만  ok\n");
}

process.stdout.write("selftest-tx: 통과 (성공·중복·실패·격리·기록)\n");

// ── 배치·교체·보관 ────────────────────────────────────────────────────────────
// 개체 셋 — p1 은 파티 첫 칸, p2·p3 은 박스에 있다
function seedBox(): SaveV3 {
  const s = seed();
  for (const id of ["p2", "p3"]) {
    const base = s.pets[0];
    if (!base) continue;
    s.pets.push({ ...structuredClone(base), id });
  }
  const box = s.boxes[0];
  if (box) {
    box.slots[0] = "p2";
    box.slots[1] = "p3";
  }
  return s;
}

// (8) 배치 — 박스 개체가 빈 칸에 꺼낸 상태로 들어간다
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.place", args: { petId: "p2" } });
  assert.equal(res.ok, true);
  const slot = f.state.party.slots[1];
  assert.equal(slot?.state, "pokemon");
  assert.equal(slot?.petId, "p2");
  assert.equal(slot?.hidden, false, "배치한 개체는 꺼낸 상태로 시작한다");
  assert.equal(f.state.boxes[0]?.slots[0], null, "박스에서 빠진다");
  process.stdout.write("(8) 배치 · 빈 칸에 꺼낸 상태로  ok\n");
}

// (9) 배치 — 잠긴 칸과 이미 찬 칸은 거절한다
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const locked = tx.run({ id: "r1", name: "party.place", args: { petId: "p2", slotIndex: 5 } });
  assert.equal(locked.ok === false && locked.reason, "slot-locked");
  const taken = tx.run({ id: "r2", name: "party.place", args: { petId: "p2", slotIndex: 0 } });
  assert.equal(taken.ok === false && taken.reason, "slot-not-empty");
  const inParty = tx.run({ id: "r3", name: "party.place", args: { petId: "p1" } });
  assert.equal(inParty.ok === false && inParty.reason, "not-in-box", "이미 파티에 있는 개체");
  assert.equal(f.writes, 0);
  process.stdout.write("(9) 배치 · 잠김·차 있음·파티 개체 거절  ok\n");
}

// (10) 교체 — 한 번에 맞바꾸고 들어온 개체는 숨김이다
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.swap", args: { slotIndex: 0, petId: "p2" } });
  assert.equal(res.ok, true);
  const slot = f.state.party.slots[0];
  assert.equal(slot?.petId, "p2");
  assert.equal(slot?.hidden, false, "교체로 들어와도 꺼낸 상태다");
  const boxed = f.state.boxes[0]?.slots.filter(Boolean);
  assert.deepStrictEqual(boxed?.sort(), ["p1", "p3"], "나간 개체가 박스로");
  assert.equal(f.writes, 1, "한 번에 맞바꾼다");
  process.stdout.write("(10) 교체 · 한 번에 맞바꾸고 숨김  ok\n");
}

// (10b) 파티 칸 옮기기 — 빈 칸이면 옮기고, 개체 칸이면 맞바꾼다. 숨김 상태는 개체를 따라간다. 잠긴 칸은 거절
{
  const s = seedBox();
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  const f = fake(s);
  const tx = createExecutor(f.ports, HANDLERS);
  assert.equal(tx.run({ id: "r1", name: "party.move", args: { petId: "p1", toSlot: 1 } }).ok, true);
  assert.equal(f.state.party.slots[0]?.state, "empty", "옛 칸이 빈다");
  assert.deepStrictEqual(f.state.party.slots[1], { state: "pokemon", petId: "p1", hidden: true }, "숨김 상태가 따라간다");
  assert.equal(tx.run({ id: "r2", name: "party.place", args: { petId: "p2", slotIndex: 0 } }).ok, true);
  assert.equal(tx.run({ id: "r3", name: "party.move", args: { petId: "p2", toSlot: 1 } }).ok, true);
  assert.equal(f.state.party.slots[0]?.petId, "p1", "개체 칸이면 맞바꾼다");
  assert.equal(f.state.party.slots[1]?.petId, "p2");
  const locked = tx.run({ id: "r4", name: "party.move", args: { petId: "p2", toSlot: 5 } });
  assert.equal(locked.ok === false && locked.reason, "slot-locked");
  const boxed = tx.run({ id: "r5", name: "party.move", args: { petId: "p3", toSlot: 1 } });
  assert.equal(boxed.ok === false && boxed.reason, "not-in-party", "박스 개체는 옮기지 않는다");
  assert.equal(f.state.boxes[0]?.slots[1], "p3", "박스는 그대로");
  process.stdout.write("(10b) 파티 칸 옮기기 · 옮김·맞바꿈·잠김 거절  ok\n");
}

// (10c) 교체는 두 자리를 맞바꾼다 — 나간 개체는 들어온 개체가 있던 박스 칸으로
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  assert.equal(tx.run({ id: "r1", name: "party.swap", args: { slotIndex: 0, petId: "p3" } }).ok, true);
  assert.equal(f.state.boxes[0]?.slots[1], "p1", "p3 가 있던 칸에 p1");
  assert.equal(f.state.boxes[0]?.slots[0], "p2", "다른 칸은 그대로");
  process.stdout.write("(10c) 교체 · 나간 개체는 들어온 개체의 박스 칸으로  ok\n");
}

// (10d) 박스 칸을 정해 보관 — 빈 칸만 받는다
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const taken = tx.run({ id: "r1", name: "party.keep", args: { petId: "p1", toBoxId: f.state.boxes[0]!.id, toSlot: 0 } });
  assert.equal(taken.ok === false && taken.reason, "slot-not-empty");
  const bad = tx.run({ id: "r2", name: "party.keep", args: { petId: "p1", toBoxId: "nope", toSlot: 5 } });
  assert.equal(bad.ok === false && bad.reason, "no-slot");
  assert.equal(tx.run({ id: "r3", name: "party.keep", args: { petId: "p1", toBoxId: f.state.boxes[0]!.id, toSlot: 7 } }).ok, true);
  assert.equal(f.state.boxes[0]?.slots[7], "p1", "고른 칸에 들어간다");
  assert.equal(f.state.party.slots[0]?.state, "empty");
  process.stdout.write("(10d) 보관 · 고른 박스 빈 칸으로  ok\n");
}

// (10e) 박스 개체는 돌보지 않는다 — 밥 주기·놀아주기 거절, 값은 그대로 (2026-09-30 사용자 "박스에선 막고")
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const before = structuredClone(f.state.pets.find((p) => p.id === "p2"));
  const fed = tx.run({ id: "r1", name: "feed", args: { petId: "p2" } });
  assert.equal(fed.ok === false && fed.reason, "not-in-party");
  const played = tx.run({ id: "r2", name: "play", args: { petId: "p2" } });
  assert.equal(played.ok === false && played.reason, "not-in-party");
  assert.deepStrictEqual(f.state.pets.find((p) => p.id === "p2"), before, "박스 개체 값은 그대로");
  assert.equal(f.writes, 0);
  process.stdout.write("(10e) 박스 개체 돌봄 거절  ok\n");
}

// (11) 보관 — 파티 칸이 비고 개체는 박스로
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.keep", args: { petId: "p1" } });
  assert.equal(res.ok, true);
  assert.equal(f.state.party.slots[0]?.state, "empty", "칸이 빈다");
  assert.ok(f.state.boxes[0]?.slots.includes("p1"));
  const again = tx.run({ id: "r2", name: "party.keep", args: { petId: "p1" } });
  assert.equal(again.ok === false && again.reason, "not-in-party");
  process.stdout.write("(11) 보관 · 칸이 비고 박스로  ok\n");
}

// (12) 박스가 가득 차면 새 박스를 만든다
{
  const s = seedBox();
  const box = s.boxes[0];
  if (box) for (let i = 0; i < box.slots.length; i++) box.slots[i] = box.slots[i] ?? `x${i}`;
  const f = fake(s);
  const tx = createExecutor(f.ports, HANDLERS);
  assert.equal(tx.run({ id: "r1", name: "party.keep", args: { petId: "p1" } }).ok, true);
  assert.equal(f.state.boxes.length, 2, "박스를 새로 만든다");
  assert.equal(f.state.boxes[1]?.slots[0], "p1");
  process.stdout.write("(12) 박스 자동 추가  ok\n");
}

// (13) 교체가 실패하면 박스도 파티도 그대로다
{
  const f = fake(seedBox());
  const tx = createExecutor(f.ports, HANDLERS);
  const res = tx.run({ id: "r1", name: "party.swap", args: { slotIndex: 1, petId: "p2" } });
  assert.equal(res.ok === false && res.reason, "not-in-party", "빈 칸과는 맞바꿀 수 없다");
  assert.equal(f.writes, 0);
  assert.equal(f.state.boxes[0]?.slots[0], "p2", "박스가 그대로");
  process.stdout.write("(13) 교체 실패 · 양쪽 모두 그대로  ok\n");
}

// (13b) 리전폼 진화 — 지도 하나를 쓴다. 돌은 남는다. 지도가 없으면 no-map 이고 저장을 쓰지 않는다 (worklog-mac/records/region-map/record.md)
{
  const pika = (bag: Record<string, number>): SaveV3 => {
    const s = seed();
    s.pets[0]!.species = "pikachu";
    s.bag = { ...bag };
    return s;
  };
  const f = fake(pika({ "thunder-stone": 1 }));
  const tx = createExecutor(f.ports, HANDLERS);
  const miss = tx.run({ id: "r1", name: "evolve", args: { petId: "p1", to: "raichu-alola" } });
  assert.equal(miss.ok === false && miss.reason, "no-map", "지도가 없으면 거절");
  assert.deepStrictEqual([f.writes, f.state.pets[0]?.species, f.state.bag["thunder-stone"]], [0, "pikachu", 1], "저장도 가방도 그대로");
  const g = fake(pika({ "thunder-stone": 1, "region-map": 1 }));
  const res = createExecutor(g.ports, HANDLERS).run({ id: "r2", name: "evolve", args: { petId: "p1", to: "raichu-alola" } });
  assert.ok(res.ok);
  assert.deepStrictEqual((res.result as { usedItem?: string; usedItems?: string[] }).usedItems, ["region-map"]);
  assert.deepStrictEqual([g.writes, g.state.pets[0]?.species, g.state.bag["thunder-stone"], g.state.bag["region-map"]], [1, "raichu-alola", 1, undefined], "한 번 쓰고 지도만 줄었다");
  // 돌 없이 지도만 — 알로라 라이츄 하나라 고르지 않아도 간다
  const h = fake(pika({ "region-map": 1 }));
  const only = createExecutor(h.ports, HANDLERS).run({ id: "r3", name: "evolve", args: { petId: "p1" } });
  assert.ok(only.ok);
  assert.deepStrictEqual([h.writes, h.state.pets[0]?.species, h.state.bag["region-map"]], [1, "raichu-alola", undefined], "지도 하나로 진화");
  process.stdout.write("(13b) 리전폼 진화 · 지도 하나  ok\n");
}

process.stdout.write("selftest-tx: 배치·교체·보관 통과\n");


// ── 커맨드 처리기와의 다리 ────────────────────────────────────────────────────
// dispatch 는 비동기라 여기서부터는 기다린다. 실패하면 종료 코드 1
async function bridgeChecks(): Promise<void> {
  // (14) 표면이 보낸 Command 가 실행기까지 간다
  {
    const f = fake(seedBox());
    const tx = createExecutor(f.ports, HANDLERS);
    const d = createDispatcher();
    const off = registerV3(d, tx);
    for (const cmd of V3_COMMANDS) assert.equal(d.has(cmd), true, `${cmd} 을 맡는다`);
    const res = await d.dispatch({ cmd: "party.hide", target: "p1", from: "menu", at: T0 });
    assert.equal(res.ok, true);
    assert.equal(res.reason, "ok");
    assert.equal(f.state.party.slots[0]?.hidden, true, "저장까지 갔다");
    off();
    assert.equal(d.has("party.hide"), false, "걷으면 사라진다");
    process.stdout.write("(14) 다리 · Command 가 실행기까지  ok\n");
  }

  // (15) 요청 식별자 — 준 값을 쓰고, 없으면 만든다
  {
    assert.equal(requestIdOf({ cmd: "shop.buy", from: "cli", at: 1, args: { reqId: "abc" } }), "abc");
    assert.equal(requestIdOf({ cmd: "shop.buy", target: "random", from: "cli", at: 7 }), "cli:7:shop.buy:random");
    process.stdout.write("(15) 다리 · 요청 식별자  ok\n");
  }

  // (16) target 과 args 를 명령마다 다른 모양으로 바꾼다
  {
    assert.deepStrictEqual(argsOf({ cmd: "party.keep", target: "p1", from: "menu" }), { petId: "p1" });
    assert.deepStrictEqual(argsOf({ cmd: "party.swap", target: "p2", from: "menu", args: { slotIndex: 3 } }), { petId: "p2", slotIndex: 3 });
    assert.deepStrictEqual(argsOf({ cmd: "egg.open", target: "e1", from: "menu" }), { eggId: "e1" });
    assert.deepStrictEqual(argsOf({ cmd: "bag.use", target: "mint", from: "menu", args: { petId: "p1", nature: "brave" } }), { itemId: "mint", petId: "p1", nature: "brave" });
    assert.deepStrictEqual(argsOf({ cmd: "shop.buy", target: "random", from: "cli" }), { productId: "random" });
    assert.deepStrictEqual(argsOf({ cmd: "bag.sell", target: "fire-stone", from: "menu", args: { count: 2 } }), { itemId: "fire-stone", count: 2 });
    process.stdout.write("(16) 다리 · 인자 모양 바꾸기  ok\n");
  }

  // (17) 같은 reqId 로 두 번 보내면 한 번만 반영한다
  {
    const f = fake(seedBox());
    const tx = createExecutor(f.ports, HANDLERS);
    const d = createDispatcher();
    registerV3(d, tx);
    const send = (): Promise<CommandResult> =>
      d.dispatch({ cmd: "party.keep", target: "p1", from: "cli", at: T0, args: { reqId: "once" } });
    const first = await send();
    const second = await send();
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.replayed, true, "두 번째는 재생");
    assert.equal(f.writes, 1, "쓰기는 한 번뿐");
    process.stdout.write("(17) 다리 · reqId 로 한 번만 반영  ok\n");
  }

  // (18) 실패는 이유 그대로 표면에 간다
  {
    const f = fake(seedBox());
    const tx = createExecutor(f.ports, HANDLERS);
    const d = createDispatcher();
    registerV3(d, tx);
    const res = await d.dispatch({ cmd: "party.place", target: "p1", from: "menu", at: T0 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not-in-box", "규칙 실패 이유를 그대로");
    process.stdout.write("(18) 다리 · 실패 이유 전달  ok\n");
  }

  process.stdout.write("selftest-tx: 다리 통과 (등록·식별자·인자·중복·실패)\n");
}

bridgeChecks().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
