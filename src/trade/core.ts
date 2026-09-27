// 친구 교환의 규칙 — 설계는 worklog/records/trade/record.md "교환 규칙", "개체에서 옮기는 값", "검사", "로컬 저장과 복구"
//
// 순수 함수다. 저장 사본을 고치고 결과만 돌려준다. 서버와 파일은 모른다.
//   올리기    내 개체의 값을 TradePet 으로 만든다. 단일 포켓몬은 올리지 못한다
//   받기 검사 친구가 올린 값을 검사한다. 규칙 밖이면 확정할 수 없다
//   잠그기    확정할 때 pending 을 남긴다. 걸린 개체는 값을 바꾸는 명령(진화·가방 사용·모습)을 거절한다
//   반영      서버가 완료를 알리면 한 번의 저장으로 맞바꾸고 pending 을 지운다. pending 이 없으면 아무것도 하지 않는다
// 받은 개체는 보낸 개체가 있던 자리(파티 칸 또는 박스 칸)에 들어간다. 그래서 개체 수와 칸 수가 바뀌지 않는다.
import { isShared } from "../dex/forms.js";
import { expForLevel, growthOf, levelFor, MAX_LEVEL } from "../dex/growth.js";
import { isNatureId } from "../dex/natures.js";
import { hasProfile } from "../dex/species.js";
import { findPet } from "../box/slots.js";
import { fixedEggs, isSingleEgg } from "../shop/catalog.js";
import { newPet, nextPetId, recordDex } from "../party/create.js";
import { snapSize } from "../save/rules.js";
import type { DexOptions } from "../dex/data";
import type { NatureId } from "../shared/types";
import type { PetV3, SaveV3, TradePendingV3 } from "../shared/save-v3";

// 교환으로 옮기는 값. 나머지(쿨타임·버프·위치·하루 기록)는 받는 쪽에서 처음 값으로 둔다
export interface TradePet {
  species: string;
  shiny: boolean;
  nature: NatureId;
  size: number;
  level: number;
  exp: number;
  affinity: number;
  fullness: number;
  mood: number;
  stage: number;
  evolved: string[];
}

export type OfferFailure = "no-pet" | "single" | "locked";
export type ReceiveFailure = "not-object" | "unknown-species" | "single" | "bad-level" | "bad-value" | "bad-nature";
export type LockFailure = OfferFailure | "busy";


const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

// 단일 포켓몬 알에 든 종 — 이 종을 거쳐 왔거나 지금 이 종이면 단일 포켓몬이다
function singleSpecies(opts?: DexOptions): Set<string> {
  const out = new Set<string>();
  for (const [kind, pool] of fixedEggs(opts)) if (isSingleEgg(kind, opts)) for (const slug of pool) out.add(slug);
  return out;
}

// 단일 포켓몬인가 — 공유 sid 계열도 단일 포켓몬 판정을 따른다 (사용자 결정 2026-09-26: 교환 불가)
export function isSinglePet(pet: Pick<PetV3, "species" | "evolved">, opts?: DexOptions): boolean {
  const singles = singleSpecies(opts);
  if ([...pet.evolved, pet.species].some((s) => singles.has(s))) return true;
  return isShared({ ...(pet as PetV3), evolved: pet.evolved }, opts);
}

export const pendingOf = (save: SaveV3): TradePendingV3 | null => save.trade?.pending ?? null;

// 교환에 걸려 값을 바꾸면 안 되는 개체인가
export const isLocked = (save: SaveV3, petId: string): boolean => pendingOf(save)?.petId === petId;

// 올릴 수 있는가
export function offerable(save: SaveV3, petId: string, opts?: DexOptions): { ok: true; pet: PetV3 } | { ok: false; reason: OfferFailure } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (isSinglePet(pet, opts)) return { ok: false, reason: "single" };
  const pending = pendingOf(save);
  if (pending && pending.petId !== petId) return { ok: false, reason: "locked" };
  return { ok: true, pet };
}

// 올릴 값
export function snapshot(pet: PetV3): TradePet {
  return {
    species: pet.species,
    shiny: pet.shiny,
    nature: pet.nature,
    size: pet.size,
    level: pet.level,
    exp: pet.exp,
    affinity: pet.affinity,
    fullness: pet.fullness,
    mood: pet.mood,
    stage: pet.stage,
    evolved: [...pet.evolved],
  };
}

