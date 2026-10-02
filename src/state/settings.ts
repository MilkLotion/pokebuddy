// 설정 한 항목 바꾸기 — 규칙은 docs/specs/game.md "설정과 연결"
//
// 한 번에 한 항목만 바꾼다. 어떤 항목인지와 허용 값을 여기가 모두 가진다.
// 화면은 무엇을 보여 줄지만 정하고 값 검사는 하지 않는다. 허용 밖의 값이면 저장을 바꾸지 않는다.
// 놀이공간 영역(`playRegion`)은 영역 그리기 창이 적용할 때 보낸다. 영역과 `region` 방식을 한 번에 바꾼다.
// 놀이공간 화면(`playScreen`)은 화면 목록이나 화면 고르기 창이 보낸다. 고른 화면과 `screen` 방식을 한 번에 바꾼다 (2026-09-28 여러 화면)
import { screenRefOf } from "../save/v3.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export type SettingKey = "language" | "startOnLogin" | "sound" | "volume" | "sleepAfterMin" | "playArea" | "playRegion" | "playScreen";

export type SettingFailure = ReasonOf<"bad-args" | "bad-value">;

export interface SetResult {
  ok: boolean;
  reason?: SettingFailure;
  key?: SettingKey;
  value?: unknown;
}

// 화면이 고를 수 있는 값. 하나뿐인 출처다
export const SETTING_CHOICES = {
  language: ["ko", "en"],
  sleepAfterMin: [3, 5, 10, 15, 0], // 0 은 잠들지 않음
  playArea: ["all", "screen", "region"],
} as const;

const KEYS: readonly SettingKey[] = ["language", "startOnLogin", "sound", "volume", "sleepAfterMin", "playArea", "playRegion", "playScreen"];

// 소리 크기 — 설정 값(0~100)을 소리마다의 최대 음량에 곱한다. 앱 소리는 이 규칙 하나를 따른다 (2026-09-27 사용자 요청 "소리가 너무 커")
//   defaultVolume  새 저장·옛 저장의 기본값
//   cryMax         울음소리 최대 음량(0~1) — 무대·도감 기기 창
//   chimeMax       배너 알림음 최대 음량(0~1) — OS 기본음(shell.beep)은 크기를 못 바꿔서 앱이 직접 낸다
export const SOUND_RULES = { defaultVolume: 30, cryMax: 0.35, chimeMax: 0.35 } as const;

// 실제로 낼 음량(0~1). 소리를 끄면 0
export const gainOf = (settings: { sound: boolean; volume: number }, max: number): number =>
  settings.sound === false ? 0 : Math.round(Math.max(0, Math.min(100, settings.volume)) * max * 10) / 1000;

// 놀이공간 영역의 최소 크기 (화면 좌표 DIP). 스펙 미확정이라 구현에서 정했다 (worklog/records/game-runtime/record.md "놀이공간·설정의 설계")
//   area  넓이 — 240 × 160 과 같은 넓이. 폭·높이 비율은 자유다(아래로 길게, 옆으로 길게) — 2026-09-26 사용자 요청
//   side  한 변 — 기본 크기(2) 포켓몬 한 마리가 들어가는 길이. 이보다 얇으면 움직일 자리가 없다
export const REGION_MIN = { area: 240 * 160, side: 80 } as const;

// 영역 크기가 최소를 넘는가 — 메인과 영역 그리기 창이 같은 규칙을 쓴다
export const regionFits = (w: number, h: number, min: { area: number; side: number } = REGION_MIN): boolean => w >= min.side && h >= min.side && w * h >= min.area;

// 영역 값 검사 — 유한한 수 넷, 최소 크기 이상. 정수로 반올림해 돌려준다
export function regionOf(value: unknown): { x: number; y: number; w: number; h: number } | null {
  if (value == null || typeof value !== "object") return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const rect = { x: Math.round(x as number), y: Math.round(y as number), w: Math.round(w as number), h: Math.round(h as number) };
  return regionFits(rect.w, rect.h) ? rect : null;
}

export const isSettingKey = (v: unknown): v is SettingKey => typeof v === "string" && KEYS.includes(v as SettingKey);

export function setSetting(save: SaveV3, key: SettingKey, value: unknown): SetResult {
  const s = save.settings;
  if (key === "startOnLogin" || key === "sound") {
    if (typeof value !== "boolean") return { ok: false, reason: "bad-value" };
    s[key] = value;
    return { ok: true, key, value };
  }
  if (key === "volume") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) return { ok: false, reason: "bad-value" };
    s.volume = value;
    return { ok: true, key, value };
  }
  if (key === "language") {
    if (!SETTING_CHOICES.language.some((v) => v === value)) return { ok: false, reason: "bad-value" };
    s.language = value as string;
    return { ok: true, key, value };
  }
  if (key === "sleepAfterMin") {
    if (!SETTING_CHOICES.sleepAfterMin.some((v) => v === value)) return { ok: false, reason: "bad-value" };
    s.sleepAfterMin = value as number;
    return { ok: true, key, value };
  }
  if (key === "playRegion") {
    const rect = regionOf(value);
    if (!rect) return { ok: false, reason: "bad-value" };
    s.playArea = { ...s.playArea, mode: "region", rect };
    return { ok: true, key, value: rect };
  }
  if (key === "playScreen") {
    const screen = screenRefOf(value);
    if (!screen) return { ok: false, reason: "bad-value" };
    s.playArea = { ...s.playArea, mode: "screen", screen };
    return { ok: true, key, value: screen };
  }
  // 놀이공간은 방식만 바꾼다. 그려 둔 영역과 고른 화면은 지우지 않는다 — 다른 방식으로 갔다가 돌아와도 그대로다
  if (!SETTING_CHOICES.playArea.some((v) => v === value)) return { ok: false, reason: "bad-value" };
  s.playArea = { ...s.playArea, mode: value as SaveV3["settings"]["playArea"]["mode"] };
  return { ok: true, key, value };
}
