// 상점 구매 자체 확인 — npm run build 뒤 node dist/tools/selftest-shop.js
//
// 테스트 프레임워크 없이 assert 만. 무작위는 정해진 값을 넣는다.
// 계약은 docs/specs/game.md "상점", 가격은 docs/specs/balance.md 가격표다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules";
import { empty } from "../save/v3";
import { buy, nextEggId } from "../shop/buy";
import { eggPool, eggPrice, find, slotPrice, speciesPrice, toolPrice } from "../shop/catalog";
import type { SaveV3 } from "../shared/save-v3";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const rand = () => 0.5;

function seed(points: number): SaveV3 {
  const s = empty(T0);
  s.points.balance = points;
  return s;
}

// (1) 가격은 한 곳에서만 온다
{
  assert.equal(eggPrice("random"), 120, "랜덤알");
  assert.equal(eggPrice("ancient-stone"), 200, "태고의돌");
  assert.equal(toolPrice("exp-candy-xl"), 320);
  assert.equal(toolPrice("normal-potion"), 0, "돌아오는 약은 0P");
  assert.equal(toolPrice("basic-food"), null, "기본먹이는 팔지 않는다");
  assert.equal(toolPrice("thunder-stone"), SHOP_V3_RULES.evoItemPrice, "진화용 도구는 공통 가격");
  assert.equal(toolPrice("bond-cord"), SHOP_V3_RULES.evoItemPrice, "연결의끈도 같다");
  assert.equal(slotPrice(0), 300);
  assert.equal(slotPrice(1), 600);
  assert.equal(slotPrice(2), null, "두 칸까지만 판다");
  assert.equal(find("없는상품"), null);
  assert.equal(eggPool("ancient-stone")?.length, 15, "태고의돌은 화석 15종");
  assert.equal(eggPool("random"), null, "랜덤알은 해금한 종에서 뽑는다");
  process.stdout.write("(1) 가격표와 상품 찾기  ok\n");
}

// (2) 알 구매 — 돌보미집에 들어가고 준비 시간이 시작된다
{
  const s = seed(200);
  const res = buy(s, "random", T0, rand);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 120);
  assert.equal(s.points.balance, 80);
  assert.equal(s.eggs.length, 1);
  assert.equal(s.eggs[0]?.kind, "random");
  assert.equal(s.eggs[0]?.remainMs, EGG_V3_RULES.readyMs);
  assert.equal(s.eggs[0]?.ready, false);
  process.stdout.write("(2) 알 구매 · 준비 시간 시작  ok\n");
}

// (2b) 랜덤알 후보는 진화 전용 종을 뺀다 — 리자드·라이츄는 빠지고, 첫 선택 후보 피카츄는 남는다
{
  const s = seed(200);
  s.dex.unlocked = ["charmander", "charmeleon", "pichu", "pikachu", "raichu"];
  buy(s, "random", T0, rand);
  assert.deepStrictEqual(s.eggs[0]?.candidates, ["charmander", "pichu"]); // 피카츄는 피츄 진화로만 얻는다 (2026-09-27 스타터 교체)
  process.stdout.write("(2b) 랜덤알 · 진화 전용 종 제외  ok\n");
}

// (3) 태고의돌은 화석 후보를 담는다
{
  const s = seed(300);
  buy(s, "ancient-stone", T0, rand);
  assert.equal(s.eggs[0]?.candidates.length, 15);
  assert.ok(s.eggs[0]?.candidates.includes("aerodactyl"));
  process.stdout.write("(3) 태고의돌 · 화석 후보  ok\n");
}

// (4) 랜덤알은 해금한 종을 후보로 담는다
{
  const s = seed(200);
  s.dex.unlocked = ["charmander", "squirtle"];
  buy(s, "random", T0, rand);
  assert.deepStrictEqual(s.eggs[0]?.candidates, ["charmander", "squirtle"]);
  process.stdout.write("(4) 랜덤알 · 해금한 종이 후보  ok\n");
}

