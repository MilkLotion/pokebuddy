// 설정 한 항목 바꾸기 — 규칙은 docs/specs/game.md "설정과 연결"
//
// 한 번에 한 항목만 바꾼다. 어떤 항목인지와 허용 값을 여기가 모두 가진다.
// 화면은 무엇을 보여 줄지만 정하고 값 검사는 하지 않는다. 허용 밖의 값이면 저장을 바꾸지 않는다.
// 놀이공간 영역(`playRegion`)은 영역 그리기 창이 적용할 때 보낸다. 영역과 `region` 방식을 한 번에 바꾼다.
// 놀이공간 화면(`playScreen`)은 화면 목록이나 화면 고르기 창이 보낸다. 고른 화면과 `screen` 방식을 한 번에 바꾼다 (2026-09-28 여러 화면)
import { screenRefOf } from "../shared/raw.js";
import type { SaveV3 } from "../shared/save-v3";
import { REGION_MIN } from "./rules.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type SettingKey = "language" | "startOnLogin" | "sound" | "volume" | "sleepAfterMin" | "playArea" | "playRegion" | "playScreen";

export type SettingFailure = ReasonOf<"bad-args" | "bad-value">;

export type SetResult = Outcome<SettingFailure> & {
  key?: SettingKey;
  value?: unknown;
};

// 화면이 고를 수 있는 값. 하나뿐인 출처다
export const SETTING_CHOICES = {
  language: ["ko", "en"],
  sleepAfterMin: [3, 5, 10, 15, 0], // 0 은 잠들지 않음
  playArea: ["all", "screen", "region"],
} as const;

const KEYS: readonly SettingKey[] = ["language", "startOnLogin", "sound", "volume", "sleepAfterMin", "playArea", "playRegion", "playScreen"];

// 소리 크기와 놀이공간 최소 크기의 값은 src/state/rules.ts 에 있다

// 실제로 낼 음량(0~1). 소리를 끄면 0
export const gainOf = (settings: { sound: boolean; volume: number }, max: number): number =>
  settings.sound === false ? 0 : Math.round(Math.max(0, Math.min(100, settings.volume)) * max * 10) / 1000;

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
