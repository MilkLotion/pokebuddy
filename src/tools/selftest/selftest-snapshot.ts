// 화면이 읽는 스냅샷 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-snapshot.js
//
// 테스트 프레임워크 없이 assert 만. 저장을 화면이 바로 그릴 수 있는 값으로 바꾸는지 본다.
// 계약은 docs/specs/modules.md 의 `settings:snapshot`, 화면은 Figma `05 · Screens` 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { MINT_RETIRED } from "../../bag/mint";
import { emptySave as empty } from "../../save/normalize";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { snapshotView } from "../../view/snapshot";
import { waitText } from "../../shared/count-text";
import { BOX_RULES } from "../../box/rules";
import { EGG_RULES } from "../../egg/rules";
import { PARTY_RULES } from "../../party/rules";
import { pointIntervalMs } from "../../state/time";
import { T0 } from "../harness/clock"; // 2026-09-24 10:00 로컬 — 게임 시간 낮
import { testPet } from "../harness/fixtures";

const MIN = 60_000;

// 시험 개체 — newPet 결과에 크기 2 와 over 를 덮는다 (src/tools/harness/fixtures.ts)
const pet = (over: Partial<PetV3> = {}): PetV3 => testPet({ size: 2, ...over });

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
  s.achievements = { "dex-50": { achievedAt: T0, claimedAt: null }, "dex-150": { achievedAt: T0, claimedAt: T0 }, "dex-300": { achievedAt: null, claimedAt: null } }; // 표에 있는 업적 id — 셈은 표에 있는 것만 본다 (94 항목 9-3-8)
  return s;
}

// (1) 슬러그 대신 한국어 이름이 온다
{
  const v = snapshotView(seed(), T0);
  const first = v.party.slots[0]?.pet;
  assert.equal(first?.species, "pikachu");
  assert.equal(first?.name, "피카츄", "화면 이름으로 바꾼다");
  assert.deepStrictEqual(first?.types, ["전기"], "타입도 화면 이름으로");
  assert.equal(first?.nature, "노력", "성격도 화면 이름으로");
  process.stdout.write("(1) 이름과 타입  ok\n");
}

// (2) 만복도는 값과 구간 이름을 함께 준다
{
  const v = snapshotView(seed(), T0);
  assert.equal(v.party.slots[0]?.pet?.fullness, 55);
  assert.equal(v.party.slots[0]?.pet?.zone, "normal", "55 는 보통");
  assert.equal(v.party.slots[1]?.pet?.zone, "hungry", "30 은 배고픔");
  assert.equal(v.party.slots[0]?.pet?.boredom, 0, "심심함 값");
  assert.equal(v.party.slots[0]?.pet?.boredWord, "보통", "심심함 단계 말 — 0 은 보통");
  process.stdout.write("(2) 만복도 구간과 심심함  ok\n");
}

// (3) 쿨타임과 버프는 사람이 읽는 단위로
{
  const v = snapshotView(seed(), T0);
  const second = v.party.slots[1]?.pet;
  assert.equal(second?.feedBlock, "cooldown");
  assert.equal(second?.feedInSec, 90, "ms 를 초로");
  assert.deepStrictEqual(second?.buffs, [{ kind: "premium-food", name: "든든함", remainMin: 45, text: "든든함 45분" }], "ms 를 분으로 · 화면 이름과 배지 글자와 함께");
  assert.deepStrictEqual(second?.buffNames, ["든든함"], "프리미엄먹이 버프의 화면 이름은 든든함 (2026-09-29 사용자 결정)");
  assert.equal(v.party.slots[0]?.pet?.feedBlock, null);
  process.stdout.write("(3) 쿨타임과 버프 단위  ok\n");
}

