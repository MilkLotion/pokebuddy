// 알림 배너 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-notify.js
//
// 테스트 프레임워크 없이 assert 만. 배너 줄 세우기·한 번 규칙·순서·재시작을 본다.
// 계약은 docs/specs/game.md "알림 배너의 개별 표시", 설계는 worklog/records/game-runtime/record.md "알림 배너의 설계".
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { empty } from "../../save/v3";
import type { BannerView } from "../../shared/model/overlays";
import type { EggV3, PetV3, SaveV3 } from "../../shared/save-v3";
import { bannerOf } from "../../view/banner";
import { createNotifier } from "../../notify/notifier";
import { writeAtomic } from "../../platform/atomic-write";
import { readJsonFile } from "../../platform/json-file";
import { refresh, take, type NotifyState } from "../../notify/queue";
import { makeTmp } from "../harness/tmp-dir";
import { pendingOf } from "../../notify/pending";

const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime();
const EMPTY: NotifyState = { v: 1, shown: [], queue: [] };

function egg(id: string, ready: boolean): EggV3 {
  return { id, kind: "random", boughtAt: T0, remainMs: ready ? 0 : 60_000, ready, candidates: ["pikachu"], careCooldownMs: 0, actions: { pat: 0, song: 0 } };
}

function pet(id: string, species: string, level: number): PetV3 {
  return {
    id,
    species,
    shiny: false,
    nature: "hardy",
    gender: "male",
    size: 2,
    level,
    exp: 0,
    affinity: 0,
    affinityProgressMs: 0,
    fullness: 80,
    fullnessProgressMs: 0,
    mood: 60,
    moodProgressMs: 0,
    feedCooldownMs: 0,
    playCooldownMs: 0,
    playWindowMs: 0,
    playStreak: 0,
    buffs: [],
    home: { dx: 0, dy: 0 },
    since: T0,
    stage: 0,
    evolved: [],
    daily: { date: "", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  };
}

// 알 둘(준비 완료), 진화 가능한 파티 개체 하나(파이리 Lv.16), 받지 않은 업적 하나
function seed(): SaveV3 {
  const s = empty(T0);
  s.eggs.push(egg("e1", true), egg("e2", true), egg("e3", false));
  s.pets.push(pet("p1", "charmander", 16), pet("p2", "bulbasaur", 3));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: false };
  s.achievements = { "show-two": { achievedAt: T0, claimedAt: null } };
  return s;
}

const keys = (state: NotifyState): string[] => state.queue.map((q) => q.key);

// (1) 개별 표시와 같은 순간의 순서 — 부화 → 진화 → 업적, 알은 돌보미집 순서
{
  const s = seed();
  assert.deepStrictEqual(
    pendingOf(s, T0).map((p) => p.key),
    ["hatch:e1", "hatch:e2", "evolve:p1:charmander", "achievement:show-two"],
    "알마다·개체마다·업적마다 따로, 부화 → 진화 → 업적",
  );
  const state = refresh(EMPTY, s, T0);
  assert.deepStrictEqual(keys(state), ["hatch:e1", "hatch:e2", "evolve:p1:charmander", "achievement:show-two"]);
  process.stdout.write("(1) 개별 표시와 순서  ok\n");
}

// (2) 먼저 생긴 것부터 — 뒤에 생긴 부화는 먼저 줄 선 업적 뒤에 선다
{
  const s = seed();
  s.eggs = [];
  s.pets = [];
  const first = refresh(EMPTY, s, T0);
  s.eggs.push(egg("e9", true));
  const later = refresh(first, s, T0 + 1000);
  assert.deepStrictEqual(keys(later), ["achievement:show-two", "hatch:e9"]);
  process.stdout.write("(2) 먼저 생긴 배너부터  ok\n");
}

// (3) 한 번 규칙 — 꺼낸 키는 미처리여도 다시 줄에 서지 않는다
{
  const s = seed();
  const taken = take(refresh(EMPTY, s, T0));
  assert.ok(taken);
  assert.equal(taken.key, "hatch:e1");
  const again = refresh(taken.state, s, T0 + 15_000);
  assert.ok(!keys(again).includes("hatch:e1"), "표시한 알은 다시 뜨지 않는다");
  assert.ok(again.shown.includes("hatch:e1"));
  process.stdout.write("(3) 표시한 상태는 반복하지 않음  ok\n");
}

