// 놀이공간·설정 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-play.js
//
// 테스트 프레임워크 없이 assert 만. 로그인 시 시작 기본값, 그림 크기, 놀이공간 영역 저장을 본다. 무대 사각형(옛 (5))은 selftest-screens 의 playLanes 가 본다.
// 설계는 worklog/records/game-runtime/record.md "놀이공간·설정의 설계".
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { HUNGER_BUBBLE_RULES, createHungerBubbles } from "../../main/hunger-bubble";
import fs from "node:fs";
import path from "node:path";
import { createGame } from "../../main/game";
import * as store from "../../save/store";
import { setSize } from "../../party/home";
import { zoomOf } from "../../main/art/stage-art";
import { empty, normalize } from "../../save/v3";
import { setSetting } from "../../state/settings";
import { createExecutor } from "../../tx/executor";
import { shopList } from "../../view/shop-list";
import { eggPrice } from "../../shop/catalog";
import type { SaveV3 } from "../../shared/save-v3";
import { makeTmp } from "../harness/tmp-dir";
import { eggPool } from "../../dex/obtain";
import { EGG_RULES } from "../../egg/rules";
import { PET_RULES } from "../../party/rules";
import { SIZE_STEPS, sizeLevelOf } from "../../party/size";
import { REGION_MIN } from "../../state/rules";
import { HANDLERS } from "../../tx/command-table";

const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime();

// (1) 로그인 시 시작 — 새 저장은 켜짐, 이미 끈 저장은 그대로
{
  assert.equal(empty(T0).settings.startOnLogin, true, "계약 기본값 켜짐");
  const off = empty(T0);
  off.settings.startOnLogin = false;
  const again = normalize(JSON.parse(JSON.stringify(off)) as unknown, T0);
  assert.equal(again?.settings.startOnLogin, false, "사용자가 끈 값을 바꾸지 않는다");
  process.stdout.write("(1) 로그인 시 시작 기본값  ok\n");
}

// (2) 그림 크기 — 단계 번호 1~5 를 받아 배율(1·1.5·2·2.5·3)을 저장한다 (src/save/rules.ts SIZE_STEPS)
{
  const save = seedPet();
  assert.deepStrictEqual(setSize(save, "p1", 4), { ok: true, petId: "p1", size: 4 });
  assert.equal(save.pets[0]?.size, 2.5, "단계 4 = 배율 2.5");
  assert.equal(setSize(save, "p1", 2).ok, true);
  assert.equal(save.pets[0]?.size, 1.5, "옛 1과 2 사이 단계");
  assert.equal(setSize(save, "p1", SIZE_STEPS.length).ok, true);
  assert.equal(save.pets[0]?.size, 3, "가장 큰 단계 = 옛 3");
  for (const bad of [0, SIZE_STEPS.length + 1, 2.5, "3", null]) assert.equal(setSize(save, "p1", bad).reason, "bad-value", String(bad));
  assert.equal(setSize(save, "없음", 3).reason, "no-pet");
  assert.equal(save.pets[0]?.size, 3, "거부하면 바꾸지 않는다");
  // 옛 저장 — 정수 배율 1~3 은 그대로, 4~6 은 가장 큰 단계로. 단계 사이 값은 가장 가까운 단계로
  for (const [old, want] of [[1, 1], [2, 2], [3, 3], [4, 3], [6, 3], [1.4, 1.5]] as const) {
    const raw = structuredClone(save);
    (raw.pets[0] as { size: number }).size = old;
    assert.equal(normalize(raw as unknown, T0)?.pets[0]?.size, want, `옛 크기 ${old}`);
  }
  assert.deepStrictEqual([1, 1.5, 2, 2.5, 3].map(sizeLevelOf), [1, 2, 3, 4, 5]);
  assert.equal(sizeLevelOf(PET_RULES.size), sizeLevelOf(PET_RULES.size), "새 개체는 기본 단계");
  assert.equal(sizeLevelOf(PET_RULES.size), 2);
  // 무대 배율 — 단계 배율 그대로, 몸이 상한을 넘으면 들어가는 가장 큰 단계로
  assert.equal(zoomOf(1.5, { w: 20, h: 20 }), 1.5);
  assert.equal(zoomOf(3, { w: 1000, h: 1000 }), 1);
  process.stdout.write("(2) 크기 단계  ok\n");
}

