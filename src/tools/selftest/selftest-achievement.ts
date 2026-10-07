// 업적과 튜토리얼 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-achievement.js
//
// 테스트 프레임워크 없이 assert 만. 조건은 코드가, 이름과 보상은 data/achievements.json 이 가진다.
// 계약은 docs/specs/game.md "파티 칸과 업적", "튜토리얼" 이다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { regionalOf } from "../../dex/regional";
import { unclaimedAchievementIds } from "../../dex/tables";
import { profileOf, speciesSlugs } from "../../dex/species";
import { sellsSpecies } from "../../shop/catalog";
import { snapshotView } from "../../view/snapshot";
import { emptySave as empty, normalizeSave as normalize } from "../../save/normalize";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { applyStarter } from "../../party/starter";
import { applyPreset, slotsOfPreset } from "../../party/presets";
import { buyProduct } from "../../shop/buy";
import { openEgg } from "../../egg/open";
import { createExecutor } from "../../tx/executor";
import { claimAchievement } from "../../achievement/claim";
import { achievementDefs, GROUPS, rewardEgg, rewardItem, rewardPoints, rewardPokemon } from "../../achievement/defs";
import { evaluateAchievements } from "../../achievement/evaluate";
import { isAchieved, progressOf } from "../../achievement/progress";
import { ACHIEVEMENT_RULES } from "../../achievement/rules";
import { isSinglePet } from "../../dex/forms";
import { eggPool, rewardSpecies, singleSpecies } from "../../dex/obtain";
import { EGG_RULES } from "../../egg/rules";
import { pendingOf } from "../../notify/pending";
import { PET_RULES } from "../../party/rules";
import { canShow, currentTutorial, doneTutorial, queueTutorials, skipTutorial } from "../../tutorial/queue";
import { HANDLERS } from "../../tx/command-table";
import { T0 } from "../harness/clock"; // 2026-09-24 10:00 로컬 — 게임 시간 낮
import { testPet } from "../harness/fixtures";

// 시험 개체 — newPet 결과에 크기 2 와 over 를 덮는다 (src/tools/harness/fixtures.ts)
const pet = (over: Partial<PetV3> = {}): PetV3 => testPet({ size: 2, ...over });

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

// (1) 업적 43개가 이름·분류·조건·보상을 가진다 (2026-10-03 업적 개선). 옛 업적 네 개의 키와 보상은 그대로다 (2026-09-29 사용자 결정 — 메타몽·라프라스)
{
  const list = achievementDefs();
  assert.equal(list.length, 43);
  for (const [id, def] of list) {
    assert.ok(def.ko.length > 0);
    assert.ok((def.en ?? "").length > 0, `영어 이름 ${id}`);
    assert.ok(GROUPS.includes(def.group), `분류 ${id}`);
    assert.ok(typeof def.cond?.kind === "string", `조건 ${id}`);
    const kinds = [def.reward === "party-slot", rewardPokemon(def) != null, rewardPoints(def) != null, rewardEgg(def) != null, rewardItem(def) != null];
    assert.equal(kinds.filter(Boolean).length, 1, `보상은 한 종류 ${id}`);
  }
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, list.filter(([, d]) => d.group === g).length]));
  assert.deepStrictEqual(byGroup, { dex: 19, grow: 5, egg: 4, find: 3, together: 12 });
  const old = ["show-two", "starter-final", "work-100h", "party-three"];
  const reward = Object.fromEntries(list.filter(([id]) => old.includes(id)).map(([id, def]) => [id, rewardPokemon(def) ?? def.reward]));
  assert.deepStrictEqual(reward, { "show-two": "party-slot", "starter-final": "party-slot", "work-100h": "lapras", "party-three": "ditto" });
  // 업적으로만 얻는 종 — 뮤·토게피, 마기아나(500년 전의 색)·피츄(삐쭉귀) (2026-10-03 사용자 결정). 루가루암(황혼의 모습)은 진화 조건으로 얻는다(같은 날 "추천대로 하자")
  // 로토무는 CLI 첫 연결(첫 작업 신호) 보상이다 (2026-10-05 사용자 결정 "로토무는 cli 첫 연결 보상으로")
  assert.deepStrictEqual(rewardSpecies().sort(), ["arceus", "ditto", "lapras", "magearna-original", "mew", "pichu-spiky-eared", "rotom", "togepi"]);
  // 업적 보상 종은 모두 단일 포켓몬이다 — 팔거나 교환할 수 없고 상점에서 팔지 않는다 (2026-10-03 사용자 결정 "업적에서 구하는 포켓몬들도 단일종으로")
  for (const slug of rewardSpecies()) {
    assert.ok(singleSpecies().has(slug), `단일 포켓몬 ${slug}`);
    assert.equal(sellsSpecies(slug), false, `상점에서 팔지 않는다 ${slug}`);
    assert.equal(isSinglePet({ species: slug, evolved: [] }), true, `교환·판매 불가 ${slug}`);
  }
  assert.equal(isSinglePet({ species: "togekiss", evolved: ["togepi", "togetic"] }), true, "업적 보상 종에서 진화한 개체도 단일 포켓몬이다");
  for (const [id, def] of list) {
    const egg = rewardEgg(def);
    if (egg) assert.ok((eggPool(egg) ?? []).length > 0, `알 종류 ${id}`);
  }
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
  assert.deepStrictEqual(evaluateAchievements(s, T0), ["show-two"], "이번에 달성한 것을 돌려준다");
  assert.equal(s.achievements["show-two"]?.achievedAt, T0);
  assert.deepStrictEqual(evaluateAchievements(s, T0 + 1000), [], "두 번 알리지 않는다");
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = true;
  evaluateAchievements(s, T0 + 2000);
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
  assert.deepStrictEqual(evaluateAchievements(s, T0), [], "시간 흐름만으로는 알리지 않는다");
  const old = seed();
  old.achievements["starter-final"] = { achievedAt: T0 - 1000, claimedAt: T0 - 500 };
  const again = structuredClone(old);
  const a0 = again.pets[0];
  if (a0) a0.level = 60;
  assert.deepStrictEqual(evaluateAchievements(again, T0, undefined, old), [], "옛 조건으로 받은 기록은 다시 알리지 않는다");
  assert.equal(again.achievements["starter-final"]?.claimedAt, T0 - 500, "옛 수령 기록을 지우지 않는다");
  process.stdout.write("(6) 시간 흐름과 옛 달성 기록  ok\n");
}

