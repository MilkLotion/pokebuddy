// 업적과 튜토리얼 자체 확인 — npm run build 뒤 node dist/tools/selftest-achievement.js
//
// 테스트 프레임워크 없이 assert 만. 조건은 코드가, 이름과 보상은 data/achievements.json 이 가진다.
// 계약은 docs/specs/game.md "파티 칸과 업적", "튜토리얼" 이다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { claim, defs, evaluate, isAchieved, rewardPokemon, rewardSpecies } from "../achievement/core";
import { SAVE_V3_RULES } from "../save/rules";
import { snapshot } from "../tx/snapshot";
import { empty } from "../save/v3";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { begin } from "../party/starter";
import { applyPreset, slotsOfPreset } from "../party/presets";
import { buy } from "../shop/buy";
import { open } from "../egg/open";
import { HANDLERS } from "../tx/handlers";
import { createExecutor } from "../tx/executor";
import { canShow, currentTutorial, done, queueTutorials, skip } from "../tutorial/core";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0,
  buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
  daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

// 첫 개체 하나가 첫 칸에 숨겨져 있다
function seed(): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet({ id: "p1" }));
  s.pets.push(pet({ id: "p2", species: "squirtle" }));
  s.starterPetId = "p1";
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  return s;
}

// (1) 업적 네 개가 이름과 보상을 가진다. 파티 칸 둘, 포켓몬 둘 (2026-09-29 사용자 결정 — 메타몽·라프라스)
{
  const list = defs();
  assert.equal(list.length, 4);
  assert.deepStrictEqual(list.map(([id]) => id).sort(), ["party-three", "show-two", "starter-final", "work-100h"]);
  for (const [id, def] of list) {
    assert.ok(def.ko.length > 0);
    assert.ok((def.en ?? "").length > 0, `영어 이름 ${id}`);
  }
  const reward = Object.fromEntries(list.map(([id, def]) => [id, rewardPokemon(def) ?? def.reward]));
  assert.deepStrictEqual(reward, { "show-two": "party-slot", "starter-final": "party-slot", "work-100h": "lapras", "party-three": "ditto" });
  assert.deepStrictEqual(rewardSpecies().sort(), ["ditto", "lapras"]);
  process.stdout.write("(1) 업적 목록과 보상  ok\n");
}

// (2) 두 마리 함께 꺼내기 — 숨긴 채 배치만 한 것은 아니다
{
  const s = seed();
  assert.equal(isAchieved(s, "show-two"), false, "둘 다 숨겼으면 아니다");
  const slot0 = s.party.slots[0];
  if (slot0) slot0.hidden = false;
  assert.equal(isAchieved(s, "show-two"), false, "한 마리로는 아니다");
  const slot1 = s.party.slots[1];
  if (slot1) slot1.hidden = false;
  assert.equal(isAchieved(s, "show-two"), true);
  process.stdout.write("(2) 두 마리 함께 꺼내기 조건  ok\n");
}

// (3) 달성은 한 번 기록하면 되돌리지 않는다
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  assert.deepStrictEqual(evaluate(s, T0), ["show-two"], "이번에 달성한 것을 돌려준다");
  assert.equal(s.achievements["show-two"]?.achievedAt, T0);
  assert.deepStrictEqual(evaluate(s, T0 + 1000), [], "두 번 알리지 않는다");
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = true;
  evaluate(s, T0 + 2000);
  assert.equal(s.achievements["show-two"]?.achievedAt, T0, "다시 숨겨도 달성은 남는다");
  process.stdout.write("(3) 달성 기록은 되돌리지 않는다  ok\n");
}

// (4) 최초로 50레벨 포켓몬 달성 — 거래 전보다 레벨이 올랐고 50 이상이면 달성 (2026-09-27 조건 변경)
{
  const prev = seed();
  const p0 = prev.pets[0];
  if (p0) p0.level = 49;
  const s = structuredClone(prev);
  const n0 = s.pets[0];
  if (n0) n0.level = 50;
  assert.equal(isAchieved(s, "starter-final", undefined, prev), true, "49 → 50 이면 달성");
  if (n0) n0.level = 49;
  assert.equal(isAchieved(s, "starter-final", undefined, prev), false, "레벨이 그대로면 아니다");
  const low = structuredClone(prev);
  const l0 = low.pets[0];
  if (l0) l0.level = 48;
  const up = structuredClone(low);
  const u0 = up.pets[0];
  if (u0) u0.level = 49;
  assert.equal(isAchieved(up, "starter-final", undefined, low), false, "50 에 못 미치면 아니다");
  process.stdout.write("(4) 50레벨 이상으로 레벨업하면 달성  ok\n");
}

