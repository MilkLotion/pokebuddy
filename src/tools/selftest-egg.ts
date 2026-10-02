// 알 돌봄·조건·부화 자체 확인 — npm run build 뒤 node dist/tools/selftest-egg.js
//
// 테스트 프레임워크 없이 assert 만. 무작위는 정해진 값을 넣어 결과를 고정한다.
// 계약은 docs/specs/game.md "알".
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { decide, pickWeighted, RANK_WEIGHT } from "../egg/hatch";
import { open } from "../egg/open";
import { buy } from "../shop/buy";
import { canGiveEgg, eggPool, fixedEggs, inRandomEgg } from "../shop/catalog";
import { prevOf } from "../dex/evo";
import { unlockRules } from "../dex/unlocks";
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

// 랜덤알을 열 때 처음 뽑는 값 — 이 값이면 다른 알이 나오지 않는다 (data/eggs.json random.bonus 합 5.5%)
const NO_BONUS = 0.99;

// 정해진 값을 차례로 돌려주는 가짜 무작위
const fixed = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
};

// (1) 알 돌봄은 없다 — 준비 시간 5분이 지나야 연다 (2026-09-28 알 돌봄·알 행동 조건 삭제)
{
  assert.equal(EGG_V3_RULES.readyMs, 5 * 60_000);
  assert.ok(!("careShortenMs" in EGG_V3_RULES) && !("careCooldownMs" in EGG_V3_RULES), "돌봄 규칙이 없다");
  process.stdout.write("(1) 준비 시간 5분 · 돌봄 없음  ok\n");
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

// (7) 알의 후보 범위에서만 뽑는다
{
  assert.equal(decide(["charmander"], fixed(0, 0.5))?.species, "charmander");
  assert.equal(decide([], fixed(0, 0.5)), null, "후보가 없으면 결과가 없다");
  process.stdout.write("(7) 후보 범위에서만  ok\n");
}

// (8) 이로치는 따로 뽑는다
{
  const shiny = decide(["charmander"], fixed(0, 0.0001));
  assert.equal(shiny?.shiny, true);
  const plain = decide(["charmander"], fixed(0, 0.5));
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

// (11) 열기 — 옛 저장의 돌봄 횟수는 결과를 바꾸지 않는다
{
  const s = seed({ remainMs: 0, ready: true, candidates: ["charmander"], actions: { pat: 9, song: 9 } });
  const res = open(s, "e1", T0, fixed(NO_BONUS, 0, 0.5, 0.5));
  assert.equal(res.ok, true);
  assert.equal(res.species, "charmander", "후보에서 나온다");
  assert.deepStrictEqual(s.dex.discovered, {}, "발견 기록을 남기지 않는다");
  process.stdout.write("(11) 열기 · 옛 돌봄 횟수 무시  ok\n");
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

// (14) 랜덤알에서 다른 알이 나온다 — 준전설 1 · 울트라비스트 0.5 · 패러독스 0.5 · 환상 0.3 · 전설 0.2 · 태고의돌 3 (%), 합 5.5 (2026-10-02 사용자 결정)
{
  const cases: [number, string, number][] = [
    [0.005, "sub-legendary", 45], // 가라르 프리져·썬더·파이어 포함 (data/regional.json, 2026-09-30)
    [0.012, "ultra-beast", 10],
    [0.017, "paradox", 20],
    [0.021, "mythical", 22],
    [0.024, "legendary", 24],
    [0.026, "ancient-stone", 15], // 화석 15종 — 단일 포켓몬 알이 아니라 늘 줄 수 있다
    [0.054, "ancient-stone", 15],
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
  // 합 5.5% 를 넘으면 포켓몬이 나온다
  const plain = seed({ remainMs: 0, ready: true });
  const hatched = open(plain, "e1", T0, fixed(0.056, 0, 0.5, 0.5));
  assert.equal(hatched.egg, undefined);
  assert.ok(hatched.petId, "5.6% 자리는 포켓몬");
  // 태고의돌은 다른 알을 주지 않는다 — 무작위를 쓰지 않고 바로 뽑는다
  const s = seed({ kind: "ancient-stone", remainMs: 0, ready: true, candidates: ["omanyte"], actions: { pat: 1, song: 0 } });
  assert.equal(open(s, "e1", T0, fixed(0, 0.5)).species, "omanyte");
  process.stdout.write("(14) 랜덤알 · 단일 포켓몬 알 확률  ok\n");
}

// (15) 단일 포켓몬 알 열기 — 이미 얻은 종은 뺀다
{
  const s = seed({ kind: "ultra-beast", remainMs: 0, ready: true, candidates: ["nihilego", "buzzwole"], actions: { pat: 8, song: 8 } });
  s.dex.obtained.push("nihilego");
  const res = open(s, "e1", T0, fixed(0, 0.5));
  assert.equal(res.species, "buzzwole", "얻은 텅비드는 빠진다");
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
  s.eggs.push(egg({ id: "e9", remainMs: 0, ready: true, actions: { pat: 1, song: 0 } }));
  const res = open(s, "e9", T0, fixed(0.012, 0, 0.5, 0.5));
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

// (18) 알에서 진화형이 나오지 않는다 (2026-09-28 보고 "알에서 진화체가 나옴")
{
  // 랜덤알 일반 후보 — 진화 전 종이 있는 종은 첫 선택 후보만 남는다 (사용자 결정 "알은 항상 진화 전 종")
  const rules = unlockRules();
  const pool = Object.keys(rules).filter((slug) => inRandomEgg(slug));
  for (const slug of pool) if (!rules[slug]?.starter) assert.equal(prevOf(slug), null, `${slug} 는 진화형이라 랜덤알에 없다`);
  assert.ok(!pool.includes("chansey"), "럭키는 핑복의 진화형");
  assert.ok(pool.includes("growlithe") && pool.includes("dratini"), "가디·미뇽은 랜덤알에서 나온다");
  // 종 목록 알(태고의돌·단일 포켓몬 알)도 진화형이 없다
  for (const [kind, list] of fixedEggs()) for (const slug of list) assert.equal(prevOf(slug), null, `${kind} 의 ${slug}`);
  process.stdout.write("(18) 알에서 진화형이 나오지 않는다  ok\n");
}

process.stdout.write("selftest-egg: 통과 (준비 시간·가중치·부화·단일 포켓몬 알·진화형 없음)\n");
