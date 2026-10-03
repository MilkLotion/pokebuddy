// 상점 상품 목록 v3 — 가격은 docs/specs/balance.md 가격표. 값은 한 곳에서만 가진다.
//
//   알          data/eggs.json 의 price
//   진화용 도구  data/evo-items.json 의 종류 공통 가격 (SHOP_RULES.evoItemPrice)
//   그 밖 도구   data/items.json 의 price. null 이면 팔지 않는다
//   파티 칸     SHOP_RULES.slotPrice — 늘 같은 값. 적용한 프리셋의 칸을 연다
//   파티 프리셋 SHOP_RULES.presetPrice — 늘 같은 값 (조건은 src/party/presets.ts presetBuyable)
//   종 지정     SHOP_RULES.speciesPrices — 수집 난이도(data/species.defaults.json 의 rank)별 가격.
//               알에서 얻을 수 있는 종만 판다. 해금한 종만 산다 (2026-09-29 사용자 결정)
// 값을 두 곳에 적지 않는다. 그래야 가격이 어긋나지 않는다.
// 기존 S4 의 src/shop/catalog.ts 와 별개다. 그쪽은 v2 경로가 계속 쓴다.
import { isMetaKey, type DexOptions } from "../dex/data.js";
import { fixedEggs, inRandomEgg, isSingleEgg } from "../dex/obtain.js";
import { rankOf } from "../dex/species.js";
import { eggTable, evoItemTable, itemTable } from "../dex/tables.js";
import { SHOP_RULES } from "./rules.js";
import { MINT_ID, MINT_RETIRED } from "../bag/mint.js";

export type ProductKind = "egg" | "tool" | "party-slot" | "species";

export interface Product {
  id: string;
  ko: string;
  price: number;
  kind: ProductKind;
  ref: string; // 알 종류 · 도구 식별자 · 종 슬러그
}

// 도구 하나의 가격. 팔지 않으면 null
export function toolPrice(id: string, opts?: DexOptions): number | null {
  if (isMetaKey(id)) return null;
  if (MINT_RETIRED && id === MINT_ID) return null; // 성격민트 은퇴 — 사지도 팔지도 않는다 (src/bag/mint.ts)
  const item = itemTable(opts)[id];
  if (item) return item.price;
  return evoItemTable(opts)[id] ? SHOP_RULES.evoItemPrice : null;
}

export function toolName(id: string, opts?: DexOptions): string | null {
  if (isMetaKey(id)) return null;
  return itemTable(opts)[id]?.ko ?? evoItemTable(opts)[id]?.ko ?? null;
}

// 파티 칸 하나의 가격 — 늘 같은 값이다. 상점으로 열 칸이 남지 않았으면 null. `left` 는 적용한 프리셋에 남은 상점 칸 수다
export function slotPrice(left: number): number | null {
  return left > 0 ? SHOP_RULES.slotPrice : null;
}

// 종 지정 구매 가격 — 수집 난이도별 값. 상점에서 팔지 않는 종이면 null. 해금 여부는 부르는 쪽이 본다
export function speciesPrice(slug: string, opts?: DexOptions): number | null {
  if (!sellsSpecies(slug, opts)) return null;
  return SHOP_RULES.speciesPrices[rankOf(slug, opts)] ?? null;
}

// 상점에서 파는 종인가 — 알에서 얻을 수 있는 종이다 (2026-09-29 사용자 결정)
//   랜덤알 후보            inRandomEgg (src/dex/obtain.ts)
//   화석                   단일 포켓몬 알이 아닌 종 목록 알(태고의돌)의 종
//   단일 포켓몬 알의 종    팔지 않는다 — 준전설·전설·환상·울트라비스트·패러독스
export function sellsSpecies(slug: string, opts?: DexOptions): boolean {
  if (isMetaKey(slug)) return false;
  if (inRandomEgg(slug, opts)) return true;
  return fixedEggs(opts).some(([kind, pool]) => !isSingleEgg(kind, opts) && pool.includes(slug));
}

export function eggPrice(kind: string, opts?: DexOptions): number | null {
  if (isMetaKey(kind)) return null;
  return eggTable(opts)[kind]?.price ?? null;
}

export function eggName(kind: string, opts?: DexOptions): string | null {
  if (isMetaKey(kind)) return null;
  return eggTable(opts)[kind]?.ko ?? null;
}

// 알 종류별 그림 색표 — 색표가 있는 알만. 메인의 그림 받기가 원작 알 그림의 색을 바꿔 쓴다 (src/main/art/egg-art.ts)
export function eggPalettes(opts?: DexOptions): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [kind, row] of Object.entries(eggTable(opts))) {
    if (isMetaKey(kind) || !Array.isArray(row.palette)) continue;
    out[kind] = row.palette.filter((c): c is string => typeof c === "string");
  }
  return out;
}

export function eggNote(kind: string, opts?: DexOptions): string | null {
  if (isMetaKey(kind)) return null;
  return eggTable(opts)[kind]?.note ?? null;
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