// 친구가 올린 값 검사. 친구 사이라 조작을 완전히 막지는 않는다. 깨진 값과 규칙 밖 개체를 거른다
export function validateReceived(raw: unknown, opts?: DexOptions): { ok: true; pet: TradePet } | { ok: false; reason: ReceiveFailure } {
  if (!isObj(raw)) return { ok: false, reason: "not-object" };
  const species = raw.species;
  const evolved = raw.evolved;
  if (typeof species !== "string" || !hasProfile(species, opts)) return { ok: false, reason: "unknown-species" };
  if (!Array.isArray(evolved) || !evolved.every((s) => typeof s === "string" && hasProfile(s, opts))) return { ok: false, reason: "unknown-species" };
  if (isSinglePet({ species, evolved: evolved as string[] }, opts)) return { ok: false, reason: "single" };
  if (!intIn(raw.level, 1, MAX_LEVEL)) return { ok: false, reason: "bad-level" };
  if (typeof raw.nature !== "string" || !isNatureId(raw.nature, opts)) return { ok: false, reason: "bad-nature" };
  if (typeof raw.shiny !== "boolean" || typeof raw.size !== "number" || !Number.isFinite(raw.size)
      || !intIn(raw.affinity, 0, 100) || !intIn(raw.fullness, 0, 100) || !intIn(raw.mood, 0, 100)
      || !intIn(raw.stage, 0, 10) || !intIn(raw.exp, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "bad-value" };
  }
  // 레벨과 경험치가 어긋나면 레벨을 믿고 경험치를 그 레벨의 시작으로 맞춘다
  const rate = growthOf(species, opts);
  const exp = levelFor(rate, raw.exp) === raw.level ? raw.exp : expForLevel(rate, raw.level);
  return {
    ok: true,
    pet: {
      species, shiny: raw.shiny, nature: raw.nature as NatureId, size: snapSize(raw.size), level: raw.level, exp, // 크기는 도트 배율 — 가장 가까운 단계로 맞춘다
      affinity: raw.affinity, fullness: raw.fullness, mood: raw.mood, stage: raw.stage, evolved: [...(evolved as string[])],
    },
  };
}

// 확정할 때 잠근다. 같은 채널·같은 개체면 판 번호만 바꾼다
export function lock(save: SaveV3, channelId: string, petId: string, offerRev: number, opts?: DexOptions): { ok: true } | { ok: false; reason: LockFailure } {
  const pending = pendingOf(save);
  if (pending && pending.channelId !== channelId) return { ok: false, reason: "busy" };
  const res = offerable(save, petId, opts);
  if (!res.ok) return res;
  save.trade = { pending: { channelId, petId, offerRev, received: pending?.received ?? null } };
  return { ok: true };
}

// 취소·만료·확정 풀기. 다른 채널의 pending 은 건드리지 않는다
export function unlock(save: SaveV3, channelId: string): boolean {
  const pending = pendingOf(save);
  if (!pending || pending.channelId !== channelId) return false;
  save.trade = { pending: null };
  return true;
}

export type ApplyResult =
  | { ok: true; applied: false }
  | { ok: true; applied: true; newPetId: string; where: { party: number } | { box: number; slot: number } }
  | { ok: false; reason: "bad-received" | "no-pet" };

// 서버가 완료를 알렸다. 보낸 개체를 빼고 받은 개체를 그 자리에 넣는다. 도감에 기록한다
export function apply(save: SaveV3, channelId: string, received: unknown, now: number, opts?: DexOptions): ApplyResult {
  const pending = pendingOf(save);
  if (!pending || pending.channelId !== channelId) return { ok: true, applied: false }; // 이미 반영했다
  const check = validateReceived(received, opts);
  if (!check.ok) return { ok: false, reason: "bad-received" };
  const sentIndex = save.pets.findIndex((p) => p.id === pending.petId);
  if (sentIndex < 0) return { ok: false, reason: "no-pet" };

  const got = check.pet;
  const id = nextPetId(save); // 보낸 개체를 빼기 전에 정한다 — 같은 번호를 다시 쓰지 않는다
  const pet: PetV3 = {
    ...newPet({ id, species: got.species, shiny: got.shiny, nature: got.nature, now }),
    size: got.size, level: got.level, exp: got.exp, affinity: got.affinity,
    fullness: got.fullness, mood: got.mood, stage: got.stage, evolved: [...got.evolved],
  };

  let where: { party: number } | { box: number; slot: number } | null = null;
  const partyIndex = save.party.slots.findIndex((s) => s.state === "pokemon" && s.petId === pending.petId);
  if (partyIndex >= 0) {
    const slot = save.party.slots[partyIndex];
    if (slot) slot.petId = id; // 숨김 상태는 그대로 둔다
    where = { party: partyIndex };
  } else {
    const spot = findPet(save.boxes, pending.petId);
    const box = spot ? save.boxes[spot.boxIndex] : undefined;
    if (spot && box) {
      box.slots[spot.slotIndex] = id;
      where = { box: spot.boxIndex, slot: spot.slotIndex };
    }
  }
  if (!where) return { ok: false, reason: "no-pet" };

  save.pets.splice(sentIndex, 1, pet);
  if (save.starterPetId === pending.petId) save.starterPetId = null;
  recordDex(save, pet.species, pet.shiny);
  save.trade = { pending: null };
  return { ok: true, applied: true, newPetId: id, where };
}
