// 상점 구매 — 규칙은 docs/specs/game.md "상점", 가격은 docs/specs/balance.md
//
// 한 거래로 검사와 반영을 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다.
//   알      돌보미집에 빈 칸이 있어야 한다. 사면 바로 들어가고 준비 시간이 시작된다
//   도구    가방에 쌓는다. 칸 수 제한은 없다
//   파티 칸 상점으로 여는 칸이 남아 있어야 한다. 값은 순서마다 다르다
//   종      해금한 종만 산다. 새 개체는 빈 파티 칸에 꺼낸 상태로, 없으면 박스로
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { putPet } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { randomNature } from "../dex/natures.js";
import { newPet, nextPetId, recordDex } from "../party/create.js";
import { openSlot } from "../party/slots.js";
import type { Rand } from "../egg/hatch";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules.js";
import { maxEggNo } from "../save/v3.js";
import type { EggV3, SaveV3 } from "../shared/save-v3";
import { canGiveEgg, eggPool, find, inRandomEgg, isSingleEgg, singleLeft, slotPrice } from "./catalog.js";

export type BuyFailure =
  | "no-product" // 그런 상품이 없다
  | "not-enough" // 포인트가 모자라다
  | "daycare-full" // 돌보미집이 가득 찼다
  | "bag-full" // 그 도구가 가방에 이미 최대 개수(SHOP_V3_RULES.bagMax)만큼 있다
  | "no-locked-slot" // 상점으로 열 칸이 남지 않았다
  | "not-unlocked" // 해금하지 않은 종이다
  | "sold-out"; // 단일 포켓몬 알인데 남은 종이 없다 (기다리는 같은 알까지 셈)

export interface BuyResult {
  ok: boolean;
  reason?: BuyFailure;
  spent?: number;
  balance?: number;
  eggId?: string;
  petId?: string;
  slotIndex?: number;
  toBox?: boolean;
}

// 다음 알 식별자 — 지금까지 만든 알 수(eggSeq)와 지금 있는 알의 가장 큰 번호 중 큰 것의 다음.
// 연 알의 식별자를 다시 쓰지 않는다. 다시 쓰면 "부화 준비" 배너의 표시 기록이 새 알에 겹쳐 배너가 뜨지 않는다
export function nextEggId(save: SaveV3): string {
  return `e${Math.max(save.eggSeq, maxEggNo(save.eggs)) + 1}`;
}

// 상점으로 이미 연 칸 수 — 남은 잠긴 칸으로 센다
const boughtSlots = (save: SaveV3): number =>
  SAVE_V3_RULES.party.shopUnlock - save.party.slots.filter((s) => s.state === "locked" && s.unlockBy === "shop").length;

// 새 개체를 파티나 박스에 넣는다
function placeNew(save: SaveV3, petId: string): { slotIndex?: number; toBox: boolean } {
  const i = save.party.slots.findIndex((s) => s.state === "empty");
  if (i >= 0) {
    save.party.slots[i] = { state: "pokemon", petId, hidden: false };
    return { slotIndex: i, toBox: false };
  }
  putPet(save.boxes, petId);
  return { toBox: true };
}

// 새 알 하나 — 후보는 이 순간에 정해 저장한다 (docs/specs/game.md "알 결과 저장"). 저장에 넣는 것은 부르는 쪽이다
//   단일 포켓몬 알   아직 얻지 않은 종
//   종 목록 알       그 목록
//   랜덤알           해금한 종 가운데 랜덤알에서 나올 수 있는 종
export function newEgg(save: SaveV3, kind: string, now: number, opts?: DexOptions): EggV3 {
  const id = nextEggId(save);
  save.eggSeq = Number(id.slice(1)); // 번호는 여기서 쓴 것으로 센다 — 알을 저장에 넣는 것은 부르는 쪽이다
  return {
    id,
    kind,
    boughtAt: now,
    remainMs: EGG_V3_RULES.readyMs,
    ready: false,
    candidates: isSingleEgg(kind, opts) ? singleLeft(save, kind, opts) : eggPool(kind, opts) ?? randomPool(save, opts),
    careCooldownMs: 0,
    actions: { pat: 0, song: 0 },
  };
}

// 랜덤알 후보 — 해금한 종 가운데 랜덤알에서 나올 수 있는 종 (규칙은 src/shop/catalog.ts inRandomEgg)
export function randomPool(save: SaveV3, opts?: DexOptions): string[] {
  const pool = save.dex.unlocked.filter((slug) => inRandomEgg(slug, opts));
  return pool.length ? pool : [...save.dex.unlocked];
}

export function buy(save: SaveV3, productId: string, now: number, rand: Rand, opts?: DexOptions): BuyResult {
  const slot = productId === "party-slot";
  const product = slot ? null : find(productId, opts);
  const price = slot ? slotPrice(boughtSlots(save)) : product?.price ?? null;

  if (price === null) return { ok: false, reason: slot ? "no-locked-slot" : "no-product" };
  if (save.points.balance < price) return { ok: false, reason: "not-enough" };

  // 검사 — 값을 바꾸기 전에 모두 본다
  if (product?.kind === "egg" && save.eggs.length >= EGG_V3_RULES.maxEggs) return { ok: false, reason: "daycare-full" };
  if (product?.kind === "egg" && !canGiveEgg(save, product.ref, opts)) return { ok: false, reason: "sold-out" };
  if (product?.kind === "species" && !save.dex.unlocked.includes(product.ref)) return { ok: false, reason: "not-unlocked" };
  if (product?.kind === "tool" && (save.bag[product.ref] ?? 0) >= SHOP_V3_RULES.bagMax) return { ok: false, reason: "bag-full" };

  save.points.balance -= price;
  const done: BuyResult = { ok: true, spent: price, balance: save.points.balance };

  if (slot) {
    const i = openSlot(save.party.slots, "shop"); // 칸 +1 — 첫 잠긴 칸을 연다
    return { ...done, slotIndex: i };
  }

  if (product?.kind === "egg") {
    const egg = newEgg(save, product.ref, now, opts);
    save.eggs.push(egg);
    return { ...done, eggId: egg.id };
  }

  if (product?.kind === "tool") {
    save.bag[product.ref] = (save.bag[product.ref] ?? 0) + 1;
    return done;
  }

  // 종 지정 구매 — 새 개체를 만든다
  const id = nextPetId(save);
  const pet = newPet({ id, species: product?.ref ?? productId, shiny: false, nature: randomNature(rand, opts).id, now });
  save.pets.push(pet);
  recordDex(save, pet.species, pet.shiny);
  const where = placeNew(save, id);
  return { ...done, petId: id, ...where };
}