// (5) 교환으로 받은 52레벨은 받는 순간 세지 않고, 53 으로 올리면 센다
{
  const prev = seed();
  const got = structuredClone(prev);
  got.pets.push(pet({ id: "p9", species: "pikachu", level: 52 }));
  assert.equal(isAchieved(got, "starter-final", undefined, prev), false, "받은 개체는 거래 전에 없다");
  const next = structuredClone(got);
  const p9 = next.pets.find((p) => p.id === "p9");
  if (p9) p9.level = 53;
  assert.equal(isAchieved(next, "starter-final", undefined, got), true, "받은 개체도 레벨업하면 센다");
  process.stdout.write("(5) 받은 개체는 레벨업해야 센다  ok\n");
}

// (6) 거래 전 저장이 없으면(시간 흐름) 레벨업 조건은 달성하지 않는다. 옛 달성 기록은 그대로 둔다
{
  const s = seed();
  const p0 = s.pets[0];
  if (p0) p0.level = 70;
  assert.equal(isAchieved(s, "starter-final"), false, "비교할 거래 전 저장이 없다");
  assert.deepStrictEqual(evaluate(s, T0), [], "시간 흐름만으로는 알리지 않는다");
  const old = seed();
  old.achievements["starter-final"] = { achievedAt: T0 - 1000, claimedAt: T0 - 500 };
  const again = structuredClone(old);
  const a0 = again.pets[0];
  if (a0) a0.level = 60;
  assert.deepStrictEqual(evaluate(again, T0, undefined, old), [], "옛 조건으로 받은 기록은 다시 알리지 않는다");
  assert.equal(again.achievements["starter-final"]?.claimedAt, T0 - 500, "옛 수령 기록을 지우지 않는다");
  process.stdout.write("(6) 시간 흐름과 옛 달성 기록  ok\n");
}

// (6-1) 이상한사탕 거래로 49 → 50 이 되면 거래 결과가 달성을 알린다
{
  let disk: SaveV3 = seed();
  const p0 = disk.pets[0];
  if (p0) p0.level = 49;
  disk.bag["rare-candy"] = 1;
  const tx = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0 }, HANDLERS);
  const res = tx.run({ id: "r1", name: "bag.use", args: { itemId: "rare-candy", petId: "p1" } });
  assert.equal(res.ok, true, "사탕 사용 성공");
  assert.deepStrictEqual(res.ok ? res.achieved : null, ["starter-final"], "거래가 달성을 돌려준다");
  assert.equal(disk.achievements["starter-final"]?.achievedAt, T0, "달성을 저장한다");
  process.stdout.write("(6-1) 이상한사탕 거래로 달성  ok\n");
}

// (7) 보상 수령 — 업적당 한 번, 잠긴 칸 하나를 연다
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  evaluate(s, T0);
  const before = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  const res = claim(s, "show-two", T0);
  assert.equal(res.ok, true);
  const after = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  assert.equal(after, before - 1, "업적 칸 하나가 열렸다");
  assert.equal(s.party.slots[res.slotIndex ?? -1]?.state, "empty");
  assert.equal(claim(s, "show-two", T0).reason, "already-claimed");
  process.stdout.write("(7) 보상 수령 · 한 번만  ok\n");
}

// (8) 달성하지 않았거나 없는 업적은 못 받는다
{
  const s = seed();
  assert.equal(claim(s, "show-two", T0).reason, "not-achieved");
  assert.equal(claim(s, "없는업적", T0).reason, "no-achievement");
  process.stdout.write("(8) 미달성과 없는 업적  ok\n");
}

