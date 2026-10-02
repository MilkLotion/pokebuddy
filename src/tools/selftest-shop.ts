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
import { petSellPrice, sellPet, sellablePet } from "../shop/sell-pet";
import { newPet, nextPetId } from "../party/create";
import { activePreset, applyPreset, presetBuyable, presetCount, presetName, shopSlots, slotsOfPreset } from "../party/presets";
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
  assert.equal(slotPrice(2), 500, "파티 칸은 늘 500P");
  assert.equal(slotPrice(1), 500);
  assert.equal(slotPrice(0), null, "상점으로 열 칸이 남지 않으면 팔지 않는다");
  assert.equal(SHOP_V3_RULES.presetPrice, 1000, "파티 프리셋은 늘 1000P");
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

// (8) 파티 칸은 늘 500P 이고 프리셋마다 따로 산다. 첫 프리셋은 두 칸, 나머지 프리셋은 네 칸까지다 (2026-10-02 사용자 결정)
{
  const s = seed(10_000);
  const first = buy(s, "party-slot", T0, rand);
  assert.equal(first.spent, 500);
  const second = buy(s, "party-slot", T0, rand);
  assert.equal(second.spent, 500);
  const third = buy(s, "party-slot", T0, rand);
  assert.equal(third.reason, "no-locked-slot");
  const open = s.party.slots.filter((x) => x.state === "empty").length;
  assert.equal(open, SAVE_V3_RULES.party.openAtStart + SAVE_V3_RULES.party.shopUnlock);
  const left = s.party.slots.filter((x) => x.state === "locked" && x.unlockBy === "achievement").length;
  assert.equal(left, 2, "업적으로 여는 칸은 남는다");
  assert.equal(s.party.slotCount, 4 + 2, "열린 칸 수 — 첫 프리셋 4 + 둘째 프리셋 2");
  assert.deepStrictEqual(shopSlots(s), { left: 0, total: 2, bought: 2 });

  // 둘째 프리셋을 적용하면 그 프리셋의 칸을 산다 — 첫 프리셋에서 산 칸은 따라오지 않는다
  assert.deepStrictEqual(applyPreset(s, 1), { ok: true });
  assert.deepStrictEqual(shopSlots(s), { left: 4, total: 4, bought: 0 });
  for (let i = 0; i < 4; i += 1) assert.equal(buy(s, "party-slot", T0, rand).spent, 500);
  assert.equal(buy(s, "party-slot", T0, rand).reason, "no-locked-slot");
  assert.ok(s.party.slots.every((x) => x.state === "empty"), "둘째 프리셋은 여섯 칸 모두 상점으로 연다");
  assert.equal(slotsOfPreset(s, 0)?.filter((x) => x.state === "locked").length, 2, "첫 프리셋의 잠금은 그대로");
  assert.equal(s.party.slotCount, 4 + 6);
  process.stdout.write("(8) 파티 칸 · 500P 고정 · 프리셋마다 따로  ok\n");
}

