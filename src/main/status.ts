// 우클릭 메뉴가 쓰는 상태 문구와 조작 가능 여부 (저장 v3) — 계약은 docs/specs/game.md "우클릭 메뉴"
//
// 메뉴는 이름·상태 / 밥 주기·놀아주기 / 설정 세 묶음이다. 상태 줄은 만복도 구간과 기분 구간을 보여 준다.
// 규칙을 다시 적지 않는다. 쿨타임과 구간은 도메인 모듈이 정한 값을 그대로 읽는다.
import { zoneOf } from "../state/time.js";
import type { CommandResult } from "../shared/types";
import type { PetV3 } from "../shared/save-v3";
import { moodWord, t, untilWord } from "./text.js";

// 이름 옆 한 줄 — "배고픔 · 기분 좋음". 구간 낱말은 관리 창(src/renderer/manage.ts)의 표와 뜻이 같다
export const petStatus = (pet: PetV3): string => {
  const zone = zoneOf(pet.fullness);
  return `${t(`zone.${zone}`)} · ${moodWord(pet.mood)}`;
};

// 밥 주기·놀아주기를 지금 할 수 있나. 못 하면 이유와 남은 초를 준다
export function careState(pet: PetV3, action: "feed" | "play"): CommandResult {
  if (action === "feed" && pet.fullness >= 100) return { ok: false, reason: "full" };
  const remainMs = action === "feed" ? pet.feedCooldownMs : pet.playCooldownMs;
  if (remainMs > 0) return { ok: false, reason: "cooldown", seconds: Math.ceil(remainMs / 1000) };
  return { ok: true, reason: "ok" };
}

// 메뉴 항목 하나의 모양 — 막혔으면 이유를 라벨 뒤에 붙인다
// 쿨타임은 초가 아니라 분·시간 단위 남은 시간 ("3분 뒤", 1분 안이면 "곧")
export function careItem(pet: PetV3, action: "feed" | "play"): { enabled: boolean; reason?: string } {
  const r = careState(pet, action);
  if (r.ok) return { enabled: true };
  if (r.reason === "cooldown") return { enabled: false, reason: untilWord(Date.now() + Number(r.seconds ?? 0) * 1000) };
  return { enabled: false, reason: t(`care.${r.reason}`) };
}