// (9) 업적 칸이 남지 않으면 받을 수 없다
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  evaluate(s, T0);
  for (let i = 0; i < s.party.slots.length; i++) {
    const x = s.party.slots[i];
    if (x?.state === "locked" && x.unlockBy === "achievement") s.party.slots[i] = { state: "empty" };
  }
  assert.equal(claim(s, "show-two", T0).reason, "no-locked-slot");
  process.stdout.write("(9) 열 칸이 없으면 거절  ok\n");
}

// (9-0) 업적으로 여는 칸은 첫 프리셋의 칸이다 — 다른 프리셋을 적용한 중에 받아도 첫 프리셋의 칸이 열린다 (2026-10-02 사용자 결정)
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  evaluate(s, T0);
  assert.deepStrictEqual(applyPreset(s, 1), { ok: true });
  const before = s.party.slots.filter((x) => x.state === "locked").length;
  const res = claim(s, "show-two", T0);
  assert.equal(res.ok, true);
  assert.equal(s.party.slots.filter((x) => x.state === "locked").length, before, "적용한 프리셋의 칸은 그대로");
  assert.equal(slotsOfPreset(s, 0)?.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length, 1, "첫 프리셋의 업적 칸 하나가 열렸다");
  process.stdout.write("(9-0) 업적 칸은 첫 프리셋에  ok\n");
}

// (9-1) 함께 100시간 일하기 — 일한 누적 시간 100시간이면 달성. 시간 흐름에서도 판정한다(옛 저장은 다음 판정에 달성)
//       수령하면 라프라스 한 마리 — 빈 파티 칸에 꺼낸 상태로, 성격 무작위, 이로치 아님, 도감 해금·획득
{
  const s = seed();
  s.totals.workMs = 100 * 3600_000 - 1;
  assert.equal(isAchieved(s, "work-100h"), false, "100시간 미만이면 아니다");
  s.totals.workMs = 100 * 3600_000;
  assert.equal(isAchieved(s, "work-100h"), true);
  assert.ok(evaluate(s, T0).includes("work-100h"), "거래 전 저장 없이도(시간 흐름) 달성");
  s.party.slots[1] = { state: "empty" }; // 빈 파티 칸 하나
  const res = claim(s, "work-100h", T0, undefined, () => 0);
  assert.equal(res.ok, true);
  const got = s.pets.find((p) => p.id === res.petId);
  assert.equal(got?.species, "lapras");
  assert.equal(got?.shiny, false);
  assert.equal(got?.level, SAVE_V3_RULES.pet.level, "새 개체의 시작 값");
  assert.equal(res.slotIndex, 1);
  assert.equal(res.toBox, false);
  assert.deepStrictEqual(s.party.slots[1], { state: "pokemon", petId: res.petId, hidden: false }, "꺼낸 상태로 파티에");
  assert.ok(s.dex.unlocked.includes("lapras") && s.dex.obtained.includes("lapras"), "도감 해금·획득");
  assert.equal(s.achievements["work-100h"]?.claimedAt, T0);
  assert.equal(claim(s, "work-100h", T0).reason, "already-claimed", "한 번만");
  const lapras = snapshot(s).achievements.list.find((a) => a.id === "work-100h");
  assert.equal(lapras?.reward, "라프라스", "업적창에는 포켓몬 이름으로");
  assert.equal(lapras?.name, "함께 100시간 일하기");
  process.stdout.write("(9-1) 함께 100시간 일하기 · 라프라스  ok\n");
}

// (9-2) 파티 세 마리 모으기 — 파티 칸에 든 포켓몬 3마리면 달성. 숨긴 개체도 센다
//       빈 파티 칸이 없으면 메타몽은 박스로 간다. 앞 박스가 가득 차면 다음 박스로 간다. 둘 곳이 없으면 box-full 로 거절한다(selftest-box 가 본다)
{
  const s = seed();
  assert.equal(isAchieved(s, "party-three"), false, "두 마리로는 아니다");
  s.pets.push(pet({ id: "p3", species: "bulbasaur" }));
  s.party.slots[2] = { state: "pokemon", petId: "p3", hidden: true };
  assert.equal(isAchieved(s, "party-three"), true, "숨긴 세 마리도 센다");
  evaluate(s, T0);
  assert.equal(s.party.slots.some((x) => x.state === "empty"), false, "빈 파티 칸 없음");
  const box = s.boxes[0];
  if (box) box.slots.fill("filler");
  const res = claim(s, "party-three", T0, undefined, () => 0.5);
  assert.equal(res.ok, true);
  assert.equal(res.toBox, true, "박스로");
  assert.equal(s.boxes[1]?.slots[0], res.petId, "가득 찬 박스 다음 박스의 첫 칸");
  assert.equal(s.pets.find((p) => p.id === res.petId)?.species, "ditto");
  assert.ok(s.dex.obtained.includes("ditto"));
  assert.equal(snapshot(s).achievements.list.find((a) => a.id === "party-three")?.reward, "메타몽");
  process.stdout.write("(9-2) 파티 세 마리 모으기 · 메타몽 · 박스로  ok\n");
}