// (3) 실행기로 크기 저장 — pet.set 에 size 만 보내면 자리는 그대로
{
  let state: SaveV3 | null = seedPet();
  const ex = createExecutor({ read: () => structuredClone(state), write: (s) => ((state = s), true), now: () => T0, rand: () => 0.5 }, HANDLERS);
  const home = state?.pets[0]?.home;
  const res = ex.run({ id: "size-1", name: "pet.set", args: { petId: "p1", size: 5 } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(state?.pets[0]?.size, 3);
  assert.deepStrictEqual(state?.pets[0]?.home, home);
  const bad = ex.run({ id: "size-2", name: "pet.set", args: { petId: "p1", size: 9 } });
  assert.equal(bad.ok, false);
  assert.equal(state?.pets[0]?.size, 3);
  process.stdout.write("(3) pet.set size  ok\n");
}

// (4) 놀이공간 영역 — 저장하면 영역 지정으로 바뀌고, 방식을 바꿔도 영역은 남는다
{
  const s = empty(T0);
  assert.deepStrictEqual(setSetting(s, "playRegion", { x: 10.4, y: 20.6, w: 800, h: 400 }), { ok: true, key: "playRegion", value: { x: 10, y: 21, w: 800, h: 400 } });
  assert.deepStrictEqual(s.settings.playArea, { mode: "region", rect: { x: 10, y: 21, w: 800, h: 400 }, screen: null });
  assert.equal(setSetting(s, "playRegion", { x: 0, y: 0, w: 200, h: 150 }).reason, "bad-value", "넓이가 모자라다");
  assert.equal(setSetting(s, "playRegion", { x: 0, y: 0, w: REGION_MIN.side - 1, h: 1000 }).reason, "bad-value", "한 변이 너무 얇다");
  // 넓이만 넘으면 비율은 자유다 — 아래로 길게, 옆으로 길게 (2026-09-26 사용자 요청)
  assert.ok(setSetting(s, "playRegion", { x: 0, y: 0, w: 120, h: 900 }).ok, "세로로 긴 영역");
  assert.ok(setSetting(s, "playRegion", { x: 0, y: 0, w: 1920, h: 80 }).ok, "가로로 긴 띠");
  assert.equal(setSetting(s, "playRegion", { x: 0, y: 0, w: 800 }).reason, "bad-value", "값이 모자라다");
  assert.equal(setSetting(s, "playRegion", { x: 10, y: 21, w: 800, h: 400 }).ok, true);
  assert.equal(setSetting(s, "playRegion", { x: 0, y: 0, w: 800 }).reason, "bad-value");
  assert.equal(s.settings.playArea.rect?.w, 800, "거부하면 이전 영역을 유지한다");
  // 옛 "full" 은 이제 고를 수 없다 — 읽을 때만 한 화면(주 화면)으로 옮긴다 (2026-09-28 여러 화면)
  assert.equal(setSetting(s, "playArea", "full").reason, "bad-value");
  setSetting(s, "playArea", "screen");
  assert.deepStrictEqual(s.settings.playArea, { mode: "screen", rect: { x: 10, y: 21, w: 800, h: 400 }, screen: null });
  process.stdout.write("(4) 영역 저장과 유지  ok\n");
}

function seedPet(): SaveV3 {
  const s = empty(T0);
  s.pets.push({
    id: "p1",
    species: "pikachu",
    shiny: false,
    nature: "hardy",
    gender: "male",
    size: 2,
    level: 5,
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
    home: { dx: -24, dy: -60 },
    since: T0,
    stage: 0,
    evolved: [],
    daily: { date: "", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  });
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  return s;
}

// (6) 배고픔 말풍선 — 들어갈 때 한 번, 머무는 동안 배고픔 10분·매우 배고픔 5분마다. 벗어나면 멈추고 다시 들어가면 바로
{
  const b = createHungerBubbles();
  const { hungry, starving } = HUNGER_BUBBLE_RULES.repeatMs;
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 80 }], T0)), [], "배부름·보통은 띄우지 않는다");
  assert.deepStrictEqual(b.due([{ id: "p1", fullness: 30 }], T0), [{ id: "p1", zone: "hungry" }], "배고픔에 들어가면 바로");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 29 }], T0 + hungry - 1)), [], "배고픔은 10분 안에 다시 띄우지 않는다");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 28 }], T0 + hungry)), ["p1"], "10분이 지나면 다시");
  assert.deepStrictEqual(b.due([{ id: "p1", fullness: 10 }], T0 + hungry + 1), [{ id: "p1", zone: "starving" }], "매우 배고픔에 들어가면 바로");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 9 }], T0 + hungry + 1 + starving)), ["p1"], "매우 배고픔은 5분마다");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 70 }], T0 + hungry + starving + 2)), [], "밥을 먹어 벗어나면 멈춘다");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 30 }], T0 + hungry + starving + 3)), ["p1"], "다시 들어가면 바로");
  assert.deepStrictEqual(ids(b.due([], T0 + hungry + starving + 4)), [], "무대에서 빠진 마리는 기록을 지운다");
  assert.deepStrictEqual(ids(b.due([{ id: "p1", fullness: 30 }], T0 + hungry + starving + 5)), ["p1"], "다시 나오면 처음부터");
  process.stdout.write("(6) 배고픔 말풍선 되풀이  ok\n");
}

