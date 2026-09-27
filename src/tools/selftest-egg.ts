// 알 돌봄·조건·부화 자체 확인 — npm run build 뒤 node dist/tools/selftest-egg.js
//
// 테스트 프레임워크 없이 assert 만. 무작위는 정해진 값을 넣어 결과를 고정한다.
// 계약은 docs/specs/game.md "알"과 "알 행동 조건", 표는 data/egg-conditions.json 이다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { care } from "../egg/care";
import { matchCondition, speciesOf, textOf } from "../egg/conditions";
import { decide, pickWeighted, RANK_WEIGHT } from "../egg/hatch";
import { open } from "../egg/open";
import { buy } from "../shop/buy";
import { canGiveEgg, eggPool } from "../shop/catalog";
import { dexDetail } from "../tx/dex-detail";
import { shopList } from "../tx/lists";
import { nextPetId } from "../party/create";
import { EGG_V3_RULES } from "../save/rules";
import { empty } from "../save/v3";
import type { EggV3, SaveV3 } from "../shared/save-v3";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const egg = (over: Partial<EggV3> = {}): EggV3 => ({
  id: "e1",
  kind: "random",
  boughtAt: T0,
  remainMs: EGG_V3_RULES.readyMs,
  ready: false,
  candidates: ["charmander", "squirtle"],
  careCooldownMs: 0,
  actions: { pat: 0, song: 0 },
  ...over,
});

function seed(e: Partial<EggV3> = {}): SaveV3 {
  const s = empty(T0);
  s.eggs.push(egg(e));
  return s;
}

// 랜덤알을 열 때 처음 뽑는 값 — 이 값이면 다른 알이 나오지 않는다 (data/eggs.json random.bonus 합 6%)
const NO_BONUS = 0.99;

// 정해진 값을 차례로 돌려주는 가짜 무작위
const fixed = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
};

// (1) 돌봄은 30초를 줄이고 쿨타임을 건다
{
  const e = egg();
  const res = care(e, "pat");
  assert.equal(res.ok, true);
  assert.equal(res.shortenedMs, EGG_V3_RULES.careShortenMs);
  assert.equal(e.remainMs, EGG_V3_RULES.readyMs - EGG_V3_RULES.careShortenMs);
  assert.equal(e.actions.pat, 1);
  assert.equal(e.careCooldownMs, EGG_V3_RULES.careCooldownMs);
  const again = care(e, "pat");
  assert.equal(again.ok, false);
  assert.equal(again.reason, "cooldown", "쿨타임 중에는 거절한다");
  assert.equal(e.actions.pat, 1, "횟수도 늘지 않는다");
  process.stdout.write("(1) 돌봄 · 30초 단축과 쿨타임  ok\n");
}

// (2) 남은 시간은 0 아래로 내려가지 않고, 0 이면 준비 완료다
{
  const e = egg({ remainMs: 10_000 });
  const res = care(e, "song");
  assert.equal(e.remainMs, 0);
  assert.equal(e.ready, true);
  assert.equal(res.shortenedMs, 10_000, "남은 만큼만 줄인다");
  process.stdout.write("(2) 돌봄 · 0 에서 멈추고 준비 완료  ok\n");
}

// (3) 준비가 끝난 뒤에도 조건은 계속 쌓인다
{
  const e = egg({ remainMs: 0, ready: true });
  assert.equal(care(e, "song").ok, true);
  assert.equal(e.actions.song, 1);
  assert.equal(e.remainMs, 0);
  process.stdout.write("(3) 준비 완료 뒤에도 조건 누적  ok\n");
}

// (4) 조건 판정 — 구간이 겹치지 않고 빈틈이 있다
{
  assert.equal(matchCondition({ pat: 0, song: 0 }), "none");
  assert.equal(matchCondition({ pat: 5, song: 0 }), "pat-3");
  assert.equal(matchCondition({ pat: 9, song: 0 }), "pat-8");
  assert.equal(matchCondition({ pat: 0, song: 4 }), "song-3");
  assert.equal(matchCondition({ pat: 0, song: 12 }), "song-8");
  assert.equal(matchCondition({ pat: 4, song: 4 }), "both-3");
  assert.equal(matchCondition({ pat: 9, song: 9 }), "both-8");
  assert.equal(matchCondition({ pat: 10, song: 4 }), null, "어디에도 맞지 않는 조합");
  assert.equal(matchCondition({ pat: 1, song: 0 }), null, "3회에 못 미치면 조건이 아니다");
  process.stdout.write("(4) 조건 판정 · 구간과 빈틈  ok\n");
}

// (5) 조건마다 대상 종이 있고 문구가 있다
{
  const ids = ["pat-3", "pat-8", "song-3", "song-8", "both-3", "both-8", "none"];
  for (const id of ids) {
    assert.ok(speciesOf(id).length >= 3, `${id} 은 종이 셋 이상`);
    assert.ok((textOf(id) ?? "").length > 0, `${id} 은 문구가 있다`);
  }
  assert.equal(speciesOf("both-8").length, 10, "600족 열 종");
  assert.equal(speciesOf("없는조건").length, 0);
  process.stdout.write("(5) 조건별 대상 종과 문구  ok\n");
}