// (6-1) 이상한사탕 거래로 49 → 50 이 되면 거래 결과가 달성을 알린다
{
  let disk: SaveV3 = seed();
  const p0 = disk.pets[0];
  if (p0) p0.level = 49;
  disk.bag["rare-candy"] = 1;
  const tx = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0, rand: Math.random }, HANDLERS);
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
  evaluateAchievements(s, T0);
  const before = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  const res = claimAchievement(s, "show-two", T0, undefined, () => 0.5);
  assert.equal(res.ok, true);
  const after = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  assert.equal(after, before - 1, "업적 칸 하나가 열렸다");
  assert.equal(s.party.slots[res.slotIndex ?? -1]?.state, "empty");
  assert.equal(claimAchievement(s, "show-two", T0, undefined, () => 0.5).reason, "already-claimed");
  process.stdout.write("(7) 보상 수령 · 한 번만  ok\n");
}

// (8) 달성하지 않았거나 없는 업적은 못 받는다
{
  const s = seed();
  assert.equal(claimAchievement(s, "show-two", T0, undefined, () => 0.5).reason, "not-achieved");
  assert.equal(claimAchievement(s, "없는업적", T0, undefined, () => 0.5).reason, "no-achievement");
  process.stdout.write("(8) 미달성과 없는 업적  ok\n");
}

// (9) 업적 칸이 남지 않으면 받을 수 없다
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  evaluateAchievements(s, T0);
  for (let i = 0; i < s.party.slots.length; i++) {
    const x = s.party.slots[i];
    if (x?.state === "locked" && x.unlockBy === "achievement") s.party.slots[i] = { state: "empty" };
  }
  assert.equal(claimAchievement(s, "show-two", T0, undefined, () => 0.5).reason, "no-locked-slot");
  process.stdout.write("(9) 열 칸이 없으면 거절  ok\n");
}

// (9-0) 업적으로 여는 칸은 첫 프리셋의 칸이다 — 다른 프리셋을 적용한 중에 받아도 첫 프리셋의 칸이 열린다 (2026-10-02 사용자 결정)
{
  const s = seed();
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  evaluateAchievements(s, T0);
  assert.deepStrictEqual(applyPreset(s, 1), { ok: true });
  const before = s.party.slots.filter((x) => x.state === "locked").length;
  const res = claimAchievement(s, "show-two", T0, undefined, () => 0.5);
  assert.equal(res.ok, true);
  assert.equal(s.party.slots.filter((x) => x.state === "locked").length, before, "적용한 프리셋의 칸은 그대로");
  assert.equal(slotsOfPreset(s, 0)?.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length, 1, "첫 프리셋의 업적 칸 하나가 열렸다");
  process.stdout.write("(9-0) 업적 칸은 첫 프리셋에  ok\n");
}

// (9-0) 함께 N시간 일하기 사다리 — 1·10·50·300·1000시간 (2026-10-05 사용자 결정, CLI 적립 2배를 업적으로 옮김)
{
  const s = seed();
  // 처음 함께 일하기 — 첫 작업 신호(작업 시간 > 0)에 로토무 (2026-10-05 사용자 결정 "로토무는 cli 첫 연결 보상으로")
  s.totals.workMs = 0;
  assert.equal(isAchieved(s, "work-1h"), false, "작업 신호가 없으면 아니다");
  s.totals.workMs = 1;
  assert.equal(isAchieved(s, "work-1h"), true, "첫 작업 신호");
  const ladder = [10, 50, 100, 300, 500, 1000];
  for (const h of ladder) {
    s.totals.workMs = h * 3600_000 - 1;
    assert.equal(isAchieved(s, `work-${h}h`), false, `${h}시간 미만이면 아니다`);
    s.totals.workMs = h * 3600_000;
    assert.equal(isAchieved(s, `work-${h}h`), true, `${h}시간이면 달성`);
  }
  process.stdout.write("(9-0) 함께 N시간 일하기 사다리  ok\n");
}

