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
import { maxIdNo } from "../shared/ids.js";
import { recordDex } from "../dex/record.js";
import { dropMissingBattlePets } from "../battle/party.js";
import { megaFormsOf } from "../dex/mega.js";
import { MEGA_RULES } from "../dex/rules.js";
import { snapSize } from "../party/size.js";
import { normalizeSlug, type DexOptions } from "../dex/data.js";
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
  // 메가스톤 — 지닌 개체만. 진행(파티 시간·돌봄 횟수)도 함께 옮겨 받는 쪽 서버 검증이 새 메가스톤으로 보지 않게 한다. 모습(on)은 옮기지 않는다 — 원래 모습으로 받는다
  // (2026-10-11 사용자 "고유개체에 메가진화했냐안했냐로 … 교환해도 유지되게" → B안 "그렇게 진행"). 옛 판 앱은 이 값을 모른다 — 메가스톤 없이 받는다
  mega?: { stone: true; bondMs: number; care: number };
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
    ...(pet.mega?.stone === true ? { mega: { stone: true as const, bondMs: pet.mega.bondMs, care: pet.mega.care } } : {}),
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
  if (typeof raw.species !== "string" || !hasProfile(raw.species, opts)) return { ok: false, reason: "unknown-species" };
  if (!Array.isArray(raw.evolved) || !raw.evolved.every((s) => typeof s === "string" && hasProfile(s, opts))) return { ok: false, reason: "unknown-species" };
  // 종 이름은 정규화해 받는다 — 대문자·`-3d` 를 그대로 저장하면 단일 포켓몬 검사를 피해 갔다 (worklog/records/perf-refactor 5-3, G76-1)
  const species = normalizeSlug(raw.species);
  const evolved = (raw.evolved as string[]).map(normalizeSlug);
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
  // 메가스톤 — 메가 모습이 있는 종이고 조건(레벨·친밀도)을 채웠을 때만 받는다. 모양이 틀리면 메가스톤 없이 받는다(교환 자체는 막지 않는다)
  const m = raw.mega;
  const mega = isObj(m) && m.stone === true && intIn(m.bondMs, 0, MEGA_RULES.bondMs) && intIn(m.care, 0, MEGA_RULES.careMax)
    && megaFormsOf(species, opts).length > 0 && raw.level >= MEGA_RULES.level && (raw.affinity as number) >= MEGA_RULES.affinity
    ? { stone: true as const, bondMs: m.bondMs, care: m.care } : undefined;
  return {
    ok: true,
    pet: {
      species, shiny: raw.shiny, nature: raw.nature as NatureId, ...(gender ? { gender } : {}), size: snapSize(raw.size), level: raw.level, exp, // 크기는 도트 배율 — 가장 가까운 단계로 맞춘다
      affinity: raw.affinity, fullness: raw.fullness, stage: raw.stage, evolved: [...(evolved as string[])],
      ...(mega ? { mega } : {}),
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

// refused — 서버는 교환을 끝냈지만 받은 개체를 넣지 않았다. 잠금은 풀었다 (2026-10-14 사용자 결정 4 "추천대로", worklog/records/perf-refactor 5-4)
//   bad-received  받은 값이 규칙 밖 — 받지 않는다
//   no-room       보낸 개체가 없어 받은 개체를 새로 넣어야 하는데 파티·박스에 빈 칸이 없다
export type ApplyResult =
  | { ok: true; applied: false; refused?: "bad-received" | "no-room" }
  | { ok: true; applied: true; newPetId: string; where: TradeWhere }
  | { ok: false; reason: "no-pet" };

// 서버가 완료를 알렸다. 보낸 개체를 빼고 받은 개체를 그 자리에 넣는다. 도감에 기록한다.
// 반영하지 못해도 잠금은 푼다 — 예전에는 잠금이 남아 앱을 다시 켜도 같은 실패를 되풀이하고 새 교환이 영영 막혔다(G33·G76-4)
export function applyTrade(save: SaveV3, channelId: string, received: unknown, now: number, opts?: DexOptions): ApplyResult {
  const pending = pendingTradeOf(save);
  if (!pending || pending.channelId !== channelId) return { ok: true, applied: false }; // 이미 반영했다
  const check = validateReceived(received, opts);
  if (!check.ok) {
    // 받지 않는다. 보낸 개체는 서버가 이미 상대에게 넘긴 것으로 적었으므로 이 저장에서도 뺀다 — 남기면 클라우드가 올리기를 거절한다(CLOUD_PET_TRADED_OUT)
    // (2026-10-14 사용자 결정 "보낸 포켓몬도 뺀다")
    removeSentPet(save, pending.petId);
    save.trade = { pending: null };
    return { ok: true, applied: false, refused: "bad-received" };
  }
  const sentIndex = save.pets.findIndex((p) => p.id === pending.petId);
  if (sentIndex < 0) return placeReceivedOnly(save, check.pet, now, opts); // 보낸 개체가 이미 없다 — 받은 개체만 넣는다

  const got = check.pet;
  const id = nextPetId(save); // 보낸 개체를 빼기 전에 정한다 — 같은 번호를 다시 쓰지 않는다
  const pet = receivedPetOf(got, id, now, opts);

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
  if (!where) {
    // 보낸 개체가 어느 칸에도 없다 — 서버는 그 개체를 보냈으므로 빼고(번호는 다시 쓰지 않는다), 받은 개체는 빈 칸에 넣는다
    removeSentPet(save, pending.petId);
    return placeReceivedOnly(save, got, now, opts);
  }

  save.pets.splice(sentIndex, 1, pet);
  if (save.starterPetId === pending.petId) save.starterPetId = null;
  finishTrade(save, pet);
  return { ok: true, applied: true, newPetId: id, where };
}

// 보낸 개체를 칸과 저장에서 뺀다 — 받지 않고 끝낸 교환(bad-received). 프리셋 칸은 빈 칸, 박스 칸은 null.
// 뺀 번호는 새 개체가 다시 쓰지 않는다(서버 검증의 pet-id 규칙, src/shop/sell-pet.ts sellPet 과 같다)
function removeSentPet(save: SaveV3, petId: string): void {
  const place = locatePet(save, petId);
  if (place?.kind === "preset") {
    const slots = slotsOfPreset(save, place.preset);
    if (slots?.[place.slot]) slots[place.slot] = { state: "empty" };
  } else if (place?.kind === "box") {
    const box = save.boxes[place.box];
    if (box) box.slots[place.slot] = null;
  }
  const at = save.pets.findIndex((p) => p.id === petId);
  if (at < 0) return;
  save.petSeq = Math.max(save.petSeq ?? 0, maxIdNo(save.pets, "p"));
  save.pets.splice(at, 1);
  if (save.starterPetId === petId) save.starterPetId = null;
  dropMissingBattlePets(save);
}

// 받은 값으로 새 개체를 만든다 — 원래 모습으로 받는다(메가 on 은 두지 않는다)
function receivedPetOf(got: TradePet, id: string, now: number, opts?: DexOptions): PetV3 {
  return {
    ...newPet({ id, species: got.species, shiny: got.shiny, nature: got.nature, gender: got.gender ?? legacyGender({ id, species: got.species, since: now }, opts), now }),
    size: got.size, level: got.level, exp: got.exp, affinity: got.affinity,
    fullness: got.fullness, stage: got.stage, evolved: [...got.evolved],
    ...(got.mega ? { mega: { bondMs: got.mega.bondMs, care: got.mega.care, stone: true } } : {}),
  };
}

// 교환 마무리 — 배틀 파티 정리, 도감, 메가스톤 기록, 교환 수, 잠금 풀기
function finishTrade(save: SaveV3, pet: PetV3): void {
  dropMissingBattlePets(save); // 보낸 개체의 배틀 파티 칸은 빈 칸이 된다 — 받은 개체는 물려받지 않는다
  recordDex(save, pet.species, pet.shiny);
  if (pet.mega?.stone) { const opened = (save.dex.megaOpened ??= []); if (!opened.includes(pet.species)) opened.push(pet.species); } // 받은 쪽 도감에도 메가스톤을 적는다 (src/dex/mega.ts settleMega 와 같은 기록)
  save.counts.traded += 1; // 교환 업적이 센다
  save.trade = { pending: null };
}

// 보낸 개체가 없을 때 — 서버 결과를 따라 받은 개체만 넣는다. 적용한 프리셋의 빈 칸, 없으면 박스. 둘 다 없으면 받지 않고 잠금만 푼다
// (2026-10-14 사용자 결정 4 "추천대로", worklog/records/perf-refactor 5-4)
function placeReceivedOnly(save: SaveV3, got: TradePet, now: number, opts?: DexOptions): ApplyResult {
  const id = nextPetId(save);
  const slot = save.party.slots.findIndex((s) => s.state === "empty");
  const boxSpot = slot < 0 ? save.boxes.findIndex((b) => b.slots.includes(null)) : -1;
  if (slot < 0 && boxSpot < 0) {
    save.trade = { pending: null };
    return { ok: true, applied: false, refused: "no-room" };
  }
  const pet = receivedPetOf(got, id, now, opts);
  save.pets.push(pet);
  let where: TradeWhere;
  if (slot >= 0) {
    save.party.slots[slot] = { state: "pokemon", petId: id, hidden: false };
    where = { party: slot };
  } else {
    const box = save.boxes[boxSpot]!;
    const i = box.slots.indexOf(null);
    box.slots[i] = id;
    where = { box: boxSpot, slot: i };
  }
  finishTrade(save, pet);
  return { ok: true, applied: true, newPetId: id, where };
}