// (6) 난이도 가중치 — 흔한 쪽이 먼저 뽑힌다
{
  assert.equal(RANK_WEIGHT[1], 100);
  assert.equal(RANK_WEIGHT[5], 1);
  // charmander 는 1등급, tyranitar 는 4등급. 가중치는 100 대 5
  assert.equal(pickWeighted(["charmander", "tyranitar"], fixed(0)), "charmander");
  assert.equal(pickWeighted(["charmander", "tyranitar"], fixed(0.99)), "tyranitar");
  assert.equal(pickWeighted([], fixed(0)), null);
  process.stdout.write("(6) 난이도 가중치 추첨  ok\n");
}

// (7) 조건을 채우면 후보 범위를 넘어선다
{
  const withCondition = decide({ pat: 9, song: 9 }, ["charmander"], fixed(0, 0.5));
  assert.ok(withCondition);
  assert.ok(speciesOf("both-8").includes(withCondition.species), "600족에서 나온다");
  assert.equal(withCondition.conditionId, "both-8");
  const plain = decide({ pat: 1, song: 0 }, ["charmander"], fixed(0, 0.5));
  assert.equal(plain?.species, "charmander", "조건이 없으면 알의 후보에서");
  assert.equal(plain?.conditionId, null);
  process.stdout.write("(7) 조건은 후보 범위를 넘어선다  ok\n");
}

// (8) 이로치는 따로 뽑는다
{
  const shiny = decide({ pat: 0, song: 0 }, ["charmander"], fixed(0, 0.0001));
  assert.equal(shiny?.shiny, true);
  const plain = decide({ pat: 0, song: 0 }, ["charmander"], fixed(0, 0.5));
  assert.equal(plain?.shiny, false);
  process.stdout.write("(8) 이로치 추첨  ok\n");
}

// (9) 열기 — 개체가 생기고 빈 파티 칸에 꺼낸 상태로 들어간다
{
  const s = seed({ remainMs: 0, ready: true, actions: { pat: 0, song: 0 } });
  const res = open(s, "e1", T0, fixed(NO_BONUS, 0, 0.5, 0.5));
  assert.equal(res.ok, true);
  assert.equal(s.pets.length, 1);
  assert.equal(s.pets[0]?.id, "p1");
  assert.equal(s.pets[0]?.level, 1);
  const slot = s.party.slots[res.slotIndex ?? -1];
  assert.equal(slot?.state, "pokemon");
  assert.equal(slot?.hidden, false, "꺼낸 상태로 들어간다");
  assert.equal(s.eggs.length, 0, "알은 사라진다");
  assert.ok(s.dex.obtained.includes(res.species ?? ""), "도감에 획득 기록");
  assert.ok(s.dex.unlocked.includes(res.species ?? ""), "해금 기록도 남는다");
  process.stdout.write("(9) 열기 · 개체 생성과 숨김 배치  ok\n");
}

// (10) 열기 — 파티가 가득 차면 박스로 간다
{
  const s = seed({ remainMs: 0, ready: true });
  for (let i = 0; i < s.party.slots.length; i++) s.party.slots[i] = { state: "locked", unlockBy: "shop" };
  const res = open(s, "e1", T0, fixed(NO_BONUS, 0, 0.5, 0.5));
  assert.equal(res.ok, true);
  assert.equal(res.toBox, true);
  assert.ok(s.boxes[0]?.slots.includes(res.petId ?? ""), "박스 첫 칸으로");
  process.stdout.write("(10) 열기 · 자리가 없으면 박스로  ok\n");
}

// (11) 열기 — 조건으로 나온 종은 발견을 기록한다
{
  const s = seed({ remainMs: 0, ready: true, actions: { pat: 9, song: 9 } });
  const res = open(s, "e1", T0, fixed(NO_BONUS, 0, 0.5, 0.5));
  assert.equal(res.ok, true);
  assert.equal(res.conditionId, "both-8");
  assert.equal(s.dex.discovered[res.species ?? ""], "both-8", "발견한 조건을 적는다");
  process.stdout.write("(11) 열기 · 조건 발견 기록  ok\n");
}

// (12) 열기 — 준비가 안 됐거나 없는 알은 거절한다
{
  const s = seed();
  assert.equal(open(s, "e1", T0, fixed(0)).reason, "not-ready");
  assert.equal(open(s, "없는알", T0, fixed(0)).reason, "no-egg");
  assert.equal(s.pets.length, 0, "개체를 만들지 않는다");
  process.stdout.write("(12) 열기 · 준비 전과 없는 알 거절  ok\n");
}

// (13) 개체 식별자는 이어서 붙는다
{
  const s = empty(T0);
  assert.equal(nextPetId(s), "p1");
  s.pets.push({ id: "p7" } as never);
  assert.equal(nextPetId(s), "p8");
  process.stdout.write("(13) 개체 식별자 이어 붙이기  ok\n");
}

