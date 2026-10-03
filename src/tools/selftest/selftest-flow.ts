// 시나리오 통합 확인 — npm run build 뒤 node dist/tools/selftest/selftest-flow.js
//
// 여기까지 만든 조각이 실제로 이어 붙는지 본다. 명령 하나씩이 아니라 흐름으로 확인한다.
// 흐름은 docs/specs/scenarios.md 의 SC-03·04·05·06·07·10 을 따라간다.
// 화면은 없다. 거래 실행기에 명령을 보내고 저장 파일의 결과를 읽는다.
// 임시 폴더에서만 돌고 끝나면 지운다 — 사용자의 저장은 건드리지 않는다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../../save/rules";
import * as store from "../../save/store";
import { empty } from "../../save/v3";
import { applyTimeAndSettle as applyTime } from "../../tx/tick"; // 시간 적용 + 후처리 사슬 — 옛 applyTime 과 같은 동작
import type { SaveV3 } from "../../shared/save-v3";
import { createExecutor, type Executor } from "../../tx/executor";
import { HANDLERS } from "../../tx/handlers";
import { makeTmp } from "../harness/tmp-dir";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 3_600_000;

const root = makeTmp("selftest-flow");
const file = path.join(root, "save.json");

// 시계와 무작위를 손에 쥔 실행기 — 저장은 실제 파일에 쓴다
class World {
  now = T0;
  rolls: number[] = [];
  private rollAt = 0;
  readonly tx: Executor;

  constructor() {
    this.tx = createExecutor(
      {
        read: () => store.read(file, { repair: false }).state,
        write: (s) => store.write(file, s),
        now: () => this.now,
        rand: () => this.rolls[Math.min(this.rollAt++, this.rolls.length - 1)] ?? 0.5,
      },
      HANDLERS,
    );
  }

  // 다음 무작위 값들 — 처음부터 차례로 쓴다
  setRolls(values: number[]): void {
    this.rolls = values;
    this.rollAt = 0;
  }

  save(): SaveV3 {
    const { state } = store.read(file, { repair: false });
    assert.ok(state, "저장을 읽는다");
    return state;
  }

  // 시간을 흘린다. 파티·알의 값이 움직이고 저장에 남는다
  pass(ms: number): ReturnType<typeof applyTime> {
    const s = this.save();
    this.now += ms;
    const events = applyTime(s, ms, this.now);
    assert.equal(store.write(file, s), true);
    return events;
  }

  run(id: string, name: string, args?: unknown): ReturnType<Executor["run"]> {
    return this.tx.run({ id, name, args });
  }

  ok(id: string, name: string, args?: unknown): Record<string, unknown> {
    const res = this.run(id, name, args);
    assert.ok(res.ok, `${name} 이 성공해야 한다: ${res.ok ? "" : res.reason}`);
    return (res.result ?? {}) as Record<string, unknown>;
  }
}

