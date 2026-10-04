// 진화 판정과 실행 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-evolve.js
//
// 테스트 프레임워크 없이 assert 만. 조건은 data/evo.json 의 실제 값을 쓴다.
// 계약은 docs/specs/game.md "진화 계약"이다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_DATA_DIR } from "../../dex/data";
import { unlockByRules } from "../../dex/unlocks";
import { evolveCandidates, canEvolve, evolvePet, missingKey, type Candidate } from "../../dex/evolve";
import { evolveAllowed } from "../../party/pet-actions";
import { gameDayPart } from "../../shared/clock";

// 못 채운 조건을 `kind:값` 으로 쓰고 `|` 로 잇는다 — 단언을 짧게 적으려고. 채웠으면 undefined
const missingOf = (c: Candidate | undefined): string | undefined => (c && !c.ready ? c.lacks.map(missingKey).join("|") : undefined);
import { formsOf, isFormLocked, isSinglePet, setForm } from "../../dex/forms";
import { SHIFT_RULES } from "../../dex/rules";
import { emptySave as empty } from "../../save/normalize";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { makeTmp } from "../harness/tmp-dir";
import { T0 } from "../harness/clock"; // 2026-09-24 10:00 로컬 — 게임 시간 낮
import { testPet } from "../harness/fixtures";

// 시험 개체 — newPet 결과에 크기 2 와 over 를 덮는다 (src/tools/harness/fixtures.ts)
const pet = (over: Partial<PetV3> = {}): PetV3 => testPet({ size: 2, ...over });

function seed(over: Partial<PetV3> = {}, bag: Record<string, number> = {}): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet(over));
  s.bag = { ...bag };
  return s;
}

// (1) 게임 시간은 30분마다 낮과 밤이 바뀐다
{
  const at = (min: number): number => new Date(2026, 8, 24, 10, min, 0).getTime();
  assert.equal(gameDayPart(at(0)), "day");
  assert.equal(gameDayPart(at(29)), "day");
  assert.equal(gameDayPart(at(30)), "night");
  assert.equal(gameDayPart(at(59)), "night");
  assert.equal(gameDayPart(new Date(2026, 8, 24, 3, 5, 0).getTime()), "day", "새벽 3시 5분도 낮이다");
  process.stdout.write("(1) 게임 시간 · 30분마다 낮밤  ok\n");
}

// (2) 레벨 조건 — 못 채우면 이유를 알려준다
{
  const s = seed({ species: "charmander", level: 10 });
  const list = evolveCandidates(s, "p1", "day");
  assert.equal(list.length, 1, "파이리는 갈 곳이 하나");
  assert.equal(list[0]?.to, "charmeleon");
  assert.deepStrictEqual(list[0]?.need, { kind: "level", level: 16 });
  assert.equal(list[0]?.ready, false);
  assert.equal(missingOf(list[0]), "level:16", "무엇이 모자란지 알려준다");
  assert.equal(canEvolve(s, "p1", "day"), false);
  process.stdout.write("(2) 레벨 조건과 모자란 이유  ok\n");
}

// (3) 레벨을 채우면 진화한다. 같은 개체다
{
  const s = seed({ species: "charmander", level: 16, affinity: 40, exp: 4096 });
  assert.equal(canEvolve(s, "p1", "day"), true);
  // 교환에 올린 개체는 알리는 쪽(배너·튜토리얼)도 진화할 수 없다고 본다 — 실행이 trade-locked 로 거절한다 (94 항목 9-5-1)
  s.trade = { pending: { channelId: "c1", petId: "p1", offerRev: 1, received: null } };
  assert.equal(evolveAllowed(s, "p1", "day"), false, "교환에 걸린 개체");
  s.trade = { pending: null };
  assert.equal(evolveAllowed(s, "p1", "day"), true);
  const res = evolvePet(s, "p1", "day");
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
  const list = evolveCandidates(none, "p1", "day");
  assert.deepStrictEqual(list[0]?.need, { kind: "item", item: "thunder-stone" });
  assert.equal(missingOf(list[0]), "item:thunder-stone");
  assert.equal(evolvePet(none, "p1", "day").reason, "not-ready");

  const s = seed({ species: "pikachu" }, { "thunder-stone": 2 });
  const res = evolvePet(s, "p1", "day");
  assert.equal(res.ok, true);
  assert.equal(res.to, "raichu");
  assert.equal(res.usedItem, "thunder-stone");
  assert.equal(s.bag["thunder-stone"], 1, "도구가 하나 줄었다");
  process.stdout.write("(4) 도구 진화 · 하나를 쓴다  ok\n");
}