// (3b) 포인트 적립 배율의 내역 — 친밀도와 상관없다. 버프(배지 순서), 그다음 배고픔·심심함 손해 (2026-10-05 돌봄 개편)
{
  const s = seed();
  const [p1, p2] = s.pets;
  assert.ok(p1 && p2);
  // 내역만 견준다 — 1P 간격(intervalMs)은 아래에서 따로 본다
  const mix = (c: { bonus: number; parts: unknown[] } | undefined) => c && { bonus: c.bonus, parts: c.parts };
  const first = snapshotView(s, T0).party.slots[0]?.pet?.care;
  assert.deepStrictEqual(mix(first), { bonus: 0, parts: [] }, "버프·손해가 없으면 0");
  assert.equal(first?.intervalMs, pointIntervalMs(p1), "1P 간격은 state/time.ts pointIntervalMs 와 같다");
  Object.assign(p1, { boredom: 60, buffs: [{ kind: "long-play", remainMs: MIN }, { kind: "premium-food", remainMs: MIN }] });
  Object.assign(p2, { buffs: [] }); // 시험 저장의 둘째 개체는 든든함이 있다 — 손해만 보려고 지운다
  const v = snapshotView(s, T0);
  assert.deepStrictEqual(mix(v.party.slots[0]?.pet?.care), {
    bonus: 110,
    parts: [{ kind: "premium-food", name: "든든함", bonus: 60 }, { kind: "long-play", name: "신남", bonus: 60 }, { kind: "bored", name: "심심해", bonus: -10 }],
  }, "든든함 · 신남 · 심심해 순서 — 저장 순서와 상관없다");
  assert.deepStrictEqual(mix(v.party.slots[1]?.pet?.care), { bonus: -30, parts: [{ kind: "hungry", name: "배고픔", bonus: -30 }] }, "만복도 30 은 배고픔 −30");
  process.stdout.write("(3b) 포인트 적립 배율 내역  ok\n");
}

// (4) 숨김과 표시 수
{
  const v = snapshotView(seed(), T0);
  assert.equal(v.party.slots[0]?.pet?.hidden, false);
  assert.equal(v.party.slots[1]?.pet?.hidden, true);
  assert.equal(v.party.shown, 1, "보이는 개체는 하나");
  assert.equal(v.party.usable, PARTY_RULES.openAtStart, "쓸 수 있는 칸");
  process.stdout.write("(4) 숨김과 표시 수  ok\n");
}

// (5) 잠긴 칸은 뒤에 모인다 — 여는 경로는 화면에 보이지 않는다
{
  const v = snapshotView(seed(), T0);
  const locked = v.party.slots.filter((s) => s.state === "locked");
  assert.equal(locked.length, 4);
  assert.equal(v.party.slots.findIndex((s) => s.state === "locked"), 2, "열린 칸이 앞, 잠긴 칸은 뒤");
  assert.equal("unlockBy" in locked[0]!, false, "여는 경로는 화면에 넘기지 않는다 — 칸 +1");
  process.stdout.write("(5) 잠긴 칸은 뒤에, 출처 없음  ok\n");
}

// (5a) 프리셋 전체보기 — 가진 프리셋 전부를 번호 순으로 싣는다. 적용한 프리셋은 party.slots 와 같은 칸, 다른 프리셋은 저장의 칸 (2026-10-07)
{
  const s = seed();
  s.pets.push(pet({ id: "p4", species: "bulbasaur", level: 7 }));
  s.party.presetCount = 2;
  s.party.presetNames = ["", "산책 파티"];
  s.party.presets = [null, [{ state: "pokemon", petId: "p4" }, { state: "empty" }, { state: "locked" }, { state: "locked" }, { state: "locked" }, { state: "locked" }]];
  const v = snapshotView(s, T0);
  assert.equal(v.party.presets.length, 2, "가진 프리셋 수만큼");
  assert.deepStrictEqual(v.party.presets.map((p) => [p.index, p.name]), [[0, "프리셋 1"], [1, "산책 파티"]], "번호와 이름");
  assert.deepStrictEqual(v.party.presets[0]?.slots, v.party.slots, "적용한 프리셋은 party.slots 와 같다");
  const other = v.party.presets[1]?.slots ?? [];
  assert.equal(other.length, 6, "칸 6개");
  assert.equal(other[0]?.pet?.name, "이상해씨", "다른 프리셋의 개체도 화면 이름");
  assert.deepStrictEqual(other.slice(1).map((x) => x.state), ["empty", "locked", "locked", "locked", "locked"], "빈 칸·잠긴 칸은 파티 순서 그대로");
  process.stdout.write("(5a) 프리셋 전체보기의 프리셋 칸  ok\n");
}

