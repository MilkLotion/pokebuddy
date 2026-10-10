// 시간 처리 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-time.js
//
// 테스트 프레임워크 없이 assert 만. 파일을 만들지 않는다 — 값만으로 확인한다.
// 계약은 docs/specs/modules.md "시간 처리 순서", 수치는 docs/specs/balance.md 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { emptySave as empty } from "../../save/normalize";
import { affinityPercent, boredStepOf, buffPercent, pointIntervalMs, pointPercent, zoneOf } from "../../state/time";
import { applyTimeAndSettle as applyTime } from "../../tx/tick"; // 시간 적용 + 후처리 사슬 — 옛 applyTime 과 같은 동작
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { TIME_RULES } from "../../state/rules";
import { applyPreset } from "../../party/presets";
import { T0 } from "../harness/clock"; // 2026-09-24 10:00 로컬 — 게임 시간 낮
import { testPet } from "../harness/fixtures";

const HOUR = 3_600_000;
const MIN = 60_000;

// 시험 개체 — newPet 결과에 크기 2 와 over 를 덮는다 (src/tools/harness/fixtures.ts)
const pet = (over: Partial<PetV3> = {}): PetV3 => testPet({ size: 2, ...over });

// 개체 하나가 파티 첫 칸에 있는 저장
function seed(over: Partial<PetV3> = {}): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet(over));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  return s;
}

// (1) 만복도는 시간당 40 줄어든다 (2026-10-05 돌봄 개편, 그 전에는 30)
{
  const s = seed();
  applyTime(s, 2 * HOUR, T0 + 2 * HOUR);
  assert.equal(s.pets[0]?.fullness, 20, "2시간에 80 감소");
  assert.equal(s.lastTickAt, T0 + 2 * HOUR);
  process.stdout.write("(1) 만복도 · 시간당 40  ok\n");
}

// (2) 짧은 틱을 여러 번 돌려도 긴 틱 한 번과 같다
{
  const long = seed();
  applyTime(long, HOUR, T0 + HOUR);
  const short = seed();
  for (let i = 0; i < 60; i++) applyTime(short, MIN, T0 + (i + 1) * MIN);
  assert.equal(short.pets[0]?.fullness, long.pets[0]?.fullness, "만복도가 같다");
  assert.equal(short.pets[0]?.affinity, long.pets[0]?.affinity, "친밀도가 같다");
  // 포인트는 친밀도에 따라 속도가 달라진다. 틱을 나누면 오른 친밀도가 더 빨리 반영되어 1 차이까지 난다
  assert.ok(Math.abs(short.points.balance - long.points.balance) <= 1, "포인트 차이는 1 이하");
  process.stdout.write("(2) 부분 진행 · 틱을 나눠도 같다  ok\n");
}

// (3) 친밀도는 10분에 1. 배부른 구간에서는 배율이 없다
{
  const s = seed();
  applyTime(s, 30 * MIN, T0 + 30 * MIN);
  assert.equal(s.pets[0]?.affinity, 3, "30분에 3");
  process.stdout.write("(3) 친밀도 · 10분에 1  ok\n");
}

// (4) 포인트는 2분에 1. 친밀도가 100 이면 두 배
{
  const s = seed();
  applyTime(s, 20 * MIN, T0 + 20 * MIN);
  assert.equal(s.points.balance, 10, "20분에 10");
  const fast = seed({ affinity: 100 });
  applyTime(fast, 20 * MIN, T0 + 20 * MIN);
  assert.equal(fast.points.balance, 20, "친밀도 100 이면 두 배");
  process.stdout.write("(4) 포인트 · 친밀도로 빨라진다  ok\n");
}

// (5) 박스에 있는 개체는 시간이 멈춘다
{
  const s = seed();
  s.party.slots[0] = { state: "empty" };
  const box = s.boxes[0];
  if (box) box.slots[0] = "p1";
  applyTime(s, 4 * HOUR, T0 + 4 * HOUR);
  assert.equal(s.pets[0]?.fullness, 100, "만복도가 그대로");
  assert.equal(s.pets[0]?.affinity, 0, "친밀도가 그대로");
  assert.equal(s.points.balance, 0, "적립도 멈춘다");
  process.stdout.write("(5) 박스 보관 · 시간이 멈춘다  ok\n");
}

