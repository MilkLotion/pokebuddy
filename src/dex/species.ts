// 종 프로필 — data/species.defaults.json(PokeAPI 에서 뽑은 1089종, src/tools/data/build-species.ts) 위에
// data/species.overrides.json(손으로 다듬은 종)을 덧씌운다. 모르는 슬러그는 기본 프로필 (design.md "상태")

import type { SpeciesProfile } from "../shared/species";
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";

type Stored = Omit<SpeciesProfile, "slug">;
type Defaults = Record<string, Stored>;
type Overrides = Record<string, Partial<Stored>>;

// 표에 없는 종의 값 — build-species.js 의 DEFAULT 와 같다
export const DEFAULT_PROFILE: Readonly<Omit<Stored, "dex">> = {
  growthRate: "medium-fast",
  bst: 0,
  stage: 1,
  rank: 1,
  genderRate: 4, // 성비 반반
  sleepiness: 1,
  moodBase: 60,
  moodSwing: 1,
  likes: ["play"],
  types: [],
};

const defaults = (opts?: DexOptions): Defaults => loadJson<Defaults>("species.defaults.json", opts);
const overrides = (opts?: DexOptions): Overrides => loadJson<Overrides>("species.overrides.json", opts);

// 수집 난이도 1~5 — data/species.defaults.json 의 rank. 표에 없으면 1. 알의 추첨 가중치(src/egg/hatch.ts)와 상점의 종 가격(src/shop/catalog.ts speciesPrice)이 쓴다
export const rankOf = (slug: string, opts?: DexOptions): number => defaults(opts)[slug]?.rank ?? 1;

// 합친 프로필 — 배열은 새로 만들어 돌려준다 (캐시를 건드리지 못하게)
export function profile(slug: string, opts?: DexOptions): SpeciesProfile {
  const key = normalizeSlug(slug);
  const base = isMetaKey(key) ? undefined : defaults(opts)[key];
  const over = isMetaKey(key) ? undefined : overrides(opts)[key];
  const merged: SpeciesProfile = { slug: key, dex: 0, ...DEFAULT_PROFILE, ...base, ...over };
  merged.likes = [...merged.likes];
  merged.types = [...merged.types];
  return merged;
}

// 표(기본값 또는 override)에 있는 종인가
export function hasProfile(slug: string, opts?: DexOptions): boolean {
  const key = normalizeSlug(slug);
  if (isMetaKey(key)) return false;
  return key in defaults(opts) || key in overrides(opts);
}

// 표에 있는 슬러그 전부 — 정렬
export function slugs(opts?: DexOptions): string[] {
  const set = new Set<string>();
  for (const k of Object.keys(defaults(opts))) if (!isMetaKey(k)) set.add(k);
  for (const k of Object.keys(overrides(opts))) if (!isMetaKey(k)) set.add(k);
  return [...set].sort();
}