// (5b) 개체 상세 튜토리얼 — 끝내거나 건너뛰기 전까지 켜져 있다
{
  const s = seed();
  assert.equal(snapshotView(s, T0).detailTutorial, true, "처음에는 보여 줄 차례");
  s.tutorials.detail = { state: "done", steps: 5 };
  assert.equal(snapshotView(s, T0).detailTutorial, false, "끝내면 다시 보이지 않는다");
  s.tutorials.detail = { state: "skipped", steps: 0 };
  assert.equal(snapshotView(s, T0).detailTutorial, false, "건너뛰어도 다시 보이지 않는다");
  process.stdout.write("(5b) 개체 상세 튜토리얼 표시 여부  ok\n");
}

// (5c) 놀이공간 튜토리얼 — 설정 › 화면으로 옮겼다(2026-09-28). 옛 바탕화면 놀이공간 기록과는 별개다
{
  const s = seed();
  s.tutorials.playground = { state: "done", steps: 1 };
  assert.equal(snapshotView(s, T0).areaTutorial, true, "옛 바탕화면 놀이공간을 끝냈어도 설정 쪽은 보여 줄 차례");
  s.tutorials.area = { state: "done", steps: 1 };
  assert.equal(snapshotView(s, T0).areaTutorial, false, "끝내면 다시 보이지 않는다");
  process.stdout.write("(5c) 놀이공간 튜토리얼 표시 여부  ok\n");
}

// (6) 박스는 사용 칸 수와 개체를 준다
{
  const v = snapshotView(seed(), T0);
  const box = v.boxes[0];
  assert.equal(box?.used, 1);
  assert.equal(box?.size, BOX_RULES.size);
  assert.equal(box?.slots[0]?.name, "꼬부기");
  assert.equal(box?.slots[1], null, "빈 칸은 null");
  process.stdout.write("(6) 박스 사용 칸과 개체  ok\n");
}

// (7) 알은 남은 초와 진행 백분율을 준다
{
  const v = snapshotView(seed(), T0);
  const egg = v.eggs.list[0];
  assert.equal(egg?.name, "랜덤알");
  assert.equal(egg?.remainSec, 120);
  assert.equal(egg?.percent, 60, "5분 중 3분이 지났다");
  assert.equal(v.eggs.used, 1);
  assert.equal(v.eggs.size, EGG_RULES.maxEggs);
  process.stdout.write("(7) 알 남은 시간과 진행  ok\n");
}

// (8) 가방은 이름을 붙이고 이름순으로 준다
{
  const v = snapshotView(seed(), T0);
  assert.equal(v.bag.length, 3);
  assert.deepStrictEqual(v.bag.map((i) => i.name), ["경험사탕S", "성격민트", "없는도구"], "이름순");
  // 진화 분류는 도구 뒤, 원작 세대순 — 카탈로그(4세대)는 진화 분류다 (src/bag/items.ts evoOrder)
  {
    const s2 = seed();
    s2.bag = { "rotom-catalog": 1, "fire-stone": 1, "region-map": 1, "exp-candy-s": 1, "dawn-stone": 1 };
    const bag = snapshotView(s2, T0).bag;
    assert.deepStrictEqual(bag.map((i) => [i.name, i.evolution]), [["경험사탕S", false], ["지도", true], ["불꽃의돌", true], ["각성의돌", true], ["로토무카탈로그", true]], "도구 → 원작에 없는 도구 → 세대순 · 가나다순");
  }
  assert.equal(v.bag.find((i) => i.id === "mint")?.count, 2);
  assert.equal(v.bag.find((i) => i.id === "없는도구")?.name, "없는도구", "모르는 도구는 식별자 그대로");
  process.stdout.write("(8) 가방 이름과 정렬  ok\n");
}