// (8b) 파티 프리셋 — 1000P 고정. 가진 프리셋의 칸을 모두 열어야 산다. 다섯 개까지다 (2026-10-02 사용자 결정)
{
  const s = seed(10_000);
  assert.equal(buy(s, "party-preset", T0, rand).reason, "slots-not-full", "2개일 때 12칸이어야 한다");
  assert.equal(s.points.balance, 10_000, "거절은 포인트를 바꾸지 않는다");
  const openAll = (): void => {
    for (let i = 0; i < presetCount(s); i += 1) for (const slot of slotsOfPreset(s, i) ?? []) if (slot.state === "locked") { slot.state = "empty"; delete slot.unlockBy; }
  };
  openAll();
  assert.deepStrictEqual(presetBuyable(s), { ok: true, open: 12, need: 12 });
  const third = buy(s, "party-preset", T0, rand);
  assert.deepStrictEqual({ ok: third.ok, spent: third.spent, preset: third.preset }, { ok: true, spent: 1000, preset: 2 });
  assert.equal(presetCount(s), 3);
  assert.equal(slotsOfPreset(s, 2)?.filter((x) => x.state === "empty").length, 2, "새 프리셋은 두 칸이 열려 있다");
  assert.equal(s.party.slotCount, 14);
  assert.equal(buy(s, "party-preset", T0, rand).reason, "slots-not-full", "3개일 때 18칸이어야 한다");
  openAll();
  assert.equal(buy(s, "party-preset", T0, rand).ok, true);
  openAll();
  assert.equal(buy(s, "party-preset", T0, rand).ok, true);
  assert.equal(presetCount(s), SAVE_V3_RULES.party.presets.max);
  openAll();
  assert.equal(buy(s, "party-preset", T0, rand).reason, "preset-max");
  assert.equal(s.points.balance, 10_000 - 3000);

  // 포인트가 모자라면 사지 않는다. 여러 개를 한 번에 사지 않는다
  const poor = seed(999);
  for (const slot of [...poor.party.slots, ...(slotsOfPreset(poor, 1) ?? [])]) if (slot.state === "locked") { slot.state = "empty"; delete slot.unlockBy; }
  assert.equal(buy(poor, "party-preset", T0, rand).reason, "not-enough");
  let state: SaveV3 | null = seed(5000);
  const ex = createExecutor({ read: () => structuredClone(state), write: (next) => ((state = next), true), now: () => T0, rand }, HANDLERS);
  const two = ex.run({ id: "pp-2", name: "shop.buy", args: { productId: "party-slot", count: 2 } });
  assert.equal(two.ok ? "ok" : two.reason, "bad-args", "파티 칸은 하나씩 산다");

  // 상점 목록 — 파티 칸은 적용한 프리셋 이름과 구매 수, 프리셋은 구매 수와 칸 조건
  const list = shopList(seed(0));
  const slot = list.find((i) => i.id === "party-slot");
  const preset = list.find((i) => i.id === "party-preset");
  assert.deepStrictEqual({ note: slot?.note, price: slot?.price, blocked: slot?.blocked }, { note: "프리셋 1 · 구매 0 / 2", price: 500, blocked: undefined });
  assert.deepStrictEqual({ note: preset?.note, price: preset?.price, category: preset?.category }, { note: "구매 0 / 3 · 칸 4 / 12", price: 1000, category: "slot" });
  assert.ok(preset?.blocked?.includes("파티 칸을 모두 열어야"), "칸 조건을 못 채우면 막는다");
  process.stdout.write("(8b) 파티 프리셋 · 1000P 고정 · 칸 조건 · 다섯 개까지  ok\n");
}