// (4) 기다리는 동안 풀리면 뺀다. 대상이 사라지면 표시 기록도 지운다
{
  const s = seed();
  const taken = take(refresh(EMPTY, s, T0));
  assert.ok(taken);
  s.eggs = s.eggs.filter((e) => e.id !== "e1" && e.id !== "e2"); // 둘 다 열었다
  s.achievements["show-two"] = { achievedAt: T0, claimedAt: T0 + 1 }; // 보상을 받았다
  const next = refresh(taken.state, s, T0 + 15_000);
  assert.deepStrictEqual(keys(next), ["evolve:p1:charmander"]);
  assert.ok(!next.shown.includes("hatch:e1"), "열린 알의 표시 기록은 지운다");
  process.stdout.write("(4) 풀린 상태는 줄에서 제외  ok\n");
}

// (5) 진화는 종까지 키에 넣는다 — 진화한 뒤 다음 단계가 가능해지면 새 배너
{
  const s = seed();
  let state = refresh(EMPTY, s, T0);
  state = { v: 1, shown: [...state.shown, ...keys(state)], queue: [] };
  const p1 = s.pets.find((p) => p.id === "p1");
  assert.ok(p1);
  p1.species = "charmeleon";
  p1.level = 36;
  const next = refresh(state, s, T0 + 15_000);
  assert.deepStrictEqual(keys(next), ["evolve:p1:charmeleon"]);
  assert.ok(!next.shown.includes("evolve:p1:charmander"), "옛 종의 키는 지운다");
  process.stdout.write("(5) 진화 다음 단계는 새 배너  ok\n");
}

// (6) 처음 켤 때는 이미 미처리인 상태를 표시한 것으로 둔다
{
  const first = refresh(null, seed(), T0);
  assert.deepStrictEqual(first.queue, []);
  assert.equal(first.shown.length, 4);
  process.stdout.write("(6) 처음 켤 때 몰아 띄우지 않음  ok\n");
}

// (7) 배너 문구 — 결과 종은 보이지 않는다
{
  const s = seed();
  const hatch = bannerOf(s, "hatch:e2");
  assert.deepStrictEqual(hatch && { title: hatch.title, target: hatch.target, go: hatch.go, route: hatch.route }, {
    title: "부화 준비 완료",
    target: "돌보미집 알 2",
    go: "바로가기",
    route: { to: "daycare" },
  });
  const evo = bannerOf(s, "evolve:p1:charmander");
  assert.deepStrictEqual(evo && { title: evo.title, target: evo.target, route: evo.route }, {
    title: "진화 가능",
    target: "파이리 Lv.16",
    route: { to: "pet", petId: "p1" },
  });
  const ach = bannerOf(s, "achievement:show-two");
  assert.equal(ach?.title, "업적 달성");
  assert.deepStrictEqual(ach?.route, { to: "achievements", id: "show-two" });
  assert.equal(bannerOf(s, "hatch:none"), null, "사라진 알은 배너가 없다");
  process.stdout.write("(7) 배너 문구와 바로가기  ok\n");
}