// (8b) 성격 변경 — 선택지 25개(원작 성격 번호 순), 민트는 한 종류, 개체의 성격 id (2026-09-29 민트 통일)
{
  const v = snapshotView(seed(), T0);
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
  const v = snapshotView(seed(), T0);
  assert.deepStrictEqual(v.dex, { unlocked: 2, obtained: 1, shiny: 0 });
  assert.equal(v.achievements.total, 2, "달성한 업적");
  assert.equal(v.achievements.unclaimed, 1, "받지 않은 업적");
  // 표에 없는 업적 행(목록에서 빠진 옛 id)은 세지 않는다 — 배너·튜토리얼과 같은 셈 (94 항목 9-3-8)
  const old = seed();
  old.achievements["gone-old-id"] = { achievedAt: T0, claimedAt: null };
  const ov = snapshotView(old, T0);
  assert.deepStrictEqual([ov.achievements.total, ov.achievements.unclaimed], [2, 1], "표 밖의 행은 달성·미수령 어디에도 들지 않는다");
  process.stdout.write("(9) 도감과 업적 수  ok\n");
}

// (10) 없는 개체를 가리키는 칸은 빈 칸으로 보인다
{
  const s = seed();
  s.party.slots[0] = { state: "pokemon", petId: "없는개체" };
  const v = snapshotView(s, T0);
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
  const day = snapshotView(s, T0); // 10시 0분 — 낮
  const evo = day.party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(evo.filter((c) => c.ready).map((c) => c.to), ["flareon"], "불꽃의돌이 있으면 부스터만 가능");
  const byTo = (list: typeof evo, to: string) => list.find((c) => c.to === to);
  assert.equal(byTo(evo, "flareon")?.name, "부스터", "결과 종은 화면 이름");
  assert.equal(byTo(evo, "flareon")?.item, "fire-stone", "돌 조건이면 도구 id 를 준다");
  // 진화 확인 창이 읽는 값 — 쓰는 도구 이름과 결과 종 타입. 해금 안 된 종은 타입도 가린다 (2026-10-05)
  assert.deepStrictEqual(byTo(evo, "flareon")?.uses, ["불꽃의돌"], "쓰는 도구 이름");
  assert.deepStrictEqual(byTo(evo, "flareon")?.typeIds, ["fire"], "결과 종 타입");
  assert.deepStrictEqual(byTo(evo, "espeon")?.uses, [], "친밀도 진화는 도구가 없다");
  assert.equal(byTo(evo, "vaporeon")?.need, "물의돌 필요", "없는 돌은 모자란 조건");
  assert.equal(byTo(evo, "espeon")?.need, "친밀도 65 필요");
  // 시간대 조건 — 지금 시간대와 바뀌기까지 남은 분을 붙인다 (2026-10-11 사용자 "밤에 진화(현재 : 낮 · 8분 뒤 밤)", 10분마다 낮밤)
  assert.equal(byTo(evo, "umbreon")?.need, "밤에 진화(현재 : 낮 · 11분 뒤 밤)", "낮에는 밤 조건을 알린다 — 10시 0분, 11분에 밤");
  const night = snapshotView(s, T0 + 15 * MIN); // 15분 — 밤(11~20분)
  const nightEvo = night.party.slots[0]?.pet?.evolutions ?? [];
  assert.equal(byTo(nightEvo, "umbreon")?.need, "친밀도 65 필요", "밤에는 친밀도가 모자란 것만 남는다");
  assert.equal(byTo(nightEvo, "espeon")?.need, "낮에 진화(현재 : 밤 · 6분 뒤 낮)", "15분 — 21분에 낮");
  assert.deepStrictEqual(day.party.slots[1]?.pet?.evolutions, [], "최종 단계는 후보가 없다");
  // 교환에 올린 개체는 조건을 채워도 준비되지 않았고, 까닭은 trade-locked 문구다 (94 항목 9-5-1)
  s.trade = { pending: { channelId: "c1", petId: "p1", offerRev: 1, received: null } };
  const lockedEvo = snapshotView(s, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.equal(byTo(lockedEvo, "flareon")?.ready, false, "교환에 걸린 개체");
  assert.equal(byTo(lockedEvo, "flareon")?.need, "교환에 올린 포켓몬이에요");
  assert.equal(byTo(lockedEvo, "vaporeon")?.need, "물의돌 필요", "조건이 모자라면 그 조건을 그대로");
  s.trade = { pending: null };
  assert.equal(day.bag.find((b) => b.id === "fire-stone")?.evolution, true, "진화용 도구 표시");
  assert.equal(day.bag.find((b) => b.id === "premium-food")?.evolution, false);
  // 판매가 — 구매가 × 60% 내림 (src/shop/sell.ts). 가격이 있으면 구매가·비율도 함께 준다
  assert.deepStrictEqual([day.bag.find((b) => b.id === "fire-stone")?.sellPrice, day.bag.find((b) => b.id === "fire-stone")?.buyPrice, day.bag.find((b) => b.id === "fire-stone")?.sellRate], [90, 150, 0.6], "진화용 도구 판매가");
  assert.equal(day.bag.find((b) => b.id === "premium-food")?.sellPrice, 30, "50P → 30P (2026-10-05 프리미엄먹이 50P)");
  process.stdout.write("(11) 진화 후보와 조건 문구  ok\n");
}

// (11b) 지도 간선 — 리전폼 후보는 map 표시를 싣는다. 돌 대신 지도인 후보는 "지도 필요", 레벨 간선은 모자란 조건을 `·` 로 잇는다 (src/dex/evolve.ts checkNeed)
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "pikachu" }));
  s.pets.push(pet({ id: "p2", species: "quilava", level: 30 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: false };
  const v = snapshotView(s, T0);
  const pika = v.party.slots[0]?.pet?.evolutions ?? [];
  // 도감 미해금 결과 종은 이름을 ??? 로 가린다. 조건은 보인다 (2026-10-01 사용자 결정)
  assert.deepStrictEqual(pika.map((c) => [c.to, c.name, c.known, c.need, c.item, c.map]), [
    ["raichu", "???", false, "천둥의돌 필요", "thunder-stone", undefined],
    ["raichu-alola", "???", false, "지도 필요", "region-map", true],
  ]);
  s.dex.unlocked.push("raichu");
  const known = snapshotView(s, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(known.map((c) => [c.name, c.known]), [["라이츄", true], ["???", false]], "해금한 종만 이름을 보인다");
  assert.equal(v.party.slots[1]?.pet?.evolutions.find((c) => c.map)?.need, "Lv.36·지도 필요");
  s.bag = { "thunder-stone": 1 };
  const onlyStone = snapshotView(s, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(onlyStone.map((c) => [c.ready, c.need]), [[true, undefined], [false, "지도 필요"]]);
  s.bag = { "region-map": 1 };
  const onlyMap = snapshotView(s, T0).party.slots[0]?.pet?.evolutions ?? [];
  assert.deepStrictEqual(onlyMap.map((c) => [c.ready, c.need]), [[false, "천둥의돌 필요"], [true, undefined]], "지도만 있으면 알로라 라이츄가 준비된다");
  process.stdout.write("(11b) 지도 간선 후보와 조건 문구  ok\n");
}

// (11c) 성별 조건 후보 — 성별이 맞지 않는 후보는 genderBlocked 다. 진화 창은 그대로 보이고, 파티 상세 진화 줄은 세지 않는다 (2026-10-07)
{
  const s = empty(T0);
  const rows: [string, string, "male" | "female"][] = [["p1", "burmy", "male"], ["p2", "burmy", "female"], ["p3", "combee", "male"], ["p4", "combee", "female"], ["p5", "kirlia", "male"], ["p6", "kirlia", "female"]];
  rows.forEach(([id, species, gender], i) => {
    s.pets.push(pet({ id, species, gender, level: 10 }));
    s.party.slots[i] = { state: "pokemon", petId: id, hidden: false };
  });
  const v = snapshotView(s, T0);
  const branches = (i: number) => (v.party.slots[i]?.pet?.evolutions ?? []).map((c) => [c.to, c.genderBlocked === true, c.need]);
  assert.deepStrictEqual(branches(0), [["wormadam", true, "암컷만"], ["mothim", false, "Lv.20 필요"]], "수컷 도롱충이는 나메일만 갈 수 있다");
  assert.deepStrictEqual(branches(1), [["wormadam", false, "Lv.20 필요"], ["mothim", true, "수컷만"]], "암컷 도롱충이는 도롱마담만");
  assert.deepStrictEqual(branches(2), [["vespiquen", true, "암컷만"]], "수컷 세꿀버리는 갈 갈래가 없다");
  assert.deepStrictEqual(branches(3), [["vespiquen", false, "Lv.21 필요"]], "암컷 세꿀버리는 성별 표기 없이 레벨");
  assert.deepStrictEqual(branches(4).map((b) => b[1]), [false, false], "수컷 킬리아는 가디안·엘레이드 둘 다");
  assert.deepStrictEqual(branches(5).map((b) => b[1]), [false, true], "암컷 킬리아는 가디안만");
  process.stdout.write("(11c) 성별 조건 후보  ok\n");
}

// (12) 공유 sid 계열 — 박스 칸의 단체사진·툴팁이 쓰는 모습 목록. 일반 개체에는 없다
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "solgaleo", level: 60, evolved: ["cosmog", "cosmoem"], stage: 2, forms: ["cosmog", "cosmoem", "solgaleo", "lunala"] }));
  s.pets.push(pet({ id: "p2", species: "charizard", evolved: ["charmander", "charmeleon"], stage: 2 }));
  s.boxes[0]!.slots[0] = "p1";
  s.boxes[0]!.slots[1] = "p2";
  const v = snapshotView(s, T0);
  const shared = v.boxes[0]?.slots[0];
  assert.deepStrictEqual(shared?.forms?.map((f) => f.name), ["코스모그", "코스모움", "솔가레오", "루나아라"]);
  assert.deepStrictEqual(shared?.forms?.[3]?.typeIds, ["psychic", "ghost"], "바꾸기 확인 창의 타입 배지");
  assert.equal(v.boxes[0]?.slots[1]?.forms, undefined);
  process.stdout.write("(12) 공유 sid 모습 목록  ok\n");
}