// (9-1) 함께 100시간 일하기 — 일한 누적 시간 100시간이면 달성. 시간 흐름에서도 판정한다(옛 저장은 다음 판정에 달성)
//       수령하면 라프라스 한 마리 — 빈 파티 칸에 꺼낸 상태로, 성격 무작위, 이로치 아님, 도감 해금·획득
{
  const s = seed();
  s.totals.workMs = 100 * 3600_000 - 1;
  assert.equal(isAchieved(s, "work-100h"), false, "100시간 미만이면 아니다");
  s.totals.workMs = 100 * 3600_000;
  assert.equal(isAchieved(s, "work-100h"), true);
  assert.ok(evaluateAchievements(s, T0).includes("work-100h"), "거래 전 저장 없이도(시간 흐름) 달성");
  s.party.slots[1] = { state: "empty" }; // 빈 파티 칸 하나
  const res = claimAchievement(s, "work-100h", T0, undefined, () => 0);
  assert.equal(res.ok, true);
  const got = s.pets.find((p) => p.id === res.petId);
  assert.equal(got?.species, "lapras");
  assert.equal(got?.shiny, false);
  assert.equal(got?.level, PET_RULES.level, "새 개체의 시작 값");
  assert.equal(res.slotIndex, 1);
  assert.equal(res.toBox, false);
  assert.deepStrictEqual(s.party.slots[1], { state: "pokemon", petId: res.petId, hidden: false }, "꺼낸 상태로 파티에");
  assert.ok(s.dex.unlocked.includes("lapras") && s.dex.obtained.includes("lapras"), "도감 해금·획득");
  assert.equal(s.achievements["work-100h"]?.claimedAt, T0);
  assert.equal(claimAchievement(s, "work-100h", T0, undefined, () => 0.5).reason, "already-claimed", "한 번만");
  const lapras = snapshotView(s, T0).achievements.list.find((a) => a.id === "work-100h");
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
  evaluateAchievements(s, T0);
  assert.equal(s.party.slots.some((x) => x.state === "empty"), false, "빈 파티 칸 없음");
  const box = s.boxes[0];
  if (box) box.slots.fill("filler");
  const res = claimAchievement(s, "party-three", T0, undefined, () => 0.5);
  assert.equal(res.ok, true);
  assert.equal(res.toBox, true, "박스로");
  assert.equal(s.boxes[1]?.slots[0], res.petId, "가득 찬 박스 다음 박스의 첫 칸");
  assert.equal(s.pets.find((p) => p.id === res.petId)?.species, "ditto");
  assert.ok(s.dex.obtained.includes("ditto"));
  assert.equal(snapshotView(s, T0).achievements.list.find((a) => a.id === "party-three")?.reward, "메타몽");
  process.stdout.write("(9-2) 파티 세 마리 모으기 · 메타몽 · 박스로  ok\n");
}

// (9-3) 수령 거래 — 실행기의 무작위로 성격을 정하고 결과에 개체를 돌려준다
{
  let disk: SaveV3 = seed();
  disk.totals.workMs = 100 * 3600_000;
  evaluateAchievements(disk, T0);
  const tx = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0, rand: Math.random }, HANDLERS);
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
  assert.equal(skipTutorial(s, "shop").ok, true);
  assert.equal(s.tutorials.shop?.state, "skipped");
  assert.equal(canShow(s, "shop"), false);
  assert.equal(skipTutorial(s, "shop").reason, "already", "두 번 기록하지 않는다");
  assert.equal(doneTutorial(s, "shop").reason, "already");

  assert.equal(doneTutorial(s, "hatch").ok, true);
  assert.equal(s.tutorials.hatch?.state, "done");
  assert.equal(s.tutorials.hatch?.steps, 1, "끝낸 단계 수는 표(TUTORIAL_STEPS)의 값이다 — 보낸 값이 아니다");
  assert.equal(skipTutorial(s, "").reason, "bad-id");
  assert.equal(doneTutorial(s, "no-such-tutorial").reason, "bad-id", "표에 없는 id 는 거절 (94 항목 9-5-5)");
  assert.equal(s.tutorials["no-such-tutorial"], undefined, "저장에 남기지 않는다");
  process.stdout.write("(10) 튜토리얼 상태 기록  ok\n");
}