// (7) 여러 개 구매 — 명령 하나(count)로 한 거래. 모자라면 하나도 사지 않는다. 0개 이하·소수는 거절.
// 알도 여러 개 산다 — 돌보미집 빈 칸과 단일 포켓몬 알의 남은 수까지. 넘치면 전부 되돌린다 (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
{
  let state: SaveV3 | null = seedPet();
  state.points.balance = 100;
  const ex = createExecutor({ read: () => structuredClone(state), write: (s) => ((state = s), true), now: () => T0, rand: () => 0.5 }, HANDLERS);
  const ok3 = ex.run({ id: "buy-3", name: "shop.buy", args: { productId: "exp-candy-xs", count: 3 } });
  assert.ok(ok3.ok, JSON.stringify(ok3));
  assert.equal(state?.bag["exp-candy-xs"], 3, "세 개가 가방에");
  assert.equal(state?.points.balance, 40, "60P 를 한 번에 쓴다");
  const short = ex.run({ id: "buy-9", name: "shop.buy", args: { productId: "exp-candy-xs", count: 3 } });
  assert.equal(short.ok, false, "40P 로 세 개(60P)는 못 산다");
  assert.equal(state?.bag["exp-candy-xs"], 3, "모자라면 하나도 사지 않는다");
  assert.equal(state?.points.balance, 40);
  for (const count of [0, -1, 1.5, "2"]) {
    const bad = ex.run({ id: `buy-bad-${String(count)}`, name: "shop.buy", args: { productId: "exp-candy-xs", count } });
    assert.equal(bad.ok, false, `수량 ${String(count)} 거절`);
  }
  state.points.balance = 100_000;
  // 빈 칸 3 — 알 셋을 먼저 넣어 둔다
  assert.ok(ex.run({ id: "egg-pre", name: "shop.buy", args: { productId: "random", count: EGG_RULES.maxEggs - 3 } }).ok);
  assert.equal(state?.eggs.length, EGG_RULES.maxEggs - 3);
  const before = state.points.balance;
  const egg4 = ex.run({ id: "buy-egg-4", name: "shop.buy", args: { productId: "random", count: 4 } });
  assert.equal(egg4.ok ? "ok" : egg4.reason, "daycare-full", "빈 칸 3 에 넷은 못 산다");
  assert.equal(state?.eggs.length, EGG_RULES.maxEggs - 3, "넘치면 하나도 넣지 않는다");
  assert.equal(state?.points.balance, before, "포인트도 그대로");
  const egg3 = ex.run({ id: "buy-egg-3", name: "shop.buy", args: { productId: "random", count: 3 } });
  assert.ok(egg3.ok, JSON.stringify(egg3));
  assert.equal(state?.eggs.length, EGG_RULES.maxEggs, "빈 칸 3 에 셋");
  assert.equal(state?.points.balance, before - 3 * (eggPrice("random") ?? 0), "세 개 값을 한 번에 쓴다");
  assert.deepStrictEqual(egg3.ok && (egg3.result as { eggIds?: string[] }).eggIds, state?.eggs.slice(-3).map((e) => e.id), "결과에 새 알 식별자 셋");
  // 단일 포켓몬 알 — 남은 종 2, 기다리는 같은 알 1 이면 하나만 더 산다
  state.eggs = [];
  const pool = eggPool("legendary") ?? [];
  state.dex.obtained = pool.slice(2);
  assert.ok(ex.run({ id: "single-1", name: "shop.buy", args: { productId: "legendary" } }).ok);
  const single2 = ex.run({ id: "single-2", name: "shop.buy", args: { productId: "legendary", count: 2 } });
  assert.equal(single2.ok ? "ok" : single2.reason, "sold-out", "남은 종보다 많이는 못 산다");
  assert.equal(state?.eggs.length, 1, "하나도 더 넣지 않는다");
  assert.ok(ex.run({ id: "single-3", name: "shop.buy", args: { productId: "legendary", count: 1 } }).ok, "하나는 산다");
  const room = shopList(state).find((p) => p.id === "legendary");
  assert.equal(room?.room, 0, "상점 목록의 상한도 0");
  state.eggs = [];
  state.dex.obtained = [];
  // 가방 최대 999 — 가진 개수를 넘겨 사지 못한다. 넘치는 묶음은 하나도 사지 않는다
  state.points.balance = 100_000;
  state.bag["exp-candy-xs"] = 997;
  const over = ex.run({ id: "buy-over", name: "shop.buy", args: { productId: "exp-candy-xs", count: 3 } });
  assert.equal(over.ok, false, "997 + 3 은 999 를 넘는다");
  assert.equal(state?.bag["exp-candy-xs"], 997, "넘치면 하나도 사지 않는다");
  const fit = ex.run({ id: "buy-fit", name: "shop.buy", args: { productId: "exp-candy-xs", count: 2 } });
  assert.ok(fit.ok, JSON.stringify(fit));
  assert.equal(state?.bag["exp-candy-xs"], 999, "999 까지는 산다");
  const full = ex.run({ id: "buy-full", name: "shop.buy", args: { productId: "exp-candy-xs" } });
  assert.equal(full.ok ? "ok" : full.reason, "bag-full", "가득 차면 bag-full");
  process.stdout.write("(7) 여러 개 구매 · 알 여러 개 · 가방 최대 999  ok\n");
}

