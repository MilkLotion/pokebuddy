// 기기 창 모델 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-devices.js
//
// 가방·상점·파티·개체 기기 창 모델(src/view/device-*.ts)이 입력을 바로잡고 갈래마다 맞는 글자를 내는지 본다.
// 옛 모델(설정창 src/renderer/manage/manage.ts)과 같은지는 기기 창 덤프 A/B 가 본다. 이 검사는 갈래의 단언만 둔다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { candyMax, candyResult } from "../../bag/preview";
import { empty } from "../../save/v3";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import type { BagDeviceInput, ShopDeviceInput } from "../../shared/model/devices";
import { bagDeviceModel } from "../../view/device-bag";
import { partyDeviceModel } from "../../view/device-party";
import { petDeviceModel } from "../../view/device-pet";
import { shopDeviceModel } from "../../view/device-shop";
import { resultLineOf } from "../../view/result-lines";
import { EGG_SOURCE, tintEgg } from "../../main/egg-art";
import { decodePng, encodePng } from "../../main/png";
import { snapshot } from "../../view/snapshot";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

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
  s.pets.push(pet({ id: "p1", species: "pikachu", level: 12, exp: 2000, fullness: 55 }));
  s.pets.push(pet({ id: "p2", species: "charmander", shiny: true, fullness: 30, feedCooldownMs: 90_000, buffs: [{ kind: "long-play", remainMs: 45 * 60_000 }] }));
  s.pets.push(pet({ id: "p3", species: "squirtle", level: 5 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  s.boxes[0]!.slots[0] = "p3";
  s.bag = { "rare-candy": 1, "exp-candy-s": 5, "premium-food": 3, toy: 2, "fire-stone": 1 };
  return s;
}

const v = snapshot(seed(), undefined, undefined, undefined, T0);
const bagIn = (over: Partial<BagDeviceInput>): BagDeviceInput => ({ itemId: "rare-candy", mode: "use", targetPetId: "p1", qty: 1, sellQty: 1, notice: "", result: null, busy: false, ...over });
const bag = (over: Partial<BagDeviceInput>) => {
  const r = bagDeviceModel(v, bagIn(over));
  assert.ok(r, `가방 모델이 있다 (${JSON.stringify(over)})`);
  return r;
};

// (1) 사탕 미리보기 — 레벨 사탕은 한 개에 1레벨, 경험사탕은 100레벨 값에서 멈추고 넘친 만큼 사라진다
{
  const curve = Array.from({ length: 101 }, (_, l) => l * 100);
  assert.deepEqual(candyResult(curve, { level: 12, exp: 1200 }, "level", 1, 3), { level: 15, gain: 300, lost: 0 });
  assert.deepEqual(candyResult(curve, { level: 99, exp: 9900 }, "exp", 800, 1), { level: 100, gain: 100, lost: 700 });
  assert.equal(candyMax(curve, { level: 98, exp: 9800 }, "level", 1, 5), 2, "레벨 사탕은 100레벨까지 남은 개수");
  assert.equal(candyMax(curve, { level: 90, exp: 9000 }, "exp", 300, 9), 4, "경험사탕은 100레벨까지 필요한 개수(올림)");
  assert.equal(candyMax(curve, { level: 100, exp: 10000 }, "exp", 300, 9), 0, "100레벨이면 0");
}

// (2) 가방 사용 쪽 — 대상이 없으면 첫 파티 개체, 수량은 상한으로 자른다. 그림은 열쇠다
{
  const r = bag({ targetPetId: "p3", qty: 1 });
  assert.equal(r.input.targetPetId, "p1", "박스 개체는 대상이 아니다 — 첫 파티 개체로");
  assert.equal(r.model.art, "item:rare-candy");
  assert.deepEqual(r.model.party?.map((p) => [p.petId, p.art, p.picked]), [["p1", "portrait:pikachu", true], ["p2", "portrait:charmander:shiny", false]], "숨긴 개체도 파티 줄에 있다");
  assert.equal(r.model.title, v.party.preset.name);
  assert.equal(r.model.preview.lead, "피카츄 Lv.12 → Lv.13");
  assert.equal(r.model.go.label, "1개 사용");
  const many = bag({ itemId: "exp-candy-s", qty: 999 });
  assert.equal(many.input.qty, many.model.qty?.cap, "수량은 상한까지");
  assert.ok((many.model.qty?.cap ?? 0) <= 5, "가진 개수를 넘지 않는다");
  assert.match(many.model.preview.line, /^획득 경험치 \+[\d,]+ · 소멸 [\d,]+$/);
  assert.equal(bag({ itemId: "premium-food", qty: 9 }).model.qty, null, "사탕이 아니면 수량 줄이 없다");
}

// (3) 막힘·결과·실패 — 새 줄을 끼우지 않고 미리보기 상자의 글자와 색만 바뀐다
{
  const cool = bag({ itemId: "premium-food", targetPetId: "p2" });
  assert.match(cool.model.preview.lead, /^파이리 · 밥 주기 쿨타임이에요 \(.+\)\.$/);
  assert.equal(cool.model.go.disabled, true);
  const play = bag({ itemId: "toy", targetPetId: "p2" });
  assert.match(play.model.preview.line, /이미 신남 · 남은 45분 → 2시간으로 갱신/, "걸린 버프는 남은 시간을 바꾼다");
  assert.equal(bag({ notice: "안 돼요" }).model.preview.tone, "bad");
  const done = bag({ result: { lead: "피카츄 Lv.12 → Lv.13", line: "이상한사탕 1개를 썼어요" }, busy: true });
  assert.deepEqual([done.model.preview.tone, done.model.preview.lead, done.model.go.busy], ["ok", "피카츄 Lv.12 → Lv.13", true]);
}

// (4) 판매 쪽 — 진화용 도구는 판매만, 수량은 보유 수까지
{
  const evo = bag({ itemId: "fire-stone", mode: "use" });
  assert.deepEqual([evo.input.mode, evo.model.mode, evo.model.modes, evo.model.kind], ["sell", "sell", false, "진화"]);
  const sell = bag({ itemId: "premium-food", mode: "sell", sellQty: 99 });
  assert.equal(sell.input.sellQty, 3);
  assert.deepEqual(sell.model.qty, { count: 3, cap: 3, hint: "최대 3 · 보유 수" });
  assert.match(sell.model.preview.lead, /^받는 포인트 [\d,]+P$/);
  assert.equal(sell.model.party, null);
  assert.equal(bagDeviceModel(v, bagIn({ itemId: "없는도구" })), null, "가방에 없으면 닫는다");
}

// (5) 파티가 비면 사용 단추를 막는다
{
  const s = seed();
  s.party.slots[0] = { state: "empty" };
  s.party.slots[1] = { state: "empty" };
  const r = bagDeviceModel(snapshot(s, undefined, undefined, undefined, T0), bagIn({}));
  assert.deepEqual([r?.input.targetPetId, r?.model.preview.lead, r?.model.go.disabled], [null, "쓸 포켓몬이 없어요", true]);
}

// (6) 상점 — 수량 상한과 까닭, 포인트 부족, 그림 열쇠, 하나씩만 사는 상품
{
  const shopIn = (productId: string, over: Partial<ShopDeviceInput> = {}): ShopDeviceInput => ({ productId, qty: 1, notice: "", done: null, busy: false, ...over });
  const shop = (productId: string, over: Partial<ShopDeviceInput> = {}) => {
    const r = shopDeviceModel(v, shopIn(productId, over));
    assert.ok(r, `상점 모델이 있다 (${productId})`);
    return r;
  };
  const food = shop("premium-food", { qty: 999 });
  assert.equal(food.input.qty, food.model.qty?.cap, "수량은 상한까지");
  assert.match(food.model.qty?.hint ?? "", / · 포인트$/, "포인트가 가장 작은 상한");
  assert.equal(food.model.art, "item:premium-food");
  const egg = shop("random");
  assert.equal(egg.model.art, "egg:random");
  assert.match(egg.model.total.line, /돌보미집 1 \/ \d+$/, "알은 돌보미집 칸을 함께 보인다");
  assert.equal(shop("ancient-stone").model.art, "item:ancient-stone", "태고의돌은 도구 그림");
  const big = shop("sub-legendary");
  assert.deepEqual([big.model.state, big.model.total.lead, big.model.buy.disabled], ["포인트 부족", "포인트가 모자라요", true]);
  const slot = shop("party-slot", { qty: 5 });
  assert.deepEqual([slot.model.art, slot.model.qty, slot.input.qty], [null, null, 1], "파티 칸은 하나씩");
  const locked = shop("party-preset");
  assert.equal(locked.model.state, "파티 칸을 모두 열어야 해요 (4 / 12)", "살 수 없는 까닭은 머리 줄에");
  assert.equal(locked.model.buy.disabled, true);
  assert.equal(shop("toy", { notice: "안 돼요" }).model.total.tone, "bad");
  assert.equal(shop("toy", { done: { lead: "샀어요", line: "" } }).model.total.tone, "ok");
  assert.equal(shopDeviceModel(v, shopIn("없는상품")), null);
}

// (7) 파티 교체 — 든 개체가 파티에서 빠졌으면 놓고, 박스 개체를 든 동안 빈 칸이 놓을 칸이다
{
  const gone = partyDeviceModel(v, { heldPetId: "p3", heldFromBox: false, notice: "" });
  assert.equal(gone.input.heldPetId, null);
  assert.ok(gone.model.slots.every((s) => !s.target), "든 것이 없으면 놓을 칸이 없다");
  const held = partyDeviceModel(v, { heldPetId: "p1", heldFromBox: false, notice: "실패" });
  assert.deepEqual(held.model.slots.slice(0, 3).map((s) => [s.state, s.held, s.target, s.art]), [["pokemon", true, false, "portrait:pikachu"], ["pokemon", false, false, "portrait:charmander:shiny"], ["locked", false, false, null]]);
  assert.equal(held.model.notice, "실패");
  assert.equal(held.model.presets.length, v.party.preset.max);
}

// (8) 파티 상세 — 자리 글자, 튜토리얼은 파티 개체만
{
  const where = (id: string) => petDeviceModel(v, { petId: id, notice: "", dexOpen: false })?.model;
  assert.deepEqual([where("p1")?.where, where("p1")?.slotIndex, where("p1")?.tutorial], ["파티 1번 · 나와 있음", 0, v.detailTutorial]);
  assert.equal(where("p2")?.where, "파티 2번 · 볼 안");
  assert.deepEqual([where("p3")?.where, where("p3")?.inParty, where("p3")?.tutorial], [`${v.boxes[0]?.name} · 보관 중`, false, false]);
  assert.equal(where("없음"), undefined, "없는 개체면 닫는다");
  // 포인트 적립 줄과 막대 글자 — 박스 개체는 적립 없음, 친밀도 100 전은 기본
  assert.deepEqual(where("p3")?.careLine, { title: "포인트 적립 없음", desc: "파티에 있을 때만 포인트가 쌓여요" });
  assert.deepEqual(where("p1")?.careLine, { title: "포인트 적립 기본", desc: "친밀도가 가득이면 돌봄으로 더 빨리 쌓여요" });
  const p1 = v.party.slots[0]?.pet;
  assert.deepEqual(where("p1")?.bars, { affinity: `${p1?.affinity}`, fullness: `55 · ${p1?.zoneText}`, mood: `${p1?.mood} · ${p1?.moodWord}` });
}

// (9) 결과 줄 — 거래 앞뒤 화면 값을 견준다. 결과 줄이 없는 명령은 null
{
  const after = (change: (s: SaveV3) => void) => {
    const s = seed();
    change(s);
    return snapshot(s, undefined, undefined, undefined, T0);
  };
  const candy = resultLineOf({ cmd: "bag.use", target: "rare-candy", args: { petId: "p1" } }, v, after((s) => void (s.pets[0]!.level = 13)));
  assert.deepEqual(candy, { lead: "피카츄 Lv.12 → Lv.13", line: "이상한사탕 1개를 썼어요" });
  const exp = resultLineOf({ cmd: "bag.use", target: "exp-candy-s", args: { petId: "p1", count: 2 } }, v, after((s) => void (s.pets[0]!.exp += 1600)));
  assert.deepEqual(exp?.line, "경험사탕S 2개를 썼어요");
  assert.match(exp?.lead ?? "", /^피카츄 (경험치 \+1,600|Lv\.12 → Lv\.\d+)$/);
  const food = resultLineOf({ cmd: "bag.use", target: "premium-food", args: { petId: "p2" } }, v, after((s) => {
    s.pets[1]!.fullness = 100;
    s.pets[1]!.buffs.push({ kind: "premium-food", remainMs: 2 * 3_600_000 });
  }));
  assert.equal(food?.lead, "파이리 만복도 30 → 100 · 든든함 2시간");
  const egg = resultLineOf({ cmd: "shop.buy", target: "random", args: { count: 2 } }, v, after((s) => {
    s.points.balance -= 240;
    s.eggs.push({ id: "e1", kind: "random", boughtAt: T0, remainMs: 1, ready: false, candidates: [], careCooldownMs: 0, actions: { pat: 0, song: 0 } });
    s.eggs.push({ id: "e2", kind: "random", boughtAt: T0, remainMs: 1, ready: false, candidates: [], careCooldownMs: 0, actions: { pat: 0, song: 0 } });
  }));
  assert.equal(egg?.lead, "랜덤알 2개를 샀어요");
  assert.match(egg?.line ?? "", /^보유 1,000P · 돌보미집 2 \/ \d+$/);
  assert.equal(resultLineOf({ cmd: "bag.sell", target: "toy" }, v, v), null, "판매는 결과 줄이 없다");
  assert.equal(resultLineOf({ cmd: "bag.use", target: "없는도구", args: { petId: "p1" } }, v, v), null);
}

// (10) 그림 열쇠 칸 — 상점 상품·가방 도구·돌보미집 알. 상점 기기 창의 그림도 같은 열쇠다
{
  const shopIcon = (id: string) => v.shop.find((i) => i.id === id)?.icon;
  assert.deepEqual([shopIcon("random"), shopIcon("ancient-stone"), shopIcon("premium-food"), shopIcon("party-slot")], ["egg:random", "item:ancient-stone", "item:premium-food", null]);
  assert.equal(shopDeviceModel(v, { productId: "random", qty: 1, notice: "", done: null, busy: false })?.model.art, "egg:random");
  assert.ok(v.bag.every((i) => i.icon === `item:${i.id}`), "가방 도구는 item:<id>");
  const s = seed();
  s.eggs.push({ id: "e1", kind: "random", boughtAt: T0, remainMs: 1, ready: false, candidates: [], careCooldownMs: 0, actions: { pat: 0, song: 0 } });
  s.eggs.push({ id: "e2", kind: "ancient-stone", boughtAt: T0, remainMs: 1, ready: false, candidates: [], careCooldownMs: 0, actions: { pat: 0, song: 0 } });
  assert.deepEqual(snapshot(s, undefined, undefined, undefined, T0).eggs.list.map((e) => e.icon), ["egg:random", "item:ancient-stone"]);
}

// (11) 알 색칠 — 원작 색은 색표의 같은 자리 색으로, 투명한 점과 원작 색이 아닌 점은 그대로. 색표 길이가 다르면 null
{
  const rgba = (hex: string, a = 255): number[] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];
  const base = encodePng({ w: 3, h: 1, px: Buffer.from([...rgba(EGG_SOURCE[0]), ...rgba(EGG_SOURCE[3], 0), ...rgba("#123456")]) });
  const palette = EGG_SOURCE.map((_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
  const out = decodePng(tintEgg(base, palette)!);
  assert.deepEqual([...(out?.px ?? [])], [0, 0, 0, 255, ...rgba(EGG_SOURCE[3], 0), ...rgba("#123456")]);
  assert.equal(tintEgg(base, palette.slice(1)), null, "색표 길이가 다르면 칠하지 않는다");
}

process.stdout.write("selftest-devices: 통과 (사탕 미리보기·가방 사용·막힘과 결과·판매·빈 파티·상점·파티 교체·파티 상세·결과 줄·그림 열쇠·알 색칠)\n");
