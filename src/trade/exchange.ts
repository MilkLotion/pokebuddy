// 친구 교환의 규칙(저장 사본만 고친다) — 서버 호출은 src/online/trade-net.ts, 진행은 src/online/trade-session.ts. 설계는 worklog/records/trade/trade.md "교환 규칙", "개체에서 옮기는 값", "검사", "로컬 저장과 복구"
//
// 순수 함수다. 저장 사본을 고치고 결과만 돌려준다. 서버와 파일은 모른다.
//   올리기    내 개체의 값을 TradePet 으로 만든다(checkOffer · offerOf). 단일 포켓몬은 올리지 못한다. 지문(refOf)을 함께 보낸다
//   받기 검사 친구가 올린 값을 검사한다. 규칙 밖이면 확정할 수 없다
//   잠그기    확정할 때 pending 을 남긴다. 걸린 개체는 값을 바꾸는 명령(진화·가방 사용·모습)을 거절한다
//   반영      서버가 완료를 알리면 한 번의 저장으로 맞바꾸고 pending 을 지운다. pending 이 없으면 아무것도 하지 않는다
// 받은 개체는 보낸 개체가 있던 자리(파티 칸 또는 박스 칸)에 들어간다. 그래서 개체 수와 칸 수가 바뀌지 않는다.
import { isSinglePet } from "../dex/forms.js";
import { pendingTradeOf } from "../party/pet-actions.js";
import { expForLevel, growthOf, levelFor, MAX_LEVEL } from "../dex/growth.js";
import { fixedGender, isGender, legacyGender } from "../dex/gender.js";
import { isNatureId } from "../dex/natures.js";
import { hasProfile } from "../dex/species.js";
import { slotsOfPreset } from "../party/presets.js";
import { locatePet } from "../party/locate.js";
import { newPet, nextPetId } from "../party/create.js";
import { recordDex } from "../dex/record.js";
import { dropMissingBattlePets } from "../battle/party.js";
import { snapSize } from "../party/size.js";
import type { DexOptions } from "../dex/data";
import type { Gender, NatureId } from "../shared/species";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

// 교환으로 옮기는 값. 나머지(쿨타임·버프·위치·하루 기록)는 받는 쪽에서 처음 값으로 둔다
export interface TradePet {
  species: string;
  shiny: boolean;
  nature: NatureId;
  gender?: Gender; // 2026-09-30 에 더했다. 옛 판 앱은 보내지 않는다 — 받는 쪽이 정한다 (apply)
  size: number;
  level: number;
  exp: number;
  affinity: number;
  fullness: number;
  // 옛 판 앱이 검사하는 자리 — 2026-10-05 기분을 없앤 뒤에도 보낸다(늘 60). 받을 때는 쓰지 않는다. 받은 개체의 심심함은 0 이다
  mood?: number;
  stage: number;
  evolved: string[];
}

export type OfferFailure = ReasonOf<"no-pet" | "single" | "locked">;
export type ReceiveFailure = "not-object" | "unknown-species" | "single" | "bad-level" | "bad-value" | "bad-nature";
export type LockFailure = OfferFailure | "busy";


const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

// 올릴 수 있는가
export function checkOffer(save: SaveV3, petId: string, opts?: DexOptions): { ok: true; pet: PetV3 } | { ok: false; reason: OfferFailure } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (isSinglePet(pet, opts)) return { ok: false, reason: "single" };
  const pending = pendingTradeOf(save);
  if (pending && pending.petId !== petId) return { ok: false, reason: "locked" };
  return { ok: true, pet };
}

// 옛 판 앱(기분이 있던)이 받는 값 — 그 앱의 새 개체 기분 시작값과 같다
const TRADE_LEGACY_MOOD = 60;

// 올릴 값
export function offerOf(pet: PetV3): TradePet {
  return {
    species: pet.species,
    shiny: pet.shiny,
    nature: pet.nature,
    gender: pet.gender,
    size: pet.size,
    level: pet.level,
    exp: pet.exp,
    affinity: pet.affinity,
    fullness: pet.fullness,
    mood: TRADE_LEGACY_MOOD,
    stage: pet.stage,
    evolved: [...pet.evolved],
  };
}

// 제안한 개체의 지문 — 서버가 내 서버 저장에서 그 개체를 찾고 교환 원장과 대조한다 (worklog-mac/records/cloud-authority/design-p2.md 4절)
//   개체 ID 는 저장마다 따로 매기므로 만든 시각(since, 정수 ms)을 함께 보낸다. 진화해도 둘 다 바뀌지 않는다
export interface PetRef {
  id: string;
  since: number;
}