// (12b) 로토무 — 박스 칸은 지금 종 그대로(forms 없음). 모습 바꾸기 확인 창이 읽는 shiftForms 는 해금(개체 작업 2시간) 뒤에만 (docs/specs/game.md "로토무의 모습 바꾸기").
//       업적 보상 종이라 공유 계열로도 판정되지만 단체사진이 아니다 (2026-10-05)
{
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "rotom", level: 20 }));
  s.boxes[0]!.slots[0] = "p1";
  const shut = snapshotView(s, T0).boxes[0]?.slots[0];
  assert.equal(shut?.forms, undefined, "단체사진이 아니다");
  assert.equal(shut?.shiftForms, undefined, "해금 전에는 고를 모습이 없다");
  s.pets[0]!.workMs = 7_200_000;
  const open = snapshotView(s, T0).boxes[0]?.slots[0];
  assert.equal(open?.forms, undefined, "해금 뒤에도 박스 칸은 지금 종 그대로");
  assert.deepStrictEqual(open?.shiftForms?.map((f) => f.name), ["로토무", "히트로토무", "워시로토무", "프로스트로토무", "스핀로토무", "커트로토무"]);
  assert.deepStrictEqual(open?.shiftForms?.[1]?.typeIds, ["electric", "fire"], "바꾸기 확인 창의 타입 배지");
  assert.deepStrictEqual(open?.formItem, { name: "로토무카탈로그", base: "rotom" }, "확인 창 안내 — 카탈로그 1개, 로토무로는 공짜");
  process.stdout.write("(12b) 로토무 모습 목록  ok\n");
}