// (6) 숨겨도 시간은 흐른다
{
  const s = seed();
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  applyTime(s, 20 * MIN, T0 + 20 * MIN);
  assert.equal(s.points.balance, 10, "숨겨도 적립한다 (2026-10-05 사용자 결정 숨김은 정배)");
  assert.equal(s.pets[0]?.affinity, 2, "친밀도는 그대로 쌓인다");
  assert.equal(s.pets[0]?.fullness, 87, "만복도도 그대로 준다");
  const care = seed({ affinity: 100, buffs: [{ kind: "premium-food", remainMs: 2 * HOUR }] });
  care.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  applyTime(care, 20 * MIN, T0 + 20 * MIN);
  assert.equal(care.points.balance, 32, "볼 안도 버프를 받는다 — 든든함 +60%");
  process.stdout.write("(6) 숨김 · 적립은 이어진다  ok\n");
}

// (7) 버프는 더한다. 든든함 +60 · 신남 +60 (2026-10-05 돌봄 개편, 놀아주기 신남은 "b로 하자" 로 없앴다)
{
  assert.equal(buffPercent([]), 100);
  assert.equal(buffPercent([{ kind: "premium-food", remainMs: MIN }]), 160);
  assert.equal(buffPercent([{ kind: "long-play", remainMs: MIN }]), 160);
  assert.equal(buffPercent([{ kind: "premium-food", remainMs: MIN }, { kind: "long-play", remainMs: MIN }]), 220);
  assert.equal(buffPercent([{ kind: "long-play", remainMs: MIN }, { kind: "long-play", remainMs: MIN }]), 160, "같은 버프는 겹치지 않는다");
  assert.equal(buffPercent([{ kind: "long-play", remainMs: 0 }]), 100, "끝난 버프는 세지 않는다");
  const s = seed({ buffs: [{ kind: "premium-food", remainMs: HOUR }] });
  applyTime(s, 30 * MIN, T0 + 30 * MIN);
  assert.equal(s.pets[0]?.affinity, 4, "1.6배로 쌓인다 — 30분 × 1.6 = 48분");
  assert.equal(s.pets[0]?.buffs[0]?.remainMs, HOUR - 30 * MIN, "남은 시간이 준다");
  process.stdout.write("(7) 버프 · 더하고 시간이 준다  ok\n");
}

// (8) 배고픔 구간은 친밀도 증가를 깎는다
{
  assert.equal(zoneOf(100), "full");
  assert.equal(zoneOf(60), "full");
  assert.equal(zoneOf(59), "normal");
  assert.equal(zoneOf(40), "normal");
  assert.equal(zoneOf(39), "hungry");
  assert.equal(zoneOf(15), "hungry");
  assert.equal(zoneOf(14), "starving");
  assert.equal(affinityPercent(pet({ fullness: 30 })), TIME_RULES.zonePercent.hungry);
  assert.equal(affinityPercent(pet({ fullness: 5 })), TIME_RULES.zonePercent.starving);
  process.stdout.write("(8) 만복도 구간과 디버프  ok\n");
}

// (9) 배고픔과 매우 배고픔에 들어갈 때만 알린다
{
  const s = seed({ fullness: 42 });
  const a = applyTime(s, 10 * MIN, T0 + 10 * MIN); // 42 → 36, 배고픔 진입 (시간당 40)
  assert.deepStrictEqual(a.hungerEnter, [{ petId: "p1", zone: "hungry" }]);
  const b = applyTime(s, 10 * MIN, T0 + 20 * MIN); // 36 → 29, 같은 구간
  assert.deepStrictEqual(b.hungerEnter, [], "같은 구간 안에서는 알리지 않는다");
  const c = applyTime(s, 40 * MIN, T0 + 60 * MIN); // 매우 배고픔 진입
  assert.deepStrictEqual(c.hungerEnter, [{ petId: "p1", zone: "starving" }]);
  const full = seed({ fullness: 70 });
  const d = applyTime(full, 20 * MIN, T0 + 20 * MIN); // 70 → 57, 보통으로 내려가도 조용하다
  assert.deepStrictEqual(d.hungerEnter, [], "보통 구간은 알리지 않는다");
  process.stdout.write("(9) 말풍선 · 두 구간 진입만  ok\n");
}

