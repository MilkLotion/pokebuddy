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
import { addBox, boxBuyable } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { hasUnlocked } from "../dex/record.js";
import { addNewPet, checkNewPetRoom } from "../party/create.js";
import { addItem, bagRoomOf } from "../bag/items.js";
import { openSlot, presetSlots } from "../party/slots.js";
import { addPreset, countParty, presetBuyable, presetCount, shopSlots } from "../party/presets.js";
import type { Rand } from "../shared/rand.js";
import { SHOP_RULES } from "./rules.js";
import type { SaveV3 } from "../shared/save-v3";
import { checkGiveEgg, eggRoomOf, newEgg } from "../egg/pool.js";
import { findProduct, slotPrice } from "./catalog.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

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

export type BuyResult = Outcome<BuyFailure> & {
  spent?: number;
  balance?: number;
  eggId?: string;
  petId?: string;
  slotIndex?: number;
  toBox?: boolean;
  preset?: number; // 새로 산 프리셋 번호
  boxId?: string; // 새로 산 박스
};

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

// 상품 하나를 지금 살 수 있는 상태 — 값, 여러 개를 한 번에 살 수 있는지, 살 수 있는 수, 한 개도 못 살 때의 까닭
//   many    여러 개를 한 번에 살 수 있는 상품이다(알과 도구)
//   room    지금 살 수 있는 수. 포인트·가방 자리·돌보미집 빈 칸·단일 알의 남은 종 가운데 가장 작은 값
//   reason  한 개도 못 살 때의 까닭. 보는 순서는 값 → 포인트 → 상품별 자리다
export interface BuyState {
  price: number | null;
  many: boolean;
  room: number;
  reason?: BuyFailure;
}

export function buyStateOf(save: SaveV3, productId: string, opts?: DexOptions): BuyState {
  if (productId === "party-preset" || productId === "box") {
    const price = productId === "box" ? SHOP_RULES.boxPrice : SHOP_RULES.presetPrice;
    const can = productId === "box" ? (boxBuyable(save.boxes).ok ? null : "box-max") : presetBuyable(save).ok ? null : presetBuyable(save).reason === "preset-max" ? "preset-max" : "slots-not-full";
    const reason: BuyFailure | undefined = can ?? (save.points.balance < price ? "not-enough-points" : undefined);
    return { price, many: false, room: reason ? 0 : 1, ...(reason ? { reason } : {}) };
  }
  const slot = productId === "party-slot";
  const product = slot ? null : findProduct(productId, opts);
  const price = slot ? slotPrice(shopSlots(save).left) : product?.price ?? null; // 파티 칸은 적용한 프리셋의 칸이다
  if (price === null) return { price, many: false, room: 0, reason: slot ? "no-locked-slot" : "no-product" };
  const many = product?.kind === "egg" || product?.kind === "tool";
  const byPoints = price > 0 ? Math.floor(save.points.balance / price) : Number.MAX_SAFE_INTEGER;
  const fail = (reason: BuyFailure): BuyState => ({ price, many, room: 0, reason });
  if (byPoints < 1) return fail("not-enough-points");
  if (product?.kind === "egg") {
    const can = checkGiveEgg(save, product.ref, opts);
    if (!can.ok) return fail(can.reason);
    return { price, many, room: Math.min(byPoints, eggRoomOf(save, product.ref, opts)) };
  }
  if (product?.kind === "species") {
    if (!hasUnlocked(save, product.ref)) return fail("not-unlocked");
    if (!checkNewPetRoom(save, "party-first").ok) return fail("box-full");
  }
  if (product?.kind === "tool") {
    const bag = bagRoomOf(save, product.ref);
    if (bag < 1) return fail("bag-full");
    return { price, many, room: Math.min(byPoints, bag) };
  }
  return { price, many, room: 1 };
}

export function buyProduct(save: SaveV3, productId: string, now: number, rand: Rand, opts?: DexOptions): BuyResult {
  if (productId === "party-preset") return buyPreset(save);
  if (productId === "box") return buyBox(save);
  const slot = productId === "party-slot";
  const product = slot ? null : findProduct(productId, opts);

  // 검사 — 값을 바꾸기 전에 모두 본다
  const state = buyStateOf(save, productId, opts);
  if (state.reason) return { ok: false, reason: state.reason };
  const price = state.price ?? 0;

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
