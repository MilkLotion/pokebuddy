// 시간 처리 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-time.js
//
// 테스트 프레임워크 없이 assert 만. 파일을 만들지 않는다 — 값만으로 확인한다.
// 계약은 docs/specs/modules.md "시간 처리 순서", 수치는 docs/specs/balance.md 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { empty } from "../../save/v3";
import { affinityPercent, buffPercent, carePercent, zoneOf } from "../../state/time";
import { applyTimeAndSettle as applyTime } from "../../tx/tick"; // 시간 적용 + 후처리 사슬 — 옛 applyTime 과 같은 동작
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { TIME_RULES } from "../../state/rules";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const HOUR = 3_600_000;
const MIN = 60_000;

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
  daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

// 개체 하나가 파티 첫 칸에 있는 저장
function seed(over: Partial<PetV3> = {}): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet(over));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  return s;
}

// (1) 만복도는 시간당 30 줄어든다
{
  const s = seed();
  applyTime(s, 2 * HOUR, T0 + 2 * HOUR);
  assert.equal(s.pets[0]?.fullness, 40, "2시간에 60 감소");
  assert.equal(s.lastTickAt, T0 + 2 * HOUR);
  process.stdout.write("(1) 만복도 · 시간당 30  ok\n");
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
  const fast = seed({ affinity: 100, mood: 59 }); // 기분 보통 — 돌봄 보너스가 없다
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
  assert.equal(s.points.balance, 10, "숨겨도 적립한다");
  assert.equal(s.pets[0]?.affinity, 2);
  process.stdout.write("(6) 숨김 · 적립은 이어진다  ok\n");
}