// (10) 알은 준비 시간이 줄고 끝나면 한 번만 알린다
{
  const s = seed();
  s.eggs.push({ id: "e1", kind: "random", boughtAt: T0, remainMs: 5 * MIN, ready: false, candidates: [], careCooldownMs: 30_000, actions: { pat: 0, song: 0 } });
  const a = applyTime(s, 2 * MIN, T0 + 2 * MIN);
  assert.deepStrictEqual(a.hatchReady, []);
  assert.equal(s.eggs[0]?.remainMs, 3 * MIN);
  const b = applyTime(s, 3 * MIN, T0 + 5 * MIN);
  assert.deepStrictEqual(b.hatchReady, ["e1"]);
  assert.equal(s.eggs[0]?.ready, true);
  const c = applyTime(s, MIN, T0 + 6 * MIN);
  assert.deepStrictEqual(c.hatchReady, [], "이미 알린 알은 다시 알리지 않는다");
  process.stdout.write("(10) 알 · 준비 완료를 한 번만 알린다  ok\n");
}

// (11) 밥 쿨타임은 0 아래로 내려가지 않는다
{
  const s = seed({ feedCooldownMs: 3 * MIN });
  applyTime(s, 10 * MIN, T0 + 10 * MIN);
  assert.equal(s.pets[0]?.feedCooldownMs, 0);
  process.stdout.write("(11) 쿨타임 · 0 에서 멈춘다  ok\n");
}

// (12) 흐른 시간이 없으면 아무것도 바꾸지 않는다
{
  const s = seed();
  const res = applyTime(s, 0, T0 + 1000);
  assert.deepStrictEqual(res.hatchReady, []);
  assert.equal(s.pets[0]?.fullness, 100);
  assert.equal(s.lastTickAt, T0 + 1000, "마지막 틱 시각은 갱신한다");
  process.stdout.write("(12) 흐른 시간 0  ok\n");
}

// (13) 에이전트 작업 시간 — 누적만 센다. 친밀도·포인트를 더 쌓지 않는다 (2026-10-05 사용자 결정 "cli 적립2배는 없애고")
{
  const base = seed();
  applyTime(base, HOUR, T0 + HOUR);
  const working = seed();
  applyTime(working, HOUR, T0 + HOUR, { workMs: HOUR });
  assert.equal(base.pets[0]?.affinity, 6, "기본은 1시간에 친밀도 6");
  assert.equal(working.pets[0]?.affinity, 6, "작업해도 친밀도는 같다");
  assert.equal(working.points.balance, base.points.balance, "포인트도 같다");
  assert.equal(working.pets[0]?.daily.work, 0, "옛 작업 적립 칸은 쌓지 않는다");
  assert.equal(working.totals.workMs, HOUR, "누적 작업 시간은 센다 — 업적·로토무");
  assert.deepEqual([base.pets[0]?.boredom, working.pets[0]?.boredom], [30, 60], "심심함은 작업 시간만큼 한 번 더 쌓인다");
  process.stdout.write("(13) 작업 시간 · 누적만 센다  ok\n");
}

// (14) 작업 시간은 흐른 시간을 넘지 않는다
{
  const s = seed();
  s.pets.push(pet({ id: "p2" })); // 파티 칸에 없다 — 박스와 같다
  applyTime(s, HOUR, T0 + HOUR, { workMs: 5 * HOUR });
  assert.equal(s.totals.workMs, HOUR, "흐른 시간만큼만 센다");
  assert.equal(s.pets[1]?.affinity, 0, "파티 밖 개체는 시간이 멈춘다");
  process.stdout.write("(14) 작업 시간 · 상한  ok\n");
}

// (15) 심심함 — 파티 개체는 시간당 +30, 에이전트 작업 중이면 +60. 100 을 넘지 않는다. 박스는 멈춘다. 틱을 나눠도 같다 (2026-10-05 돌봄 개편)
{
  const s = seed();
  applyTime(s, HOUR, T0 + HOUR);
  assert.equal(s.pets[0]?.boredom, 30, "1시간에 +30");
  const top = seed({ boredom: 95 });
  s.pets.push(pet({ id: "p2", boredom: 40 })); // 파티 칸에 없다 — 박스와 같다
  applyTime(top, HOUR, T0 + HOUR);
  assert.equal(top.pets[0]?.boredom, 100, "100 에서 멈춘다");
  applyTime(s, HOUR, T0 + 2 * HOUR);
  assert.equal(s.pets[1]?.boredom, 40, "파티 밖 개체는 쌓이지 않는다");
  const long = seed();
  applyTime(long, HOUR, T0 + HOUR, { workMs: 30 * MIN });
  const short = seed();
  for (let i = 0; i < 60; i++) applyTime(short, MIN, T0 + (i + 1) * MIN, { workMs: i < 30 ? MIN : 0 });
  assert.equal(short.pets[0]?.boredom, long.pets[0]?.boredom, "짧은 틱 여러 번과 긴 틱 한 번이 같다");
  assert.equal(long.pets[0]?.boredom, 45, "30분 작업 + 1시간 = 45");
  process.stdout.write("(15) 심심함 · 시간·작업·상한·박스·틱 나누기  ok\n");
}