// (9-3) 수령 거래 — 실행기의 무작위로 성격을 정하고 결과에 개체를 돌려준다
{
  let disk: SaveV3 = seed();
  disk.totals.workMs = 100 * 3600_000;
  evaluate(disk, T0);
  const tx = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0 }, HANDLERS);
  const res = tx.run({ id: "c1", name: "achievement.claim", args: { id: "work-100h" } });
  assert.equal(res.ok, true);
  const petId = res.ok ? (res.result as { petId?: string }).petId : undefined;
  assert.equal(disk.pets.find((p) => p.id === petId)?.species, "lapras");
  process.stdout.write("(9-3) 포켓몬 보상 수령 거래  ok\n");
}

// (10) 튜토리얼 — 건너뛰거나 마치면 다시 띄우지 않는다
{
  const s = seed();
  assert.equal(canShow(s, "shop"), true, "처음에는 띄운다");
  assert.equal(skip(s, "shop").ok, true);
  assert.equal(s.tutorials.shop?.state, "skipped");
  assert.equal(canShow(s, "shop"), false);
  assert.equal(skip(s, "shop").reason, "already", "두 번 기록하지 않는다");
  assert.equal(done(s, "shop").reason, "already");

  assert.equal(done(s, "hatch", 2).ok, true);
  assert.equal(s.tutorials.hatch?.state, "done");
  assert.equal(s.tutorials.hatch?.steps, 2, "끝낸 단계 수를 남긴다");
  assert.equal(skip(s, "").reason, "bad-id");
  process.stdout.write("(10) 튜토리얼 상태 기록  ok\n");
}

