// 화면이 읽는 스냅샷 자체 확인 — npm run build 뒤 node dist/tools/selftest-snapshot.js
//
// 테스트 프레임워크 없이 assert 만. 저장을 화면이 바로 그릴 수 있는 값으로 바꾸는지 본다.
// 계약은 docs/specs/modules.md 의 `settings:snapshot`, 화면은 Figma `05 · Screens` 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { MINT_RETIRED } from "../bag/mint";
import { EGG_V3_RULES, SAVE_V3_RULES } from "../save/rules";
import { empty } from "../save/v3";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { snapshot } from "../tx/snapshot";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const MIN = 60_000;

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
  daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

function seed(): SaveV3 {
  const s = empty(T0);
  s.points.balance = 1240;
  s.pets.push(pet({ id: "p1", species: "pikachu", level: 12, exp: 2000, affinity: 80, fullness: 55 }));
  s.pets.push(pet({ id: "p2", species: "charmander", fullness: 30, feedCooldownMs: 90_000, buffs: [{ kind: "premium-food", remainMs: 45 * MIN }] }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  const box = s.boxes[0];
  if (box) box.slots[0] = "p3";
  s.pets.push(pet({ id: "p3", species: "squirtle", level: 5 }));
  s.eggs.push({ id: "e1", kind: "random", boughtAt: T0, remainMs: 2 * MIN, ready: false, candidates: [], careCooldownMs: 30_000, actions: { pat: 2, song: 0 } });
  s.bag = { mint: 2, "exp-candy-s": 1, "없는도구": 3 };
  s.dex = { unlocked: ["pikachu", "charmander"], obtained: ["pikachu"], shinyObtained: [], discovered: {}, rulesRev: 1 };
  s.achievements = { a1: { achievedAt: T0, claimedAt: null }, a2: { achievedAt: T0, claimedAt: T0 }, a3: { achievedAt: null, claimedAt: null } };
  return s;
}

// (1) 슬러그 대신 한국어 이름이 온다
{
  const v = snapshot(seed());
  const first = v.party.slots[0]?.pet;
  assert.equal(first?.species, "pikachu");
  assert.equal(first?.name, "피카츄", "화면 이름으로 바꾼다");
  assert.deepStrictEqual(first?.types, ["전기"], "타입도 화면 이름으로");
  assert.equal(first?.nature, "노력", "성격도 화면 이름으로");
  process.stdout.write("(1) 이름과 타입  ok\n");
}

// (2) 만복도는 값과 구간 이름을 함께 준다
{
  const v = snapshot(seed());
  assert.equal(v.party.slots[0]?.pet?.fullness, 55);
  assert.equal(v.party.slots[0]?.pet?.zone, "normal", "55 는 보통");
  assert.equal(v.party.slots[1]?.pet?.zone, "hungry", "30 은 배고픔");
  assert.equal(v.party.slots[0]?.pet?.mood, 60, "기분 값");
  assert.equal(v.party.slots[0]?.pet?.moodWord, "좋음", "기분 단계 말 — 60 은 좋음");
  process.stdout.write("(2) 만복도 구간과 기분  ok\n");
}

// (3) 쿨타임과 버프는 사람이 읽는 단위로
{
  const v = snapshot(seed());
  const second = v.party.slots[1]?.pet;
  assert.equal(second?.feedReady, false);
  assert.equal(second?.feedInSec, 90, "ms 를 초로");
  assert.deepStrictEqual(second?.buffs, [{ kind: "premium-food", name: "든든함", remainMin: 45 }], "ms 를 분으로 · 화면 이름과 함께");
  assert.deepStrictEqual(second?.buffNames, ["든든함"], "프리미엄먹이 버프의 화면 이름은 든든함 (2026-09-29 사용자 결정)");
  assert.equal(v.party.slots[0]?.pet?.feedReady, true);
  process.stdout.write("(3) 쿨타임과 버프 단위  ok\n");
}

// (4) 숨김과 표시 수
{
  const v = snapshot(seed());
  assert.equal(v.party.slots[0]?.pet?.hidden, false);
  assert.equal(v.party.slots[1]?.pet?.hidden, true);
  assert.equal(v.party.shown, 1, "보이는 개체는 하나");
  assert.equal(v.party.usable, SAVE_V3_RULES.party.openAtStart, "쓸 수 있는 칸");
  process.stdout.write("(4) 숨김과 표시 수  ok\n");
}

// (5) 잠긴 칸은 뒤에 모인다 — 여는 경로는 화면에 보이지 않는다
{
  const v = snapshot(seed());
  const locked = v.party.slots.filter((s) => s.state === "locked");
  assert.equal(locked.length, 4);
  assert.equal(v.party.slots.findIndex((s) => s.state === "locked"), 2, "열린 칸이 앞, 잠긴 칸은 뒤");
  assert.equal("unlockBy" in locked[0]!, false, "여는 경로는 화면에 넘기지 않는다 — 칸 +1");
  process.stdout.write("(5) 잠긴 칸은 뒤에, 출처 없음  ok\n");
}

// (5b) 개체 상세 튜토리얼 — 끝내거나 건너뛰기 전까지 켜져 있다
{
  const s = seed();
  assert.equal(snapshot(s).detailTutorial, true, "처음에는 보여 줄 차례");
  s.tutorials.detail = { state: "done", steps: 5 };
  assert.equal(snapshot(s).detailTutorial, false, "끝내면 다시 보이지 않는다");
  s.tutorials.detail = { state: "skipped", steps: 0 };
  assert.equal(snapshot(s).detailTutorial, false, "건너뛰어도 다시 보이지 않는다");
  process.stdout.write("(5b) 개체 상세 튜토리얼 표시 여부  ok\n");
}

// (5c) 놀이공간 튜토리얼 — 설정 › 화면으로 옮겼다(2026-09-28). 옛 바탕화면 놀이공간 기록과는 별개다
{
  const s = seed();
  s.tutorials.playground = { state: "done", steps: 1 };
  assert.equal(snapshot(s).areaTutorial, true, "옛 바탕화면 놀이공간을 끝냈어도 설정 쪽은 보여 줄 차례");
  s.tutorials.area = { state: "done", steps: 1 };
  assert.equal(snapshot(s).areaTutorial, false, "끝내면 다시 보이지 않는다");
  process.stdout.write("(5c) 놀이공간 튜토리얼 표시 여부  ok\n");
}

// (6) 박스는 사용 칸 수와 개체를 준다
{
  const v = snapshot(seed());
  const box = v.boxes[0];
  assert.equal(box?.used, 1);
  assert.equal(box?.size, SAVE_V3_RULES.box.size);
  assert.equal(box?.slots[0]?.name, "꼬부기");
  assert.equal(box?.slots[1], null, "빈 칸은 null");
  process.stdout.write("(6) 박스 사용 칸과 개체  ok\n");
}

// (7) 알은 남은 초와 진행 백분율을 준다
{
  const v = snapshot(seed());
  const egg = v.eggs.list[0];
  assert.equal(egg?.name, "랜덤알");
  assert.equal(egg?.remainSec, 120);
  assert.equal(egg?.percent, 60, "5분 중 3분이 지났다");
  assert.equal(v.eggs.used, 1);
  assert.equal(v.eggs.size, EGG_V3_RULES.maxEggs);
  process.stdout.write("(7) 알 남은 시간과 진행  ok\n");
}

// (8) 가방은 이름을 붙이고 이름순으로 준다
{
  const v = snapshot(seed());
  assert.equal(v.bag.length, 3);
  assert.deepStrictEqual(v.bag.map((i) => i.name), ["경험사탕S", "성격민트", "없는도구"], "이름순");
  assert.equal(v.bag.find((i) => i.id === "mint")?.count, 2);
  assert.equal(v.bag.find((i) => i.id === "없는도구")?.name, "없는도구", "모르는 도구는 식별자 그대로");
  process.stdout.write("(8) 가방 이름과 정렬  ok\n");
}

// (8b) 성격 변경 — 선택지 25개(원작 성격 번호 순), 민트는 한 종류, 개체의 성격 id (2026-09-29 민트 통일)
{
  const v = snapshot(seed());
  assert.equal(v.natures.length, 25, "성격은 25개");
  assert.equal(v.natures[0]?.id, "hardy", "5×5 성격표 순서 — 노력이 맨 앞");
  assert.equal(v.natures[24]?.id, "quirky", "변덕이 맨 끝");
  assert.equal(v.natures.find((n) => n.id === "adamant")?.name, "고집");
  assert.equal(v.bag.find((i) => i.id === "mint")?.effect, "nature", "가방의 민트 — 효과로 분류한다");
  assert.equal(v.party.slots[0]?.pet?.natureId, "hardy", "개체의 성격 id");
  const mints = v.shop.filter((p) => p.id === "mint" || p.id.endsWith("-mint"));
  assert.deepStrictEqual(mints.map((p) => [p.id, p.name, p.category, p.price]), MINT_RETIRED ? [] : [["mint", "성격민트", "tool", 100]], "상점에 성격민트는 하나, 도구 분류 100P — 은퇴한 동안은 없다");
  process.stdout.write("(8b) 성격 선택지와 민트  ok\n");
}

// (9) 도감과 업적은 수만 준다
{
  const v = snapshot(seed());
  assert.deepStrictEqual(v.dex, { unlocked: 2, obtained: 1, shiny: 0 });
  assert.equal(v.achievements.total, 2, "달성한 업적");
  assert.equal(v.achievements.unclaimed, 1, "받지 않은 업적");
  process.stdout.write("(9) 도감과 업적 수  ok\n");
}

// (10) 없는 개체를 가리키는 칸은 빈 칸으로 보인다
{
  const s = seed();
  s.party.slots[0] = { state: "pokemon", petId: "없는개체" };
  const v = snapshot(s);
  assert.equal(v.party.slots[0]?.state, "empty", "화면이 빈 칸을 그린다");
  process.stdout.write("(10) 어긋난 참조는 빈 칸  ok\n");
}

// (11) 진화 후보 — 가능한 후보와 모자란 조건을 화면 문구로 준다. 낮·밤은 스냅샷 시각으로 정한다
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "eevee" }));
  s.pets.push(pet({ id: "p2", species: "charizard" }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: false };
  s.bag = { "fire-stone": 1, "premium-food": 1 };
  s.dex.unlocked.push("flareon", "vaporeon", "espeon", "umbreon"); // 이름 검사용 — 도감 미해금은 아래 (11b)
  const day = snapshot(s, undefined, undefined, undefined, T0); // 10시 0분 — 낮
  const evo = day.party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(evo.filter((c) => c.ready).map((c) => c.to), ["flareon"], "불꽃의돌이 있으면 부스터만 가능");
  const byTo = (list: typeof evo, to: string) => list.find((c) => c.to === to);
  assert.equal(byTo(evo, "flareon")?.name, "부스터", "결과 종은 화면 이름");
  assert.equal(byTo(evo, "flareon")?.item, "fire-stone", "돌 조건이면 도구 id 를 준다");
  assert.equal(byTo(evo, "vaporeon")?.need, "물의돌 필요", "없는 돌은 모자란 조건");
  assert.equal(byTo(evo, "espeon")?.need, "친밀도 65 필요");
  assert.equal(byTo(evo, "umbreon")?.need, "밤에만", "낮에는 밤 조건을 알린다");
  const night = snapshot(s, undefined, undefined, undefined, T0 + 30 * MIN); // 30분 — 밤
  const nightEvo = night.party.slots[0]?.pet?.evolutions ?? [];
  assert.equal(byTo(nightEvo, "umbreon")?.need, "친밀도 65 필요", "밤에는 친밀도가 모자란 것만 남는다");
  assert.equal(byTo(nightEvo, "espeon")?.need, "낮에만");
  assert.deepStrictEqual(day.party.slots[1]?.pet?.evolutions, [], "최종 단계는 후보가 없다");
  assert.equal(day.bag.find((b) => b.id === "fire-stone")?.evolution, true, "진화용 도구 표시");
  assert.equal(day.bag.find((b) => b.id === "premium-food")?.evolution, false);
  // 판매가 — 구매가 × 60% 내림 (src/shop/sell.ts). 가격이 있으면 구매가·비율도 함께 준다
  assert.deepStrictEqual([day.bag.find((b) => b.id === "fire-stone")?.sellPrice, day.bag.find((b) => b.id === "fire-stone")?.buyPrice, day.bag.find((b) => b.id === "fire-stone")?.sellRate], [90, 150, 0.6], "진화용 도구 판매가");
  assert.equal(day.bag.find((b) => b.id === "premium-food")?.sellPrice, 36, "60P → 36P");
  process.stdout.write("(11) 진화 후보와 조건 문구  ok\n");
}