// (16) 심심함 단계 — 50 이상 심심해, 80 이상 지루해 (2026-10-05 사용자 결정 "심심해 / 지루해 2스텝")
{
  assert.equal(boredStepOf(0), null);
  assert.equal(boredStepOf(49), null);
  assert.equal(boredStepOf(50), "bored");
  assert.equal(boredStepOf(79), "bored");
  assert.equal(boredStepOf(80), "tired");
  assert.equal(boredStepOf(100), "tired");
  process.stdout.write("(16) 심심함 단계  ok\n");
}

// (17) 포인트 적립 배율 — 100 + 버프 − 손해(배고픔 −30·매우 −60, 심심해 −10·지루해 −20). 곱하지 않고 더한다. 친밀도와 상관없다 (2026-10-05 사용자 결정)
{
  const earn = (over: Partial<PetV3>): number => {
    const s = seed(over);
    applyTime(s, 20 * MIN, T0 + 20 * MIN);
    return s.points.balance;
  };
  const food = [{ kind: "premium-food" as const, remainMs: 2 * HOUR }];
  const long = [{ kind: "long-play" as const, remainMs: 2 * HOUR }];
  assert.equal(earn({ affinity: 100 }), 20, "기본");
  assert.equal(earn({ affinity: 100, buffs: food }), 32, "든든함 +60%");
  assert.equal(earn({ affinity: 100, buffs: long }), 32, "신남 +60%");
  assert.equal(earn({ affinity: 100, buffs: [...food, ...long] }), 44, "더한다 — 100 + 60 + 60");
  assert.equal(pointPercent(pet({ affinity: 100, buffs: [...food, ...long] })), 220, "최대 220");
  assert.equal(earn({ affinity: 100, fullness: 30 }), 14, "배고픔 −30%");
  assert.equal(earn({ affinity: 100, fullness: 10 }), 8, "매우 배고픔 −60%");
  assert.equal(earn({ affinity: 100, boredom: 60 }), 18, "심심해 −10%");
  assert.equal(earn({ affinity: 100, boredom: 90 }), 16, "지루해 −20%");
  assert.equal(earn({ affinity: 100, fullness: 10, boredom: 90 }), 4, "매우 배고픔 + 지루해 = 20%");
  // 1P 간격 — 120초 ÷ (1 + 친밀도/100) ÷ 배율. 파티 상세 `포인트 적립` 줄이 보인다 (2026-10-10)
  assert.deepEqual(
    [pet({ affinity: 0 }), pet({ affinity: 50 }), pet({ affinity: 100 }), pet({ affinity: 100, buffs: long }), pet({ affinity: 100, buffs: [...food, ...long] }), pet({ affinity: 100, fullness: 10 })].map(pointIntervalMs),
    [120_000, 80_000, 60_000, 37_500, 27_273, 150_000],
  );
  assert.equal(earn({ affinity: 100, fullness: 30, buffs: long }), 26, "신남이 배고픔을 메운다 — 100 + 60 − 30");
  assert.equal(earn({ affinity: 0, buffs: food }), 16, "친밀도 0 도 버프를 받는다 — 10P × 1.6");
  const working = seed({ affinity: 100 });
  applyTime(working, 20 * MIN, T0 + 20 * MIN, { workMs: 20 * MIN });
  assert.equal(working.points.balance, 20, "작업해도 포인트는 같다");
  process.stdout.write("(17) 포인트 적립 배율 · 버프와 손해를 더한다  ok\n");
}