// (8) 이어진 저장 실패 — 3번 이어서 못 쓰면 보기에 saveFailing. 한 번 쓰면 사라진다. 명령과 주기 저장을 함께 센다
{
  const dir = makeTmp("selftest-play");
  try {
    const file = path.join(dir, "save.json");
    const seed = seedPet();
    seed.points.balance = 100;
    store.write(file, seed);
    const game = createGame({ file, now: () => T0 });
    // 임시 파일 자리에 폴더를 두면 쓰기가 실패한다 (src/save/legacy.ts writeAtomic)
    const block = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(block);
    game.tick(); // 1번째 실패 — 메모리 진행은 들고 있다 (src/main/game.ts)
    assert.equal(game.saveFailing(), false, "한 번 실패로는 안내하지 않는다");
    assert.equal(game.send({ cmd: "shop.buy", target: "exp-candy-xs" }, "settings").reason, "save-failed", "2번째 실패");
    assert.equal(game.view()?.saveFailing, undefined, "두 번까지는 안내하지 않는다");
    game.tick();
    assert.equal(game.saveFailing(), true, "3번 이어서 실패");
    assert.equal(game.view()?.saveFailing, true, "보기에 싣는다");
    fs.rmdirSync(block);
    assert.ok(game.tick(), "다시 쓸 수 있다");
    assert.equal(game.view()?.saveFailing, undefined, "한 번 쓰면 사라진다");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("(8) 이어진 저장 실패 안내  ok\n");
}

// (9) 사탕 여러 개 쓰기 — 명령 하나(count)로 한 거래. 하나라도 못 쓰면 하나도 쓰지 않는다. 사탕이 아닌 도구는 하나씩
{
  let state: SaveV3 | null = seedPet();
  state.bag["exp-candy-s"] = 3;
  state.bag["rare-candy"] = 5;
  state.bag["premium-food"] = 2;
  const ex = createExecutor({ read: () => structuredClone(state), write: (s) => ((state = s), true), now: () => T0, rand: () => 0.5 }, HANDLERS);
  const before = state.pets[0]!.exp;
  const two = ex.run({ id: "use-2", name: "bag.use", args: { itemId: "exp-candy-s", petId: "p1", count: 2 } });
  assert.ok(two.ok, JSON.stringify(two));
  assert.equal(state?.bag["exp-candy-s"], 1, "두 개를 쓴다");
  assert.equal(state?.pets[0]?.exp, before + 1600, "경험치 800 × 2");
  const over = ex.run({ id: "use-over", name: "bag.use", args: { itemId: "exp-candy-s", petId: "p1", count: 2 } });
  assert.equal(over.ok, false, "하나만 남았는데 두 개");
  assert.equal(state?.bag["exp-candy-s"], 1, "모자라면 하나도 쓰지 않는다");
  const lvBefore = state!.pets[0]!.level;
  assert.ok(ex.run({ id: "use-rare", name: "bag.use", args: { itemId: "rare-candy", petId: "p1", count: 3 } }).ok);
  assert.equal(state?.pets[0]?.level, lvBefore + 3, "이상한사탕 세 개면 세 레벨");
  assert.equal(state?.bag["rare-candy"], 2);
  const food = ex.run({ id: "use-food", name: "bag.use", args: { itemId: "premium-food", petId: "p1", count: 2 } });
  assert.equal(food.ok, false, "먹이는 하나씩");
  assert.equal(state?.bag["premium-food"], 2);
  process.stdout.write("(9) 사탕 여러 개 쓰기  ok\n");
}

process.stdout.write("selftest-play: 통과 (로그인 시 시작·크기·pet.set size·영역·배고픔 말풍선·여러 개 구매·저장 실패 안내·사탕 여러 개)\n");