export const refOf = (pet: Pick<PetV3, "id" | "since">): PetRef => ({ id: pet.id, since: pet.since });

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
      || !intIn(raw.affinity, 0, 100) || !intIn(raw.fullness, 0, 100) || (raw.mood !== undefined && !intIn(raw.mood, 0, 100))
      || !intIn(raw.stage, 0, 10) || !intIn(raw.exp, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "bad-value" };
  }
  // 성별 — 한 성별 종이면 그 성별로 맞춘다. 모르는 값이면 두지 않는다
  const gender = fixedGender(species, opts) ?? (isGender(raw.gender) && raw.gender !== "none" ? raw.gender : undefined);
  // 레벨과 경험치가 어긋나면 레벨을 믿고 경험치를 그 레벨의 시작으로 맞춘다
  const rate = growthOf(species, opts);
  const exp = levelFor(rate, raw.exp) === raw.level ? raw.exp : expForLevel(rate, raw.level);
  return {
    ok: true,
    pet: {
      species, shiny: raw.shiny, nature: raw.nature as NatureId, ...(gender ? { gender } : {}), size: snapSize(raw.size), level: raw.level, exp, // 크기는 도트 배율 — 가장 가까운 단계로 맞춘다
      affinity: raw.affinity, fullness: raw.fullness, stage: raw.stage, evolved: [...(evolved as string[])],
    },
  };
}

// 확정할 때 잠근다. 같은 채널·같은 개체면 판 번호만 바꾼다
export function lockTrade(save: SaveV3, channelId: string, petId: string, offerRev: number, opts?: DexOptions): { ok: true } | { ok: false; reason: LockFailure } {
  const pending = pendingTradeOf(save);
  if (pending && pending.channelId !== channelId) return { ok: false, reason: "busy" };
  const res = checkOffer(save, petId, opts);
  if (!res.ok) return res;
  save.trade = { pending: { channelId, petId, offerRev, received: pending?.received ?? null } };
  return { ok: true };
}

// 취소·만료·확정 풀기. 다른 채널의 pending 은 건드리지 않는다
export function unlockTrade(save: SaveV3, channelId: string): boolean {
  const pending = pendingTradeOf(save);
  if (!pending || pending.channelId !== channelId) return false;
  save.trade = { pending: null };
  return true;
}

// 받은 개체가 들어간 자리 — party 는 적용한 프리셋의 칸, preset 은 그 밖의 프리셋의 칸
export type TradeWhere = { party: number } | { preset: number; slot: number } | { box: number; slot: number };

export type ApplyResult =
  | { ok: true; applied: false }
  | { ok: true; applied: true; newPetId: string; where: TradeWhere }
  | { ok: false; reason: "bad-received" | "no-pet" };

// 서버가 완료를 알렸다. 보낸 개체를 빼고 받은 개체를 그 자리에 넣는다. 도감에 기록한다
export function applyTrade(save: SaveV3, channelId: string, received: unknown, now: number, opts?: DexOptions): ApplyResult {
  const pending = pendingTradeOf(save);
  if (!pending || pending.channelId !== channelId) return { ok: true, applied: false }; // 이미 반영했다
  const check = validateReceived(received, opts);
  if (!check.ok) return { ok: false, reason: "bad-received" };
  const sentIndex = save.pets.findIndex((p) => p.id === pending.petId);
  if (sentIndex < 0) return { ok: false, reason: "no-pet" };

  const got = check.pet;
  const id = nextPetId(save); // 보낸 개체를 빼기 전에 정한다 — 같은 번호를 다시 쓰지 않는다
  const pet: PetV3 = {
    ...newPet({ id, species: got.species, shiny: got.shiny, nature: got.nature, gender: got.gender ?? legacyGender({ id, species: got.species, since: now }, opts), now }),
    size: got.size, level: got.level, exp: got.exp, affinity: got.affinity,
    fullness: got.fullness, stage: got.stage, evolved: [...got.evolved],
  };

  // 받은 개체는 보낸 개체의 자리를 물려받는다 — 적용한 프리셋(파티), 다른 프리셋, 박스 (src/party/presets.ts locatePet)
  let where: TradeWhere | null = null;
  const place = locatePet(save, pending.petId);
  if (place?.kind === "preset") {
    const slot = slotsOfPreset(save, place.preset)?.[place.slot];
    if (slot) {
      slot.petId = id; // 숨김 상태는 그대로 둔다
      where = place.active ? { party: place.slot } : { preset: place.preset, slot: place.slot };
    }
  } else if (place?.kind === "box") {
    const box = save.boxes[place.box];
    if (box) {
      box.slots[place.slot] = id;
      where = { box: place.box, slot: place.slot };
    }
  }
  if (!where) return { ok: false, reason: "no-pet" };

  save.pets.splice(sentIndex, 1, pet);
  dropMissingBattlePets(save); // 보낸 개체의 배틀 파티 칸은 빈 칸이 된다 — 받은 개체는 물려받지 않는다
  if (save.starterPetId === pending.petId) save.starterPetId = null;
  recordDex(save, pet.species, pet.shiny);
  save.counts.traded += 1; // 교환 업적이 센다
  save.trade = { pending: null };
  return { ok: true, applied: true, newPetId: id, where };
}