// (18) 다른 프리셋 — 포인트만 0.2배, 버프·손해 없음. 나머지 시간은 멈춘다 (2026-10-05 사용자 결정 "프리셋의 포켓몬들은 0.2배")
{
  const other = (over: Partial<PetV3> = {}): SaveV3 => {
    const s = empty(T0);
    s.pets.push(pet({ id: "p2", ...over }));
    const slots = s.party.presets?.[1];
    assert.ok(slots, "빈 저장에는 둘째 프리셋이 있다");
    slots[0] = { state: "pokemon", petId: "p2", hidden: false };
    return s;
  };
  const food = [{ kind: "premium-food" as const, remainMs: 2 * HOUR }];
  const a = other({ affinity: 100, boredom: 90, fullness: 30, buffs: food });
  applyTime(a, 20 * MIN, T0 + 20 * MIN);
  assert.equal(a.points.balance, 4, "친밀도 100 은 20분 20P × 0.2 — 버프·손해 없음");
  assert.equal(a.pets[0]?.fullness, 30, "만복도는 멈춘다");
  assert.equal(a.pets[0]?.boredom, 90, "심심함은 멈춘다");
  assert.equal(a.pets[0]?.buffs[0]?.remainMs, 2 * HOUR, "버프 시간은 멈춘다");
  const b = other({ affinity: 0 });
  applyTime(b, HOUR, T0 + HOUR, { workMs: HOUR });
  assert.equal(b.points.balance, 6, "한 시간 30P × 0.2 — 작업해도 같다");
  assert.equal(b.pets[0]?.affinity, 0, "친밀도는 멈춘다");
  // 박스는 그대로 0 — 프리셋에 없는 개체
  const box = empty(T0);
  box.pets.push(pet({ id: "p3", affinity: 100 }));
  applyTime(box, HOUR, T0 + HOUR);
  assert.equal(box.points.balance, 0, "박스는 적립하지 않는다");
  process.stdout.write("(18) 다른 프리셋 · 포인트만 0.2배  ok\n");
}

// (19) 프리셋을 적용하면 새로 적용한 프리셋의 숨김이 풀린다. 떠난 프리셋의 숨김은 남는다 (2026-10-05 사용자 결정)
{
  const s = seed();
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  s.pets.push(pet({ id: "p2" }));
  const slots = s.party.presets?.[1];
  assert.ok(slots);
  slots[0] = { state: "pokemon", petId: "p2", hidden: true };
  assert.equal(applyPreset(s, 1).ok, true);
  assert.equal(s.party.slots[0]?.hidden, false, "들어온 칸의 숨김이 풀린다");
  assert.equal(s.party.presets?.[0]?.[0]?.hidden, true, "떠난 칸은 그대로");
  assert.equal(applyPreset(s, 0).ok, true);
  assert.equal(s.party.slots[0]?.hidden, false, "돌아오면 풀린다");
  process.stdout.write("(19) 프리셋 적용 · 숨김 풀림  ok\n");
}

// (20) 로토무 개체 작업 시간 — 지금 파티(볼 안 포함)에서 받은 작업 시간만, 2시간에서 멈춘다. 박스·다른 프리셋은 멈춘다 (2026-10-05)
{
  const s = seed({ species: "rotom" });
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  applyTime(s, HOUR, T0 + HOUR);
  assert.equal(s.pets[0]?.workMs, undefined, "작업하지 않으면 늘지 않는다");
  applyTime(s, HOUR, T0 + 2 * HOUR, { workMs: 30 * MIN });
  assert.equal(s.pets[0]?.workMs, 30 * MIN, "볼 안이어도 작업한 만큼");
  applyTime(s, 3 * HOUR, T0 + 5 * HOUR, { workMs: 3 * HOUR });
  assert.equal(s.pets[0]?.workMs, 2 * HOUR, "2시간에서 멈춘다");
  const box = empty(T0);
  box.pets.push(pet({ id: "p2", species: "rotom" }));
  box.boxes[0]!.slots[0] = "p2";
  applyTime(box, HOUR, T0 + HOUR, { workMs: HOUR });
  assert.equal(box.pets[0]?.workMs, undefined, "박스는 멈춘다");
  process.stdout.write("(20) 로토무 개체 작업 시간  ok\n");
}

process.stdout.write("selftest-time: 통과 (만복도·친밀도·포인트·버프·구간·알·작업 보너스·기분·돌봄 보너스)\n");
