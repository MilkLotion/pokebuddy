// 포켓몬 판매 — 규칙은 docs/specs/game.md "포켓몬 판매", 판매가는 docs/specs/balance.md "가격표"
//
// 판매가 = 그 종이 나오는 알의 값 × SHOP_RULES.petSellRate, petSellUnit 단위로 내림.
// 종은 그 개체의 진화 계열 맨 앞 종으로 본다. 레벨·이로치·성별은 값에 넣지 않는다.
// 팔지 않는 개체: 단일 포켓몬(공유 sid 계열 포함), 어느 알에도 없는 종, 교환에 올린 개체, 마지막 한 마리, 파티 프리셋에 든 개체.
// 박스 개체만 판다 (2026-10-02 사용자 결정 — 그 전에는 파티 개체도 팔았다). 도감 기록은 지우지 않는다.
// 중복 팔기 — 같은 종에서 한 마리를 남기고 나머지를 한 거래에서 판다 (2026-10-05 사용자 결정, docs/specs/game.md "중복 팔기")
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다
import { takePet } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { prevOf } from "../dex/evo.js";
import { regionalOf } from "../dex/regional.js";
import { maxIdNo } from "../shared/ids.js";
import { locatePet } from "../party/locate.js";
import { isInBattle } from "../battle/party.js";
import { allPresets } from "../party/presets.js";
import { SHOP_RULES } from "./rules.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { isSinglePet } from "../dex/forms.js";
import { checkPetFree } from "../party/pet-actions.js";
import { eggPrice } from "./catalog.js";
import { eggOfSpecies } from "../dex/obtain.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type SellPetFailure = ReasonOf<
  | "no-pet" // 그런 개체가 없다
  | "pet-not-sellable" // 단일 포켓몬이거나 어느 알에도 없는 종이다
  | "trade-locked" // 교환에 올린 개체다
  | "last-pet" // 가진 개체가 한 마리뿐이다
  | "in-preset" // 파티 프리셋에 든 개체다
  | "in-battle" // 배틀 파티에 든 개체다
>;

export type SellPetResult = Outcome<SellPetFailure> & {
  petId?: string;
  species?: string;
  earned?: number; // 받은 포인트
  balance?: number;
};

const CHAIN_MAX = 8; // 진화 계열을 거슬러 오르는 횟수의 상한 — 데이터가 돌아도 멈춘다

// 진화 계열 맨 앞 종 — 진화 이력의 첫 종에서 진화 전 종을 더 거슬러 오른다(우편·교환으로 받은 진화형)
// 한 방향 모습(플라엣테(영원의 꽃)·다투곰(붉은 달), get tool)은 기본 종에서 시작한다 — 판매가는 기본 종과 같다 (2026-10-08)
function rootSpecies(pet: Pick<PetV3, "species" | "evolved">, opts?: DexOptions): string {
  const first = pet.evolved[0] ?? pet.species;
  const form = regionalOf(first, opts);
  let slug = form?.get === "tool" ? form.base : first;
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
  const { petSellRate, petSellUnit } = SHOP_RULES;
  const each = Math.floor((price * petSellRate) / petSellUnit) * petSellUnit;
  return each > 0 ? each : null;
}

// 팔 수 있는가 — 화면이 `팔기` 줄을 켤지 정할 때도 쓴다
export function sellablePet(save: SaveV3, petId: string, opts?: DexOptions): { ok: true; pet: PetV3; price: number } | { ok: false; reason: SellPetFailure } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  const price = petSellPrice(pet, opts);
  if (price === null) return { ok: false, reason: "pet-not-sellable" };
  const free = checkPetFree(save, petId, "sell");
  if (!free.ok) return { ok: false, reason: free.reason };
  if (save.pets.length <= 1) return { ok: false, reason: "last-pet" };
  // 프리셋에 든 개체는 팔지 않는다 — 적용한 프리셋(지금 파티)도 같다. 박스로 뺀 뒤 판다 (2026-10-02 사용자 결정)
  if (locatePet(save, petId)?.kind === "preset") return { ok: false, reason: "in-preset" };
  // 배틀 파티에 든 개체도 팔지 않는다 — 배틀 파티에서 뺀 뒤 판다 (docs/specs/adventure.md "배틀 파티")
  if (isInBattle(save, petId)) return { ok: false, reason: "in-battle" };
  return { ok: true, pet, price };
}

