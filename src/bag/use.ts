// 가방 도구 사용 — 규칙은 docs/specs/game.md, 수치는 docs/specs/balance.md, 효과는 data/items.json
//
// 검사와 반영을 한 거래로 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다.
// 기본먹이는 무료이며 무제한이라 가방에서 차감하지 않는다. 나머지는 하나씩 쓴다.
// 진화용 도구는 여기서 다루지 않는다. 진화는 따로 계약이 있다.
import { loadJson, type DexOptions } from "../dex/data.js";
import { countCare } from "../dex/mega.js";
import { expForLevel, growthOf, levelFor, MAX_LEVEL } from "../dex/growth.js";
import { isNatureId } from "../dex/natures.js";
import { MINT_ID, MINT_RETIRED } from "./mint.js";
import { BAG_RULES } from "./rules.js";
import { recordShiny } from "../dex/record.js";
import { PET_RULES } from "../party/rules.js";
import { isInParty } from "../party/presets.js";
import type { BuffKind, PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type ItemEffect = "fullness" | "fullness-full-buff" | "play-buff" | "exp" | "level" | "nature" | "shiny-on" | "shiny-off";

export interface ItemEntry {
  ko: string;
  price: number | null;
  effect: ItemEffect;
  amount: number;
}

export type UseFailure = ReasonOf<
  | "no-item" // 그런 도구가 없다
  | "none-left" // 가방에 없다
  | "no-pet" // 그런 개체가 없다
  | "full" // 만복도가 이미 가득이다
  | "cooldown" // 밥 주기 쿨타임이다
  | "max-level" // 이미 최대 레벨이다
  | "already" // 이미 그 상태다
  | "bad-nature" // 바꿀 성격을 고르지 않았거나 모르는 성격이다
  | "not-in-party" // 파티 개체에게만 쓰는 도구를 박스 개체에게 쓰려 했다
>;

export type UseResult = Outcome<UseFailure> & {
  petId?: string;
  left?: number; // 쓰고 남은 개수
  level?: number;
  exp?: number;
  fullness?: number;
  nature?: string;
  shiny?: boolean;
};

const items = (opts?: DexOptions): Record<string, ItemEntry> => loadJson<Record<string, ItemEntry>>("items.json", opts);

export const itemOf = (id: string, opts?: DexOptions): ItemEntry | null => (id.startsWith("_") ? null : items(opts)[id] ?? null);

// 버프를 건다. 남아 있으면 지속시간으로 바꾼다. 더하지 않는다.
// 남은 시간이 더 길면 그대로 둔다 — 장난감 신남(2시간)이 남은 동안 3중첩 놀아주기(30분)가 줄이지 않는다.
// 신남(long-play)을 걸면 들뜸(short-play)은 지운다 — 아랫단계가 윗단계로 바뀐다(곱하지 않는다, 제안). 놀아주기(src/state/care.ts)와 장난감이 함께 쓴다
export function setBuff(pet: PetV3, kind: BuffKind, remainMs: number = BAG_RULES.buffMs[kind]): void {
  if (kind === "long-play") pet.buffs = pet.buffs.filter((b) => b.kind !== "short-play");
  const hit = pet.buffs.find((b) => b.kind === kind);
  if (hit) hit.remainMs = Math.max(hit.remainMs, remainMs);
  else pet.buffs.push({ kind, remainMs });
}

const addAffinity = (pet: PetV3, gain: number): void => {
  pet.affinity = Math.min(PET_RULES.statMax, pet.affinity + gain);
};

// 박스 개체에게도 쓸 수 있는 도구의 효과 — 사탕뿐이다
const BOX_OK_EFFECTS: readonly string[] = ["exp", "level"];

export function useItem(save: SaveV3, itemId: string, petId: string, args: { nature?: string } = {}, opts?: DexOptions): UseResult {
  const item = itemOf(itemId, opts);
  if (!item || (MINT_RETIRED && itemId === MINT_ID)) return { ok: false, reason: "no-item" }; // 성격민트 은퇴 — 쓰지 않는다 (src/bag/mint.ts)

  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  // 사탕(경험사탕·이상한사탕)만 박스 개체에게도 쓴다. 그 밖의 도구는 적용한 프리셋의 파티 개체에게만 (2026-10-04 사용자 결정 "사탕만 박스도", 94 항목 9-1-1)
  if (!BOX_OK_EFFECTS.includes(item.effect) && !isInParty(save, petId)) return { ok: false, reason: "not-in-party" };

  const free = item.price === null; // 기본먹이처럼 무료인 도구는 재고를 세지 않는다
  const stock = save.bag[itemId] ?? 0;
  if (!free && stock <= 0) return { ok: false, reason: "none-left" };

  const rate = growthOf(pet.species, opts);
  const done = (extra: Partial<Omit<UseResult, "ok" | "reason">>): UseResult => {
    if (!free) {
      const left = stock - 1;
      if (left > 0) save.bag[itemId] = left;
      else delete save.bag[itemId];
      return { ok: true, petId, left, ...extra };
    }
    return { ok: true, petId, ...extra };
  };

  switch (item.effect) {
    case "fullness":
    case "fullness-full-buff": {
      if (pet.fullness >= 100) return { ok: false, reason: "full" };
      if (pet.feedCooldownMs > 0) return { ok: false, reason: "cooldown" };
      pet.fullness = item.effect === "fullness-full-buff" ? PET_RULES.statMax : Math.min(PET_RULES.statMax, pet.fullness + item.amount);
      pet.fullnessProgressMs = 0;
      pet.feedCooldownMs = BAG_RULES.feedCooldownMs;
      if (item.effect === "fullness-full-buff") {
        setBuff(pet, "premium-food");
        // 프리미엄먹이는 밥 주기 횟수에 든다 — 메가진화 조건의 돌봄 횟수와 누적 기록(2026-10-04 사용자 결정 "센다", 94 항목 9-3-6).
        // 기본먹이는 밥 주기 명령(src/state/care.ts feedPet)이 센다 — 같은 길을 지나 여기서 세면 두 번이 된다
        countCare(pet, opts);
        save.totals.fed += 1;
      }
      addAffinity(pet, BAG_RULES.feedAffinity);
      pet.mood = Math.min(PET_RULES.statMax, pet.mood + BAG_RULES.feedMood);
      pet.daily.feeds += 1;
      return done({ fullness: pet.fullness });
    }
    case "play-buff": {
      setBuff(pet, "long-play", BAG_RULES.toyBuffMs); // 장난감은 신남을 준다. 놀아주기로 켠 신남보다 길다
      addAffinity(pet, BAG_RULES.playAffinity);
      pet.mood = Math.min(PET_RULES.statMax, pet.mood + BAG_RULES.playMood); // 장난감도 놀아주기다
      pet.daily.plays += 1;
      // 장난감은 놀아주기 횟수에 든다 (2026-10-04 사용자 결정 "센다", 94 항목 9-3-6)
      countCare(pet, opts);
      save.totals.played += 1;
      return done({});
    }
    case "exp": {
      if (pet.level >= MAX_LEVEL) return { ok: false, reason: "max-level" };
      pet.exp += item.amount;
      const capped = expForLevel(rate, MAX_LEVEL);
      if (pet.exp > capped) pet.exp = capped;
      pet.level = levelFor(rate, pet.exp);
      return done({ level: pet.level, exp: pet.exp });
    }
    case "level": {
      if (pet.level >= MAX_LEVEL) return { ok: false, reason: "max-level" };
      pet.level += 1;
      pet.exp = expForLevel(rate, pet.level); // 새 레벨의 진행은 0부터
      return done({ level: pet.level, exp: pet.exp });
    }
    case "nature": {
      // 민트는 한 종류다. 원작 25 성격 가운데 아무 성격이나 받는다. 지금 성격이면 거절한다 (2026-09-29 사용자 결정)
      const next = args.nature ?? "";
      if (!isNatureId(next, opts)) return { ok: false, reason: "bad-nature" };
      if (pet.nature === next) return { ok: false, reason: "already" };
      pet.nature = next;
      return done({ nature: next });
    }
    case "shiny-on": {
      if (pet.shiny) return { ok: false, reason: "already" };
      pet.shiny = true;
      recordShiny(save, pet.species);
      return done({ shiny: true });
    }
    case "shiny-off": {
      if (!pet.shiny) return { ok: false, reason: "already" };
      pet.shiny = false; // 도감의 이로치 획득 기록은 지우지 않는다
      return done({ shiny: false });
    }
    default:
      return { ok: false, reason: "no-item" };
  }
}