try {
  // ── 시작 — 첫 선택을 마친 직후의 저장을 만든다 (SC-01·SC-03) ──────────────
  const seed = empty(T0);
  seed.points.balance = SHOP_V3_RULES.startPoints;
  seed.dex.unlocked = ["charmander", "squirtle", "pichu"];
  seed.pets.push({
    id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
    level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
    mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
    daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  });
  seed.dex.obtained = ["charmander"];
  seed.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  assert.equal(store.write(file, seed), true);

  const w = new World();
  assert.equal(w.save().points.balance, 120, "시작 포인트 120");
  process.stdout.write("(1) 첫 선택 뒤 상태 · 개체 하나와 시작 포인트  ok\n");

  // ── SC-03 시작 포인트로 랜덤알을 산다 ────────────────────────────────────
  const bought = w.ok("r1", "shop.buy", { productId: "random" });
  assert.equal(bought.spent, 120);
  assert.equal(w.save().points.balance, 0, "포인트를 다 썼다");
  const eggId = String(bought.eggId);
  assert.equal(w.save().eggs.length, 1);
  assert.deepStrictEqual(w.save().eggs[0]?.candidates, ["charmander", "squirtle", "pichu"], "해금한 종이 후보");
  process.stdout.write("(2) SC-03 · 랜덤알 구매와 후보 저장  ok\n");

  // 같은 요청을 다시 보내도 알이 늘지 않는다
  const again = w.run("r1", "shop.buy", { productId: "random" });
  assert.ok(again.ok && again.replayed, "중복 요청은 재생");
  assert.equal(w.save().eggs.length, 1, "알은 하나뿐");
  process.stdout.write("(3) 중복 요청 · 알이 늘지 않는다  ok\n");

  // ── SC-04 시간을 흘려 부화한다 — 알 돌봄은 없다(2026-09-28 삭제) ─────────
  w.pass(3 * MIN);
  const egg = w.save().eggs[0];
  assert.equal(egg?.remainMs, EGG_V3_RULES.readyMs - 3 * MIN, "5분에서 흐른 3분만 줄어든다");
  process.stdout.write("(4) SC-04 · 준비 시간은 흐른 시간만큼 줄어든다  ok\n");

  const events = w.pass(5 * MIN);
  assert.deepStrictEqual(events.hatchReady, [eggId], "준비 완료를 알린다");
  assert.equal(w.save().eggs[0]?.ready, true);
  process.stdout.write("(5) SC-04 · 시간이 지나 준비 완료  ok\n");

  // 열기 — 산 때의 후보에서 나온다.
  // 첫 값은 랜덤알의 다른 알 추첨이다(data/eggs.json random.bonus 합 5.5%). 0.99 면 나오지 않는다
  const candidates = w.save().eggs[0]?.candidates ?? [];
  w.setRolls([0.99, 0, 0.5, 0.5]);
  const hatched = w.ok("open1", "egg.open", { eggId });
  const after = w.save();
  assert.equal(after.eggs.length, 0, "알이 사라졌다");
  assert.equal(after.pets.length, 2, "개체가 늘었다");
  const born = String(hatched.petId);
  assert.ok(candidates.includes(String(hatched.species)), "알의 후보에서 나온다");
  assert.ok(after.dex.obtained.includes(String(hatched.species)), "획득 기록");
  const slot = after.party.slots.find((s) => s.petId === born);
  assert.equal(slot?.hidden, false, "새 개체는 꺼낸 상태로 들어간다");
  process.stdout.write("(6) SC-04 · 부화와 배치  ok\n");

  // ── SC-05 두 마리가 보인다 — 새 개체는 꺼낸 상태로 들어왔다 ─────────────────
  const shown = w.save().party.slots.filter((s) => s.state === "pokemon" && s.hidden !== true).length;
  assert.equal(shown, 2, "두 마리가 보인다");
  process.stdout.write("(7) SC-05 · 두 마리 함께 꺼내기  ok\n");

  // ── SC-02 시간이 흐르면 만복도가 줄고 포인트가 쌓인다 ────────────────────
  // 앞의 돌봄 사이에 이미 8분이 흘러 포인트가 조금 쌓여 있다. 증가분으로 본다
  const before = w.save();
  const tick = w.pass(2 * HOUR);
  const grown = w.save();
  const dropped = (before.pets.find((p) => p.id === "p1")?.fullness ?? 0) - (grown.pets.find((p) => p.id === "p1")?.fullness ?? 0);
  assert.equal(dropped, 60, "2시간에 60 감소");
  assert.equal(grown.points.balance - before.points.balance, tick.pointsGained, "이번 틱에 쌓인 만큼 늘었다");
  assert.ok(tick.pointsGained >= 100, "두 마리가 2시간이면 100 이상");
  assert.ok(tick.hungerEnter.length >= 1, "배고픔 구간 진입을 알린다");
  process.stdout.write("(8) SC-02 · 만복도 감소와 포인트 적립  ok\n");

  // ── SC-02 밥을 준다 ──────────────────────────────────────────────────────
  const hungry = w.save().pets.find((p) => p.id === "p1")?.fullness ?? 0;
  const fed = w.ok("feed1", "bag.use", { itemId: "basic-food", petId: "p1" });
  assert.equal(Number(fed.fullness) - hungry, 20, "만복도 +20");
  const blocked = w.run("feed2", "bag.use", { itemId: "basic-food", petId: "p1" });
  assert.equal(blocked.ok === false && blocked.reason, "cooldown", "쿨타임 중에는 못 준다");
  w.pass(SAVE_V3_RULES.feedCooldownMs);
  const waited = w.save().pets.find((p) => p.id === "p1")?.fullness ?? 0;
  assert.equal(Number(w.ok("feed3", "bag.use", { itemId: "basic-food", petId: "p1" }).fullness) - waited, 20, "쿨타임 뒤 다시 준다");
  process.stdout.write("(9) SC-02 · 밥 주기와 쿨타임  ok\n");

  // ── SC-06 사탕으로 레벨을 올린다 ─────────────────────────────────────────
  w.ok("buy2", "shop.buy", { productId: "exp-candy-m" });
  const leveled = w.ok("use1", "bag.use", { itemId: "exp-candy-m", petId: "p1" });
  assert.ok(Number(leveled.level) > 1, "레벨이 올랐다");
  assert.equal(w.save().bag["exp-candy-m"], undefined, "사탕을 다 썼다");
  process.stdout.write("(10) SC-06 · 경험사탕으로 레벨 상승  ok\n");

  // ── SC-07 박스에 보관하고 다시 배치한다 ──────────────────────────────────
  w.ok("keep1", "party.keep", { petId: born });
  const kept = w.save();
  assert.ok(kept.boxes[0]?.slots.includes(born), "박스로 갔다");
  assert.equal(kept.party.slots.filter((s) => s.state === "pokemon").length, 1);
  // 박스에 있는 동안에는 시간이 멈춘다
  const boxedBefore = kept.pets.find((p) => p.id === born)?.fullness ?? 0;
  w.pass(4 * HOUR);
  assert.equal(w.save().pets.find((p) => p.id === born)?.fullness, boxedBefore, "박스 개체는 그대로");
  w.ok("place1", "party.place", { petId: born });
  const placed = w.save();
  assert.equal(placed.party.slots.find((s) => s.petId === born)?.hidden, false, "돌아와도 꺼낸 상태로 시작");
  process.stdout.write("(11) SC-07 · 보관 중 정지와 재배치  ok\n");

  // ── SC-09 파티 칸을 산다 ─────────────────────────────────────────────────
  const rich = w.save();
  rich.points.balance = 1000;
  assert.equal(store.write(file, rich), true);
  const slotBuy = w.ok("buy3", "shop.buy", { productId: "party-slot" });
  assert.equal(slotBuy.spent, 500, "파티 칸은 500P");
  const open = w.save().party.slots.filter((s) => s.state === "empty").length;
  assert.equal(open, 1, "빈 칸이 하나 늘었다");
  process.stdout.write("(12) SC-09 · 파티 칸 구매  ok\n");

  // ── SC-10 다시 열어도 이어진다 ───────────────────────────────────────────
  const reopened = store.read(file, { repair: false });
  assert.ok(reopened.state);
  assert.equal(reopened.migrated, false, "이미 v3 이라 옮기지 않는다");
  assert.equal(reopened.state.pets.length, 2);
  assert.equal(reopened.state.tx.length >= 8, true, "완료한 요청이 남아 있다");
  process.stdout.write("(13) SC-10 · 다시 열어도 이어진다  ok\n");

  process.stdout.write("selftest-flow: 통과 (구매→돌봄→부화→꺼내기→시간→돌봄→레벨→보관→칸→재개)\n");
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 지우지 못해도 검사 결과는 그대로다
  }
}