export function sellPet(save: SaveV3, petId: string, opts?: DexOptions): SellPetResult {
  const res = sellablePet(save, petId, opts);
  if (!res.ok) return { ok: false, reason: res.reason };

  takePet(save.boxes, petId); // 팔 수 있는 개체는 박스에만 있다
  save.petSeq = Math.max(save.petSeq ?? 0, maxIdNo(save.pets, "p")); // 판 개체의 번호를 새 개체가 다시 쓰지 않게 — 서버 검증의 pet-id 규칙
  save.pets.splice(save.pets.indexOf(res.pet), 1);
  if (save.starterPetId === petId) save.starterPetId = null;
  save.points.balance += res.price;
  return { ok: true, petId, species: res.pet.species, earned: res.price, balance: save.points.balance };
}

// 남길 개체의 순서 — 이로치 > 레벨 > 친밀도 > 먼저 얻은 개체 (2026-10-05 사용자 결정 "같은 종 1마리 남김")
const keepFirst = (a: PetV3, b: PetV3): number =>
  Number(b.shiny) - Number(a.shiny) || b.level - a.level || b.affinity - a.affinity || a.since - b.since;

// 중복 팔기 후보 — 박스 순서대로. 같은 종(모습 포함, species 값)을 묶는다.
//   그 종이 파티 프리셋에 있으면 박스의 그 종은 모두 후보다
//   프리셋에 없으면 박스에서 한 마리를 남긴다(keepFirst 의 맨 앞)
//   이로치는 후보가 아니다. 팔 수 없는 개체(sellablePet 이 거절)도 후보가 아니다
export function duplicateCandidates(save: SaveV3, opts?: DexOptions): { petId: string; price: number }[] {
  const inPreset = new Set<string>();
  for (const { slots } of allPresets(save)) {
    for (const s of slots) {
      const species = s.petId ? save.pets.find((p) => p.id === s.petId)?.species : undefined;
      if (species) inPreset.add(species);
    }
  }
  const boxed: PetV3[] = [];
  for (const box of save.boxes) {
    for (const id of box.slots) {
      const pet = id ? save.pets.find((p) => p.id === id) : undefined;
      if (pet) boxed.push(pet);
    }
  }
  const keep = new Set<string>();
  const bySpecies = new Map<string, PetV3[]>();
  for (const pet of boxed) bySpecies.set(pet.species, [...(bySpecies.get(pet.species) ?? []), pet]);
  for (const [species, pets] of bySpecies) {
    if (inPreset.has(species)) continue;
    const best = [...pets].sort(keepFirst)[0];
    if (best) keep.add(best.id);
  }
  const out: { petId: string; price: number }[] = [];
  for (const pet of boxed) {
    if (keep.has(pet.id) || pet.shiny) continue;
    const res = sellablePet(save, pet.id, opts);
    if (res.ok) out.push({ petId: pet.id, price: res.price });
  }
  return out;
}

export type SellPetsResult = Outcome<SellPetFailure | ReasonOf<"bad-args">> & {
  petId?: string; // 거절한 개체
  count?: number;
  earned?: number;
  balance?: number;
};

// 여러 마리를 한 거래에서 판다. 하나라도 팔 수 없으면 거절한다 — 거래 실행기가 바꾼 사본을 버린다 (가방 판매와 같은 원칙).
// 규칙은 한 마리 판매(sellPet)와 같다
export function sellPets(save: SaveV3, petIds: string[], opts?: DexOptions): SellPetsResult {
  const ids = [...new Set(petIds)];
  if (ids.length === 0) return { ok: false, reason: "bad-args" };
  let earned = 0;
  for (const id of ids) {
    const res = sellPet(save, id, opts);
    if (!res.ok) return { ok: false, reason: res.reason, petId: id };
    earned += res.earned ?? 0;
  }
  return { ok: true, count: ids.length, earned, balance: save.points.balance };
}