// (11) 튜토리얼 대기열 — 첫 선택 → 첫 돌봄·상점, 첫 돌봄 끝 → 놀이공간(첫 돌봄 바로 뒤), 랜덤알 구매 → 부화. 이미 한 행동은 완료로 넘긴다
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  assert.equal(s.points.balance, 120, "첫 선택 뒤 시작 포인트 120 — 랜덤알 하나 값");
  assert.deepStrictEqual(queueTutorials(s, T0), ["first-care", "shop"], "같은 순간이면 첫 돌봄이 상점보다 먼저");
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "first-care", surface: "stage" });
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), [], "두 번 불러도 다시 넣지 않는다");
  // 바탕화면에 나온 포켓몬이 없으면 첫 돌봄은 차례를 넘긴다 — 설정창 튜토리얼을 막지 않는다. 다시 꺼내면 돌아온다
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = true;
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "shop", surface: "manage" }, "첫 돌봄이 막히면 상점이 먼저");
  for (const x of s.party.slots) if (x.state === "pokemon") x.hidden = false;
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "first-care", surface: "stage" }, "꺼내면 첫 돌봄이 다시 앞");
  // 튜토리얼 밖(설정창·CLI)의 밥 주기는 첫 돌봄을 끝내지 않는다 — 튜토리얼 메뉴에서 고른 돌봄으로만 끝난다
  // (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
  s.totals.fed += 1;
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), [], "바탕화면 놀이공간 튜토리얼은 줄에 들지 않는다");
  assert.equal(s.tutorials["first-care"]?.state, "none", "다른 곳의 밥 주기는 완료가 아니다");
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "first-care", surface: "stage" });
  assert.ok(doneTutorial(s, "first-care").ok, "튜토리얼 메뉴의 돌봄 — app.ts 가 tutorial.done 을 보낸다");
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), ["growth"], "첫 돌봄이 끝나면 성장 튜토리얼이 줄에 든다");
  assert.equal(s.tutorials.playground, undefined, "놀이공간 설명은 설정 › 화면으로 옮겼다(area, 대기열 밖)");
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "shop", surface: "manage" }, "첫 돌봄 뒤 상점");
  // 줄에 들 때 이미 돌본 옛 저장은 바로 완료로 넘긴다
  const old = empty(T0);
  assert.ok(applyStarter(old, "charmander", T0, () => 0.5).ok);
  old.totals.played = 3;
  queueTutorials(old, T0);
  assert.equal(old.tutorials["first-care"]?.state, "done", "이미 돌본 저장은 첫 돌봄을 띄우지 않는다");

  assert.ok(buyProduct(s, "random", T0 + 2, () => 0.5).ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), ["hatch"]);
  assert.equal(s.tutorials.shop?.state, "done", "랜덤알을 샀으니 상점 튜토리얼은 완료");
  assert.equal(currentTutorial(s, T0)?.id, "growth", "먼저 줄에 든 성장이 부화보다 앞");
  assert.ok(doneTutorial(s, "growth").ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), ["points"], "성장이 끝나면 포인트");
  assert.equal(s.tutorials.points?.queuedAt, s.tutorials.growth?.queuedAt, "포인트는 성장의 대기 시각을 물려받아 부화보다 앞");
  assert.equal(currentTutorial(s, T0)?.id, "points");
  assert.ok(skipTutorial(s, "points").ok);
  assert.equal(currentTutorial(s, T0)?.id, "hatch");

  const egg = s.eggs[0]!;
  Object.assign(egg, { ready: true, remainMs: 0, actions: { pat: 1, song: 0 }, candidates: ["rattata"] });
  assert.ok(openEgg(s, egg.id, T0 + 3, () => 0.99).ok);
  assert.deepStrictEqual(queueTutorials(s, T0 + 3), ["party"], "둘째 포켓몬을 얻으면 파티와 박스 튜토리얼");
  assert.equal(s.tutorials.hatch?.state, "done", "알을 열었으니 부화 튜토리얼은 완료");
  assert.equal(currentTutorial(s, T0)?.id, "party");
  assert.ok(doneTutorial(s, "party").ok);
  assert.equal(currentTutorial(s, T0), null);
  // 파티 프리셋 — 파티 튜토리얼을 끝낸 뒤 개체가 3마리가 되면 줄에 든다
  assert.deepStrictEqual(queueTutorials(s, T0 + 4), [], "두 마리면 프리셋 튜토리얼은 없다");
  s.pets.push({ ...s.pets[1]!, id: "p-third" });
  assert.deepStrictEqual(queueTutorials(s, T0 + 5), ["preset"], "셋째 포켓몬을 얻으면 프리셋 튜토리얼");
  assert.equal(s.tutorials.preset?.queuedAt, s.tutorials.party?.queuedAt, "프리셋은 파티의 대기 시각을 물려받는다");
  assert.equal(currentTutorial(s, T0)?.id, "preset");
  assert.ok(doneTutorial(s, "preset").ok);
  assert.equal(currentTutorial(s, T0), null);
  process.stdout.write("(11) 튜토리얼 대기열 · 시작 조건과 건너뛰기  ok\n");
}

// (11b) 가방·진화 튜토리얼 — 처음 쓸 수 있게 될 때 줄에 든다. 쓸 수 없게 되면 차례를 넘긴다
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  for (const id of ["first-care", "shop", "growth", "points"]) s.tutorials[id] = { state: "done", steps: 0 };
  assert.deepStrictEqual(queueTutorials(s, T0), [], "도구가 없으면 가방 튜토리얼은 없다");
  s.bag["basic-food"] = 5;
  assert.deepStrictEqual(queueTutorials(s, T0), [], "기본먹이는 도구로 치지 않는다");
  s.bag["exp-candy-s"] = 1;
  assert.deepStrictEqual(queueTutorials(s, T0 + 1), ["bag"]);
  s.bag["exp-candy-s"] = 0;
  assert.equal(currentTutorial(s, T0), null, "도구를 다 쓰면 가방 튜토리얼은 차례를 넘긴다");
  s.bag["exp-candy-s"] = 1;
  assert.equal(currentTutorial(s, T0)?.id, "bag");
  assert.ok(skipTutorial(s, "bag").ok);
  // 파이리는 Lv.16 에 진화한다 — 레벨 조건을 채우면 진화 튜토리얼
  const pet = s.pets[0]!;
  assert.deepStrictEqual(queueTutorials(s, T0 + 2), [], "진화 조건 전에는 없다");
  pet.exp = 1_000_000;
  pet.level = 100;
  assert.deepStrictEqual(queueTutorials(s, T0 + 3), ["evolution"]);
  assert.equal(currentTutorial(s, T0)?.id, "evolution");
  process.stdout.write("(11b) 새 기능 튜토리얼 · 가방과 진화  ok\n");
}

