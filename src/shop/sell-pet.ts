// 포켓몬 판매 — 규칙은 docs/specs/game.md "포켓몬 판매", 판매가는 docs/specs/balance.md "가격표"
//
// 판매가 = 그 종이 나오는 알의 값 × SHOP_V3_RULES.petSellRate, petSellUnit 단위로 내림.
// 종은 그 개체의 진화 계열 맨 앞 종으로 본다. 레벨·이로치·성별은 값에 넣지 않는다.
// 팔지 않는 개체: 단일 포켓몬(공유 sid 계열 포함), 어느 알에도 없는 종, 교환에 올린 개체, 마지막 한 마리.
// 파티 개체도 박스 개체도 판다. 판 파티 칸은 빈 칸이 된다. 도감 기록은 지우지 않는다.
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다
import { takePet } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { prevOf } from "../dex/evo.js";
import { maxPetNo } from "../party/create.js";
import { SHOP_V3_RULES } from "../save/rules.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { isLocked, isSinglePet } from "../trade/core.js";
import { eggOfSpecies, eggPrice } from "./catalog.js";

export type SellPetFailure =
  | "no-pet" // 그런 개체가 없다
  | "pet-not-sellable" // 단일 포켓몬이거나 어느 알에도 없는 종이다
  | "trade-locked" // 교환에 올린 개체다
  | "last-pet"; // 가진 개체가 한 마리뿐이다

export interface SellPetResult {
  ok: boolean;
  reason?: SellPetFailure;
  petId?: string;
  species?: string;
  earned?: number; // 받은 포인트
  balance?: number;
  slotIndex?: number; // 파티 개체였으면 비운 칸 번호
}

const CHAIN_MAX = 8; // 진화 계열을 거슬러 오르는 횟수의 상한 — 데이터가 돌아도 멈춘다

// 진화 계열 맨 앞 종 — 진화 이력의 첫 종에서 진화 전 종을 더 거슬러 오른다(우편·교환으로 받은 진화형)
function rootSpecies(pet: Pick<PetV3, "species" | "evolved">, opts?: DexOptions): string {
  let slug = pet.evolved[0] ?? pet.species;
  for (let i = 0; i < CHAIN_MAX; i += 1) {
    const prev = prevOf(slug, opts);
    if (!prev) break;
    slug = prev;
  }
  return slug;
}

// 개체 하나의 판매가 — 팔 수 없는 종이면 null. 교환 잠금과 마지막 한 마리는 sellPet 이 본다
export function petSellPrice(pet: Pick<PetV3, "species" | "evolved">, opts?: DexOptions): number | null {
  if (isSinglePet(pet, opts)) return null;
  const kind = eggOfSpecies(rootSpecies(pet, opts), opts);
  const price = kind ? eggPrice(kind, opts) : null;
  if (price === null || price <= 0) return null;
  const { petSellRate, petSellUnit } = SHOP_V3_RULES;
  const each = Math.floor((price * petSellRate) / petSellUnit) * petSellUnit;
  return each > 0 ? each : null;
}

// 팔 수 있는가 — 화면이 `팔기` 줄을 켤지 정할 때도 쓴다
export function sellablePet(save: SaveV3, petId: string, opts?: DexOptions): { ok: true; pet: PetV3; price: number } | { ok: false; reason: SellPetFailure } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  const price = petSellPrice(pet, opts);
  if (price === null) return { ok: false, reason: "pet-not-sellable" };
  if (isLocked(save, petId)) return { ok: false, reason: "trade-locked" };
  if (save.pets.length <= 1) return { ok: false, reason: "last-pet" };
  return { ok: true, pet, price };
}

export function sellPet(save: SaveV3, petId: string, opts?: DexOptions): SellPetResult {
  const res = sellablePet(save, petId, opts);
  if (!res.ok) return { ok: false, reason: res.reason };

  const slotIndex = save.party.slots.findIndex((s) => s.state === "pokemon" && s.petId === petId);
  if (slotIndex >= 0) save.party.slots[slotIndex] = { state: "empty" };
  else takePet(save.boxes, petId);
  save.petSeq = Math.max(save.petSeq ?? 0, maxPetNo(save.pets)); // 판 개체의 번호를 새 개체가 다시 쓰지 않게 — 서버 검증의 pet-id 규칙
  save.pets.splice(save.pets.indexOf(res.pet), 1);
  if (save.starterPetId === petId) save.starterPetId = null;
  save.points.balance += res.price;
  return { ok: true, petId, species: res.pet.species, earned: res.price, balance: save.points.balance, ...(slotIndex >= 0 ? { slotIndex } : {}) };
}
