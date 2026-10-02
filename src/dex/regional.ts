// 리전폼 — data/regional.json (손으로 관리하는 표, worklog-mac/records/region-map). 도감 번호는 같지만 다른 종으로 본다
// 특수 폼(플라엣테(영원의 꽃) · 루가루암(한밤중) 등)도 이 표에 special 로 든다 — 지방 모습은 아니지만 같은 규칙의 다른 종이다 (worklog/records/extra-evolution)
//
//   forms  슬러그 → 기본 종 · 지방 · 폼 순번 · PokeAPI 포켓몬 번호(초상) · PMD 폼 경로(무대) · 얻는 방법
//   edges   진화 간선 — 빌드가 data/evo.json 에 덧붙인다 (src/tools/build-evo.ts). 런타임은 evo.json 만 본다
//           need 는 원작 조건이다. 지도 간선의 원작 조건이 도구면 빌드가 지도로 바꿔 적는다
// 표가 없으면 빈 표로 본다 — 시험용 dataDir 에 이 파일이 없어도 깨지지 않게
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";
import type { EvoStep } from "./evo";
import type { EvoNeed } from "../shared/types";

// 도감의 지방 칸 — johto · sinnoh · unova · kalos 는 특수 폼(피츄(삐쭉귀) · 기라티나(오리진폼) · 배쓰나이(청색근) · 플라엣테(영원의 꽃))만 쓴다
export type RegionId = "johto" | "sinnoh" | "unova" | "kalos" | "alola" | "galar" | "hisui" | "paldea";

// 얻는 방법 — map 지도 진화 결과 · base 다른 종과 같은 규칙의 진화 전 종 · path 리전폼이 진화해 얻는 종
//   branch 기본형 종에서 지도 없이 진화해 얻는 특수 폼(루가루암(한밤중)) · gift 우편으로만 받는 특수 폼(피츄(삐쭉귀)) — 단일 포켓몬이다
//   variant 알에서 기본형 대신 나오는 특수 폼(배쓰나이(백색근)) — 표의 hatch 가 확률을 정한다
//   shift 기본형 개체가 모습 바꾸기로 오가는 특수 폼(기라티나(오리진폼)) — 표의 shift 가 짝을 정한다
export type RegionalGet = "map" | "base" | "path" | "branch" | "gift" | "variant" | "shift";

export interface RegionalForm {
  base: string; // 같은 도감 번호의 기본 종
  region: RegionId;
  no: number; // 한 도감 번호 안의 폼 순번 — 표시 번호 `26-1`
  pokemonId: number; // PokeAPI pokemon.csv id — 초상 그림 번호
  portrait?: string; // 초상 파일 이름(`172-spiky-eared`) — 포켓몬 번호가 따로 없는 폼만 적는다. 있으면 pokemonId 보다 먼저 쓴다
  pmd?: string; // PMD SpriteCollab 폼 경로(`0026/0001`). 없으면 기본형 그림을 쓴다
  ko: string;
  en: string;
  get: RegionalGet;
  special?: true; // 특수 폼 — 지방 모습이 아니다
}

// 알에서 한 종이 나올 때 대신 나오는 모습 — [슬러그, 가중치]. 기본형 자신도 목록에 든다
export type HatchVariants = [string, number][];

export interface RegionalTable {
  forms: Record<string, RegionalForm>;
  edges: Record<string, EvoStep[]>;
  hatch: Record<string, HatchVariants>;
  shift: Record<string, string[]>; // 기본 종 → 모습 바꾸기로 오가는 모습들
  gender: Record<string, Partial<Record<"male" | "female", GenderLook>>>; // 종 → 성별 → 그 성별의 그림
}

// 성별마다 그림이 다른 종의 그림 한 벌 — 종은 그대로이고 그림만 다르다 (대쓰여너 암컷)
export interface GenderLook {
  look: string; // 그림을 가리키는 이름 — 종 슬러그가 아니다. 그림 캐시의 열쇠로만 쓴다
  pokemonId: number; // PokeAPI pokemon.csv id — 초상
  pmd?: string; // PMD SpriteCollab 경로(`0902/0000/0000/0002`)
  pmdShiny?: string; // 이로치 경로
}