// (11c) 가이드북의 다시 보기 — 끝낸 튜토리얼도 처음부터, 줄 맨 앞에. "이미 했다"로 바로 끝내지 않는다. 대상이 없으면 목록에서 빠진다
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  queueTutorials(s, T0);
  for (const id of ["first-care", "shop", "dex", "detail"]) s.tutorials[id] = { state: "done", steps: 1, queuedAt: T0 };
  s.tutorials.growth = { state: "none", steps: 0, queuedAt: T0 + 5 };
  const ready = (): string[] => snapshotView(s, T0).replayTutorials;
  assert.ok(ready().includes("first-care") && ready().includes("growth") && ready().includes("detail"), "파티 포켓몬이 있으면 첫 돌봄·성장·개체 상세를 다시 볼 수 있다");
  for (const id of ["hatch", "achievement", "box", "bag", "evolution"]) assert.ok(!ready().includes(id), `${id} — 대상이 없으면 흐린다`);
  assert.ok(!ready().includes("shop") && !ready().includes("playground"), "상점·놀이공간은 다시 보기에 없다");

  s.totals.fed = 3; // 첫 돌봄의 "이미 했다"
  assert.ok(HANDLERS["tutorial.replay"]!(s, { id: "first-care" }, { now: T0, rand: () => 0.5 }).ok);
  assert.deepStrictEqual(s.tutorials["first-care"], { state: "none", steps: 0, queuedAt: 0, replay: true });
  queueTutorials(s, T0 + 1);
  assert.equal(s.tutorials["first-care"]?.state, "none", "다시 보는 중에는 이미 한 행동으로 끝내지 않는다");
  assert.deepStrictEqual(currentTutorial(s, T0), { id: "first-care", surface: "stage" }, "먼저 줄에 든 성장보다 앞");
  assert.ok(skipTutorial(s, "first-care").ok);
  assert.equal(s.tutorials["first-care"]?.replay, undefined, "닫으면 다시 보기 표시를 지운다");
  assert.equal(currentTutorial(s, T0)?.id, "growth");

  assert.ok(buyProduct(s, "random", T0 + 2, () => 0.5).ok);
  s.tutorials.hatch = { state: "done", steps: 1, queuedAt: T0 };
  const pts = s.points.balance;
  assert.ok(ready().includes("hatch"), "랜덤알이 있으면 부화를 다시 볼 수 있다");
  assert.ok(HANDLERS["tutorial.replay"]!(s, { id: "hatch" }, { now: T0, rand: () => 0.5 }).ok);
  s.eggs = [];
  queueTutorials(s, T0 + 2);
  assert.equal(s.tutorials.hatch?.state, "none", "알이 없어져도 다시 보기는 바로 끝나지 않는다 — 대상이 없으면 차례만 넘긴다");

  assert.ok(HANDLERS["tutorial.replay"]!(s, { id: "dex" }, { now: T0, rand: () => 0.5 }).ok);
  assert.deepStrictEqual(s.tutorials.dex, { state: "none", steps: 0, replay: true }, "화면 튜토리얼은 줄에 들지 않고 그 화면을 열 때 보인다");
  assert.ok(snapshotView(s, T0).screenTutorials?.includes("dex"));
  assert.ok(doneTutorial(s, "dex").ok);
  assert.equal(s.tutorials.dex?.replay, undefined, "끝내면 다시 보기 표시를 지운다");
  assert.ok(HANDLERS["tutorial.replay"]!(s, { id: "detail" }, { now: T0, rand: () => 0.5 }).ok);
  assert.equal(snapshotView(s, T0).detailTutorial, true, "개체 상세 튜토리얼이 다시 보인다");

  assert.equal(HANDLERS["tutorial.replay"]!(s, { id: "shop" }, { now: T0, rand: () => 0.5 }).ok, false, "상점은 다시 보기에 없다");
  assert.equal(HANDLERS["tutorial.replay"]!(s, { id: "playground" }, { now: T0, rand: () => 0.5 }).ok, false);
  assert.equal(HANDLERS["tutorial.replay"]!(s, { id: "" }, { now: T0, rand: () => 0.5 }).ok, false);
  assert.equal(s.points.balance, pts, "다시 보기는 포인트를 바꾸지 않는다");
  const norm = normalize(structuredClone(s) as unknown, T0);
  assert.equal(norm?.tutorials.detail?.replay, true, "다시 보기 표시는 저장을 다시 읽어도 남는다");
  process.stdout.write("(11c) 튜토리얼 다시 보기 — 처음부터·줄 맨 앞·대상 판정  ok\n");
}

// (12) 같은 순간에 생긴 조건은 스펙 순서(상점 → 부화), 먼저 생긴 것이 먼저. 이미 다른 개체가 있는 옛 저장은 상점을 넘긴다
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  assert.ok(buyProduct(s, "random", T0, () => 0.5).ok);
  s.eggSeq = 0; // 산 기록이 없는 옛 저장처럼 — 상점이 넘어가지 않게
  s.totals.fed = 1; // 첫 돌봄은 이미 했다 — 상점과 부화의 순서만 본다
  s.tutorials.playground = { state: "skipped", steps: 0 }; // 놀이공간도 넘겼다
  queueTutorials(s, T0);
  assert.equal(currentTutorial(s, T0)?.id, "shop", "같은 순간이면 상점이 부화보다 먼저");

  const old = empty(T0);
  assert.ok(applyStarter(old, "charmander", T0, () => 0.5).ok);
  old.pets.push({ ...old.pets[0]!, id: "p9" });
  queueTutorials(old, T0);
  assert.equal(old.tutorials.shop?.state, "done", "다른 개체가 이미 있으면 상점 튜토리얼은 완료");
  process.stdout.write("(12) 튜토리얼 순서 · 옛 저장  ok\n");
}

