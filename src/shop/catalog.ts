// 상점 상품 목록 v3 — 가격은 docs/specs/balance.md 가격표. 값은 한 곳에서만 가진다.
//
//   알          data/eggs.json 의 price
//   진화용 도구  data/evo-items.json 의 종류 공통 가격 (SHOP_V3_RULES.evoItemPrice)
//   그 밖 도구   data/items.json 의 price. null 이면 팔지 않는다
//   파티 칸     SHOP_V3_RULES.slotPrice — 늘 같은 값. 적용한 프리셋의 칸을 연다
//   파티 프리셋 SHOP_V3_RULES.presetPrice — 늘 같은 값 (조건은 src/party/presets.ts presetBuyable)
//   종 지정     SHOP_V3_RULES.speciesPrices — 수집 난이도(data/species.defaults.json 의 rank)별 가격.
//               알에서 얻을 수 있는 종만 판다. 해금한 종만 산다 (2026-09-29 사용자 결정)
// 값을 두 곳에 적지 않는다. 그래야 가격이 어긋나지 않는다.
// 기존 S4 의 src/shop/catalog.ts 와 별개다. 그쪽은 v2 경로가 계속 쓴다.
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { SHOP_V3_RULES } from "../save/rules.js";
import { unlockRules } from "../dex/unlocks.js";
import { prevOf } from "../dex/evo.js";
import { rankOf } from "../egg/hatch.js";
import { MINT_ID, MINT_RETIRED } from "../bag/mint.js";
import type { SaveV3 } from "../shared/save-v3";

export type ProductKind = "egg" | "tool" | "party-slot" | "species";

export interface Product {
  id: string;
  ko: string;
  price: number;
  kind: ProductKind;
  ref: string; // 알 종류 · 도구 식별자 · 종 슬러그
}

interface EggEntry {
  ko: string;
  price: number | null; // null 이면 상점에서 팔지 않는다
  note?: string; // 상점의 설명 줄
  pool?: unknown; // "unlocked" 또는 종 목록
  single?: boolean; // 단일 포켓몬 알 — 종별 한 번만 얻는다
  bonus?: Record<string, number>; // 열 때 포켓몬 대신 다른 알이 나올 확률
  palette?: string[]; // 알 그림 색표 — 원작 egg.png 의 9색을 같은 순서로 바꾼다
}

interface ItemEntry {
  ko: string;
  price: number | null;
}

interface EvoItemEntry {
  ko: string;
}

const eggs = (opts?: DexOptions): Record<string, EggEntry> => loadJson<Record<string, EggEntry>>("eggs.json", opts);
const items = (opts?: DexOptions): Record<string, ItemEntry> => loadJson<Record<string, ItemEntry>>("items.json", opts);
const evoItems = (opts?: DexOptions): Record<string, EvoItemEntry> => loadJson<Record<string, EvoItemEntry>>("evo-items.json", opts);

// 도구 하나의 가격. 팔지 않으면 null
export function toolPrice(id: string, opts?: DexOptions): number | null {
  if (isMetaKey(id)) return null;
  if (MINT_RETIRED && id === MINT_ID) return null; // 성격민트 은퇴 — 사지도 팔지도 않는다 (src/bag/mint.ts)
  const item = items(opts)[id];
  if (item) return item.price;
  return evoItems(opts)[id] ? SHOP_V3_RULES.evoItemPrice : null;
}

export function toolName(id: string, opts?: DexOptions): string | null {
  if (isMetaKey(id)) return null;
  return items(opts)[id]?.ko ?? evoItems(opts)[id]?.ko ?? null;
}

// 파티 칸 하나의 가격 — 늘 같은 값이다. 상점으로 열 칸이 남지 않았으면 null. `left` 는 적용한 프리셋에 남은 상점 칸 수다
export function slotPrice(left: number): number | null {
  return left > 0 ? SHOP_V3_RULES.slotPrice : null;
}

// 종 지정 구매 가격 — 수집 난이도별 값. 상점에서 팔지 않는 종이면 null. 해금 여부는 부르는 쪽이 본다
export function speciesPrice(slug: string, opts?: DexOptions): number | null {
  if (!sellsSpecies(slug, opts)) return null;
  return SHOP_V3_RULES.speciesPrices[rankOf(slug, opts)] ?? null;
}

// 상점에서 파는 종인가 — 알에서 얻을 수 있는 종이다 (2026-09-29 사용자 결정)
//   랜덤알 후보            inRandomEgg
//   화석                   단일 포켓몬 알이 아닌 종 목록 알(태고의돌)의 종
//   단일 포켓몬 알의 종    팔지 않는다 — 준전설·전설·환상·울트라비스트·패러독스
export function sellsSpecies(slug: string, opts?: DexOptions): boolean {
  if (isMetaKey(slug)) return false;
  if (inRandomEgg(slug, opts)) return true;
  return fixedEggs(opts).some(([kind, pool]) => !isSingleEgg(kind, opts) && pool.includes(slug));
}

export function eggPrice(kind: string, opts?: DexOptions): number | null {
  if (isMetaKey(kind)) return null;
  return eggs(opts)[kind]?.price ?? null;
}

export function eggName(kind: string, opts?: DexOptions): string | null {
  if (isMetaKey(kind)) return null;
  return eggs(opts)[kind]?.ko ?? null;
}

// 알 종류별 그림 색표 — 색표가 있는 알만. 관리 창이 원작 알 그림의 색을 바꿔 쓴다
export function eggPalettes(opts?: DexOptions): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [kind, row] of Object.entries(eggs(opts))) {
    if (isMetaKey(kind) || !Array.isArray(row.palette)) continue;
    out[kind] = row.palette.filter((c): c is string => typeof c === "string");
  }
  return out;
}