// (5) 시간대 조건 — 낮에만 되는 진화
{
  const s = seed({ species: "eevee", affinity: 100 });
  const day = evolveCandidates(s, "p1", "day").find((c) => c.to === "espeon");
  const night = evolveCandidates(s, "p1", "night").find((c) => c.to === "espeon");
  assert.equal(day?.ready, true, "에브이는 낮에");
  assert.equal(night?.ready, false);
  assert.equal(missingOf(night), "time:day");
  const umbreon = evolveCandidates(s, "p1", "night").find((c) => c.to === "umbreon");
  assert.equal(umbreon?.ready, true, "블래키는 밤에");
  process.stdout.write("(5) 시간대 조건  ok\n");
}

// (6) 후보가 여럿이면 골라야 한다
{
  const s = seed({ species: "eevee", affinity: 100 }, { "water-stone": 1 });
  const res = evolvePet(s, "p1", "day");
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
  assert.equal(evolvePet(s, "p1", "day", "flareon").reason, "bad-choice", "조건을 못 채운 종");
  const res = evolvePet(s, "p1", "day", "vaporeon");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.species, "vaporeon");
  assert.equal(s.bag["water-stone"], undefined, "도구를 다 썼다");
  process.stdout.write("(7) 분기 · 고른 종으로  ok\n");
}

// (8) 이로치는 진화해도 유지되고 도감에도 남는다
{
  const s = seed({ species: "charmander", level: 16, shiny: true });
  evolvePet(s, "p1", "day");
  assert.equal(s.pets[0]?.shiny, true);
  assert.ok(s.dex.shinyObtained.includes("charmeleon"));
  process.stdout.write("(8) 이로치 유지  ok\n");
}

// (9) 갈 곳이 없거나 없는 개체
{
  const s = seed({ species: "raichu", level: 50 });
  assert.equal(evolvePet(s, "p1", "day").reason, "no-step");
  assert.equal(evolvePet(s, "없는개체", "day").reason, "no-pet");
  process.stdout.write("(9) 갈 곳 없음과 없는 개체  ok\n");
}

