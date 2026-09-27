// 진화 판정과 실행 자체 확인 — npm run build 뒤 node dist/tools/selftest-evolve.js
//
// 테스트 프레임워크 없이 assert 만. 조건은 data/evo.json 의 실제 값을 쓴다.
// 계약은 docs/specs/game.md "진화 계약"이다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { candidates, canEvolve, dayPartOf, evolve } from "../dex/evolve";
import { formsOf, setForm } from "../dex/forms";
import { empty } from "../save/v3";
import type { PetV3, SaveV3 } from "../shared/save-v3";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
  daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

function seed(over: Partial<PetV3> = {}, bag: Record<string, number> = {}): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet(over));
  s.bag = { ...bag };
  return s;
}

// (1) 게임 시간은 30분마다 낮과 밤이 바뀐다
{
  const at = (min: number): number => new Date(2026, 8, 24, 10, min, 0).getTime();
  assert.equal(dayPartOf(at(0)), "day");
  assert.equal(dayPartOf(at(29)), "day");
  assert.equal(dayPartOf(at(30)), "night");
  assert.equal(dayPartOf(at(59)), "night");
  assert.equal(dayPartOf(new Date(2026, 8, 24, 3, 5, 0).getTime()), "day", "새벽 3시 5분도 낮이다");
  process.stdout.write("(1) 게임 시간 · 30분마다 낮밤  ok\n");
}

// (2) 레벨 조건 — 못 채우면 이유를 알려준다
{
  const s = seed({ species: "charmander", level: 10 });
  const list = candidates(s, "p1", "day");
  assert.equal(list.length, 1, "파이리는 갈 곳이 하나");
  assert.equal(list[0]?.to, "charmeleon");
  assert.deepStrictEqual(list[0]?.need, { kind: "level", level: 16 });
  assert.equal(list[0]?.ready, false);
  assert.equal(list[0]?.missing, "level:16", "무엇이 모자란지 알려준다");
  assert.equal(canEvolve(s, "p1", "day"), false);
  process.stdout.write("(2) 레벨 조건과 모자란 이유  ok\n");
}

// (3) 레벨을 채우면 진화한다. 같은 개체다
{
  const s = seed({ species: "charmander", level: 16, affinity: 40, exp: 4096 });
  assert.equal(canEvolve(s, "p1", "day"), true);
  const res = evolve(s, "p1", "day");
  assert.equal(res.ok, true);
  assert.equal(res.from, "charmander");
  assert.equal(res.to, "charmeleon");
  const p = s.pets[0];
  assert.equal(p?.id, "p1", "식별자가 그대로");
  assert.equal(p?.species, "charmeleon");
  assert.equal(p?.affinity, 40, "친밀도가 그대로");
  assert.equal(p?.exp, 4096, "경험치가 그대로");
  assert.equal(p?.level, 16, "레벨도 그대로");
  assert.equal(p?.stage, 1);
  assert.deepStrictEqual(p?.evolved, ["charmander"], "거쳐 온 종을 남긴다");
  assert.ok(s.dex.obtained.includes("charmeleon"), "도감에 적는다");
  process.stdout.write("(3) 레벨 진화 · 개체가 이어진다  ok\n");
}

// (4) 도구 진화 — 가방에 없으면 못 한다. 쓰면 하나 준다
{
  const none = seed({ species: "pikachu", level: 50 });
  const list = candidates(none, "p1", "day");
  assert.deepStrictEqual(list[0]?.need, { kind: "item", item: "thunder-stone" });
  assert.equal(list[0]?.missing, "item:thunder-stone");
  assert.equal(evolve(none, "p1", "day").reason, "not-ready");

  const s = seed({ species: "pikachu" }, { "thunder-stone": 2 });
  const res = evolve(s, "p1", "day");
  assert.equal(res.ok, true);
  assert.equal(res.to, "raichu");
  assert.equal(res.usedItem, "thunder-stone");
  assert.equal(s.bag["thunder-stone"], 1, "도구가 하나 줄었다");
  process.stdout.write("(4) 도구 진화 · 하나를 쓴다  ok\n");
}

// (5) 시간대 조건 — 낮에만 되는 진화
{
  const s = seed({ species: "eevee", affinity: 100 });
  const day = candidates(s, "p1", "day").find((c) => c.to === "espeon");
  const night = candidates(s, "p1", "night").find((c) => c.to === "espeon");
  assert.equal(day?.ready, true, "에브이는 낮에");
  assert.equal(night?.ready, false);
  assert.equal(night?.missing, "time:day");
  const umbreon = candidates(s, "p1", "night").find((c) => c.to === "umbreon");
  assert.equal(umbreon?.ready, true, "블래키는 밤에");
  process.stdout.write("(5) 시간대 조건  ok\n");
}

// (6) 후보가 여럿이면 골라야 한다
{
  const s = seed({ species: "eevee", affinity: 100 }, { "water-stone": 1 });
  const res = evolve(s, "p1", "day");
  assert.equal(res.ok, false);
  assert.equal(res.reason, "need-choice");
  assert.ok((res.choices ?? []).includes("espeon"));
  assert.ok((res.choices ?? []).includes("vaporeon"));
  assert.equal(s.pets[0]?.species, "eevee", "고르기 전에는 바뀌지 않는다");
  assert.equal(s.bag["water-stone"], 1, "도구도 그대로");
  process.stdout.write("(6) 분기 · 고르기 전에는 그대로  ok\n");
}

