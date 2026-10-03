// 상점 구매 — 규칙은 docs/specs/game.md "상점", 가격은 docs/specs/balance.md
//
// 한 거래로 검사와 반영을 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다.
//   알      돌보미집에 빈 칸이 있어야 한다. 사면 바로 들어가고 준비 시간이 시작된다
//   도구    가방에 쌓는다. 칸 수 제한은 없다
//   파티 칸 적용한 프리셋에 상점으로 여는 칸이 남아 있어야 한다. 값은 늘 같다
//   파티 프리셋 가진 프리셋의 칸을 모두 열어야 한다. 값은 늘 같다
//   박스    상한(BOX_RULES.max)까지 하나씩 산다. 값은 늘 같다. 빈 박스가 맨 뒤에 생긴다
//   종      해금한 종만 산다. 새 개체는 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 둘 곳이 없으면 사지 못한다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { addBox, boxBuyable, boxRoom, putPet } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { addNewPet, checkNewPetRoom, hasRoom, placeNew } from "../party/create.js";
import { addItem, bagRoomOf } from "../bag/items.js";
import { openSlot, presetSlots } from "../party/slots.js";
import { addPreset, countParty, presetBuyable, presetCount, shopSlots } from "../party/presets.js";
import type { Rand } from "../shared/rand.js";
import { BAG_RULES } from "../bag/rules.js";
import { EGG_RULES } from "../egg/rules.js";
import { SHOP_RULES } from "./rules.js";
import type { SaveV3 } from "../shared/save-v3";
import { canGiveEgg, newEgg, nextEggId, randomPool } from "../egg/pool.js";
import { find, slotPrice } from "./catalog.js";
import type { ReasonOf } from "../shared/names/reasons.js";

export type BuyFailure = ReasonOf<
  | "no-product" // 그런 상품이 없다
  | "not-enough-points" // 포인트가 모자라다
  | "daycare-full" // 돌보미집이 가득 찼다
  | "bag-full" // 그 도구가 가방에 이미 최대 개수(BAG_RULES.max)만큼 있다
  | "no-locked-slot" // 상점으로 열 칸이 남지 않았다
  | "preset-max" // 프리셋을 더 가질 수 없다
  | "slots-not-full" // 가진 프리셋의 칸을 모두 열지 않았다
  | "box-max" // 박스를 더 가질 수 없다
  | "box-full" // 새 개체를 둘 파티 빈 칸도 박스 빈 칸도 없다
  | "not-unlocked" // 해금하지 않은 종이다
  | "sold-out" // 단일 포켓몬 알인데 남은 종이 없다 (기다리는 같은 알까지 셈)
>;

export interface BuyResult {
  ok: boolean;
  reason?: BuyFailure;
  spent?: number;
  balance?: number;
  eggId?: string;
  petId?: string;
  slotIndex?: number;
  toBox?: boolean;
  preset?: number; // 새로 산 프리셋 번호
  boxId?: string; // 새로 산 박스
}

// [임시] 옛 자리의 다시 내보내기 — src/tools 가 새 자리에서 가져오면 지운다
//   새 알은 src/egg/pool.ts, 새 개체를 둘 곳은 src/party/create.ts 에 있다
export { hasRoom, newEgg, nextEggId, placeNew, randomPool };

// 파티 프리셋 하나 — 가진 프리셋의 칸을 모두 열어야 산다. 새 프리셋은 두 칸이 열린 채 비어 있다
function buyPreset(save: SaveV3): BuyResult {
  const can = presetBuyable(save);
  if (!can.ok) return { ok: false, reason: can.reason === "preset-max" ? "preset-max" : "slots-not-full" };
  const price = SHOP_RULES.presetPrice;
  if (save.points.balance < price) return { ok: false, reason: "not-enough-points" };
  save.points.balance -= price;
  const preset = addPreset(save, presetSlots(presetCount(save)));
  return { ok: true, spent: price, balance: save.points.balance, preset };
}

// 박스 하나 — 상한까지 산다. 빈 박스가 맨 뒤에 생긴다
function buyBox(save: SaveV3): BuyResult {
  if (!boxBuyable(save.boxes).ok) return { ok: false, reason: "box-max" };
  const price = SHOP_RULES.boxPrice;
  if (save.points.balance < price) return { ok: false, reason: "not-enough-points" };
  const box = addBox(save.boxes);
  if (!box) return { ok: false, reason: "box-max" };
  save.points.balance -= price;
  return { ok: true, spent: price, balance: save.points.balance, boxId: box.id };
}

export function buy(save: SaveV3, productId: string, now: number, rand: Rand, opts?: DexOptions): BuyResult {
  if (productId === "party-preset") return buyPreset(save);
  if (productId === "box") return buyBox(save);
  const slot = productId === "party-slot";
  const product = slot ? null : find(productId, opts);
  const price = slot ? slotPrice(shopSlots(save).left) : product?.price ?? null; // 파티 칸은 적용한 프리셋의 칸이다

  if (price === null) return { ok: false, reason: slot ? "no-locked-slot" : "no-product" };
  if (save.points.balance < price) return { ok: false, reason: "not-enough-points" };

  // 검사 — 값을 바꾸기 전에 모두 본다
  if (product?.kind === "egg" && save.eggs.length >= EGG_RULES.maxEggs) return { ok: false, reason: "daycare-full" };
  if (product?.kind === "egg" && !canGiveEgg(save, product.ref, opts)) return { ok: false, reason: "sold-out" };
  if (product?.kind === "species" && !save.dex.unlocked.includes(product.ref)) return { ok: false, reason: "not-unlocked" };
  if (product?.kind === "species" && !checkNewPetRoom(save, "party-first").ok) return { ok: false, reason: "box-full" };
  if (product?.kind === "tool" && bagRoomOf(save, product.ref) < 1) return { ok: false, reason: "bag-full" };

  save.points.balance -= price;
  const done: BuyResult = { ok: true, spent: price, balance: save.points.balance };

  if (slot) {
    const i = openSlot(save.party.slots, "shop"); // 칸 +1 — 첫 잠긴 칸을 연다
    countParty(save);
    return { ...done, slotIndex: i };
  }

  if (product?.kind === "egg") {
    const egg = newEgg(save, product.ref, now, opts);
    save.eggs.push(egg);
    return { ...done, eggId: egg.id };
  }

  if (product?.kind === "tool") {
    addItem(save, product.ref, 1); // 상한은 위에서 봤다
    return done;
  }

  // 종 지정 구매 — 새 개체를 만든다
  const added = addNewPet(save, { species: product?.ref ?? productId, shiny: false, now, rand, place: "party-first", opts }); // 둘 곳은 위에서 봤다
  return { ...done, petId: added?.pet.id, ...(added?.slotIndex !== undefined ? { slotIndex: added.slotIndex } : {}), toBox: added?.toBox ?? true };
}