// (12b) 업적 튜토리얼 — 달성하면 줄에 들고, 한 번 받으면 끝
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  s.totals.fed = 1;
  s.eggSeq = 1; // 상점도 이미 했다
  s.tutorials.playground = { state: "skipped", steps: 0 }; // 놀이공간도 넘겼다
  s.pets.push({ ...s.pets[0]!, id: "p9" }); // 파티가 가득 차 박스로 간 새 개체 — 파티 칸에 없다
  s.achievements["show-two"] = { achievedAt: T0, claimedAt: null };
  queueTutorials(s, T0);
  assert.equal(currentTutorial(s, T0)?.id, "achievement");
  s.achievements["show-two"] = { achievedAt: T0, claimedAt: T0 + 1 };
  queueTutorials(s, T0 + 1);
  assert.equal(s.tutorials.achievement?.state, "done", "보상을 받으면 끝");
  process.stdout.write("(12b) 업적 안내 · 박스로 간 새 개체  ok\n");
}

// (13) 밥 주기·놀아주기 처리기는 누적 횟수를 올린다 — 첫 돌봄 튜토리얼이 "이미 돌봤다"를 이것으로 본다
{
  const s = empty(T0);
  assert.ok(applyStarter(s, "charmander", T0, () => 0.5).ok);
  s.pets[0]!.fullness = 50;
  const ctx = { now: T0, rand: () => 0.5 };
  assert.equal(HANDLERS["feed"]!(s, { petId: s.pets[0]!.id }, ctx).ok, true);
  assert.equal(HANDLERS["play"]!(s, { petId: s.pets[0]!.id }, ctx).ok, true);
  assert.deepStrictEqual([s.totals.fed, s.totals.played], [1, 1]);
  process.stdout.write("(13) 돌봄 누적 횟수  ok\n");
}

// (14) 셀 수 있는 조건과 진행도 — 도감 수, 지방 완성(리전폼은 세지 않는다), 한 번에 채우는 조건은 진행도가 없다
{
  const s = seed();
  s.dex.obtained = Array.from({ length: 50 }, (_, i) => `x${i}`);
  assert.equal(isAchieved(s, "dex-50"), true);
  assert.equal(isAchieved(s, "dex-150"), false);
  assert.deepStrictEqual(progressOf(s, "dex-150"), { now: 50, goal: 150, unit: "" });
  assert.deepStrictEqual(progressOf(s, "dex-50"), { now: 50, goal: 50, unit: "" }, "현재 값은 기준을 넘지 않는다");

  const k = seed();
  k.dex.obtained = ["bulbasaur", "rattata-alola", "mew"];
  assert.deepStrictEqual(progressOf(k, "dex-kanto"), { now: 1, goal: 150, unit: "" }, "리전폼과 뮤는 세지 않는다");
  const byDex = new Map<number, string>();
  for (const slug of speciesSlugs()) {
    if (regionalOf(slug)) continue;
    const d = profileOf(slug).dex;
    if (d >= 1 && d <= 150 && !byDex.has(d)) byDex.set(d, slug);
  }
  assert.equal(byDex.size, 150);
  k.dex.obtained = [...byDex.values()].slice(1);
  assert.equal(isAchieved(k, "dex-kanto"), false, "한 종이 모자라다");
  k.dex.obtained = [...byDex.values()];
  assert.equal(isAchieved(k, "dex-kanto"), true);

  // 종 모으기 — 적은 종을 모두 얻으면 달성한다. 아르세우스는 세 종이다. 오리진폼은 조건이 아니다
  // (2026-10-03 사용자 결정 "아르세우스는 디아루가,펄기아,기라티나 구하면", "업적은 그냥 디아루가 펄기아 기라티나 얻기로 다시 변경", "500년전 마이가나는 볼케니온이랑 마기아나 구하면")
  const myth = seed();
  myth.dex.obtained = ["dialga", "palkia", "dialga-origin", "giratina-origin"];
  assert.deepStrictEqual(progressOf(myth, "dex-creation"), { now: 2, goal: 3, unit: "" }, "오리진폼은 세지 않는다");
  assert.equal(isAchieved(myth, "dex-creation"), false);
  myth.dex.obtained.push("giratina");
  assert.equal(isAchieved(myth, "dex-creation"), true);
  assert.equal(isAchieved(myth, "dex-soul-heart"), false);
  myth.dex.obtained.push("volcanion", "magearna");
  assert.equal(isAchieved(myth, "dex-soul-heart"), true);
  assert.deepStrictEqual(
    ["dex-creation", "dex-soul-heart", "dex-1000"].map((id) => snapshotView(myth, T0).achievements.list.find((x) => x.id === id)?.reward),
    ["아르세우스", "마기아나(500년 전의 색)", "랜덤전설알"],
  );
  // 신오 도감 완성은 493번까지다 — 아르세우스를 얻어야 끝난다
  assert.deepStrictEqual(progressOf(myth, "dex-sinnoh"), { now: 3, goal: 107, unit: "" });

  const g = seed();
  assert.equal(progressOf(g, "level-100"), null, "레벨업은 진행도가 없다");
  assert.equal(progressOf(g, "show-two"), null, "옛 업적은 진행도를 보이지 않는다");
  assert.equal(progressOf(g, "shiny-1"), null, "기준이 1 이면 진행도가 없다");
  assert.equal(isAchieved(g, "affinity-100"), false);
  g.pets[0]!.affinity = 100;
  assert.equal(isAchieved(g, "affinity-100"), true);
  g.totals.workMs = 64 * 3600_000 + 5;
  assert.deepStrictEqual(progressOf(g, "work-500h"), { now: 64, goal: 500, unit: "시간" });
  g.find = { seq: 212, log: [] };
  assert.deepStrictEqual(progressOf(g, "find-500"), { now: 212, goal: 500, unit: "" });
  assert.equal(isAchieved(g, "find-50"), true);
  g.dex.megaOpened = ["charizard"];
  assert.equal(isAchieved(g, "mega-1"), true);
  g.dex.obtained = ["mewtwo"];
  assert.equal(isAchieved(g, "single-1"), true, "단일 포켓몬 알의 종");
  // 화면 모델 — 분류와 진행도. 달성한 뒤에는 진행도를 보이지 않는다
  const view = snapshotView(g, T0).achievements.list;
  assert.equal(view.find((a) => a.id === "find-500")?.group, "find");
  assert.deepStrictEqual(view.find((a) => a.id === "find-500")?.progress, { now: 212, goal: 500, unit: "" });
  evaluateAchievements(g, T0);
  assert.equal(snapshotView(g, T0).achievements.list.find((a) => a.id === "find-50")?.progress, undefined);
  assert.deepStrictEqual(
    ["dex-50", "dex-300", "shiny-10", "dex-kanto", "show-two"].map((id) => view.find((a) => a.id === id)?.reward),
    ["200P", "랜덤준전설알", "모습이 바뀌는 약", "뮤", "파티 칸 +1"],
  );
  assert.equal(view.find((a) => a.id === "find-3000")?.reward, "1,500P");
  process.stdout.write("(14) 조건·진행도·화면 모델  ok\n");
}

