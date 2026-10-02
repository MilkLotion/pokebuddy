// 돌봄 — 규칙은 docs/specs/game.md "일상 사용 계약", 수치는 docs/specs/balance.md "버프와 친밀도"
//
// 밥 주기와 놀아주기는 우클릭 메뉴와 개체 상세에서 부른다.
//   밥 주기    기본먹이를 쓰는 것과 같다. 무료이며 무제한이고 쿨타임을 함께 쓴다
//   놀아주기   쿨타임마다 한 번 친밀도를 올린다. 이어서 놀아주면 버프 들뜸(2중첩)·신남(3중첩)이 붙는다. 장난감은 신남을 준다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다.
import { setBuff, use, type UseResult } from "../bag/use.js";
import type { DexOptions } from "../dex/data";
import { BAG_V3_RULES, MOOD_RULES, SAVE_V3_RULES } from "../save/rules.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export const BASIC_FOOD = "basic-food";

export type PlayFailure = ReasonOf<"no-pet" | "cooldown">;

export interface PlayResult {
  ok: boolean;
  reason?: PlayFailure;
  petId?: string;
  affinity?: number;
  streak?: number; // 이어서 놀아준 횟수
  longPlay?: boolean; // 신남 버프가 붙었다 (3중첩)
  shortPlay?: boolean; // 들뜸 버프가 붙었다 (2중첩, 신남이 없을 때만)
}

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
  pet.playWindowMs = SAVE_V3_RULES.playWindowMs;
  pet.playCooldownMs = SAVE_V3_RULES.playCooldownMs;
  pet.affinity = Math.min(100, pet.affinity + BAG_V3_RULES.playAffinity);
  pet.mood = Math.min(100, pet.mood + MOOD_RULES.play);
  pet.daily.plays += 1;

  const longPlay = pet.playStreak >= SAVE_V3_RULES.longPlayAt;
  const excited = pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0);
  const shortPlay = !longPlay && !excited && pet.playStreak >= SAVE_V3_RULES.shortPlayAt;
  if (longPlay) setBuff(pet, "long-play");
  else if (shortPlay) setBuff(pet, "short-play");
  return { ok: true, petId, affinity: pet.affinity, streak: pet.playStreak, longPlay, shortPlay };
}
