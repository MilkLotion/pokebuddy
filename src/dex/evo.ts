// 진화 사슬 — data/evo.json (src/tools/data/build-evo.ts). 종 단위 표이고, 폼 슬러그(rotom-wash · deoxys-attack)는
// 같은 도감번호의 기본 종으로 풀어 본다 — 그래서 lineOf 는 "같은 사슬의 모습 전부" 를 준다 (design.md "모습 선택지")
//
// stageOf 는 사슬의 뿌리부터의 거리(도감 사실)다. 저장의 Pet.stage(그 마리가 몇 번 진화했나)와는 다른 수 —
// 피츄→피카츄→라이츄에서 스타터 피카츄는 stageOf 1, Pet.stage 0
//
// 리전폼(raichu-alola · meowth-galar, src/dex/regional.ts)은 도감 번호가 같아도 다른 종이다 — 기본 종으로 풀지 않는다.
// 기본형과 리전폼이 같은 종으로 진화하면(나옹·가라르 나옹 → 페르시온) 부모는 기본형이다

import type { DayPart, EvoNeed, Gender } from "../shared/species";
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";
import { isRegional } from "./regional.js";

export interface EvoStep {
  to: string;
  when?: DayPart;
  need?: EvoNeed; // 진화 조건 — 옛 data/evo.json 에는 없다 (src/tools/data/build-evo.ts)
  gender?: Exclude<Gender, "none">; // 이 성별만 진화한다 — 염뉴트 암컷, 엘레이드 수컷 (2026-09-30 사용자 결정)
  map?: true; // 지도(region-map)도 필요한 간선 — 기본형 → 리전폼 진화 (data/regional.json)
  affinity?: number; // 조건에 더해 친밀도도 이만큼 필요한 간선 — 암멍이 → 루가루암(황혼의 모습) (Lv.25 와 친밀도 100, data/regional.json)
}

type EvoTable = Record<string, EvoStep[]>;
type SpeciesDex = Record<string, { dex: number }>;

interface Index {
  parentOf: Map<string, string>; // 자식 → 부모
  members: Set<string>; // 사슬에 나오는 슬러그 전부
  baseOfDex: Map<number, string>; // 도감번호 → 기본 종 (사슬 멤버가 있으면 그것, 없으면 가장 짧은 슬러그 — 폼 슬러그는 기본 종 뒤에 붙어 항상 더 길다)
  formsOfDex: Map<number, string[]>; // 도감번호 → 그 번호의 슬러그 전부(정렬)
  dexOf: Map<string, number>;
}

const indexes = new WeakMap<EvoTable, Index>();

const table = (opts?: DexOptions): EvoTable => loadJson<EvoTable>("evo.json", opts);

function indexOf(opts?: DexOptions): Index {
  const evo = table(opts);
  const hit = indexes.get(evo);
  if (hit) return hit;
  const parentOf = new Map<string, string>();
  const members = new Set<string>();
  for (const [from, steps] of Object.entries(evo)) {
    if (isMetaKey(from)) continue;
    members.add(from);
    for (const s of steps) {
      members.add(s.to);
      // 부모가 이미 있으면 리전폼 부모로 덮어쓰지 않는다 — 페르시온의 부모는 나옹이다
      const kept = parentOf.get(s.to);
      if (kept === undefined || (isRegional(kept, opts) && !isRegional(from, opts))) parentOf.set(s.to, from);
    }
  }
  const species = loadJson<SpeciesDex>("species.defaults.json", opts);
  const dexOf = new Map<string, number>();
  const formsOfDex = new Map<number, string[]>();
  const baseOfDex = new Map<number, string>();
  for (const [slug, p] of Object.entries(species)) {
    if (isMetaKey(slug) || !p.dex) continue;
    dexOf.set(slug, p.dex);
    const list = formsOfDex.get(p.dex) ?? [];
    list.push(slug);
    formsOfDex.set(p.dex, list);
  }
  for (const [dex, list] of formsOfDex) {
    list.sort();
    // 기본 종 후보에서 리전폼은 뺀다 — 리전폼은 자기 자신으로 풀리므로 기본 종이 될 일이 없다
    const plain = list.filter((s) => !isRegional(s, opts));
    const member = plain.find((s) => members.has(s));
    const shortest = [...plain].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
    const base = member ?? shortest;
    if (base) baseOfDex.set(dex, base);
  }
  const built: Index = { parentOf, members, baseOfDex, formsOfDex, dexOf };
  indexes.set(evo, built);
  return built;
}

// 슬러그 → 대신 볼 기본 종. 사슬 멤버면 그대로, 폼이면 같은 도감번호의 기본 종(rotom-wash → rotom), 모르는 슬러그는 자기 자신.
// 리전폼은 늘 자기 자신 — 가라르 메더처럼 간선이 없는 리전폼도 기본형 간선을 받지 않는다
function resolve(slug: string, opts?: DexOptions): string {
  const key = normalizeSlug(slug);
  const ix = indexOf(opts);
  if (ix.members.has(key) || isRegional(key, opts)) return key;
  const dex = ix.dexOf.get(key);
  const base = dex === undefined ? undefined : ix.baseOfDex.get(dex);
  return base ?? key;
}

// 다음 단계들 — 분기가 있으면 여럿(이브이 8). 없으면 []
export const nextOf = (slug: string, opts?: DexOptions): EvoStep[] => (table(opts)[resolve(slug, opts)] ?? []).map((s) => ({ ...s }));

// 이전 단계 — 뿌리면 null
export const prevOf = (slug: string, opts?: DexOptions): string | null => indexOf(opts).parentOf.get(resolve(slug, opts)) ?? null;

// 사슬의 뿌리
export function rootOf(slug: string, opts?: DexOptions): string {
  const ix = indexOf(opts);
  let cur = resolve(slug, opts);
  let guard = 0;
  while (ix.parentOf.has(cur) && guard < 10) {
    cur = ix.parentOf.get(cur) as string;
    guard += 1;
  }
  return cur;
}

// 뿌리부터의 거리 — 뿌리 0. 사슬에 없는 종도 0
export function evoStageOf(slug: string, opts?: DexOptions): number {
  const ix = indexOf(opts);
  let cur = resolve(slug, opts);
  let n = 0;
  while (ix.parentOf.has(cur) && n < 10) {
    cur = ix.parentOf.get(cur) as string;
    n += 1;
  }
  return n;
}

// 사슬 전체 — 뿌리부터 너비 우선, 종마다 그 종의 폼(같은 도감번호)을 뒤에 붙인다. 모습 선택지의 후보
// 사슬에 없는 종은 자기 자신(+ 폼)만
export function lineOf(slug: string, opts?: DexOptions): string[] {
  const evo = table(opts);
  const ix = indexOf(opts);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
    const dex = ix.dexOf.get(s);
    for (const form of dex === undefined ? [] : (ix.formsOfDex.get(dex) ?? [])) {
      if (seen.has(form) || isRegional(form, opts)) continue; // 리전폼은 모습이 아니라 다른 종이다
      seen.add(form);
      out.push(form);
    }
  };
  const queue = [rootOf(slug, opts)];
  while (queue.length) {
    const cur = queue.shift() as string;
    push(cur);
    for (const s of evo[cur] ?? []) queue.push(s.to);
  }
  return out;
}

// 사슬에 나오는 종인가 (폼은 기본 종으로 풀어 본다)
export const inChain = (slug: string, opts?: DexOptions): boolean => indexOf(opts).members.has(resolve(slug, opts));