// (15) 보상 종류 — 포인트·알·도구. 알은 돌보미집이 가득 차거나 남은 종이 없으면 받지 못하고 미수령으로 남는다
{
  const got = (s: SaveV3, id: string): void => {
    s.achievements[id] = { achievedAt: T0, claimedAt: null };
  };
  const s = seed();
  s.points.balance = 10;
  got(s, "dex-50");
  assert.deepStrictEqual(claimAchievement(s, "dex-50", T0 + 1, undefined, () => 0.5), { ok: true, id: "dex-50", points: 200 });
  assert.equal(s.points.balance, 210);
  assert.equal(claimAchievement(s, "dex-50", T0 + 2, undefined, () => 0.5).reason, "already-claimed");

  got(s, "dex-300");
  const egg = claimAchievement(s, "dex-300", T0 + 1, undefined, () => 0.5);
  assert.equal(egg.ok, true);
  assert.equal(s.eggs.length, 1);
  assert.equal(s.eggs[0]?.kind, "sub-legendary");
  assert.equal(s.eggs[0]?.id, egg.eggId);
  assert.ok((s.eggs[0]?.candidates.length ?? 0) > 0);

  got(s, "hatch-200");
  while (s.eggs.length < EGG_RULES.maxEggs) s.eggs.push({ ...s.eggs[0]!, id: `e${s.eggs.length + 10}`, kind: "random" });
  assert.equal(claimAchievement(s, "hatch-200", T0 + 1, undefined, () => 0.5).reason, "daycare-full");
  assert.equal(s.achievements["hatch-200"]?.claimedAt, null, "미수령으로 남는다");
  s.eggs.length = 0;
  s.dex.obtained = [...(eggPool("sub-legendary") ?? [])];
  assert.equal(claimAchievement(s, "hatch-200", T0 + 1, undefined, () => 0.5).reason, "egg-none");
  s.dex.obtained = [];
  assert.equal(claimAchievement(s, "hatch-200", T0 + 1, undefined, () => 0.5).ok, true);

  got(s, "shiny-10");
  assert.deepStrictEqual(claimAchievement(s, "shiny-10", T0 + 1, undefined, () => 0.5).item, { id: "shiny-potion", count: 1 });
  assert.equal(s.bag["shiny-potion"], 1);

  // 단일 포켓몬 보상 — 이미 얻은 종이면 개체를 주지 않고 수령만 기록한다. 업적 보상 종은 모두 단일 포켓몬이다
  got(s, "party-three");
  s.dex.obtained = ["ditto"];
  assert.deepStrictEqual(claimAchievement(s, "party-three", T0 + 1, undefined, () => 0.5), { ok: true, id: "party-three", skipped: true }, "옛 규칙으로 이미 얻은 메타몽");
  got(s, "dex-johto");
  s.dex.obtained = ["pichu-spiky-eared"];
  const before = s.pets.length;
  assert.deepStrictEqual(claimAchievement(s, "dex-johto", T0 + 1, undefined, () => 0.5), { ok: true, id: "dex-johto", skipped: true });
  assert.equal(s.pets.length, before);
  assert.equal(s.achievements["dex-johto"]?.claimedAt, T0 + 1);
  const t = seed();
  got(t, "dex-johto");
  const pichu = claimAchievement(t, "dex-johto", T0 + 1, undefined, () => 0.5);
  assert.equal(t.pets.find((p) => p.id === pichu.petId)?.species, "pichu-spiky-eared");
  // 수령 거래의 결과
  const u = seed();
  got(u, "find-50");
  const res = HANDLERS["achievement.claim"]!(u, { id: "find-50" }, { now: T0, rand: () => 0.5 });
  assert.equal(res.ok && (res.result as { points?: number }).points, 100);
  process.stdout.write("(15) 포인트·알·도구 보상 · 단일 포켓몬 보상  ok\n");
}

