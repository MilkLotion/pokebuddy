// 레벨 곡선과 가방 도구 사용 자체 확인 — npm run build 뒤 node dist/tools/selftest-bag.js
//
// 테스트 프레임워크 없이 assert 만. 파일을 만들지 않는다 — 값만으로 확인한다.
// 곡선은 원작 경험치 타입 6종의 100레벨 누적값으로 맞춘다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { use } from "../bag/use";
import { expForLevel, growthOf, levelFor, MAX_LEVEL, progressTo } from "../dex/growth";
import { BAG_V3_RULES, SAVE_V3_RULES } from "../save/rules";
import { empty, normalize } from "../save/v3";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { feed, play } from "../state/care";
import { applyTime } from "../state/time";

// 놀아주기 상태가 끝날 만큼 시간을 흘린다. 개체가 파티에 있어야 시간이 흐른다
function applyTimeForTest(s: SaveV3): void {
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  applyTime(s, SAVE_V3_RULES.playWindowMs, T0 + SAVE_V3_RULES.playWindowMs);
}

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
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

// (1) 100레벨 누적 경험치가 원작과 같다
{
  assert.equal(expForLevel("fast", 100), 800_000);
  assert.equal(expForLevel("medium-fast", 100), 1_000_000);
  assert.equal(expForLevel("medium-slow", 100), 1_059_860);
  assert.equal(expForLevel("slow", 100), 1_250_000);
  assert.equal(expForLevel("erratic", 100), 600_000);
  assert.equal(expForLevel("fluctuating", 100), 1_640_000);
  process.stdout.write("(1) 곡선 · 100레벨 누적값  ok\n");
}

// (2) 레벨 1 은 0 이고 곡선은 늘 오른다
{
  const rates = ["fast", "medium-fast", "medium-slow", "slow", "erratic", "fluctuating"] as const;
  for (const r of rates) {
    assert.equal(expForLevel(r, 1), 0, `${r} 레벨 1`);
    let prev = -1;
    for (let x = 1; x <= MAX_LEVEL; x++) {
      const v = expForLevel(r, x);
      assert.ok(v > prev, `${r} 레벨 ${x} 이 앞보다 크다`);
      prev = v;
    }
  }
  process.stdout.write("(2) 곡선 · 단조 증가  ok\n");
}

// (3) 누적 경험치로 레벨을 읽는다
{
  assert.equal(levelFor("medium-fast", 0), 1);
  assert.equal(levelFor("medium-fast", 7), 1, "레벨 2 는 8 부터");
  assert.equal(levelFor("medium-fast", 8), 2);
  assert.equal(levelFor("medium-fast", 1_000_000), 100);
  assert.equal(levelFor("medium-fast", 9_999_999), 100, "100 을 넘지 않는다");
  const p = progressTo("medium-fast", 8 + (27 - 8) / 2);
  assert.equal(p.level, 2);
  assert.equal(p.percent, 50, "레벨 2 에서 3 으로 절반");
  process.stdout.write("(3) 경험치로 레벨 읽기  ok\n");
}

// (4) 종의 경험치 타입을 데이터에서 읽는다
{
  assert.equal(growthOf("charmander"), "medium-slow", "1세대 스타터는 보통 느림");
  assert.equal(growthOf("pikachu"), "medium-fast");
  assert.equal(growthOf("없는종"), "medium-fast", "모르면 보통 빠름");
  process.stdout.write("(4) 종별 경험치 타입  ok\n");
}