// (7) 버프는 더한다. 든든함과 신남이 함께면 2.5배. 들뜸은 ×1.2, 신남이 있으면 들뜸은 세지 않는다 (2026-09-29 사용자 결정 — 수치, 교체는 제안)
{
  assert.equal(buffPercent([]), 100);
  assert.equal(buffPercent([{ kind: "premium-food", remainMs: MIN }]), 200);
  assert.equal(buffPercent([{ kind: "long-play", remainMs: MIN }]), 150);
  assert.equal(buffPercent([{ kind: "premium-food", remainMs: MIN }, { kind: "long-play", remainMs: MIN }]), 250);
  assert.equal(buffPercent([{ kind: "long-play", remainMs: MIN }, { kind: "long-play", remainMs: MIN }]), 150, "같은 버프는 겹치지 않는다");
  assert.equal(buffPercent([{ kind: "short-play", remainMs: MIN }]), 120, "들뜸 ×1.2");
  assert.equal(buffPercent([{ kind: "premium-food", remainMs: MIN }, { kind: "short-play", remainMs: MIN }]), 220, "든든함 + 들뜸");
  assert.equal(buffPercent([{ kind: "long-play", remainMs: MIN }, { kind: "short-play", remainMs: MIN }]), 150, "신남이 있으면 들뜸은 세지 않는다");
  const s = seed({ buffs: [{ kind: "premium-food", remainMs: HOUR }] });
  applyTime(s, 30 * MIN, T0 + 30 * MIN);
  assert.equal(s.pets[0]?.affinity, 6, "두 배로 쌓인다");
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
  const a = applyTime(s, 10 * MIN, T0 + 10 * MIN); // 42 → 37, 배고픔 진입
  assert.deepStrictEqual(a.hungerEnter, [{ petId: "p1", zone: "hungry" }]);
  const b = applyTime(s, 10 * MIN, T0 + 20 * MIN); // 37 → 32, 같은 구간
  assert.deepStrictEqual(b.hungerEnter, [], "같은 구간 안에서는 알리지 않는다");
  const c = applyTime(s, 40 * MIN, T0 + 60 * MIN); // 매우 배고픔 진입
  assert.deepStrictEqual(c.hungerEnter, [{ petId: "p1", zone: "starving" }]);
  const full = seed({ fullness: 70 });
  const d = applyTime(full, 20 * MIN, T0 + 20 * MIN); // 70 → 60, 보통으로 내려가도 조용하다
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

// (13) 에이전트 작업 보너스 — 작업한 시간만큼 친밀도와 포인트를 한 번 더 쌓는다
{
  const base = seed();
  applyTime(base, HOUR, T0 + HOUR);
  const working = seed();
  applyTime(working, HOUR, T0 + HOUR, { workMs: HOUR });
  assert.equal(base.pets[0]?.affinity, 6, "기본은 1시간에 친밀도 6");
  assert.equal(working.pets[0]?.affinity, 12, "작업한 1시간은 2배");
  assert.ok(working.points.balance >= base.points.balance * 2 - 1, "포인트도 2배");
  assert.equal(working.pets[0]?.fullness, base.pets[0]?.fullness, "만복도 감소는 그대로");
  assert.equal(working.pets[0]?.daily.work, HOUR, "오늘 작업 적립을 가중 시간으로 남긴다");
  assert.equal(working.totals.workMs, HOUR);
  process.stdout.write("(13) 작업 보너스 · 적립 2배  ok\n");
}

// (14) 작업 시간은 흐른 시간을 넘지 않는다. 박스 개체는 받지 않는다
{
  const s = seed();
  s.pets.push(pet({ id: "p2" })); // 파티 칸에 없다 — 박스와 같다
  applyTime(s, HOUR, T0 + HOUR, { workMs: 5 * HOUR });
  assert.equal(s.pets[0]?.affinity, 12, "흐른 시간만큼만 더한다");
  assert.equal(s.pets[1]?.affinity, 0, "파티 밖 개체는 받지 않는다");
  assert.equal(s.pets[1]?.daily.work, 0);
  process.stdout.write("(14) 작업 보너스 · 상한과 대상  ok\n");
}

// (15) 기분 — 파티 개체는 10분에 1 줄고, 배고프면 2배·매우 배고프면 3배로 준다
{
  const s = seed({ mood: 60 });
  applyTime(s, HOUR, T0 + HOUR);
  assert.equal(s.pets[0]?.mood, 54, "배부른 1시간에 6 감소");
  const hungry = seed({ mood: 60, fullness: 30 });
  applyTime(hungry, 10 * MIN, T0 + 10 * MIN);
  assert.equal(hungry.pets[0]?.mood, 58, "배고픔 구간 10분에 2 감소");
  const starving = seed({ mood: 60, fullness: 10 });
  applyTime(starving, 10 * MIN, T0 + 10 * MIN);
  assert.equal(starving.pets[0]?.mood, 57, "매우 배고픔 구간 10분에 3 감소");
  process.stdout.write("(15) 기분 · 시간 감소와 배고픔 배율  ok\n");
}

// (16) 기분 — 박스 개체는 멈춘다. 0 아래로 가지 않는다. 틱을 나눠도 같다
{
  const s = seed({ mood: 1 });
  s.pets.push(pet({ id: "p2", mood: 60 })); // 파티 칸에 없다 — 박스와 같다
  applyTime(s, HOUR, T0 + HOUR);
  assert.equal(s.pets[0]?.mood, 0, "0 에서 멈춘다");
  assert.equal(s.pets[1]?.mood, 60, "파티 밖 개체는 줄지 않는다");
  const long = seed({ mood: 80 });
  applyTime(long, HOUR, T0 + HOUR);
  const short = seed({ mood: 80 });
  for (let i = 0; i < 60; i++) applyTime(short, MIN, T0 + (i + 1) * MIN);
  assert.equal(short.pets[0]?.mood, long.pets[0]?.mood, "짧은 틱 여러 번과 긴 틱 한 번이 같다");
  process.stdout.write("(16) 기분 · 박스·바닥·틱 나누기  ok\n");
}

// (17) 돌봄 보너스 — 친밀도 100 인 개체는 기분 단계와 버프가 포인트 적립을 올린다 (2026-10-02 사용자 결정)
{
  const earn = (over: Partial<PetV3>): number => {
    const s = seed(over);
    applyTime(s, 20 * MIN, T0 + 20 * MIN);
    return s.points.balance;
  };
  const food = [{ kind: "premium-food" as const, remainMs: 2 * HOUR }];
  const long = [{ kind: "long-play" as const, remainMs: 2 * HOUR }];
  const short = [{ kind: "short-play" as const, remainMs: 2 * HOUR }];
  assert.equal(earn({ affinity: 100, mood: 60 }), 23, "좋음 +15%");
  assert.equal(earn({ affinity: 100, mood: 79 }), 23, "79 까지 좋음");
  assert.equal(earn({ affinity: 100, mood: 80 }), 26, "최고 +30%");
  assert.equal(earn({ affinity: 100, mood: 0, buffs: food }), 40, "든든함 +100%");
  assert.equal(earn({ affinity: 100, mood: 0, buffs: long }), 30, "신남 +50%");
  assert.equal(earn({ affinity: 100, mood: 0, buffs: short }), 24, "들뜸 +20%");
  assert.equal(earn({ affinity: 100, mood: 100, buffs: [...food, ...long] }), 56, "더한다 — 100 + 100 + 50 + 30");
  assert.equal(carePercent(pet({ affinity: 100, mood: 100, buffs: [...food, ...long, ...short] })), 280, "신남이 있으면 들뜸은 세지 않는다");
  // 친밀도 100 미만은 지금과 같다 — 기분과 버프가 포인트를 바꾸지 않는다
  assert.equal(carePercent(pet({ affinity: 99, mood: 100, buffs: food })), 100);
  assert.equal(earn({ affinity: 0, mood: 100, fullness: 10, buffs: food }), 10, "친밀도 0 은 2분에 1 그대로");
  // 배고픔은 포인트를 직접 깎지 않는다
  assert.equal(earn({ affinity: 100, mood: 59, fullness: 10 }), 20, "매우 배고픔이어도 기본 속도");
  assert.equal(earn({ affinity: 100, mood: 0, fullness: 10, buffs: food }), 40, "배고픔이 버프 보너스를 깎지 않는다");
  // 작업 보너스와는 곱해진다 — 적립 시간을 두 번 센다
  const working = seed({ affinity: 100, mood: 80 });
  applyTime(working, 20 * MIN, T0 + 20 * MIN, { workMs: 20 * MIN });
  assert.equal(working.points.balance, 52, "작업한 20분은 26 의 두 배");
  process.stdout.write("(17) 돌봄 보너스 · 기분과 버프  ok\n");
}

process.stdout.write("selftest-time: 통과 (만복도·친밀도·포인트·버프·구간·알·작업 보너스·기분·돌봄 보너스)\n");