// (13) 구간 낱말·배고픔 디버프·이름 상한·잠들기 선택지 — 화면이 표를 따로 두지 않는다
{
  const v = snapshotView(seed(), T0);
  const p1 = v.party.slots[0]?.pet;
  const p2 = v.party.slots[1]?.pet;
  assert.deepEqual([p1?.zone, p1?.zoneText, p1?.debuffs], ["normal", "보통", []], "만복도 55 는 보통 — 디버프 없음");
  // 심심함 배지 — 배고픔 뒤에 심심해(경고)·지루해(위험) (2026-10-05 사용자 결정 "그 2개도")
  {
    const b = seed();
    Object.assign(b.pets[0]!, { boredom: 60 });
    Object.assign(b.pets[1]!, { boredom: 90 });
    const bv = snapshotView(b, T0);
    assert.deepEqual(bv.party.slots[0]?.pet?.debuffs, [{ label: "심심해", tone: "warning", note: "포인트 −10%" }]);
    assert.deepEqual(bv.party.slots[1]?.pet?.debuffs.map((d) => d.label), ["배고픔", "지루해"], "배고픔 다음 심심함");
  }
  assert.deepEqual([p2?.zone, p2?.zoneText, p2?.debuffs], ["hungry", "배고픔", [{ label: "배고픔", tone: "warning", note: "포인트 −30% · 친밀도 증가량 −30%" }]], "만복도 30 은 배고픔");
  const s = seed();
  s.pets[1]!.fullness = 5;
  assert.deepEqual(snapshotView(s, T0).party.slots[1]?.pet?.debuffs, [{ label: "매우 배고픔", tone: "danger", note: "포인트 −60% · 친밀도 증가량 −60%" }], "만복도 5 는 매우 배고픔");
  assert.deepEqual(v.limits, { boxNameMax: BOX_RULES.nameMax, presetNameMax: BOX_RULES.nameMax });
  assert.deepEqual(v.settings.sleepChoices.map((c) => c.label), ["3분", "5분", "10분", "15분", "잠들지 않음"]);
  assert.deepEqual(v.settings.sleepChoices.map((c) => c.value), [3, 5, 10, 15, 0]);
  process.stdout.write("(13) 구간 낱말·디버프·이름 상한·잠들기 선택지  ok\n");
}