// (5) 기본먹이는 무료이며 가방에서 차감하지 않는다
{
  const s = seed({ fullness: 50 });
  const res = use(s, "basic-food", "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.fullness, 70, "만복도 +20");
  assert.equal(s.pets[0]?.feedCooldownMs, SAVE_V3_RULES.feedCooldownMs);
  assert.equal(s.pets[0]?.affinity, BAG_V3_RULES.feedAffinity);
  assert.equal(s.bag["basic-food"], undefined, "재고를 세지 않는다");
  const again = use(s, "basic-food", "p1");
  assert.equal(again.reason, "cooldown", "쿨타임 중에는 거절");
  process.stdout.write("(5) 기본먹이 · 무료와 쿨타임  ok\n");
}

// (6) 만복도가 가득이면 거절한다
{
  const s = seed({ fullness: 100 });
  assert.equal(use(s, "basic-food", "p1").reason, "full");
  process.stdout.write("(6) 만복도 가득  ok\n");
}

// (7) 프리미엄먹이는 가득 채우고 버프를 건다
{
  const s = seed({ fullness: 10 }, { "premium-food": 2 });
  const res = use(s, "premium-food", "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.fullness, 100);
  assert.equal(s.pets[0]?.buffs[0]?.kind, "premium-food");
  assert.equal(s.pets[0]?.buffs[0]?.remainMs, BAG_V3_RULES.buffMs["premium-food"]);
  assert.equal(s.bag["premium-food"], 1, "하나 줄었다");
  process.stdout.write("(7) 프리미엄먹이 · 가득과 버프  ok\n");
}

// (8) 장난감은 신남 버프를 건다. 다시 쓰면 갱신한다. 들뜸이 있으면 신남으로 바뀐다 (2026-09-29 사용자 결정 — 이름, 교체는 제안)
{
  const s = seed({ buffs: [{ kind: "long-play", remainMs: 1000 }] }, { toy: 1 });
  const res = use(s, "toy", "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.buffs.length, 1, "겹쳐 쌓지 않는다");
  assert.equal(s.pets[0]?.buffs[0]?.remainMs, BAG_V3_RULES.buffMs["long-play"], "남은 시간을 기본값으로 바꾼다");
  assert.equal(s.bag.toy, undefined, "다 쓰면 가방에서 사라진다");
  assert.equal(use(s, "toy", "p1").reason, "none-left");
  const giddy = seed({ buffs: [{ kind: "short-play", remainMs: 1000 }] }, { toy: 1 });
  assert.equal(use(giddy, "toy", "p1").ok, true);
  assert.deepEqual(giddy.pets[0]?.buffs, [{ kind: "long-play", remainMs: BAG_V3_RULES.buffMs["long-play"] }], "장난감 — 들뜸이 신남으로 바뀐다");
  process.stdout.write("(8) 장난감 · 신남 · 갱신과 소진  ok\n");
}

// (9) 경험사탕은 경험치를 올리고 레벨을 다시 읽는다
{
  const s = seed({}, { "exp-candy-m": 1 });
  const res = use(s, "exp-candy-m", "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.exp, 3000);
  assert.equal(s.pets[0]?.level, levelFor("medium-slow", 3000), "종의 곡선으로 읽는다");
  assert.ok((s.pets[0]?.level ?? 0) > 1);
  process.stdout.write("(9) 경험사탕 · 레벨 재계산  ok\n");
}

// (10) 이상한사탕은 레벨을 1 올리고 진행을 0 으로 둔다
{
  const s = seed({ level: 5, exp: expForLevel("medium-slow", 5) + 500 }, { "rare-candy": 1 });
  const res = use(s, "rare-candy", "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.level, 6);
  assert.equal(s.pets[0]?.exp, expForLevel("medium-slow", 6), "새 레벨의 진행은 0");
  process.stdout.write("(10) 이상한사탕 · 레벨 +1  ok\n");
}

// (11) 최대 레벨이면 사탕을 거절한다
{
  const s = seed({ level: 100, exp: expForLevel("medium-slow", 100) }, { "rare-candy": 1, "exp-candy-xl": 1 });
  assert.equal(use(s, "rare-candy", "p1").reason, "max-level");
  assert.equal(use(s, "exp-candy-xl", "p1").reason, "max-level");
  assert.equal(s.bag["rare-candy"], 1, "쓰지 않았으니 그대로");
  process.stdout.write("(11) 최대 레벨 거절  ok\n");
}

// (12) 민트는 한 종류다 — 원작 25 성격 가운데 아무 성격으로나 바꾼다. 지금 성격이면 거절하고 쓰지 않는다 (2026-09-29 사용자 결정)
{
  const s = seed({ nature: "hardy" }, { mint: 3 });
  assert.equal(use(s, "mint", "p1").reason, "bad-nature", "성격을 골라야 한다");
  assert.equal(use(s, "mint", "p1", { nature: "없는성격" }).reason, "bad-nature", "모르는 성격은 안 된다");
  assert.equal(s.bag.mint, 3, "거절하면 쓰지 않는다");
  const res = use(s, "mint", "p1", { nature: "adamant" });
  assert.equal(res.ok, true);
  assert.equal(res.nature, "adamant");
  assert.equal(s.pets[0]?.nature, "adamant");
  assert.equal(s.bag.mint, 2, "1개를 썼다");
  assert.equal(use(s, "mint", "p1", { nature: "quirky" }).ok, true, "보정 없는 성격도 같은 민트로");
  assert.equal(use(s, "mint", "p1", { nature: "quirky" }).reason, "already", "지금 성격으로는 못 바꾼다");
  assert.equal(s.bag.mint, 1, "거절하면 쓰지 않는다");
  process.stdout.write("(12) 민트 · 아무 성격으로, 같은 성격은 거절  ok\n");
}

// (12b) 옛 민트 21종(<성격>-mint, 그 전의 mint-<성격>)은 저장을 읽을 때 민트 하나로 합친다. 합친 개수는 999 에서 자른다
{
  const old = empty(0);
  const bag = old.bag as Record<string, number>;
  bag["mint-adamant"] = 2;
  bag["adamant-mint"] = 1;
  bag["serious-mint"] = 4;
  bag["exp-candy-s"] = 5;
  assert.deepStrictEqual(normalize(JSON.parse(JSON.stringify(old)) as unknown, 0)?.bag, { mint: 7, "exp-candy-s": 5 });
  const many = empty(0);
  (many.bag as Record<string, number>)["brave-mint"] = 700;
  (many.bag as Record<string, number>)["calm-mint"] = 700;
  many.bag["exp-candy-s"] = 1200;
  assert.deepStrictEqual(normalize(JSON.parse(JSON.stringify(many)) as unknown, 0)?.bag, { mint: 999, "exp-candy-s": 1200 }, "민트는 999 에서 자르고 다른 도구는 그대로");
  assert.deepStrictEqual(normalize(JSON.parse(JSON.stringify({ ...empty(0), bag: { mint: 2 } })) as unknown, 0)?.bag, { mint: 2 }, "지금 민트는 그대로");
  process.stdout.write("(12b) 옛 민트 합치기  ok\n");
}

// (13) 약 두 개는 이로치를 오간다. 도감 기록은 남는다
{
  const s = seed({}, { "shiny-potion": 1, "normal-potion": 1 });
  assert.equal(use(s, "normal-potion", "p1").reason, "already", "이미 일반색");
  assert.equal(use(s, "shiny-potion", "p1").ok, true);
  assert.equal(s.pets[0]?.shiny, true);
  assert.ok(s.dex.shinyObtained.includes("charmander"), "도감에 이로치 획득");
  assert.equal(use(s, "normal-potion", "p1").ok, true);
  assert.equal(s.pets[0]?.shiny, false);
  assert.ok(s.dex.shinyObtained.includes("charmander"), "되돌려도 기록은 남는다");
  process.stdout.write("(13) 이로치 약 · 오가고 기록은 보존  ok\n");
}

// (14) 없는 도구와 없는 개체
{
  const s = seed({}, { mint: 1 });
  assert.equal(use(s, "없는도구", "p1").reason, "no-item");
  assert.equal(use(s, "mint", "없는개체").reason, "no-pet");
  assert.equal(use(s, "adamant-mint", "p1").reason, "no-item", "옛 민트 식별자는 도구가 아니다");
  assert.equal(use(s, "_comment", "p1").reason, "no-item", "메모 키는 도구가 아니다");
  process.stdout.write("(14) 없는 도구와 개체  ok\n");
}

process.stdout.write("selftest-bag: 통과 (곡선·먹이·버프·사탕·민트·약)\n");

// ── 돌봄 ───────────────────────────────────────────────────────────────────────

// (15) 밥 주기는 기본먹이와 같은 길로 간다
{
  const s = seed({ fullness: 50 });
  const res = feed(s, "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.fullness, 70);
  assert.equal(s.pets[0]?.feedCooldownMs, SAVE_V3_RULES.feedCooldownMs);
  assert.equal(feed(s, "p1").reason, "cooldown");
  assert.equal(feed(s, "없는개체").reason, "no-pet");
  process.stdout.write("(15) 밥 주기 · 기본먹이와 같은 길  ok\n");
}

// (16) 놀아주기는 쿨타임마다 한 번 친밀도를 올린다
{
  const s = seed({ affinity: 10 });
  const res = play(s, "p1");
  assert.equal(res.ok, true);
  assert.equal(s.pets[0]?.affinity, 10 + BAG_V3_RULES.playAffinity);
  assert.equal(s.pets[0]?.playCooldownMs, SAVE_V3_RULES.playCooldownMs);
  assert.equal(s.pets[0]?.daily.plays, 1);
  assert.equal(play(s, "p1").reason, "cooldown", "쿨타임 중에는 거절");
  assert.equal(s.pets[0]?.affinity, 13, "친밀도도 오르지 않는다");
  assert.equal(play(s, "없는개체").reason, "no-pet");
  process.stdout.write("(16) 놀아주기 · 쿨타임마다 한 번  ok\n");
}

// (17) 밥 주기와 놀아주기의 쿨타임은 따로 간다
{
  const s = seed({ fullness: 50 });
  assert.equal(feed(s, "p1").ok, true);
  assert.equal(play(s, "p1").ok, true, "밥을 줬어도 놀아줄 수 있다");
  process.stdout.write("(17) 두 쿨타임은 따로  ok\n");
}

// (18) 친밀도는 100 을 넘지 않는다
{
  const s = seed({ affinity: 99 });
  play(s, "p1");
  assert.equal(s.pets[0]?.affinity, 100);
  process.stdout.write("(18) 친밀도 상한  ok\n");
}

process.stdout.write("selftest-bag: 돌봄 통과 (밥·놀이·쿨타임)\n");

// (19) 놀아주기 2중첩이면 들뜸(×1.2, 30분), 3중첩이면 신남(×1.5, 30분). 신남이 되면 들뜸은 신남으로 바뀐다 (2026-09-29 사용자 결정 — 이름·수치, 교체는 제안)
{
  const s = seed();
  const pet0 = s.pets[0];
  assert.ok(pet0);
  const first = play(s, "p1");
  assert.equal(first.streak, 1);
  assert.equal(first.longPlay, false, "한 번은 아직 아니다");
  assert.equal(pet0.playWindowMs, SAVE_V3_RULES.playWindowMs, "20분 상태가 붙는다");
  assert.equal(pet0.buffs.length, 0, "그 자체로는 효과가 없다");

  // 쿨타임 10분이 지나고 상태는 10분 남았다
  pet0.playCooldownMs = 0;
  pet0.playWindowMs = SAVE_V3_RULES.playWindowMs - SAVE_V3_RULES.playCooldownMs;
  const second = play(s, "p1");
  assert.equal(second.streak, 2);
  assert.equal(second.longPlay, false);
  assert.equal(second.shortPlay, true, "두 번이면 들뜸");
  assert.deepEqual(pet0.buffs, [{ kind: "short-play", remainMs: BAG_V3_RULES.buffMs["short-play"] }]);
  assert.equal(BAG_V3_RULES.buffMs["short-play"], 30 * 60_000, "들뜸 30분");

  pet0.playCooldownMs = 0;
  pet0.playWindowMs = SAVE_V3_RULES.playWindowMs - SAVE_V3_RULES.playCooldownMs;
  const third = play(s, "p1");
  assert.equal(third.streak, 3);
  assert.equal(third.longPlay, true, "세 번이면 신남");
  assert.deepEqual(pet0.buffs, [{ kind: "long-play", remainMs: BAG_V3_RULES.buffMs["long-play"] }], "들뜸은 신남으로 바뀐다 — 둘이 함께 남지 않는다");

  // 신남이 남아 있으면 2중첩을 다시 채워도 들뜸을 새로 걸지 않는다
  const s2 = seed({ buffs: [{ kind: "long-play", remainMs: 20 * 60_000 }] });
  const p2 = s2.pets[0]!;
  play(s2, "p1");
  p2.playCooldownMs = 0;
  p2.playWindowMs = SAVE_V3_RULES.playWindowMs - SAVE_V3_RULES.playCooldownMs;
  const again = play(s2, "p1");
  assert.equal(again.streak, 2);
  assert.equal(again.shortPlay, false, "신남 중에는 들뜸을 걸지 않는다");
  assert.deepEqual(p2.buffs, [{ kind: "long-play", remainMs: 20 * 60_000 }], "신남은 그대로");

  // 들뜸이 남아 있을 때 다시 2중첩이면 기본 지속시간으로 갱신한다
  const s3 = seed({ buffs: [{ kind: "short-play", remainMs: 1000 }] });
  const p3 = s3.pets[0]!;
  play(s3, "p1");
  p3.playCooldownMs = 0;
  p3.playWindowMs = SAVE_V3_RULES.playWindowMs - SAVE_V3_RULES.playCooldownMs;
  play(s3, "p1");
  assert.deepEqual(p3.buffs, [{ kind: "short-play", remainMs: BAG_V3_RULES.buffMs["short-play"] }], "들뜸 갱신");

  // 옛 저장의 오래 놀아주기(long-play)는 그대로 신남으로 이어진다. 신남과 들뜸이 함께 저장돼 있으면 들뜸을 뺀다
  const old = empty(0);
  old.pets.push(pet({ buffs: [{ kind: "long-play", remainMs: 5000 }, { kind: "short-play", remainMs: 5000 }] }));
  old.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(old)) as unknown, 0)?.pets[0]?.buffs, [{ kind: "long-play", remainMs: 5000 }]);
  process.stdout.write("(19) 놀아주기 2중첩 들뜸 · 3중첩 신남  ok\n");
}

// (20) 상태가 끊기면 처음부터 다시 센다
{
  const s = seed();
  const pet0 = s.pets[0];
  assert.ok(pet0);
  assert.equal(play(s, "p1").streak, 1);
  pet0.playCooldownMs = 0;
  pet0.playWindowMs = 0; // 20분이 다 지났다
  assert.equal(play(s, "p1").streak, 1, "끊기면 처음부터");
  process.stdout.write("(20) 상태가 끊기면 다시 1부터  ok\n");
}

// (21) 시간이 흘러 상태가 끝나면 중첩이 풀린다
{
  const s = seed();
  play(s, "p1");
  applyTimeForTest(s);
  assert.equal(s.pets[0]?.playWindowMs, 0);
  assert.equal(s.pets[0]?.playStreak, 0, "창이 닫히면 중첩도 0");
  process.stdout.write("(21) 창이 닫히면 중첩이 풀린다  ok\n");
}

// (22) 기분 — 놀아주기·장난감 +15, 밥 주기 +10, 100 을 넘지 않는다
{
  const played = seed({ mood: 60 });
  assert.equal(play(played, "p1").ok, true);
  assert.equal(played.pets[0]?.mood, 75, "놀아주기 +15");
  const fed = seed({ mood: 60, fullness: 50 });
  assert.equal(feed(fed, "p1").ok, true);
  assert.equal(fed.pets[0]?.mood, 70, "밥 주기 +10");
  const toyed = seed({ mood: 60 }, { toy: 1 });
  assert.equal(use(toyed, "toy", "p1").ok, true);
  assert.equal(toyed.pets[0]?.mood, 75, "장난감도 놀아주기다");
  const full = seed({ mood: 95 });
  play(full, "p1");
  assert.equal(full.pets[0]?.mood, 100, "100 을 넘지 않는다");
  process.stdout.write("(22) 기분 · 돌봄으로 오른다  ok\n");
}

process.stdout.write("selftest-bag: 놀아주기 중첩 통과\n");