// (16) 옛 저장의 첫 판정은 조용하다 — 이미 채운 조건이 한꺼번에 달성돼도 배너 줄에 서지 않는다. 다음 달성부터는 알린다
{
  const s = seed();
  s.achRev = 0;
  s.dex.obtained = Array.from({ length: 50 }, (_, i) => `x${i}`);
  assert.deepStrictEqual(evaluateAchievements(s, T0), [], "첫 판정은 알리지 않는다");
  assert.equal(s.achievements["dex-50"]?.quiet, true);
  assert.equal(s.achRev, ACHIEVEMENT_RULES.rev);
  assert.equal(pendingOf(s, T0).some((p) => p.kind === "achievement"), false, "배너 줄에 서지 않는다");
  assert.equal(snapshotView(s, T0).achievements.unclaimed, 1, "업적 아이콘의 점은 켠다");
  assert.deepStrictEqual(unclaimedAchievementIds(s), ["dex-50"], "quiet 도 미수령 셈에 든다 — 배너만 끈다 (94 항목 9-3-8)");
  s.dex.obtained = Array.from({ length: 150 }, (_, i) => `x${i}`);
  assert.deepStrictEqual(evaluateAchievements(s, T0 + 1000), ["dex-150"]);
  assert.equal(s.achievements["dex-150"]?.quiet, undefined);
  assert.deepStrictEqual(pendingOf(s, T0 + 1000).filter((p) => p.kind === "achievement").map((p) => p.target), ["dex-150"]);
  // 새 저장은 처음부터 알린다
  const n = seed();
  n.party.slots[0]!.hidden = false;
  n.party.slots[1]!.hidden = false;
  assert.deepStrictEqual(evaluateAchievements(n, T0), ["show-two"]);
  // 정규화 — quiet 와 판을 지킨다. 누적 값이 없는 옛 저장은 흔적에서 시작한다
  const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  const back = normalize(raw, T0 + 2000);
  assert.equal(back?.achievements["dex-50"]?.quiet, true);
  assert.equal(back?.achRev, ACHIEVEMENT_RULES.rev);
  delete raw.counts;
  delete raw.achRev;
  raw.eggSeq = 7;
  (raw.pets as { stage: number }[])[0]!.stage = 2;
  const legacy = normalize(raw, T0 + 2000);
  assert.deepStrictEqual(legacy?.counts, { hatched: 7, evolved: 2, traded: 0, day: "", streak: 0 });
  assert.equal(legacy?.achRev, 0);
  process.stdout.write("(16) 옛 저장의 조용한 첫 판정 · 정규화  ok\n");
}

// (17) 이어진 날 — 같은 날은 한 번, 다음 날은 이어지고, 하루를 거르면 1 로 돌아간다. 부화는 알에서 포켓몬이 나올 때 센다
{
  const DAY = 24 * 3600_000;
  const s = seed();
  evaluateAchievements(s, T0);
  assert.equal(s.counts?.streak, 1);
  evaluateAchievements(s, T0 + 3600_000);
  assert.equal(s.counts?.streak, 1, "같은 날");
  evaluateAchievements(s, T0 + DAY);
  assert.equal(s.counts?.streak, 2);
  evaluateAchievements(s, T0 + 3 * DAY);
  assert.equal(s.counts?.streak, 1, "하루를 걸렀다");
  for (let d = 4; d <= 9; d += 1) evaluateAchievements(s, T0 + d * DAY);
  assert.equal(s.counts?.streak, 7);
  assert.ok(s.achievements["streak-7"]?.achievedAt != null);
  evaluateAchievements(s, T0 + 20 * DAY);
  assert.equal(s.counts?.streak, 1);
  assert.ok(s.achievements["streak-7"]?.achievedAt != null, "끊겨도 달성은 남는다");

  const e = empty(T0);
  assert.ok(applyStarter(e, "charmander", T0, () => 0.5).ok);
  e.points.balance = 1000;
  assert.ok(buyProduct(e, "random", T0, () => 0.5).ok);
  const eggId = e.eggs[0]!.id;
  e.eggs[0]!.ready = true;
  e.eggs[0]!.remainMs = 0;
  assert.ok(openEgg(e, eggId, T0, () => 0.99).ok);
  assert.equal(e.counts?.hatched, 1);
  process.stdout.write("(17) 이어진 날 · 부화 횟수  ok\n");
}

process.stdout.write("selftest-achievement: 통과 (업적 목록·조건·진행도·보상 종류·수령·조용한 첫 판정·이어진 날·튜토리얼·대기열·다시 보기·돌봄 누적)\n");