// (10) 친밀도 조건 — 원작 값을 환산한 값
{
  const s = seed({ species: "golbat", affinity: 60 });
  const list = evolveCandidates(s, "p1", "day");
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
  assert.deepStrictEqual(evolveCandidates(s, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["solgaleo"], "낮에는 솔가레오만");
  assert.deepStrictEqual(evolveCandidates(s, "p1", "night").filter((c) => c.ready).map((c) => c.to), ["lunala"], "밤에는 루나아라만");
  const res = evolvePet(s, "p1", "day");
  assert.equal(res.ok, true);
  const p = s.pets[0];
  assert.equal(p?.species, "solgaleo");
  assert.deepStrictEqual([...(p?.forms ?? [])].sort(), ["cosmoem", "cosmog", "lunala", "solgaleo"]);
  for (const slug of ["solgaleo", "lunala"]) assert.ok(s.dex.obtained.includes(slug), `도감 획득 ${slug}`);
  assert.equal(s.pets.length, 1, "새 개체를 만들지 않는다");
  process.stdout.write("(12) 공유 sid · 코스모움 갈래는 둘 다  ok\n");
}

// (12b) 공유 sid — 치고마는 악의 족자 하나로 진화하고 두 태세를 함께 받는다. 암멍이는 공유 계열이 아니라 낮·밤의 종 하나가 된다
// (2026-10-03 사용자 결정 "얘는 단일종이라 모습변화로 해야해", "족자는 하나만 하자", "루가루암은 진화루트 분리하고", "황혼은 업적으로 넘기자")
{
  const s = seed({ species: "kubfu", level: 30 });
  assert.deepStrictEqual(evolveCandidates(s, "p1", "day").filter((c) => c.ready).map((c) => c.to), [], "족자가 없으면 후보가 없다");
  s.bag["scroll-of-darkness"] = 1;
  assert.deepStrictEqual(evolveCandidates(s, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["urshifu", "urshifu-rapid-strike"], "악의 족자 하나로 두 태세가 모두 후보");
  const res = evolvePet(s, "p1", "day", "urshifu-rapid-strike");
  assert.deepStrictEqual([res.ok, res.to, s.bag["scroll-of-darkness"]], [true, "urshifu-rapid-strike", undefined]);
  const p = s.pets[0] as PetV3;
  assert.deepStrictEqual([...(p.forms ?? [])].sort(), ["kubfu", "urshifu", "urshifu-rapid-strike"]);
  for (const slug of ["urshifu", "urshifu-rapid-strike"]) assert.ok(s.dex.obtained.includes(slug), `도감 획득 ${slug}`);
  assert.equal(setForm(s, "p1", "urshifu").ok, true, "모습 바꾸기로 일격 태세");
  assert.equal(s.pets.length, 1);

  const r = seed({ species: "rockruff", level: 25 });
  assert.deepStrictEqual(evolveCandidates(r, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["lycanroc"], "낮에는 루가루암");
  assert.deepStrictEqual(evolveCandidates(r, "p1", "night").filter((c) => c.ready).map((c) => c.to), ["lycanroc-midnight"], "밤에는 루가루암(한밤중의 모습)");
  // 루가루암(황혼의 모습) — Lv.25 와 친밀도 100, 낮·밤 무관 (2026-10-03 사용자 결정 "추천대로 하자")
  assert.equal(missingOf(evolveCandidates(r, "p1", "night").find((c) => c.to === "lycanroc-dusk")), "affinity:100", "친밀도가 모자라다");
  const low = seed({ species: "rockruff", level: 20 });
  assert.equal(missingOf(evolveCandidates(low, "p1", "day").find((c) => c.to === "lycanroc-dusk")), "level:25|affinity:100", "둘 다 모자라면 함께 알린다");
  assert.equal(evolvePet(r, "p1", "night", "lycanroc-dusk").ok, false, "친밀도 없이 진화하지 못한다");
  (r.pets[0] as PetV3).affinity = 100;
  assert.deepStrictEqual(evolveCandidates(r, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["lycanroc", "lycanroc-dusk"], "낮에는 루가루암과 황혼");
  assert.deepStrictEqual(evolveCandidates(r, "p1", "night").filter((c) => c.ready).map((c) => c.to), ["lycanroc-midnight", "lycanroc-dusk"], "밤에는 한밤중과 황혼");
  assert.equal(evolvePet(r, "p1", "night").reason, "need-choice", "후보가 둘이면 고른다");
  assert.equal(evolvePet(r, "p1", "night", "lycanroc-dusk").ok, true);
  assert.deepStrictEqual(formsOf(r.pets[0] as PetV3), [], "암멍이 계열은 공유 계열이 아니다");
  const t = seed({ species: "toxel", level: 30 });
  assert.deepStrictEqual(evolveCandidates(t, "p1", "day").filter((c) => c.ready).map((c) => c.to), ["toxtricity", "toxtricity-low-key"], "일레즌은 둘 가운데 고른다");
  process.stdout.write("(12b) 치고마 두 태세 · 암멍이·일레즌 갈래  ok\n");
}

// (12c) 기라티나·디아루가·펄기아 — 진화 없이 오리진폼과 모습 바꾸기로 오간다. 바꾼 모습은 도감에 남는다
// (2026-10-03 사용자 결정 "이거는 모습변경으로하자.")
{
  const s = seed({ species: "giratina", level: 50 });
  const p = s.pets[0] as PetV3;
  assert.deepStrictEqual(formsOf(p), ["giratina", "giratina-origin"]);
  assert.ok(!s.dex.obtained.includes("giratina-origin"));
  assert.deepStrictEqual(setForm(s, "p1", "giratina-origin"), { ok: true, petId: "p1", from: "giratina", to: "giratina-origin" });
  assert.equal(p.species, "giratina-origin");
  assert.ok(s.dex.obtained.includes("giratina-origin") && s.dex.unlocked.includes("giratina-origin"), "처음 바꾼 모습은 도감에 남는다");
  assert.deepStrictEqual(formsOf(p), ["giratina", "giratina-origin"], "오리진폼에서도 같은 목록");
  assert.equal(setForm(s, "p1", "giratina").ok, true, "돌아간다");
  assert.equal(s.pets.length, 1);
  assert.deepStrictEqual(formsOf(seed({ species: "dialga", level: 50 }).pets[0] as PetV3), ["dialga", "dialga-origin"], "디아루가도 오리진폼과 오간다 (셋 다 모습 바꾸기로 통일하자)");
  assert.deepStrictEqual(formsOf(seed({ species: "palkia", level: 50 }).pets[0] as PetV3), ["palkia", "palkia-origin"]);
  assert.deepStrictEqual(formsOf(seed({ species: "mewtwo", level: 50 }).pets[0] as PetV3), ["mewtwo"], "모습이 없는 단일 포켓몬은 자기 하나");
  assert.deepStrictEqual(formsOf(seed({ species: "giratina-origin", level: 50 }).pets[0] as PetV3), ["giratina-origin", "giratina"], "오리진폼만 든 저장도 공유 계열이다");
  process.stdout.write("(12c) 기라티나 모습 바꾸기  ok\n");
}

// (12d) 로토무 — 공유 계열이 아니어도 다섯 모습과 모습 바꾸기로 오간다. 계정의 에이전트 작업 시간 50시간부터 열린다
// (2026-10-04 사용자 결정 "그렇게하자", "에이전트 작업 시간", "50시간" — docs/specs/game.md "로토무의 모습 바꾸기")
{
  const ROTOM = ["rotom", "rotom-heat", "rotom-wash", "rotom-frost", "rotom-fan", "rotom-mow"];
  assert.equal(SHIFT_RULES.workMs.rotom, 180_000_000, "50시간");
  const s = seed({ species: "rotom", level: 20 });
  const p = s.pets[0] as PetV3;
  assert.deepStrictEqual(formsOf(p), ROTOM, "로토무와 다섯 모습");
  assert.equal(isSinglePet(p), false, "단일 포켓몬이 아니다 — 판매·교환은 지금 종 그대로");
  s.totals.workMs = 180_000_000 - 1;
  assert.equal(isFormLocked(s, p), true, "50시간 미만은 잠김");
  assert.equal(setForm(s, "p1", "rotom-heat").reason, "form-locked");
  assert.equal(p.species, "rotom");
  assert.ok(!s.dex.obtained.includes("rotom-heat"));
  assert.equal(setForm(s, "p1", "pikachu").reason, "bad-form", "묶음 밖의 종은 해금과 무관하게 bad-form");
  s.totals.workMs = 180_000_000;
  assert.equal(isFormLocked(s, p), false, "50시간이면 열림");
  assert.deepStrictEqual(setForm(s, "p1", "rotom-heat"), { ok: true, petId: "p1", from: "rotom", to: "rotom-heat" });
  assert.ok(s.dex.obtained.includes("rotom-heat"), "처음 바꾼 모습은 도감에 남는다");
  assert.deepStrictEqual(p.forms, ROTOM, "서버 검증의 종 변경 근거로 묶음을 남긴다");
  assert.deepStrictEqual(formsOf(p), ROTOM, "모습에서도 같은 목록");
  assert.equal(setForm(s, "p1", "rotom-mow").ok, true, "모습끼리도 오간다");
  assert.equal(setForm(s, "p1", "rotom").ok, true, "돌아간다");
  assert.equal(isFormLocked(s, seed({ species: "giratina", level: 50 }).pets[0] as PetV3), false, "공유 계열(오리진폼)은 잠그지 않는다");
  process.stdout.write("(12d) 로토무 모습 바꾸기  ok\n");
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
  assert.deepStrictEqual(evolveCandidates(s, "p1", "day"), [], "코스모움은 이미 가져 진화 후보가 아니다");
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

// (15) 성별 조건 — 야도뉴는 암컷만 염뉴트로, 킬리아는 수컷만 엘레이드로 (2026-09-30 사용자 결정)
{
  const male = seed({ species: "salandit", gender: "male", level: 40 });
  assert.deepEqual(evolveCandidates(male, "p1", "day").map((c) => [c.to, c.ready, missingOf(c)]), [["salazzle", false, "gender:female"]], "수컷 야도뉴는 진화하지 못한다");
  assert.equal(evolvePet(male, "p1", "day").reason, "not-ready");
  const female = seed({ species: "salandit", gender: "female", level: 40 });
  assert.equal(evolvePet(female, "p1", "day").to, "salazzle");
  assert.equal(female.pets[0]?.gender, "female", "진화해도 성별은 그대로");
  const kirlia = seed({ species: "kirlia", gender: "female", level: 30 }, { "dawn-stone": 1 });
  assert.deepEqual(evolveCandidates(kirlia, "p1", "day").map((c) => [c.to, c.ready]), [["gardevoir", true], ["gallade", false]], "암컷 킬리아는 가디안만");
  assert.equal(evolvePet(kirlia, "p1", "day").to, "gardevoir", "후보가 하나면 고르지 않는다");
  process.stdout.write("(15) 성별 조건  ok\n");
}

// (16) 리전폼 (data/regional.json) — 지도 간선은 지도 하나를 쓴다. 돌 간선은 지도가 돌을 대신한다 (worklog-mac/records/region-map/record.md 2차 결정, "지도 1개 소비로 변경")
{
  // 피카츄 + 천둥의돌 + 지도 → 라이츄와 알로라 라이츄 둘 다 후보. 고르지 않으면 need-choice
  const pika = seed({ species: "pikachu" }, { "thunder-stone": 1, "region-map": 1 });
  assert.deepStrictEqual(evolveCandidates(pika, "p1", "day").map((c) => [c.to, c.ready, c.map]), [["raichu", true, undefined], ["raichu-alola", true, true]]);
  assert.deepStrictEqual(evolveCandidates(pika, "p1", "day").find((c) => c.map)?.need, { kind: "item", item: "region-map" }, "알로라 라이츄의 조건은 지도");
  assert.equal(evolvePet(pika, "p1", "day").reason, "need-choice");
  assert.deepStrictEqual([pika.bag["thunder-stone"], pika.bag["region-map"]], [1, 1], "고르기 전에는 가방 그대로");
  // 알로라 라이츄를 고르면 지도만 쓴다 — 천둥의돌은 남는다
  const alola = evolvePet(pika, "p1", "day", "raichu-alola");
  assert.deepStrictEqual([alola.ok, alola.to, alola.usedItem, alola.usedItems], [true, "raichu-alola", "region-map", ["region-map"]]);
  assert.deepStrictEqual([pika.bag["thunder-stone"], pika.bag["region-map"]], [1, undefined], "지도 하나만 썼다");
  assert.deepStrictEqual([pika.pets[0]?.species, pika.pets[0]?.stage, pika.pets[0]?.evolved], ["raichu-alola", 1, ["pikachu"]]);
  assert.ok(pika.dex.obtained.includes("raichu-alola") && pika.dex.unlocked.includes("raichu-alola"), "진화로 얻을 때 해금한다");
  // 돌 없이 지도만 — 알로라 라이츄 하나가 준비된다. 라이츄는 천둥의돌이 모자라다
  const mapOnly = seed({ species: "pikachu" }, { "region-map": 1 });
  assert.deepStrictEqual(evolveCandidates(mapOnly, "p1", "day").map((c) => [c.to, c.ready, missingOf(c)]), [["raichu", false, "item:thunder-stone"], ["raichu-alola", true, undefined]]);
  assert.equal(canEvolve(mapOnly, "p1", "day"), true, "지도만 있어도 진화할 수 있다고 알린다");
  const mo = evolvePet(mapOnly, "p1", "day");
  assert.deepStrictEqual([mo.ok, mo.to, mo.usedItems, mapOnly.bag["region-map"]], [true, "raichu-alola", ["region-map"], undefined], "준비된 후보가 하나면 고르지 않는다");
  // 기본형 결과는 지도가 있어도 지도를 쓰지 않는다
  const plain = seed({ species: "pikachu" }, { "thunder-stone": 1, "region-map": 2 });
  const r = evolvePet(plain, "p1", "day", "raichu");
  assert.deepStrictEqual([r.to, r.usedItems, plain.bag["thunder-stone"], plain.bag["region-map"]], ["raichu", ["thunder-stone"], undefined, 2]);
  // 지도가 없으면 알로라 라이츄는 조건 모자람 — 이유는 지도. 명령으로 골라도 no-map 이고 가방은 그대로
  const noMap = seed({ species: "pikachu" }, { "thunder-stone": 1 });
  assert.deepStrictEqual(evolveCandidates(noMap, "p1", "day").map((c) => [c.to, c.ready, missingOf(c)]), [["raichu", true, undefined], ["raichu-alola", false, "item:region-map"]]);
  const nm = evolvePet(noMap, "p1", "day", "raichu-alola");
  assert.deepStrictEqual([nm.ok, nm.reason, nm.choices], [false, "no-map", ["raichu"]]);
  assert.deepStrictEqual([noMap.pets[0]?.species, noMap.bag["thunder-stone"]], ["pikachu", 1], "실패하면 아무것도 바꾸지 않는다");
  assert.equal(evolvePet(noMap, "p1", "day").to, "raichu", "준비된 후보가 하나면 기본형으로 간다");
  // 둘 다 없으면 각자 자기 도구 하나가 모자라다 — 알로라 라이츄는 돌을 보지 않는다
  const bare = seed({ species: "pikachu" });
  assert.deepStrictEqual(evolveCandidates(bare, "p1", "day").map((c) => missingOf(c)), ["item:thunder-stone", "item:region-map"]);
  assert.equal(evolvePet(bare, "p1", "day", "raichu-alola").reason, "not-ready", "준비된 후보가 없으면 not-ready");
  // 다른 돌 간선 3개도 같다 — 아라리·흉내내·치릴리
  for (const [from, to] of [["exeggcute", "exeggutor-alola"], ["mime-jr", "mr-mime-galar"], ["petilil", "lilligant-hisui"]] as const) {
    const s = seed({ species: from }, { "region-map": 1 });
    const res = evolvePet(s, "p1", "day", to);
    assert.deepStrictEqual([res.ok, res.to, res.usedItems], [true, to, ["region-map"]], `${from} → ${to} 지도만`);
  }
  // 레벨 지도 간선 — Lv.36 마그케인 + 지도 → 히스이 블레이범. 지도만 쓴다
  const quilava = seed({ species: "quilava", level: 36 }, { "region-map": 1 });
  const q = evolvePet(quilava, "p1", "day", "typhlosion-hisui");
  assert.deepStrictEqual([q.ok, q.to, q.usedItem, q.usedItems, quilava.bag["region-map"]], [true, "typhlosion-hisui", "region-map", ["region-map"], undefined]);
  const lowQuilava = seed({ species: "quilava", level: 35 }, { "region-map": 1 });
  assert.equal(missingOf(evolveCandidates(lowQuilava, "p1", "day").find((c) => c.map)), "level:36");
  assert.equal(evolvePet(lowQuilava, "p1", "day", "typhlosion-hisui").reason, "not-ready", "Lv.35 + 지도는 준비 안 됨");
  assert.equal(lowQuilava.bag["region-map"], 1);
  const quilavaNoMap = seed({ species: "quilava", level: 36 });
  assert.equal(missingOf(evolveCandidates(quilavaNoMap, "p1", "day").find((c) => c.map)), "item:region-map", "레벨 간선은 조건과 지도를 함께 본다");
  // 리전폼 진화 전 종은 자기 간선만 받는다 — 가라르 나옹 Lv.28 은 나이킹 하나. 지도가 필요 없다
  const galar = seed({ species: "meowth-galar", level: 28 });
  assert.deepStrictEqual(evolveCandidates(galar, "p1", "day").map((c) => c.to), ["perrserker"]);
  assert.equal(evolvePet(galar, "p1", "day").to, "perrserker");
  // 리전폼의 다음 진화에는 지도가 필요 없다
  const vulpix = seed({ species: "vulpix-alola" }, { "ice-stone": 1, "region-map": 1 });
  const v = evolvePet(vulpix, "p1", "day");
  assert.deepStrictEqual([v.ok, v.to, v.usedItems, vulpix.bag["region-map"]], [true, "ninetales-alola", ["ice-stone"], 1]);
  assert.ok(vulpix.dex.obtained.includes("ninetales-alola"));
  // 간선이 없는 리전폼 — 기본형 간선을 받지 않는다
  assert.deepStrictEqual(evolveCandidates(seed({ species: "stunfisk-galar", level: 100 }), "p1", "day"), []);
  // 기본 야돈 → 야도킹은 연결의끈
  const slow = seed({ species: "slowpoke" }, { "bond-cord": 1 });
  assert.equal(evolvePet(slow, "p1", "day").to, "slowking");
  const slowWreath = seed({ species: "slowpoke" }, { "galarica-wreath": 1 });
  assert.equal(canEvolve(slowWreath, "p1", "day"), false, "가라두구머리장식은 가라르 야돈 전용");
  process.stdout.write("(16) 리전폼 · 지도 간선 확인·소비  ok\n");
}

// (17) 배너 판정 — canEvolve 는 기본형 간선만 본다. 지도 간선만 남은 표를 꽂아 가른다
{
  const dir = makeTmp("evolve");
  try {
    cpSync(DEFAULT_DATA_DIR, dir, { recursive: true });
    const evo = JSON.parse(readFileSync(path.join(dir, "evo.json"), "utf8")) as Record<string, { to: string; map?: true }[]>;
    evo.cubone = (evo.cubone ?? []).filter((st) => st.map);
    writeFileSync(path.join(dir, "evo.json"), JSON.stringify(evo));
    const opts = { dataDir: dir };
    const s = seed({ species: "cubone", level: 28 }, { "region-map": 1 });
    assert.deepStrictEqual(evolveCandidates(s, "p1", "day", opts).map((c) => [c.to, c.ready]), [["marowak-alola", true]]);
    assert.equal(canEvolve(s, "p1", "day", opts), false, "지도 간선만 준비되면 배너를 띄우지 않는다");
    assert.equal(canEvolve(s, "p1", "day"), true, "실제 표 — 짝인 기본형 간선(Lv.28 텅구리)으로 알린다");
    assert.equal(evolvePet(s, "p1", "day", undefined, opts).to, "marowak-alola", "진화 자체는 된다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("(17) 배너 판정 · 지도 간선 제외  ok\n");
}

// (18) 해금 — 지도 결과(알로라 라이츄)는 규칙표에 진화 규칙이 있어도 틱 해금으로 열리지 않는다. 실제로 진화해 얻을 때 연다 (src/dex/unlocks.ts unlockByRules)
{
  const s = seed({ species: "pikachu", affinity: 999 });
  unlockByRules(s, T0);
  assert.equal(s.dex.unlocked.includes("raichu-alola"), false, "지도 없이 해금되지 않는다");
  assert.equal(s.dex.unlocked.includes("raichu"), false, "기본형 결과도 진화로 연다 — 같은 규칙");
  process.stdout.write("(18) 해금 · 지도 결과는 진화로만  ok\n");
}

process.stdout.write("selftest-evolve: 통과 (레벨·도구·시간대·분기·이로치·공유 sid·성별·리전폼·지도·배너 판정)\n");