// (11) 튜토리얼 대기열 — 첫 선택 → 첫 돌봄·상점, 첫 돌봄 끝 → 놀이공간(첫 돌봄 바로 뒤), 랜덤알 구매 → 부화. 이미 한 행동은 완료로 넘긴다
{
  const s = empty(T0);
  assert.ok(begin(s, "charmander", T0, () => 0.5).ok);
  assert.equal(s.points.balance, 120, "첫 선택 뒤 시작 포인트 120 — 랜덤알 하나 값");
  assert.deepStrictEqual(queueTutorials(s, T0), ["first-care", "shop"], "같은 순간이면 첫 돌봄이 상점보다 먼저");
  assert.deepStrictEqual(currentTutorial(s), { id: "first-care", surface: "stage" });
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), [], "두 번 불러도 다시 넣지 않는다");
  // 바탕화면에 나온 포켓몬이 없으면 첫 돌봄은 차례를 넘긴다 — 설정창 튜토리얼을 막지 않는다. 다시 꺼내면 돌아온다
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = true;
  assert.deepStrictEqual(currentTutorial(s), { id: "shop", surface: "manage" }, "첫 돌봄이 막히면 상점이 먼저");
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  assert.deepStrictEqual(currentTutorial(s), { id: "first-care", surface: "stage" }, "꺼내면 첫 돌봄이 다시 앞");
  // 튜토리얼 밖(설정창·점프 목록·CLI)의 밥 주기는 첫 돌봄을 끝내지 않는다 — 튜토리얼 메뉴에서 고른 돌봄으로만 끝난다
  // (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
  s.totals.fed += 1;
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), [], "바탕화면 놀이공간 튜토리얼은 줄에 들지 않는다");
  assert.equal(s.tutorials["first-care"]?.state, "none", "다른 곳의 밥 주기는 완료가 아니다");
  assert.deepStrictEqual(currentTutorial(s), { id: "first-care", surface: "stage" });
  assert.ok(done(s, "first-care", 2).ok, "튜토리얼 메뉴의 돌봄 — app.ts 가 tutorial.done 을 보낸다");
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), ["growth"], "첫 돌봄이 끝나면 성장 튜토리얼이 줄에 든다");
  assert.equal(s.tutorials.playground, undefined, "놀이공간 설명은 설정 › 화면으로 옮겼다(area, 대기열 밖)");
  assert.deepStrictEqual(currentTutorial(s), { id: "shop", surface: "manage" }, "첫 돌봄 뒤 상점");
  // 줄에 들 때 이미 돌본 옛 저장은 바로 완료로 넘긴다
  const old = empty(T0);
  assert.ok(begin(old, "charmander", T0, () => 0.5).ok);
  old.totals.played = 3;
  queueTutorials(old, T0);
  assert.equal(old.tutorials["first-care"]?.state, "done", "이미 돌본 저장은 첫 돌봄을 띄우지 않는다");

  assert.ok(buy(s, "random", T0 + 2, () => 0.5).ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), ["hatch"]);
  assert.equal(s.tutorials.shop?.state, "done", "랜덤알을 샀으니 상점 튜토리얼은 완료");
  assert.equal(currentTutorial(s)?.id, "growth", "먼저 줄에 든 성장이 부화보다 앞");
  assert.ok(done(s, "growth", 3).ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), ["points"], "성장이 끝나면 포인트");
  assert.equal(s.tutorials.points?.queuedAt, s.tutorials.growth?.queuedAt, "포인트는 성장의 대기 시각을 물려받아 부화보다 앞");
  assert.equal(currentTutorial(s)?.id, "points");
  assert.ok(skip(s, "points").ok);
  assert.equal(currentTutorial(s)?.id, "hatch");

  const egg = s.eggs[0]!;
  Object.assign(egg, { ready: true, remainMs: 0, actions: { pat: 1, song: 0 }, candidates: ["rattata"] });
  assert.ok(open(s, egg.id, T0 + 3, () => 0.99).ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 3), ["party"], "둘째 포켓몬을 얻으면 파티와 박스 튜토리얼");
  assert.equal(s.tutorials.hatch?.state, "done", "알을 열었으니 부화 튜토리얼은 완료");
  assert.equal(currentTutorial(s)?.id, "party");
  assert.ok(done(s, "party", 2).ok);
  assert.equal(currentTutorial(s), null);
  // 파티 프리셋 — 파티 튜토리얼을 끝낸 뒤 개체가 3마리가 되면 줄에 든다
  assert.deepStrictEqual(queueTutorials(s, T0 + 4), [], "두 마리면 프리셋 튜토리얼은 없다");
  s.pets.push({ ...s.pets[1]!, id: "p-third" });
  assert.deepStrictEqual(queueTutorials(s, T0 + 5), ["preset"], "셋째 포켓몬을 얻으면 프리셋 튜토리얼");
  assert.equal(s.tutorials.preset?.queuedAt, s.tutorials.party?.queuedAt, "프리셋은 파티의 대기 시각을 물려받는다");
  assert.equal(currentTutorial(s)?.id, "preset");
  assert.ok(done(s, "preset", 3).ok);
  assert.equal(currentTutorial(s), null);
  process.stdout.write("(11) 튜토리얼 대기열 · 시작 조건과 건너뛰기  ok\n");
}