// (14) 시간으로 바뀌는 글자 — 버프 배지, 돌봄 단추, 알 칸 아래 글자. 화면은 이 글자를 그대로 쓰고 1초 시계가 표시만 고친다
{
  const v = snapshotView(seed(), T0);
  const p1 = v.party.slots[0]?.pet;
  const p2 = v.party.slots[1]?.pet;
  assert.deepEqual([p1?.feedText, p1?.playText], ["밥 주기", "놀아주기"]);
  assert.equal(p2?.feedText, "밥 주기 · 2분", "쿨타임 90초는 올려서 2분");
  assert.deepEqual(p2?.buffs.map((b) => b.text), ["든든함 45분"]);
  const egg = v.eggs.list[0];
  assert.equal(egg?.noteText, `${egg?.percent}% · 2분`);
  const s = seed();
  s.pets[0]!.fullness = 100;
  s.pets[0]!.playCooldownMs = 60_000;
  s.eggs[0]!.ready = true;
  const after = snapshotView(s, T0);
  assert.deepEqual([after.party.slots[0]?.pet?.feedText, after.party.slots[0]?.pet?.playText], ["밥 주기 · 배부름", "놀아주기 · 1분"], "놀아주기도 밥 주기처럼 남은 시간 (94 항목 5-1)");
  assert.equal(after.eggs.list[0]?.noteText, "준비 완료");
  // 진행 퍼센트는 내림 — 1초 남은 알은 99% 다 (94 항목 9-5-5)
  const almost = seed();
  almost.eggs[0]!.remainMs = 1000;
  almost.eggs[0]!.ready = false;
  assert.equal(snapshotView(almost, T0).eggs.list[0]?.percent, 99, "준비 전에는 100% 가 아니다");
  assert.deepEqual([45, 90, 4800, 7200].map((n) => waitText(n, "en")), ["45s", "2m", "1h 20m", "2h"], "영어 남은 시간");
  process.stdout.write("(14) 시간 글자  ok\n");
}

process.stdout.write("selftest-snapshot: 통과 (이름·구간·단위·칸·알·가방·도감·진화 후보·공유 sid·구간 낱말·디버프·이름 상한·잠들기·시간 글자)\n");