// (8c) 프리셋 명령 — 적용과 이름 바꾸기. 이름은 12자까지, 비우면 기본 이름
{
  let state: SaveV3 | null = seed(0);
  state.pets.push(newPet({ id: "p1", species: "bulbasaur", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  state.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  const ex = createExecutor({ read: () => structuredClone(state), write: (next) => ((state = next), true), now: () => T0, rand }, HANDLERS);
  const run = (id: string, name: string, args: unknown) => ex.run({ id, name, args });
  const reason = (id: string, name: string, args: unknown): string => {
    const r = run(id, name, args);
    return r.ok ? "ok" : r.reason;
  };

  assert.equal(reason("pr-1", "party.preset", { preset: 0 }), "already-active");
  assert.equal(reason("pr-2", "party.preset", { preset: 2 }), "no-preset", "가지지 않은 프리셋");
  assert.equal(reason("pr-3", "party.preset", {}), "bad-args");
  const to2 = run("pr-4", "party.preset", { preset: 1 });
  assert.deepStrictEqual(to2.ok && to2.result, { preset: 1, name: "프리셋 2", shown: 0 });
  assert.equal(activePreset(state!), 1);
  assert.equal(state!.party.slots.some((x) => x.state === "pokemon"), false, "둘째 프리셋은 비어 있다");
  assert.deepStrictEqual(slotsOfPreset(state!, 0)?.[0], { state: "pokemon", petId: "p1", hidden: true }, "나간 프리셋의 칸은 숨김째 남는다");
  assert.equal(reason("pr-5", "feed", { petId: "p1" }), "not-in-party", "적용하지 않은 프리셋의 개체는 돌보지 않는다");
  assert.equal(reason("pr-6", "party.preset", { preset: 0 }), "ok");
  assert.equal(state!.party.slots[0]?.petId, "p1");

  const named = run("pn-1", "party.preset.rename", { preset: 1, name: "  탐험용  " });
  assert.deepStrictEqual(named.ok && named.result, { preset: 1, name: "탐험용" });
  assert.equal(presetName(state!, 1), "탐험용");
  assert.equal(presetName(state!, 0), "프리셋 1", "다른 프리셋의 이름은 그대로");
  run("pn-2", "party.preset.rename", { preset: 0, name: "가나다라마바사아자차카타파하" });
  assert.equal(presetName(state!, 0), "가나다라마바사아자차카타", "12자까지");
  run("pn-3", "party.preset.rename", { preset: 0, name: "   " });
  assert.equal(presetName(state!, 0), "프리셋 1", "비우면 기본 이름");
  assert.equal(reason("pn-4", "party.preset.rename", { preset: 4, name: "x" }), "no-preset");
  assert.equal(reason("pn-5", "party.preset.rename", { preset: 0 }), "bad-args");
  assert.equal(shopList(state!).find((i) => i.id === "party-slot")?.note, "프리셋 1 · 구매 0 / 2");
  process.stdout.write("(8c) 프리셋 명령 · 적용·이름  ok\n");
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
  assert.deepStrictEqual([pure.bag["toy"], pure.points.balance], [undefined, 24], "다 팔면 칸이 사라진다 (20P × 60% × 2)");
  process.stdout.write("(11) 가방 판매 · 60% 내림 · 판매 불가 · 보유 부족 · 원자성  ok\n");
}

// (12) 리전폼 (data/regional.json) — 지도는 진화용 도구 공통 가격. 리전폼 진화 전 종은 알에서 얻는 종이라 파는 종, 진화 결과·전설은 팔지 않는다
{
  assert.equal(toolPrice("region-map"), SHOP_V3_RULES.evoItemPrice, "지도 150P");
  assert.equal(toolPrice("galarica-cuff"), SHOP_V3_RULES.evoItemPrice, "가라두구팔찌");
  assert.equal(sellsSpecies("vulpix-alola"), true);
  assert.equal(sellsSpecies("tauros-paldea-blaze-breed"), true);
  assert.equal(sellsSpecies("raichu-alola"), false, "진화 결과");
  assert.equal(sellsSpecies("articuno-galar"), false, "단일 포켓몬 알의 종");
  assert.ok(eggPool("sub-legendary")?.includes("articuno-galar"), "가라르 프리져는 랜덤준전설알");
  // 특수 폼 2종도 랜덤준전설알의 단일 포켓몬이라 팔지 않는다 (2026-10-03 사용자 결정 "준전설알로.")
  for (const s of ["floette-eternal", "ursaluna-bloodmoon"]) {
    assert.equal(sellsSpecies(s), false, `단일 포켓몬 알의 종 ${s}`);
    assert.ok(eggPool("sub-legendary")?.includes(s), `${s} 는 랜덤준전설알`);
  }
  process.stdout.write("(12) 리전폼 · 지도 가격 · 파는 종  ok\n");
}

// (13) 포켓몬 판매 — 판매가 = 그 종이 나오는 알 값의 1/4, 10P 단위 내림. 단일 포켓몬과 알에 없는 종은 팔지 않는다
// (2026-10-01 사용자 결정 "가격은 알 1/4 가격으로. 대충 10단위로 떨어지게", 2026-10-02 "단일 포켓몬은 판매불가", "어느 알에도 없는 종은 판매불가")
{
  const of = (species: string, evolved: string[] = []) => petSellPrice({ species, evolved });
  assert.equal(of("bulbasaur"), 30, "랜덤알 120P → 30P");
  assert.equal(of("venusaur", ["bulbasaur", "ivysaur"]), 30, "진화형은 진화 전 종의 알로 본다");
  assert.equal(of("venusaur"), 30, "진화 이력이 없는 진화형(우편·교환)도 계열 맨 앞 종으로");
  assert.equal(of("omanyte"), 50, "태고의돌 200P → 50P");
  assert.equal(of("mewtwo"), null, "단일 포켓몬");
  assert.equal(of("solgaleo", ["cosmog", "cosmoem"]), null, "공유 계열도 단일 포켓몬");
  assert.equal(of("ditto"), null, "어느 알에도 없는 종 — 업적 보상");
  assert.equal(of("lapras"), null, "어느 알에도 없는 종 — 업적 보상");

  const mk = (id: string, species: string) => newPet({ id, species, shiny: false, nature: "hardy", gender: "male", now: T0 });
  let state: SaveV3 | null = seed(100);
  state.pets.push(mk("p1", "bulbasaur"), mk("p2", "omanyte"), mk("p3", "mewtwo"), mk("p4", "pikachu"));
  state.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  state.boxes[0]!.slots[0] = "p2";
  state.boxes[0]!.slots[1] = "p3";
  state.boxes[2]!.slots[4] = "p4";
  state.starterPetId = "p1";
  const ex = createExecutor({ read: () => structuredClone(state), write: (next) => ((state = next), true), now: () => T0, rand }, HANDLERS);
  const run = (id: string, petId: unknown) => ex.run({ id, name: "pet.sell", args: { petId } });
  const reason = (id: string, petId: unknown): string => {
    const r = run(id, petId);
    return r.ok ? "ok" : r.reason;
  };

  assert.equal(reason("ps-single", "p3"), "pet-not-sellable", "단일 포켓몬 거절");
  assert.equal(reason("ps-none", "p9"), "no-pet");
  assert.equal(reason("ps-bad", 3), "bad-args");
  state.trade = { pending: { channelId: "c1", petId: "p2", offerRev: 0, received: null } };
  assert.equal(reason("ps-locked", "p2"), "trade-locked", "교환에 올린 개체 거절");
  state.trade = { pending: null };
  assert.equal(state.points.balance, 100, "거절은 포인트를 바꾸지 않는다");
  assert.equal(state.pets.length, 4, "거절은 개체를 지우지 않는다");

  // 박스 개체 — 칸이 비고 포인트가 는다
  const box = run("ps-box", "p4");
  assert.deepStrictEqual(box.ok && box.result, { petId: "p4", species: "pikachu", earned: 30, balance: 130 });
  assert.equal(state?.boxes[2]!.slots[4], null, "박스 칸이 빈다");
  assert.equal(state?.pets.some((p) => p.id === "p4"), false);
  assert.equal(state?.petSeq, 4, "판 개체의 번호를 기억한다");
  assert.equal(nextPetId(state!), "p5", "판 번호를 다시 쓰지 않는다");
  assert.equal(run("ps-box", "p4").ok, true, "같은 요청은 한 번만 반영한다");
  assert.equal(state?.points.balance, 130);

  // 프리셋에 든 개체는 팔지 않는다 — 적용한 프리셋(지금 파티)도, 다른 프리셋도 (2026-10-02 사용자 결정)
  assert.equal(reason("ps-party", "p1"), "in-preset", "파티 개체 거절");
  assert.equal(state?.party.slots[0]?.petId, "p1", "거절은 칸을 비우지 않는다");
  state!.boxes[0]!.slots[0] = null;
  slotsOfPreset(state!, 1)![0] = { state: "pokemon", petId: "p2", hidden: false };
  assert.equal(reason("ps-preset", "p2"), "in-preset", "적용하지 않은 프리셋의 개체 거절");
  assert.equal(state?.points.balance, 130);

  // 박스로 뺀 뒤에는 판다. 첫 선택 개체 표시도 지운다
  state!.party.slots[0] = { state: "empty" };
  state!.boxes[1]!.slots[0] = "p1";
  const boxed = run("ps-boxed", "p1");
  assert.deepStrictEqual(boxed.ok && boxed.result, { petId: "p1", species: "bulbasaur", earned: 30, balance: 160 });
  assert.equal(state?.boxes[1]!.slots[0], null);
  assert.equal(state?.starterPetId, null);
  assert.equal(state?.dex.obtained.length, 0, "도감 기록은 건드리지 않는다");

  // 마지막 한 마리는 팔지 않는다
  const one = seed(0);
  one.pets.push(mk("p1", "bulbasaur"));
  one.boxes[0]!.slots[0] = "p1";
  assert.deepStrictEqual(sellablePet(one, "p1"), { ok: false, reason: "last-pet" });
  assert.equal(sellPet(one, "p1").reason, "last-pet");
  assert.equal(one.pets.length, 1);
  process.stdout.write("(13) 포켓몬 판매 · 알 값의 1/4 · 단일·알 없는 종 거절 · 교환 잠금 · 프리셋 개체 거절 · 마지막 한 마리 · 번호 재사용 없음  ok\n");
}

process.stdout.write("selftest-shop: 통과 (가격·알·도구·파티 칸·종·리전폼·포켓몬 판매)\n");
