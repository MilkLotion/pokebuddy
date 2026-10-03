// data/*.json 표의 항목 타입과 읽기 — 표 하나에 항목 타입 하나, 읽기 함수 하나.
// 여러 파일이 같은 표를 각자 타입을 달아 읽던 것을 여기로 모은다. 열쇠가 "_" 로 시작하는 항목(설명)은 부르는 쪽이 isMetaKey 로 거른다
import { loadJson, type DexOptions } from "./data.js";

// ── data/species.defaults.json ── 기본 표만(손으로 다듬은 덮어쓰기는 src/dex/species.ts profile 이 합친다)
export interface SpeciesRow {
  dex: number;
  rank?: number;
}
export const speciesTable = (opts?: DexOptions): Record<string, SpeciesRow> => loadJson<Record<string, SpeciesRow>>("species.defaults.json", opts);

// ── data/eggs.json ──
export interface EggRow {
  ko: string;
  price: number | null; // null 이면 상점에서 팔지 않는다
  note?: string; // 상점의 설명 줄
  pool?: unknown; // "unlocked" 또는 종 목록
  single?: boolean; // 단일 포켓몬 알 — 종별 한 번만 얻는다
  bonus?: Record<string, number>; // 열 때 포켓몬 대신 다른 알이 나올 확률
  palette?: string[]; // 알 그림 색표 — 원작 egg.png 의 9색을 같은 순서로 바꾼다
}
export const eggTable = (opts?: DexOptions): Record<string, EggRow> => loadJson<Record<string, EggRow>>("eggs.json", opts);

// ── data/items.json ──
export type ItemEffect = "fullness" | "fullness-full-buff" | "play-buff" | "exp" | "level" | "nature" | "shiny-on" | "shiny-off";
export interface ItemRow {
  ko: string;
  en?: string;
  price: number | null; // null 이면 팔지 않는다
  effect: ItemEffect;
  amount: number;
  group?: string;
  desc?: string;
  effectText?: string;
}
export const itemTable = (opts?: DexOptions): Record<string, ItemRow> => loadJson<Record<string, ItemRow>>("items.json", opts);

// ── data/evo-items.json ──
export interface EvoItemRow {
  ko: string;
  en?: string;
  targets?: string[];
}
export const evoItemTable = (opts?: DexOptions): Record<string, EvoItemRow> => loadJson<Record<string, EvoItemRow>>("evo-items.json", opts);

// ── data/achievements.json ──
export type AchievementReward = "party-slot" | { pokemon: string } | { points: number } | { egg: string } | { item: string; count?: number };

// 업적창의 분류 칩
export type AchievementGroup = "dex" | "grow" | "egg" | "find" | "together";

export type AchievementCond =
  | { kind: "dex"; count: number }
  | { kind: "region"; from: number; to: number }
  | { kind: "species"; species: string[] }
  | { kind: "shiny"; count: number }
  | { kind: "level"; level: number }
  | { kind: "affinity"; value: number }
  | { kind: "evolve"; count: number }
  | { kind: "mega"; count: number }
  | { kind: "hatch"; count: number }
  | { kind: "single"; count: number }
  | { kind: "find"; count: number }
  | { kind: "work"; hours: number }
  | { kind: "streak"; days: number }
  | { kind: "trade"; count: number }
  | { kind: "shown"; count: number }
  | { kind: "party"; count: number };

export interface AchievementDef {
  ko: string;
  en?: string; // 영어 이름 — 설정 언어가 en 이면 화면이 쓴다 (src/view/text.ts achievementName)
  desc?: string; // 이름만으로 조건이 드러나면 두지 않는다 — 업적창에 설명 줄이 그려지지 않는다
  group: AchievementGroup;
  cond: AchievementCond;
  reward: AchievementReward;
}
export const achievementTable = (opts?: DexOptions): Record<string, AchievementDef> => loadJson<Record<string, AchievementDef>>("achievements.json", opts);
