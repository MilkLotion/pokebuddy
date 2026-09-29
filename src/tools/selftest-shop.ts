// 상점 구매 자체 확인 — npm run build 뒤 node dist/tools/selftest-shop.js
//
// 테스트 프레임워크 없이 assert 만. 무작위는 정해진 값을 넣는다.
// 계약은 docs/specs/game.md "상점", 가격은 docs/specs/balance.md 가격표다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules";
import { empty } from "../save/v3";
import { buy, nextEggId } from "../shop/buy";
import { eggPool, eggPrice, find, inRandomEgg, sellsSpecies, slotPrice, speciesPrice, toolPrice } from "../shop/catalog";
import { rankOf } from "../egg/hatch";
import { shopList } from "../tx/lists";
import { sell, sellPrice } from "../shop/sell";
import { createExecutor } from "../tx/executor";
import { HANDLERS } from "../tx/handlers";
import { unlockRules } from "../dex/unlocks";
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

// (9) 종 지정 구매 — 알에서 얻을 수 있는 종을 수집 난이도별 가격에 판다. 해금한 종만 산다 (2026-09-29 사용자 결정)
{
  assert.deepStrictEqual({ ...SHOP_V3_RULES.speciesPrices }, { 1: 200, 2: 300, 3: 400, 4: 500, 5: 600 });
  // 판매 대상 — 랜덤알 후보 + 태고의돌 화석
  const fossils = eggPool("ancient-stone") ?? [];
  const sold = [...new Set([...Object.keys(unlockRules()).filter((slug) => inRandomEgg(slug)), ...fossils])];
  assert.ok(sold.length > 400, `판매 대상 ${sold.length}종`);
  // 등급별 가격 — 판매 대상 전부가 자기 등급의 값이다
  for (const slug of sold) {
    assert.ok(sellsSpecies(slug), `${slug} 판매`);
    assert.equal(speciesPrice(slug), SHOP_V3_RULES.speciesPrices[rankOf(slug)], `${slug} 가격`);
  }
  assert.equal(rankOf("rattata"), 1);
  assert.equal(speciesPrice("rattata"), 200, "1등급 200P");
  assert.equal(rankOf("scyther"), 2);
  assert.equal(speciesPrice("scyther"), 300, "2등급 300P");
  assert.equal(rankOf("heracross"), 3);
  assert.equal(speciesPrice("heracross"), 400, "3등급 400P");
  for (const slug of ["ditto", "lapras"]) assert.equal(speciesPrice(slug), null, `업적 보상 종 ${slug} 미판매`);
  // 화석 — 랜덤알 후보가 아니어도 판다
  assert.equal(fossils.length, 15);
  for (const slug of fossils) assert.ok(!inRandomEgg(slug) && sellsSpecies(slug), `화석 ${slug} 판매`);
  assert.equal(speciesPrice("aerodactyl"), 400, "프테라 3등급 400P");
  // 단일 포켓몬 알의 종 · 진화형은 팔지 않는다
  for (const kind of ["sub-legendary", "ultra-beast", "paradox", "mythical", "legendary"])
    for (const slug of eggPool(kind) ?? []) assert.equal(speciesPrice(slug), null, `${kind} ${slug} 미판매`);
  for (const slug of ["charmeleon", "snorlax", "chansey", "pikachu"]) assert.equal(speciesPrice(slug), null, `진화형 ${slug} 미판매`);

  // 해금 전에는 못 산다 — 화석은 태고의돌에서 나와 해금된 뒤 산다
  const locked = seed(1000);
  assert.equal(buy(locked, "omanyte", T0, rand).reason, "not-unlocked", "해금 전에는 못 산다");
  assert.equal(locked.points.balance, 1000, "포인트도 그대로");
  const s = seed(1000);
  s.dex.unlocked = ["omanyte"];
  const res = buy(s, "omanyte", T0, rand);
  assert.equal(res.ok, true);
  assert.equal(res.spent, 200);
  assert.equal(s.pets.length, 1);
  assert.equal(s.pets[0]?.species, "omanyte");
  assert.equal(s.party.slots[res.slotIndex ?? -1]?.hidden, false, "꺼낸 상태로 들어간다");
  assert.ok(s.dex.obtained.includes("omanyte"));
  // 해금했어도 팔지 않는 종은 상품이 없다
  const no = seed(10_000);
  no.dex.unlocked = ["mewtwo", "snorlax"];
  assert.equal(buy(no, "mewtwo", T0, rand).reason, "no-product", "전설은 팔지 않는다");
  assert.equal(buy(no, "snorlax", T0, rand).reason, "no-product", "잠만보는 먹고자에서 진화해 얻는다");
  assert.equal(no.points.balance, 10_000, "포인트도 그대로");

  // 상점 목록 — 해금한 판매 대상만, 도감 번호 순
  const list = seed(0);
  list.dex.unlocked = ["omanyte", "snorlax", "rattata", "mewtwo", "bulbasaur", "charmeleon"];
  assert.deepStrictEqual(
    shopList(list).filter((p) => p.category === "pokemon").map((p) => [p.id, p.price]),
    [["bulbasaur", 200], ["rattata", 200], ["omanyte", 200]],
  );
  process.stdout.write(`(9) 종 지정 구매 · 알 종 ${sold.length}종 · 등급별 가격 · 해금한 종만  ok\n`);
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

// (11) 가방 판매 — 판매가 = 구매가 × 60%, 내림. 가격이 없거나 0P 인 도구는 팔지 않는다. 한 거래로 판다
// (2026-09-30 사용자 결정 "아이템 판매 기능 추가 (가방에서) 판매가는 구매가의 60%.")
{
  assert.equal(SHOP_V3_RULES.sellRate, 0.6);
  assert.equal(sellPrice("fire-stone"), 90, "진화용 도구 150P → 90P");
  assert.equal(sellPrice("exp-candy-xs"), 12, "20P → 12P");
  assert.equal(sellPrice("basic-food"), null, "가격 없는 기본먹이는 팔지 않는다");
  assert.equal(sellPrice("normal-potion"), null, "0P 돌아오는 약은 팔지 않는다");
  assert.equal(sellPrice("없는도구"), null);

  // 명령 — 150P 도구 2개를 팔면 180P 가 는다
  let state: SaveV3 | null = seed(1000);
  state.bag["fire-stone"] = 3;
  state.bag["basic-food"] = 5;
  state.bag["normal-potion"] = 1;
  const ex = createExecutor({ read: () => structuredClone(state), write: (next) => ((state = next), true), now: () => T0, rand }, HANDLERS);
  const two = ex.run({ id: "sell-2", name: "bag.sell", args: { itemId: "fire-stone", count: 2 } });
  assert.ok(two.ok, JSON.stringify(two));
  assert.equal(state?.points.balance, 1180, "180P 증가");
  assert.equal(state?.bag["fire-stone"], 1, "하나 남는다");
  assert.deepStrictEqual(two.ok && two.result, { itemId: "fire-stone", count: 2, earned: 180, left: 1, balance: 1180 });

  const reason = (id: string, args: Record<string, unknown>): string => {
    const res = ex.run({ id, name: "bag.sell", args });
    return res.ok ? "ok" : res.reason;
  };
  assert.equal(reason("sell-food", { itemId: "basic-food" }), "not-sellable", "기본먹이 거절");
  assert.equal(reason("sell-potion", { itemId: "normal-potion" }), "not-sellable", "돌아오는 약 거절");
  assert.equal(reason("sell-over", { itemId: "fire-stone", count: 2 }), "not-enough-items", "가진 것보다 많이는 못 판다");
  assert.equal(reason("sell-none", { itemId: "thunder-stone" }), "not-enough-items", "없는 도구");
  for (const count of [0, -1, 1.5, "2"]) assert.equal(reason(`sell-bad-${String(count)}`, { itemId: "fire-stone", count }), "bad-count", `수량 ${String(count)} 거절`);
  assert.equal(state?.points.balance, 1180, "거절은 포인트를 바꾸지 않는다");
  assert.equal(state?.bag["fire-stone"], 1, "거절은 가방을 바꾸지 않는다");
  assert.equal(state?.bag["basic-food"], 5);

  // 원자성 — 순수 함수가 거절하면 사본도 그대로다. 다 팔면 가방에서 지운다
  const pure = seed(0);
  pure.bag["toy"] = 2;
  assert.equal(sell(pure, "toy", 3).reason, "not-enough-items");
  assert.deepStrictEqual([pure.bag["toy"], pure.points.balance], [2, 0], "거절하면 하나도 팔지 않는다");
  assert.ok(sell(pure, "toy", 2).ok);
  assert.deepStrictEqual([pure.bag["toy"], pure.points.balance], [undefined, 48], "다 팔면 칸이 사라진다 (40P × 60% × 2)");
  process.stdout.write("(11) 가방 판매 · 60% 내림 · 판매 불가 · 보유 부족 · 원자성  ok\n");
}

process.stdout.write("selftest-shop: 통과 (가격·알·도구·파티 칸·종)\n");
