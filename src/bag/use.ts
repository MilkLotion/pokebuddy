// 가방 도구 사용 — 규칙은 docs/specs/game.md, 수치는 docs/specs/balance.md, 효과는 data/items.json
//
// 검사와 반영을 한 거래로 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다.
// 기본먹이는 무료이며 무제한이라 가방에서 차감하지 않는다. 나머지는 하나씩 쓴다.
// 진화용 도구는 여기서 다루지 않는다. 진화는 따로 계약이 있다.
import type { DexOptions } from "../dex/data.js";
import { countCare } from "../dex/mega.js";
import { MEGA_RULES } from "../dex/rules.js";
import { expForLevel, growthOf, levelFor, MAX_LEVEL } from "../dex/growth.js";
import { isNatureId } from "../dex/natures.js";
import { MINT_ID, MINT_RETIRED } from "./mint.js";
import { BAG_RULES } from "./rules.js";
import { recordShiny } from "../dex/record.js";
import { dexSlugOf } from "../dex/regional.js";
import { PET_RULES } from "../party/rules.js";
import { isInParty } from "../party/locate.js";
import type { BuffKind, PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";
import { itemOf } from "./items.js";
import { feedBlock } from "../state/care-block.js";

export type UseFailure = ReasonOf<
  | "no-item" // 그런 도구가 없다
  | "none-left" // 가방에 없다
  | "no-pet" // 그런 개체가 없다
  | "full" // 만복도가 이미 가득이다
  | "cooldown" // 밥 주기 쿨타임이다
  | "max-level" // 이미 최대 레벨이다
  | "already" // 이미 그 상태다
  | "already-shiny" // 이미 이로치다
  | "already-normal" // 이미 일반 색이다
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

// 버프를 건다. 남아 있으면 지속시간으로 바꾼다. 더하지 않는다. 남은 시간이 더 길면 그대로 둔다. 장난감·프리미엄먹이가 쓴다
export function setBuff(pet: PetV3, kind: BuffKind, remainMs: number = BAG_RULES.buffMs[kind]): void {
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
      // 배부름·쿨타임 판정은 src/state/care-block.ts feedBlock 하나 — 두 먹이가 같이 쓴다. 배부를 때 프리미엄먹이를 쓰게 두면 친밀도 +8 을 쿨타임마다 얻어서 막는다 (2026-10-05)
      const blocked = feedBlock(pet);
      if (blocked) return { ok: false, reason: blocked };
      pet.fullness = item.effect === "fullness-full-buff" ? PET_RULES.statMax : Math.min(PET_RULES.statMax, pet.fullness + item.amount);
      pet.fullnessProgressMs = 0;
      pet.feedCooldownMs = BAG_RULES.feedCooldownMs;
      if (item.effect === "fullness-full-buff") {
        // 프리미엄먹이 — 만복도 가득 + 든든함 2시간(포인트 +80%·친밀도 +20%, 그동안 만복도가 줄지 않는다) + 친밀도 +8 (2026-10-05 돌봄 개편, 2026-10-11 도구 역할 나누기)
        setBuff(pet, "premium-food");
        addAffinity(pet, BAG_RULES.premiumAffinity - BAG_RULES.feedAffinity); // 아래 밥 주기 몫(+2)과 합쳐 +8
        // 프리미엄먹이는 밥 주기 누적 기록에 든다(2026-10-04 사용자 결정 "센다", 94 항목 9-3-6). 메가진화 조건에는 세지 않는다 — 2026-10-11 놀아주기 30회로 바꿈.
        // 기본먹이는 밥 주기 명령(src/state/care.ts feedPet)이 센다 — 같은 길을 지나 여기서 세면 두 번이 된다
        save.totals.fed += 1;
      }
      addAffinity(pet, BAG_RULES.feedAffinity);
      pet.daily.feeds += 1;
      return done({ fullness: pet.fullness });
    }
    case "play-buff": {
      // 장난감 — 심심함 0 + 신남 2시간(포인트 +30%·친밀도 +150%, 심심함은 다시 쌓인다) + 친밀도 +5 (2026-10-05 돌봄 개편, 2026-10-11 도구 역할 나누기)
      setBuff(pet, "long-play");
      addAffinity(pet, BAG_RULES.toyAffinity);
      pet.boredom = 0;
      pet.boredomProgressMs = 0;
      pet.daily.plays += 1;
      // 장난감은 놀아주기 횟수에 든다 — 메가진화 조건의 놀아주기 30회에는 한 번에 2회로 센다 (2026-10-04 사용자 결정 "센다", 2026-10-11 "2오르게")
      countCare(pet, opts, MEGA_RULES.toyCare);
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
      if (pet.shiny) return { ok: false, reason: "already-shiny" }; // 약마다 다른 까닭 (94 항목 9-3-3)
      pet.shiny = true;
      recordShiny(save, dexSlugOf(pet.species, opts));
      return done({ shiny: true });
    }
    case "shiny-off": {
      if (!pet.shiny) return { ok: false, reason: "already-normal" };
      pet.shiny = false; // 도감의 이로치 획득 기록은 지우지 않는다
      return done({ shiny: false });
    }
    default:
      return { ok: false, reason: "no-item" };
  }
}