// (7) 고른 종으로 간다. 후보가 아니면 거절한다
{
  const s = seed({ species: "eevee", affinity: 100 }, { "water-stone": 1 });
  assert.equal(evolve(s, "p1", "day", "flareon").reason, "bad-choice", "조건을 못 채운 종");
  const res = evolve(s, "p1", "day", "vaporeon");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.species, "vaporeon");
  assert.equal(s.bag["water-stone"], undefined, "도구를 다 썼다");
  process.stdout.write("(7) 분기 · 고른 종으로  ok\n");
}

// (8) 이로치는 진화해도 유지되고 도감에도 남는다
{
  const s = seed({ species: "charmander", level: 16, shiny: true });
  evolve(s, "p1", "day");
  assert.equal(s.pets[0]?.shiny, true);
  assert.ok(s.dex.shinyObtained.includes("charmeleon"));
  process.stdout.write("(8) 이로치 유지  ok\n");
}

// (9) 갈 곳이 없거나 없는 개체
{
  const s = seed({ species: "raichu", level: 50 });
  assert.equal(evolve(s, "p1", "day").reason, "no-step");
  assert.equal(evolve(s, "없는개체", "day").reason, "no-pet");
  process.stdout.write("(9) 갈 곳 없음과 없는 개체  ok\n");
}

// (10) 친밀도 조건 — 원작 값을 환산한 값
{
  const s = seed({ species: "golbat", affinity: 60 });
  const list = candidates(s, "p1", "day");
  assert.equal(list[0]?.to, "crobat");
  assert.equal(list[0]?.need.kind, "affinity");
  assert.equal(list[0]?.ready, false, "친밀도가 모자라다");
  s.pets[0] = { ...pet({ species: "golbat", affinity: 100 }) };
  assert.equal(canEvolve(s, "p1", "day"), true);
  process.stdout.write("(10) 친밀도 조건  ok\n");
}

// (12) 공유 sid — 코스모움은 낮에 솔가레오가 되고 루나아라도 함께 받는다 (docs/specs/game.md "코스모움에서 진화를 한 번 실행하면")
{
  const s = seed({ species: "cosmoem", level: 53, evolved: ["cosmog"], stage: 1 });
  assert.deepStrictEqual(candidates(s, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["solgaleo"], "낮에는 솔가레오만");
  assert.deepStrictEqual(candidates(s, "p1", "night").filter((c) => c.ready).map((c) => c.to), ["lunala"], "밤에는 루나아라만");
  const res = evolve(s, "p1", "day");
  assert.equal(res.ok, true);
  const p = s.pets[0];
  assert.equal(p?.species, "solgaleo");
  assert.deepStrictEqual([...(p?.forms ?? [])].sort(), ["cosmoem", "cosmog", "lunala", "solgaleo"]);
  for (const slug of ["solgaleo", "lunala"]) assert.ok(s.dex.obtained.includes(slug), `도감 획득 ${slug}`);
  assert.equal(s.pets.length, 1, "새 개체를 만들지 않는다");
  process.stdout.write("(12) 공유 sid · 코스모움 갈래는 둘 다  ok\n");
}

// (13) 모습 바꾸기 — 고를 수 있는 종만, 진행 상태는 그대로. 가진 종으로 가는 진화는 다시 열리지 않는다
{
  const s = seed({ species: "solgaleo", level: 60, affinity: 70, evolved: ["cosmog", "cosmoem"], stage: 2, forms: ["cosmog", "cosmoem", "solgaleo", "lunala"] });
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  assert.equal(setForm(s, "p1", "pikachu").reason, "bad-form");
  assert.equal(setForm(s, "p1", "solgaleo").reason, "already");
  assert.equal(setForm(s, "p1", "cosmog").ok, true);
  const p = s.pets[0];
  assert.equal(p?.species, "cosmog");
  assert.equal(p?.level, 60);
  assert.equal(p?.affinity, 70);
  assert.equal(s.party.slots[0]?.petId, "p1", "같은 파티 칸 그대로");
  assert.deepStrictEqual(candidates(s, "p1", "day"), [], "코스모움은 이미 가져 진화 후보가 아니다");
  assert.equal(setForm(s, "p1", "lunala").ok, true);
  assert.equal(s.pets[0]?.species, "lunala");
  process.stdout.write("(13) 공유 sid · 모습 바꾸기  ok\n");
}

// (14) 공유 계열이 아닌 개체 — forms 가 없고 바꿀 수 없다. 저장에 forms 가 없던 공유 개체는 거쳐 온 종으로 만든다
{
  const s = seed({ species: "charizard", evolved: ["charmander", "charmeleon"], stage: 2 });
  assert.deepStrictEqual(formsOf(s.pets[0] as PetV3), []);
  assert.equal(setForm(s, "p1", "charmander").reason, "not-shared");
  const old = seed({ species: "silvally", evolved: ["type-null"], stage: 1 });
  assert.deepStrictEqual(formsOf(old.pets[0] as PetV3), ["type-null", "silvally"]);
  assert.equal(setForm(old, "p1", "type-null").ok, true);
  process.stdout.write("(14) 공유 sid · 일반 개체와 옛 저장  ok\n");
}

process.stdout.write("selftest-evolve: 통과 (레벨·도구·시간대·분기·이로치·공유 sid)\n");
