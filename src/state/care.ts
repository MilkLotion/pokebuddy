// 돌봄 — 규칙은 docs/specs/game.md "일상 사용 계약", 수치는 docs/specs/balance.md "버프와 친밀도"
//
// 밥 주기와 놀아주기는 우클릭 메뉴와 개체 상세에서 부른다.
//   밥 주기    기본먹이를 쓰는 것과 같다. 무료이며 무제한이고 쿨타임을 함께 쓴다
//   놀아주기   쿨타임마다 한 번 친밀도를 올린다. 이어서 놀아주면 버프 들뜸(2중첩)·신남(3중첩)이 붙는다. 장난감은 신남을 준다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { setBuff, use, type UseFailure, type UseResult } from "../bag/use.js";
import { countCare } from "../dex/mega.js";
import type { DexOptions } from "../dex/data";
import { BAG_RULES } from "../bag/rules.js";
import { PET_RULES } from "../party/rules.js";
import { CARE_RULES } from "./rules.js";
import type { SaveV3 } from "../shared/save-v3";
import { isInParty } from "../party/presets.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export const BASIC_FOOD = "basic-food";

export type PlayFailure = ReasonOf<"no-pet" | "cooldown">;

export type PlayResult = Outcome<PlayFailure> & {
  petId?: string;
  affinity?: number;
  streak?: number; // 이어서 놀아준 횟수
  longPlay?: boolean; // 신남 버프가 붙었다 (3중첩)
  shortPlay?: boolean; // 들뜸 버프가 붙었다 (2중첩, 신남이 없을 때만)
};

// 밥 주기 — 기본먹이 사용과 같은 길로 간다. 검사도 쿨타임도 한 곳에만 둔다
export const feed = (save: SaveV3, petId: string, opts?: DexOptions): UseResult => use(save, BASIC_FOOD, petId, {}, opts);

// 놀아주기 — 쿨타임마다 한 번 친밀도를 올린다. 이어서 놀아주면 중첩이 오른다
//
// 한 번 놀아주면 20분짜리 놀아주기 상태가 붙는다. 그 자체로는 아무 효과가 없다.
// 쿨타임 10분이 지난 뒤 남은 10분 안에 또 놀아주면 중첩이 오른다.
// 두 번 이어지면 버프 들뜸(×1.2, 30분), 세 번 이어지면 버프 신남(×1.5, 30분)이 붙는다 (2026-09-29 사용자 결정).
// 신남이 붙으면 들뜸은 신남으로 바뀐다(곱하지 않는다). 신남이 남아 있으면 들뜸을 새로 걸지 않는다 (제안, 사용자 확인 전).
// 신남은 장난감이 주는 것과 같은 버프다.
export function play(save: SaveV3, petId: string): PlayResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (pet.playCooldownMs > 0) return { ok: false, reason: "cooldown" };

  // 상태가 남아 있으면 이어 센다. 끊겼으면 처음부터
  pet.playStreak = pet.playWindowMs > 0 ? pet.playStreak + 1 : 1;
  pet.playWindowMs = CARE_RULES.playWindowMs;
  pet.playCooldownMs = CARE_RULES.playCooldownMs;
  pet.affinity = Math.min(PET_RULES.statMax, pet.affinity + BAG_RULES.playAffinity);
  pet.mood = Math.min(PET_RULES.statMax, pet.mood + BAG_RULES.playMood);
  pet.daily.plays += 1;

  const longPlay = pet.playStreak >= CARE_RULES.longPlayAt;
  const excited = pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0);
  const shortPlay = !longPlay && !excited && pet.playStreak >= CARE_RULES.shortPlayAt;
  if (longPlay) setBuff(pet, "long-play");
  else if (shortPlay) setBuff(pet, "short-play");
  return { ok: true, petId, affinity: pet.affinity, streak: pet.playStreak, longPlay, shortPlay };
}

// ── 돌봄 명령 — 밥 주기·놀아주기를 할 수 있는지 보고, 하고, 센다 ─────────────────────
// 박스 개체는 돌보지 않는다 — 박스에서는 값이 줄지 않아 올린 값이 그대로 남는다 (2026-09-30 사용자 결정 "박스에선 막고").
// 가방 도구(bag.use)는 따로다 — 박스 개체에게도 쓸 수 있다

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
  const res = feed(save, petId, opts);
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
  const res = play(save, petId);
  if (!res.ok || !pet) return res;
  countCare(pet, opts);
  save.totals.played += 1;
  return res;
}