// (14) 랜덤알에서 단일 포켓몬 알이 나온다 — 누적 확률 준전설 1.5 · 울트라비스트 2 · 패러독스 2 · 환상 2 · 전설 0.5 (%)
{
  const cases: [number, string, number][] = [
    [0.01, "sub-legendary", 42],
    [0.02, "ultra-beast", 10],
    [0.04, "paradox", 20],
    [0.06, "mythical", 22],
    [0.077, "legendary", 24],
  ];
  for (const [roll, kind, count] of cases) {
    const s = seed({ remainMs: 0, ready: true });
    const res = open(s, "e1", T0, fixed(roll));
    assert.equal(res.ok, true);
    assert.equal(res.petId, undefined, "포켓몬은 나오지 않는다");
    assert.deepStrictEqual(res.egg, { id: "e2", kind }, "연 알 자리에 새 알 — 식별자는 겹치지 않는다");
    assert.equal(s.eggs.length, 1);
    const next = s.eggs[0];
    assert.equal(next?.kind, kind);
    assert.equal(next?.ready, false);
    assert.equal(next?.remainMs, EGG_V3_RULES.readyMs);
    assert.equal(next?.candidates.length, count);
    assert.equal(s.pets.length, 0);
  }
  // 태고의돌은 다른 알을 주지 않는다 — 무작위를 쓰지 않고 바로 뽑는다
  const s = seed({ kind: "ancient-stone", remainMs: 0, ready: true, candidates: ["omanyte"], actions: { pat: 1, song: 0 } });
  assert.equal(open(s, "e1", T0, fixed(0, 0.5)).species, "omanyte");
  process.stdout.write("(14) 랜덤알 · 단일 포켓몬 알 확률  ok\n");
}

// (15) 단일 포켓몬 알 열기 — 이미 얻은 종은 빼고, 행동 조건은 보지 않는다
{
  const s = seed({ kind: "ultra-beast", remainMs: 0, ready: true, candidates: ["nihilego", "buzzwole"], actions: { pat: 8, song: 8 } });
  s.dex.obtained.push("nihilego");
  const res = open(s, "e1", T0, fixed(0, 0.5));
  assert.equal(res.species, "buzzwole", "얻은 텅비드는 빠진다");
  assert.equal(res.conditionId, null, "쓰다듬기·노래 8회여도 조건 종이 아니다");
  assert.ok(s.dex.obtained.includes("buzzwole"));
  process.stdout.write("(15) 단일 포켓몬 알 · 얻은 종 제외  ok\n");
}

// (16) 남은 종이 기다리는 알보다 많을 때만 준다 — 사기와 랜덤알 보너스 모두
{
  const ub = eggPool("ultra-beast") ?? [];
  const s = empty(T0);
  s.points.balance = 10_000;
  s.dex.obtained.push(...ub.slice(0, ub.length - 1)); // 한 종만 남았다
  assert.equal(canGiveEgg(s, "ultra-beast"), true);
  const first = buy(s, "ultra-beast", T0, fixed(0));
  assert.equal(first.ok, true);
  assert.deepStrictEqual(s.eggs[0]?.candidates, [ub[ub.length - 1]], "후보는 남은 한 종");
  assert.equal(buy(s, "ultra-beast", T0, fixed(0)).reason, "sold-out", "남은 한 종을 기다리는 알이 이미 있다");
  assert.equal(s.points.balance, 10_000 - 2000, "품절이면 포인트를 쓰지 않는다");
  assert.equal(shopList(s).find((p) => p.id === "ultra-beast")?.blocked, "모두 모았어요");
  // 랜덤알 보너스가 울트라비스트를 뽑아도 줄 수 없으면 포켓몬이 나온다
  s.eggs.push(egg({ id: "e9", remainMs: 0, ready: true, actions: { pat: 1, song: 0 } })); // 어느 행동 조건에도 맞지 않게
  const res = open(s, "e9", T0, fixed(0.02, 0, 0.5, 0.5));
  assert.equal(res.egg, undefined);
  assert.ok(res.species === "charmander" || res.species === "squirtle");
  process.stdout.write("(16) 단일 포켓몬 알 · 품절  ok\n");
}

// (17) 상점 가격과 도감 입수 방법
{
  const s = empty(T0);
  const prices = Object.fromEntries(shopList(s).filter((p) => p.category === "egg").map((p) => [p.id, p.price]));
  assert.deepStrictEqual(prices, { random: 120, "ancient-stone": 200, "sub-legendary": 2000, "ultra-beast": 2000, paradox: 2000, mythical: 3000, legendary: 5000 });
  assert.equal(dexDetail(s, "mewtwo")?.methods, "랜덤전설알");
  assert.equal(dexDetail(s, "kartana")?.methods, "랜덤울트라비스트알");
  assert.equal(dexDetail(s, "iron-crown")?.methods, "랜덤패러독스알");
  process.stdout.write("(17) 상점 가격 · 도감 입수 방법  ok\n");
}

process.stdout.write("selftest-egg: 통과 (돌봄·조건·가중치·부화·단일 포켓몬 알)\n");
