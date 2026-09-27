// 알 돌봄 — 규칙은 docs/specs/game.md "알", 수치는 docs/specs/balance.md
//
// 쓰다듬기와 노래 들려주기는 단축량이 같다. 결과 조건만 다르다.
// 인정 간격은 1분이다. 버튼을 계속 눌러도 반복 차감하지 않는다.
// 남은 시간은 0 아래로 내려가지 않는다. 준비가 끝난 뒤에도 조건은 계속 쌓을 수 있다.
import { EGG_V3_RULES } from "../save/rules.js";
import type { EggV3 } from "../shared/save-v3";

export type CareAction = "pat" | "song";
export type CareFailure = "no-egg" | "cooldown" | "bad-action";

export interface CareResult {
  ok: boolean;
  reason?: CareFailure;
  shortenedMs?: number; // 이번에 줄인 시간
  remainMs?: number;
  ready?: boolean;
}

export const isCareAction = (v: unknown): v is CareAction => v === "pat" || v === "song";

export function care(egg: EggV3, action: CareAction): CareResult {
  if (egg.careCooldownMs > 0) return { ok: false, reason: "cooldown" };

  const before = egg.remainMs;
  egg.remainMs = Math.max(0, egg.remainMs - EGG_V3_RULES.careShortenMs);
  egg.careCooldownMs = EGG_V3_RULES.careCooldownMs;
  egg.actions[action] += 1;
  if (egg.remainMs === 0) egg.ready = true;

  return { ok: true, shortenedMs: before - egg.remainMs, remainMs: egg.remainMs, ready: egg.ready };
}