// (11b) 지도 간선 — 리전폼 후보는 map 표시를 싣는다. 돌 대신 지도인 후보는 "지도 필요", 레벨 간선은 모자란 조건을 `·` 로 잇는다 (src/dex/evolve.ts checkNeed)
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "pikachu" }));
  s.pets.push(pet({ id: "p2", species: "quilava", level: 30 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: false };
  const v = snapshot(s, undefined, undefined, undefined, T0);
  const pika = v.party.slots[0]?.pet?.evolutions ?? [];
  // 도감 미해금 결과 종은 이름을 ??? 로 가린다. 조건은 보인다 (2026-10-01 사용자 결정)
  assert.deepStrictEqual(pika.map((c) => [c.to, c.name, c.known, c.need, c.item, c.map]), [
    ["raichu", "???", false, "천둥의돌 필요", "thunder-stone", undefined],
    ["raichu-alola", "???", false, "지도 필요", "region-map", true],
  ]);
  s.dex.unlocked.push("raichu");
  const known = snapshot(s, undefined, undefined, undefined, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(known.map((c) => [c.name, c.known]), [["라이츄", true], ["???", false]], "해금한 종만 이름을 보인다");
  assert.equal(v.party.slots[1]?.pet?.evolutions.find((c) => c.map)?.need, "Lv.36·지도 필요");
  s.bag = { "thunder-stone": 1 };
  const onlyStone = snapshot(s, undefined, undefined, undefined, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(onlyStone.map((c) => [c.ready, c.need]), [[true, undefined], [false, "지도 필요"]]);
  s.bag = { "region-map": 1 };
  const onlyMap = snapshot(s, undefined, undefined, undefined, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(onlyMap.map((c) => [c.ready, c.need]), [[false, "천둥의돌 필요"], [true, undefined]], "지도만 있으면 알로라 라이츄가 준비된다");
  process.stdout.write("(11b) 지도 간선 후보와 조건 문구  ok\n");
}

// (12) 공유 sid 계열 — 박스 칸의 단체사진·툴팁이 쓰는 모습 목록. 일반 개체에는 없다
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "solgaleo", level: 60, evolved: ["cosmog", "cosmoem"], stage: 2, forms: ["cosmog", "cosmoem", "solgaleo", "lunala"] }));
  s.pets.push(pet({ id: "p2", species: "charizard", evolved: ["charmander", "charmeleon"], stage: 2 }));
  s.boxes[0]!.slots[0] = "p1";
  s.boxes[0]!.slots[1] = "p2";
  const v = snapshot(s, undefined, undefined, undefined, T0);
  const shared = v.boxes[0]?.slots[0];
  assert.deepStrictEqual(shared?.forms?.map((f) => f.name), ["코스모그", "코스모움", "솔가레오", "루나아라"]);
  assert.deepStrictEqual(shared?.forms?.[3]?.typeIds, ["psychic", "ghost"], "바꾸기 확인 창의 타입 배지");
  assert.equal(v.boxes[0]?.slots[1]?.forms, undefined);
  process.stdout.write("(12) 공유 sid 모습 목록  ok\n");
}

process.stdout.write("selftest-snapshot: 통과 (이름·구간·단위·칸·알·가방·도감·진화 후보·공유 sid)\n");
