// 리전폼 — data/regional.json (손으로 관리하는 표, worklog-mac/records/region-map). 도감 번호는 같지만 다른 종으로 본다
//
//   forms   슬러그 → 기본 종 · 지방 · 폼 순번 · PokeAPI 포켓몬 번호(초상) · PMD 폼 경로(무대) · 얻는 방법
//   edges   진화 간선 — 빌드가 data/evo.json 에 덧붙인다 (src/tools/build-evo.ts). 런타임은 evo.json 만 본다
//           need 는 원작 조건이다. 지도 간선의 원작 조건이 도구면 빌드가 지도로 바꿔 적는다
// 표가 없으면 빈 표로 본다 — 시험용 dataDir 에 이 파일이 없어도 깨지지 않게
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";
import type { EvoStep } from "./evo";
import type { EvoNeed } from "../shared/types";

export type RegionId = "alola" | "galar" | "hisui" | "paldea";

// 얻는 방법 — map 지도 진화 결과 · base 다른 종과 같은 규칙의 진화 전 종 · path 리전폼이 진화해 얻는 종
export type RegionalGet = "map" | "base" | "path";

export interface RegionalForm {
  base: string; // 같은 도감 번호의 기본 종
  region: RegionId;
  no: number; // 한 도감 번호 안의 폼 순번 — 표시 번호 `26-1`
  pokemonId: number; // PokeAPI pokemon.csv id — 초상 그림 번호
  pmd?: string; // PMD SpriteCollab 폼 경로(`0026/0001`). 없으면 기본형 그림을 쓴다
  ko: string;
  en: string;
  get: RegionalGet;
}

export interface RegionalTable {
  forms: Record<string, RegionalForm>;
  edges: Record<string, EvoStep[]>;
}

// 지도 도구 식별자 — 진화 간선의 map 표시가 요구하는 도구
export const REGION_MAP = "region-map";

// 조건 자체가 지도인가 — 원작 조건이 돌인 지도 간선은 빌드가 need 를 지도로 바꿔 둔다 (src/tools/build-evo.ts)
//   이런 간선은 돌을 보지도 쓰지도 않는다. 화면도 "지도" 하나만 적는다 (2026-09-30 사용자 결정 "아이템1개만쓰는게 나을거같네")
export const needIsMap = (need: EvoNeed | undefined): boolean => need?.kind === "item" && need.item === REGION_MAP;

const EMPTY: RegionalTable = { forms: {}, edges: {} };
const tables = new Map<string, RegionalTable>();

// 표 전체 — 파일이 없거나 깨졌으면 빈 표
export function regionalTable(opts?: DexOptions): RegionalTable {
  const key = opts?.dataDir ?? "";
  const hit = tables.get(key);
  if (hit) return hit;
  let table = EMPTY;
  try {
    const raw = loadJson<Partial<RegionalTable>>("regional.json", opts);
    table = { forms: raw.forms ?? {}, edges: raw.edges ?? {} };
  } catch {
    table = EMPTY;
  }
  tables.set(key, table);
  return table;
}

// 리전폼 정보 — 리전폼이 아니면 null
export function regionalOf(slug: string, opts?: DexOptions): RegionalForm | null {
  const key = normalizeSlug(slug);
  if (isMetaKey(key)) return null;
  return regionalTable(opts).forms[key] ?? null;
}

export const isRegional = (slug: string, opts?: DexOptions): boolean => regionalOf(slug, opts) !== null;

// 리전폼 슬러그 전부 — 표 순서
export const regionalSlugs = (opts?: DexOptions): string[] => Object.keys(regionalTable(opts).forms).filter((k) => !isMetaKey(k));

// 도감 표시 번호 — 리전폼이면 `26-1`, 아니면 `26`. 자릿수 채움은 부르는 쪽이 pad 로 정한다
export function dexLabel(slug: string, dex: number, pad = 0, opts?: DexOptions): string {
  const no = String(dex).padStart(pad, "0");
  const form = regionalOf(slug, opts);
  return form ? `${no}-${form.no}` : no;
}