// (11b) 가방·진화 튜토리얼 — 처음 쓸 수 있게 될 때 줄에 든다. 쓸 수 없게 되면 차례를 넘긴다
{
  const s = empty(T0);
  assert.ok(begin(s, "charmander", T0, () => 0.5).ok);
  for (const id of ["first-care", "shop", "growth", "points"]) s.tutorials[id] = { state: "done", steps: 0 };
  assert.deepStrictEqual(queueTutorials(s, T0), [], "도구가 없으면 가방 튜토리얼은 없다");
  s.bag["basic-food"] = 5;
  assert.deepStrictEqual(queueTutorials(s, T0), [], "기본먹이는 도구로 치지 않는다");
  s.bag["exp-candy-s"] = 1;
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), ["bag"]);
  s.bag["exp-candy-s"] = 0;
  assert.equal(currentTutorial(s), null, "도구를 다 쓰면 가방 튜토리얼은 차례를 넘긴다");
  s.bag["exp-candy-s"] = 1;
  assert.equal(currentTutorial(s)?.id, "bag");
  assert.ok(skip(s, "bag").ok);
  // 파이리는 Lv.16 에 진화한다 — 레벨 조건을 채우면 진화 튜토리얼
  const pet = s.pets[0]!;
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), [], "진화 조건 전에는 없다");
  pet.exp = 1_000_000;
  pet.level = 100;
  assert.deepStrictEqual(queueTutorials(s, T0 + 3), ["evolution"]);
  assert.equal(currentTutorial(s)?.id, "evolution");
  process.stdout.write("(11b) 새 기능 튜토리얼 · 가방과 진화  ok\n");
}

// (12) 같은 순간에 생긴 조건은 스펙 순서(상점 → 부화), 먼저 생긴 것이 먼저. 이미 다른 개체가 있는 옛 저장은 상점을 넘긴다
{
  const s = empty(T0);
  assert.ok(begin(s, "charmander", T0, () => 0.5).ok);
  assert.ok(buy(s, "random", T0, () => 0.5).ok);
  s.eggSeq = 0; // 산 기록이 없는 옛 저장처럼 — 상점이 넘어가지 않게
  s.totals.fed = 1; // 첫 돌봄은 이미 했다 — 상점과 부화의 순서만 본다
  s.tutorials.playground = { state: "skipped", steps: 0 }; // 놀이공간도 넘겼다
  queueTutorials(s, T0);
  assert.equal(currentTutorial(s)?.id, "shop", "같은 순간이면 상점이 부화보다 먼저");

  const old = empty(T0);
  assert.ok(begin(old, "charmander", T0, () => 0.5).ok);
  old.pets.push({ ...old.pets[0]!, id: "p9" });
  queueTutorials(old, T0);
  assert.equal(old.tutorials.shop?.state, "done", "다른 개체가 이미 있으면 상점 튜토리얼은 완료");
  process.stdout.write("(12) 튜토리얼 순서 · 옛 저장  ok\n");
}

// (12b) 업적 튜토리얼 — 달성하면 줄에 들고, 한 번 받으면 끝
{
  const s = empty(T0);
  assert.ok(begin(s, "charmander", T0, () => 0.5).ok);
  s.totals.fed = 1;
  s.eggSeq = 1; // 상점도 이미 했다
  s.tutorials.playground = { state: "skipped", steps: 0 }; // 놀이공간도 넘겼다
  s.pets.push({ ...s.pets[0]!, id: "p9" }); // 파티가 가득 차 박스로 간 새 개체 — 파티 칸에 없다
  s.achievements["show-two"] = { achievedAt: T0, claimedAt: null };
  queueTutorials(s, T0);
  assert.equal(currentTutorial(s)?.id, "achievement");
  s.achievements["show-two"] = { achievedAt: T0, claimedAt: T0 + 1 };
  queueTutorials(s, T0 + 1);
  assert.equal(s.tutorials.achievement?.state, "done", "보상을 받으면 끝");
  process.stdout.write("(12b) 업적 안내 · 박스로 간 새 개체  ok\n");
}

// (13) 밥 주기·놀아주기 처리기는 누적 횟수를 올린다 — 첫 돌봄 튜토리얼이 "이미 돌봤다"를 이것으로 본다
{
  const s = empty(T0);
  assert.ok(begin(s, "charmander", T0, () => 0.5).ok);
  s.pets[0]!.fullness = 50;
  const ctx = { now: T0, rand: () => 0.5 };
  assert.equal(HANDLERS["feed"]!(s, { petId: s.pets[0]!.id }, ctx).ok, true);
  assert.equal(HANDLERS["play"]!(s, { petId: s.pets[0]!.id }, ctx).ok, true);
  assert.deepStrictEqual([s.totals.fed, s.totals.played], [1, 1]);
  process.stdout.write("(13) 돌봄 누적 횟수  ok\n");
}

process.stdout.write("selftest-achievement: 통과 (업적 조건·수령·튜토리얼·대기열·돌봄 누적)\n");
