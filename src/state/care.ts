// 돌봄 — 규칙은 docs/specs/game.md "일상 사용 계약", 수치는 docs/specs/balance.md "버프와 친밀도"
//
// 밥 주기와 놀아주기는 우클릭 메뉴와 개체 상세에서 부른다.
//   밥 주기    기본먹이를 쓰는 것과 같다. 무료이며 무제한이고 쿨타임을 함께 쓴다
//   놀아주기   쿨타임마다 한 번 친밀도를 올리고 심심함을 줄인다. 버프는 없다 — 신남은 장난감이 준다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { useItem, type UseFailure, type UseResult } from "../bag/use.js";
import { countCare } from "../dex/mega.js";
import type { DexOptions } from "../dex/data";
import { BAG_RULES } from "../bag/rules.js";
import { PET_RULES } from "../party/rules.js";
import { BOREDOM_RULES, CARE_RULES } from "./rules.js";
import type { SaveV3 } from "../shared/save-v3";
import { isInParty } from "../party/locate.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

const BASIC_FOOD = "basic-food";

export type PlayFailure = ReasonOf<"no-pet" | "cooldown">;

export type PlayResult = Outcome<PlayFailure> & {
  petId?: string;
  affinity?: number;
  boredom?: number; // 놀아준 뒤의 심심함
};

// 밥 주기 — 기본먹이 사용과 같은 길로 간다. 검사도 쿨타임도 한 곳에만 둔다
export const applyFeed = (save: SaveV3, petId: string, opts?: DexOptions): UseResult => useItem(save, BASIC_FOOD, petId, {}, opts);

// 놀아주기 — 쿨타임(10분)마다 한 번. 친밀도 +3, 심심함 −50 (2026-10-05 사용자 결정 — 돌봄 개편).
// 이어서 놀아주는 중첩(들뜸·신남)과 놀아주기 신남은 없앴다 (2026-10-05 사용자 결정 "b로 하자" — 놀아주기 신남을 빼고 신남은 장난감 전용)
export function applyPlay(save: SaveV3, petId: string): PlayResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (pet.playCooldownMs > 0) return { ok: false, reason: "cooldown" };

  pet.playCooldownMs = CARE_RULES.playCooldownMs;
  pet.affinity = Math.min(PET_RULES.statMax, pet.affinity + BAG_RULES.playAffinity);
  pet.boredom = Math.max(0, pet.boredom - BOREDOM_RULES.playDrop);
  pet.daily.plays += 1;
  return { ok: true, petId, affinity: pet.affinity, boredom: pet.boredom };
}

// ── 돌봄 명령 — 밥 주기·놀아주기를 할 수 있는지 보고, 하고, 센다 ─────────────────────
// 박스 개체는 돌보지 않는다 — 박스에서는 값이 줄지 않아 올린 값이 그대로 남는다 (2026-09-30 사용자 결정 "박스에선 막고").
// 가방 도구(bag.use)는 따로 본다 — 사탕만 박스 개체에게도 쓸 수 있다 (src/bag/use.ts)

export type CareKind = "feed" | "play";
export type CareFailure = ReasonOf<"no-pet" | "not-in-party" | "full" | "cooldown">;

// 돌볼 수 있는가 — 개체 없음 → 파티에 없음 → (밥) 배부름 → 쿨타임 순으로 본다. 쿨타임이면 남은 시간도 준다
export function checkCare(save: SaveV3, petId: string, kind: CareKind): { ok: true } | { ok: false; reason: CareFailure; remainMs?: number } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (!isInParty(save, petId)) return { ok: false, reason: "not-in-party" };
  if (kind === "feed" && pet.fullness >= PET_RULES.statMax) return { ok: false, reason: "full" };
  const remainMs = kind === "feed" ? pet.feedCooldownMs : pet.playCooldownMs;
  if (remainMs > 0) return { ok: false, reason: "cooldown", remainMs };
  return { ok: true };
}

export type FeedResult = Outcome<UseFailure | ReasonOf<"not-in-party">> & Omit<UseResult, "ok" | "reason">;

// 밥 주기 명령 — 파티 개체만. 메가진화 조건의 돌봄 횟수와 누적 기록(첫 돌봄 튜토리얼이 "이미 돌봤다"를 본다)을 센다
export function feedPet(save: SaveV3, petId: string, opts?: DexOptions): FeedResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (pet && !isInParty(save, petId)) return { ok: false, reason: "not-in-party" };
  const res = applyFeed(save, petId, opts);
  if (!res.ok || !pet) return res;
  countCare(pet, opts);
  save.totals.fed += 1;
  return res;
}

export type PlayWithResult = Outcome<PlayFailure | ReasonOf<"not-in-party">> & Omit<PlayResult, "ok" | "reason">;

// 놀아주기 명령 — 파티 개체만. 돌봄 횟수와 누적 기록을 센다
export function playWithPet(save: SaveV3, petId: string, opts?: DexOptions): PlayWithResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (pet && !isInParty(save, petId)) return { ok: false, reason: "not-in-party" };
  const res = applyPlay(save, petId);
  if (!res.ok || !pet) return res;
  countCare(pet, opts);
  save.totals.played += 1;
  return res;
}