// (5) 포인트가 모자라면 아무것도 바꾸지 않는다
{
  const s = seed(100);
  const res = buy(s, "random", T0, rand);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not-enough");
  assert.equal(s.points.balance, 100);
  assert.equal(s.eggs.length, 0);
  process.stdout.write("(5) 포인트 부족 · 그대로  ok\n");
}

// (6) 돌보미집이 가득 차면 거절한다
{
  const s = seed(10_000);
  for (let i = 0; i < EGG_V3_RULES.maxEggs; i++) assert.equal(buy(s, "random", T0, rand).ok, true);
  const res = buy(s, "random", T0, rand);
  assert.equal(res.reason, "daycare-full");
  assert.equal(s.eggs.length, EGG_V3_RULES.maxEggs);
  process.stdout.write("(6) 돌보미집 가득  ok\n");
}

// (7) 도구는 가방에 쌓인다
{
  const s = seed(1000);
  buy(s, "exp-candy-s", T0, rand);
  buy(s, "exp-candy-s", T0, rand);
  assert.equal(s.bag["exp-candy-s"], 2);
  assert.equal(s.points.balance, 1000 - 80);
  buy(s, "thunder-stone", T0, rand);
  assert.equal(s.bag["thunder-stone"], 1);
  process.stdout.write("(7) 도구 · 가방에 쌓인다  ok\n");
}

// (8) 파티 칸은 값이 순서마다 다르고 두 칸까지다
{
  const s = seed(1000);
  const first = buy(s, "party-slot", T0, rand);
  assert.equal(first.spent, 300);
  const second = buy(s, "party-slot", T0, rand);
  assert.equal(second.spent, 600);
  const third = buy(s, "party-slot", T0, rand);
  assert.equal(third.reason, "no-locked-slot");
  const open = s.party.slots.filter((x) => x.state === "empty").length;
  assert.equal(open, SAVE_V3_RULES.party.openAtStart + SAVE_V3_RULES.party.shopUnlock);
  const left = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  assert.equal(left, 2, "업적으로 여는 칸은 남는다");
  process.stdout.write("(8) 파티 칸 · 300P 뒤 600P  ok\n");
}

// (9) 종 지정 구매는 해금한 종만
{
  // 지금 상점에서 파는 종은 잠만보 하나다 (data/unlocks.json 의 shop)
  const slug = "snorlax";
  assert.equal(speciesPrice(slug), 800);
  const locked = seed(1000);
  assert.equal(buy(locked, slug, T0, rand).reason, "not-unlocked", "해금 전에는 못 산다");
  assert.equal(locked.points.balance, 1000, "포인트도 그대로");
  const s = seed(1000);
  s.dex.unlocked = [slug];
  const res = buy(s, slug, T0, rand);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 800);
  assert.equal(s.pets.length, 1);
  assert.equal(s.pets[0]?.species, slug);
  assert.equal(s.party.slots[res.slotIndex ?? -1]?.hidden, false, "꺼낸 상태로 들어간다");
  assert.ok(s.dex.obtained.includes(slug));
  process.stdout.write("(9) 종 지정 구매 · 해금한 종만  ok\n");
}

// (10) 알 식별자는 이어서 붙고, 연 알의 식별자를 다시 쓰지 않는다 — 다시 쓰면 부화 배너 기록이 겹친다
{
  const s = seed(1000);
  assert.equal(nextEggId(s), "e1");
  buy(s, "random", T0, rand);
  assert.equal(nextEggId(s), "e2");
  s.eggs = []; // e1 을 열어 돌보미집이 비었다
  buy(s, "random", T0, rand);
  assert.equal(s.eggs[0]?.id, "e2", "비어도 e1 을 다시 쓰지 않는다");
  assert.equal(s.eggSeq, 2);
  process.stdout.write("(10) 알 식별자 이어 붙이기 · 다시 쓰지 않음  ok\n");
}

process.stdout.write("selftest-shop: 통과 (가격·알·도구·파티 칸·종)\n");