// (8) 진행과 재시작 — 하나씩 보이고, 앱을 다시 켜면 남은 줄을 이어서 보인다
{
  const dir = makeTmp("notify");
  const file = path.join(dir, "notify.json");
  try {
    const s = seed();
    const eggs = s.eggs;
    s.eggs = [];
    s.pets = [];
    s.achievements = {};
    let at = T0;
    const shown: BannerView[] = [];
    const a = createNotifier({ file, read: () => s, now: () => at, show: (b) => shown.push(b), readJson: readJsonFile, write: writeAtomic, bannerOf });
    a.tick(); // 처음 — 비어 있다
    assert.equal(shown.length, 0);

    s.eggs = eggs; // 알 둘이 준비됐다
    at += 15_000;
    a.tick();
    assert.deepStrictEqual(shown.map((b) => b.key), ["hatch:e1"], "한 번에 하나만");
    a.tick();
    assert.equal(shown.length, 1, "보이는 동안 다음 것을 내보내지 않는다");

    // 첫 배너를 보이는 중에 앱이 끝났다 — 다시 켜면 둘째부터
    const restarted: BannerView[] = [];
    const b = createNotifier({ file, read: () => s, now: () => at, show: (v) => restarted.push(v), readJson: readJsonFile, write: writeAtomic, bannerOf });
    b.tick();
    assert.deepStrictEqual(restarted.map((v) => v.key), ["hatch:e2"], "표시 중이던 배너는 표시한 것으로 친다");
    b.done();
    assert.equal(restarted.length, 1, "줄이 비면 더 보이지 않는다");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as NotifyState;
    assert.deepStrictEqual(saved.queue, []);
    assert.ok(saved.shown.includes("hatch:e1") && saved.shown.includes("hatch:e2"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("(8) 하나씩 표시와 재시작  ok\n");
}

// (9) 줄 밖의 안내 배너(showOnce) — 보이는 배너가 없을 때만 보이고, 보이는 동안 틱이 줄의 배너로 덮지 않는다 (src/main/hook-upkeep.ts)
{
  const dir = makeTmp("notify");
  const file = path.join(dir, "notify.json");
  try {
    const s = seed();
    const shown: BannerView[] = [];
    const n = createNotifier({ file, read: () => s, now: () => T0, show: (b) => shown.push(b), readJson: readJsonFile, write: writeAtomic, bannerOf });
    const notice: BannerView = { key: "notice:x", kind: "notice", title: "안내", target: "본문", go: "바로가기", route: { to: "agents" } };
    assert.equal(n.showOnce(notice), true, "비어 있으면 보인다");
    n.tick();
    assert.deepStrictEqual(shown.map((b) => b.key), ["notice:x"], "보이는 동안 틱이 덮지 않는다");
    assert.equal(n.showOnce({ ...notice, key: "notice:y" }), false, "보이는 배너가 있으면 거절");
    n.done();
    assert.ok(!shown.slice(1).some((b) => b.key === "notice:x"), "끝난 안내는 다시 보이지 않는다");
    assert.equal(n.showing() === null || n.showing() !== "notice:x", true, "안내가 끝나면 보이는 배너에서 빠진다");
    if (n.showing() === null) assert.equal(n.showOnce({ ...notice, key: "notice:z" }), true, "비면 다음 안내를 받는다");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("(9) 줄 밖의 안내 배너  ok\n");
}

// (10) 서버 저장 받기(settle) — 받은 저장에 이미 있는 미처리 상태는 배너로 서지 않고, 그 뒤에 생긴 것만 선다
{
  const dir = makeTmp("notify");
  const file = path.join(dir, "notify.json");
  try {
    const rec = (n: number) => ({ id: `f${n}`, at: T0, petId: "p1", species: "charmander", kind: "points" as const, ref: "points", amount: 5 });
    const local = seed();
    local.eggs = [];
    local.achievements = {};
    local.find = { seq: 2, log: [rec(1), rec(2)] };
    let s: SaveV3 = local;
    const shown: BannerView[] = [];
    const n = createNotifier({ file, read: () => s, now: () => T0, show: (b) => shown.push(b), readJson: readJsonFile, write: writeAtomic, bannerOf });
    n.tick(); // 처음 켠 때 — 전부 표시한 것으로
    n.tick();
    assert.equal(shown.length, 0);

    // 다른 PC 가 올린 저장을 받았다 — 그사이 주운 20건과 준비된 알 둘
    const cloud = seed();
    cloud.achievements = {};
    cloud.find = { seq: 22, log: Array.from({ length: 20 }, (_, i) => rec(i + 3)) };
    const pendingCloud = pendingOf(cloud, T0).map((p) => p.key);
    assert.ok(pendingCloud.length >= 22, "받은 저장에 미처리 상태가 쌓여 있다");
    // 넘기지 않으면 알 둘과 줍기 20건이 줄을 선다 (진화는 이 PC 에서 이미 표시한 키와 같다)
    assert.equal(refresh(JSON.parse(fs.readFileSync(file, "utf8")) as NotifyState, cloud, T0).queue.length, 22);
    s = cloud;
    n.settle();
    n.tick();
    n.done();
    assert.equal(shown.length, 0, "받은 저장의 미처리 상태는 배너로 서지 않는다");
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as NotifyState;
    assert.deepStrictEqual(saved.queue, []);
    assert.deepStrictEqual([...saved.shown].sort(), [...pendingCloud].sort(), "받은 저장의 미처리 키를 표시한 것으로 둔다");

    // 받은 뒤 이 PC 에서 새로 주운 것은 선다
    cloud.find = { seq: 23, log: [...cloud.find.log.slice(1), rec(23)] };
    n.tick();
    assert.deepStrictEqual(shown.map((b) => b.key), ["find:f23"], "받은 뒤 생긴 것만 배너로 선다");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("(10) 서버 저장 받기  ok\n");
}

process.stdout.write("selftest-notify: 통과 (개별·순서·한 번·제외·진화 단계·첫 실행·문구·재시작·안내·서버 저장 받기)\n");