export function eggNote(kind: string, opts?: DexOptions): string | null {
  if (isMetaKey(kind)) return null;
  return eggs(opts)[kind]?.note ?? null;
}

// 알에서 나올 수 있는 종. `unlocked` 이면 해금한 종에서 뽑는다는 뜻이라 여기서는 null
export function eggPool(kind: string, opts?: DexOptions): string[] | null {
  const raw = isMetaKey(kind) ? undefined : eggs(opts)[kind]?.pool;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : null;
}

// 종 목록을 가진 알 전부 — [알 종류, 종 목록]. 태고의돌과 단일 포켓몬 알이다
export function fixedEggs(opts?: DexOptions): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const kind of Object.keys(eggs(opts))) {
    const pool = eggPool(kind, opts);
    if (pool) out.push([kind, pool]);
  }
  return out;
}

// ── 단일 포켓몬 알 (data/eggs.json 의 single) ──────────────────────────────────
// 종별로 저장마다 한 번만 얻는다. 이미 얻은 종은 후보에서 뺀다.
// 같은 알이 돌보미집에 여럿 기다릴 수 있다. 남은 종 수가 기다리는 알 수보다 많을 때만 새로 준다 —
// 그래야 알마다 열 때 남은 종이 적어도 하나 있다

export const isSingleEgg = (kind: string, opts?: DexOptions): boolean => !isMetaKey(kind) && eggs(opts)[kind]?.single === true;

// 아직 얻지 않은 종
export function singleLeft(save: SaveV3, kind: string, opts?: DexOptions): string[] {
  return (eggPool(kind, opts) ?? []).filter((slug) => !save.dex.obtained.includes(slug));
}

// 이 알을 하나 더 줄 수 있는가 — 단일 포켓몬 알이 아니면 늘 된다
export function canGiveEgg(save: SaveV3, kind: string, opts?: DexOptions): boolean {
  if (!isSingleEgg(kind, opts)) return true;
  const waiting = save.eggs.filter((e) => e.kind === kind).length;
  return singleLeft(save, kind, opts).length > waiting;
}

// 이 알을 열 때 다른 알이 나올 확률 — [알 종류, 확률]. 데이터에 적은 순서대로
export function eggBonus(kind: string, opts?: DexOptions): [string, number][] {
  if (isMetaKey(kind)) return [];
  return Object.entries(eggs(opts)[kind]?.bonus ?? {}).filter(([k, p]) => typeof p === "number" && p > 0 && eggs(opts)[k] != null);
}

// 랜덤알에서 나올 수 있는 종인가 — 해금 여부는 부르는 쪽이 본다 (docs/specs/game.md "랜덤알", "부화 준비와 결과")
//   해금 규칙이 없는 종        뺀다. 전설·환상·울트라비스트는 규칙이 없다 — 입수 경로를 따로 정한다.
//                              업적 보상 종(메타몽·라프라스)도 규칙이 없다 — 업적으로만 얻는다 (2026-09-29)
//                              옛 규칙으로 이미 해금된 저장도 여기서 걸러진다
//   진화 전용 종               뺀다. 해금 규칙이 진화(evolve)인 종이다(리자드·라이츄). 첫 선택 후보(starter)는 남는다
//   진화 전 종이 있는 종       뺀다. 해금 규칙이 진화가 아니어도 진화형이면 뺀다. 첫 선택 후보는 남는다.
//                              알은 늘 진화 전 종이다 (2026-09-28 사용자 결정 "알은 항상 진화 전 종")
//   고정 후보 알의 종          뺀다. 화석은 태고의돌(해금 뒤에는 상점에서도), 단일 포켓몬은 그 알로만 얻는다
export function inRandomEgg(slug: string, opts?: DexOptions): boolean {
  const rule = unlockRules(opts)[slug];
  if (!rule) return false;
  if (rule.evolve && !rule.starter) return false;
  if (prevOf(slug, opts) && !rule.starter) return false;
  return !fixedEggs(opts).some(([, pool]) => pool.includes(slug));
}

// 이 종이 나오는 알 — 종 목록 알(태고의돌)을 먼저 보고, 없으면 해금한 종에서 뽑는 알(랜덤알)이다.
// 단일 포켓몬 알은 빼고 본다. 어느 알에도 없으면 null (업적 보상 종 등)
export function eggOfSpecies(slug: string, opts?: DexOptions): string | null {
  if (isMetaKey(slug)) return null;
  const fixed = fixedEggs(opts).find(([kind, pool]) => !isSingleEgg(kind, opts) && pool.includes(slug));
  if (fixed) return fixed[0];
  if (!inRandomEgg(slug, opts)) return null;
  return Object.keys(eggs(opts)).find((kind) => !isMetaKey(kind) && eggs(opts)[kind]?.pool === "unlocked") ?? null;
}

// 상품 하나를 찾는다. 알 · 도구 · 종 순서로 본다
export function find(id: string, opts?: DexOptions): Product | null {
  const price = eggPrice(id, opts);
  if (price !== null) return { id, ko: eggName(id, opts) ?? id, price, kind: "egg", ref: id };

  const tool = toolPrice(id, opts);
  if (tool !== null) return { id, ko: toolName(id, opts) ?? id, price: tool, kind: "tool", ref: id };

  const species = speciesPrice(id, opts);
  if (species !== null) return { id, ko: id, price: species, kind: "species", ref: id };

  return null;
}
