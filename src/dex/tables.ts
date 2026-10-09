// data/*.json 표의 항목 타입과 읽기 — 표 하나에 항목 타입 하나, 읽기 함수 하나.
// 여러 파일이 같은 표를 각자 타입을 달아 읽던 것을 여기로 모은다. 열쇠가 "_" 로 시작하는 항목(설명)은 부르는 쪽이 isMetaKey 로 거른다
import { isMetaKey, loadJson, type DexOptions } from "./data.js";
import type { SaveV3 } from "../shared/save-v3";

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
export type ItemEffect = "fullness" | "fullness-full-buff" | "play-buff" | "exp" | "level" | "nature" | "shiny-on" | "shiny-off" | "form" | "call-rider";
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
  // 원작 첫 등장 세대 — 원작에 없는 우리 도구는 없다
  gen?: number;
  targets?: string[];
}
export const evoItemTable = (opts?: DexOptions): Record<string, EvoItemRow> => loadJson<Record<string, EvoItemRow>>("evo-items.json", opts);

// ── data/moves.json ── 기술 표. 규칙은 docs/specs/moves.md
export type MoveClass = "physical" | "special" | "status";
export interface MoveRow {
  ko: string;
  en?: string;
  type: string;
  class: MoveClass;
  power?: number;
  accuracy?: number | null; // null 이면 반드시 맞는다
  priority?: number;
  cooldown?: number; // 쿨타임(초)
  hits?: [number, number]; // 연속기의 [최소, 최대] 타수
  traits?: string[];
  effects?: MoveEffects;
}
// 부담과 효과 — 뜻은 docs/specs/moves.md "부담과 효과"
export interface MoveEffects {
  charge?: boolean;
  recharge?: boolean;
  recoil?: number;
  halfHp?: boolean;
  drain?: number;
  stats?: { who: "self" | "target"; stat: string; change: number; chance: number }[]; // 맞힌 뒤 chance% 로 능력 변화
  crit?: "high" | "always"; // 급소율 (docs/specs/moves.md "급소")
  status?: { kind: string | string[]; chance: number }; // 상태 이상 — 목록이면 하나를 뽑는다 (docs/specs/moves.md "상태 이상")
  flinch?: number; // 풀죽음 확률(%)
  rampage?: boolean;
  hpScale?: boolean;
}
export const moveTable = (opts?: DexOptions): Record<string, MoveRow> => loadJson<Record<string, MoveRow>>("moves.json", opts);

// ── data/species-moves.json ── 종마다 기술 2개. 칸이 객체면 기술 기본값을 덮는다
export type SpeciesMoveCell = string | ({ id: string } & Partial<MoveRow>);
export interface SpeciesMoveRow {
  moves: SpeciesMoveCell[];
  candidates?: string[]; // 후보 4개 — 마지막 진화체만 (docs/specs/moves.md "기술 고르기")
  special?: string;
}
export const speciesMoveTable = (opts?: DexOptions): Record<string, SpeciesMoveRow> => loadJson<Record<string, SpeciesMoveRow>>("species-moves.json", opts);

// ── data/mega-battle.json ── 메가·원시회귀 모습의 종족값 6개와 특성 (메가 모습은 종 표에 없다)
export interface MegaBattleRow {
  stats: number[];
  ability: string;
  baseAbility?: boolean; // 원작 특성이 없어 기본 종 특성을 쓴다
}
export const megaBattleTable = (opts?: DexOptions): Record<string, MegaBattleRow> => loadJson<Record<string, MegaBattleRow>>("mega-battle.json", opts);

// ── data/form-battle.json ── 전투 중 모습이 바뀌는 종의 다른 모습 종족값 (src/tools/data/build-form-battle.ts)
export interface FormBattleRow {
  form: string; // PokeAPI 모습 식별자
  stats: number[];
  types?: string[]; // 그 모습의 타입 — 기본 모습과 다를 때 쓴다(달마모드)
  ownMoves?: true; // 그 모습이 자기 기술 2개(species-moves.json 의 그 모습 칸)를 쓴다(메로엣타)
}
export const formBattleTable = (opts?: DexOptions): Record<string, FormBattleRow> => loadJson<Record<string, FormBattleRow>>("form-battle.json", opts);

// ── data/battle-looks.json ── 전투 중에만 보이는 모습 → PMD SpriteCollab 폼 경로(무대·배틀 창 그림)
export const battleLookTable = (opts?: DexOptions): Record<string, string> => loadJson<Record<string, string>>("battle-looks.json", opts);

// ── data/type-chart.json ── 공격 타입 → 방어 타입 → 배율
export const typeChartTable = (opts?: DexOptions): Record<string, Record<string, number>> => loadJson<Record<string, Record<string, number>>>("type-chart.json", opts);

// ── data/move-text.ko.json ── 기술 id → 원작 한국어 설명. 설명이 없는 기술은 키가 없다
export const moveTextTable = (opts?: DexOptions): Record<string, string> => loadJson<Record<string, string>>("move-text.ko.json", opts);

// ── data/abilities.json · data/species-abilities.json ── 특성 표와 종마다 특성 하나
export interface AbilityRow {
  ko: string;
  en?: string;
  text: string; // 화면 설명 — 이 게임에서의 동작을 짧게 (배틀 파티 상세 기기 창 말풍선)
}
export const abilityTable = (opts?: DexOptions): Record<string, AbilityRow> => loadJson<Record<string, AbilityRow>>("abilities.json", opts);
export const speciesAbilityTable = (opts?: DexOptions): Record<string, string> => loadJson<Record<string, string>>("species-abilities.json", opts);

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
  | { kind: "agent"; count: number }
  | { kind: "streak"; days: number }
  | { kind: "trade"; count: number }
  | { kind: "shown"; count: number }
  | { kind: "party"; count: number }
  | { kind: "pet-party"; species: string; hours: number };

export interface AchievementDef {
  ko: string;
  en?: string; // 영어 이름 — 설정 언어가 en 이면 화면이 쓴다 (src/view/text.ts achievementName)
  desc?: string; // 이름만으로 조건이 드러나면 두지 않는다 — 업적창에 설명 줄이 그려지지 않는다
  group: AchievementGroup;
  cond: AchievementCond;
  reward: AchievementReward;
}
export const achievementTable = (opts?: DexOptions): Record<string, AchievementDef> => loadJson<Record<string, AchievementDef>>("achievements.json", opts);

// 달성하고 아직 받지 않은 업적 — 표에 있는 것만, 표 순서. 배너·업적 아이콘 점·업적창 머리 수·업적 튜토리얼이 이 셈 하나를 쓴다 (94 항목 9-3-8)
// quiet(목록이 늘어난 뒤 한꺼번에 달성한 것)도 든다 — 배너만 끈다 (docs/specs/game.md "배너를 띄우지 않는다. 업적 아이콘의 점은 켠다")
export const unclaimedAchievementIds = (save: Pick<SaveV3, "achievements">, opts?: DexOptions): string[] =>
  Object.keys(achievementTable(opts)).filter((id) => !isMetaKey(id) && save.achievements[id]?.achievedAt != null && save.achievements[id]?.claimedAt == null);