// 지도 도구 식별자 — 진화 간선의 map 표시가 요구하는 도구
export const REGION_MAP = "region-map";

// 조건 자체가 지도인가 — 원작 조건이 돌인 지도 간선은 빌드가 need 를 지도로 바꿔 둔다 (src/tools/build-evo.ts)
//   이런 간선은 돌을 보지도 쓰지도 않는다. 화면도 "지도" 하나만 적는다 (2026-09-30 사용자 결정 "아이템1개만쓰는게 나을거같네")
export const needIsMap = (need: EvoNeed | undefined): boolean => need?.kind === "item" && need.item === REGION_MAP;

const EMPTY: RegionalTable = { forms: {}, edges: {}, hatch: {}, shift: {}, gender: {} };
const tables = new Map<string, RegionalTable>();

// 표 전체 — 파일이 없거나 깨졌으면 빈 표
export function regionalTable(opts?: DexOptions): RegionalTable {
  const key = opts?.dataDir ?? "";
  const hit = tables.get(key);
  if (hit) return hit;
  let table = EMPTY;
  try {
    const raw = loadJson<Partial<RegionalTable>>("regional.json", opts);
    table = { forms: raw.forms ?? {}, edges: raw.edges ?? {}, hatch: raw.hatch ?? {}, shift: raw.shift ?? {}, gender: raw.gender ?? {} };
  } catch {
    table = EMPTY;
  }
  tables.set(key, table);
  return table;
}

// 알에서 이 종이 나올 때의 모습 목록 — 없으면 빈 목록 (data/regional.json 의 hatch)
export function hatchVariants(slug: string, opts?: DexOptions): HatchVariants {
  const key = normalizeSlug(slug);
  if (isMetaKey(key)) return [];
  return (regionalTable(opts).hatch[key] ?? []).filter(([s, w]) => typeof s === "string" && typeof w === "number" && w > 0);
}

// 이 모습이 알에서 대신 나오는 기본 종 — 그런 모습이 아니면 null (배쓰나이(백색근) → 배쓰나이)
export function hatchBaseOf(slug: string, opts?: DexOptions): string | null {
  const key = normalizeSlug(slug);
  for (const [base, list] of Object.entries(regionalTable(opts).hatch)) {
    if (!isMetaKey(base) && base !== key && list.some(([s]) => s === key)) return base;
  }
  return null;
}

// 모습 바꾸기로 오가는 모습 묶음 — 기본 종과 그 모습들. 묶음에 없는 종은 빈 목록 (data/regional.json 의 shift)
export function shiftGroupOf(slug: string, opts?: DexOptions): string[] {
  const key = normalizeSlug(slug);
  for (const [base, list] of Object.entries(regionalTable(opts).shift)) {
    if (isMetaKey(base) || !Array.isArray(list)) continue;
    if (base === key || list.includes(key)) return [base, ...list.filter((s) => typeof s === "string")];
  }
  return [];
}

// 이 종·성별의 그림 이름 — 성별 그림이 따로 없으면 null (data/regional.json 의 gender)
export function genderLookOf(species: string, gender: string | undefined, opts?: DexOptions): string | null {
  if (gender !== "male" && gender !== "female") return null;
  const key = normalizeSlug(species);
  if (isMetaKey(key)) return null;
  return regionalTable(opts).gender[key]?.[gender]?.look ?? null;
}

// 그림 이름 → 그 그림의 정보와 종. 성별 그림이 아니면 null
export function genderLookInfo(look: string, opts?: DexOptions): (GenderLook & { species: string }) | null {
  for (const [species, byGender] of Object.entries(regionalTable(opts).gender)) {
    if (isMetaKey(species)) continue;
    for (const info of Object.values(byGender)) if (info?.look === look) return { ...info, species };
  }
  return null;
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
