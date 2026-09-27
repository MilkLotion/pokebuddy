// 화면이 읽는 목록 — 상점 상품과 도감 항목. 스냅샷과 같은 태도로 화면이 바로 그릴 값만 준다.
//
// 상점은 작아서 스냅샷에 함께 담는다. 도감은 1089종이라 탭을 열 때만 따로 부른다.
// 값의 출처는 한 곳이다. 가격은 `src/shop/catalog.ts`, 이름은 이름표, 상태는 저장이 가진다.
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { petName } from "../main/text.js";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules.js";
import { canGiveEgg, eggName, eggNote, eggPrice, slotPrice, speciesPrice, toolName, toolPrice } from "../shop/catalog.js";
import type { DexEntry, ShopItemView } from "../shared/manage";
import type { SaveV3 } from "../shared/save-v3";

interface EggEntry {
  ko: string;
}

interface ItemEntry {
  ko: string;
  price: number | null;
}

interface EvoItemEntry {
  ko: string;
  targets: string[];
}

interface SpeciesEntry {
  dex: number;
}

const eggs = (opts?: DexOptions): Record<string, EggEntry> => loadJson<Record<string, EggEntry>>("eggs.json", opts);
const items = (opts?: DexOptions): Record<string, ItemEntry> => loadJson<Record<string, ItemEntry>>("items.json", opts);
const evoItems = (opts?: DexOptions): Record<string, EvoItemEntry> => loadJson<Record<string, EvoItemEntry>>("evo-items.json", opts);
const species = (opts?: DexOptions): Record<string, SpeciesEntry> => loadJson<Record<string, SpeciesEntry>>("species.defaults.json", opts);

// 상점으로 이미 연 칸 수 — 남은 잠긴 칸으로 센다
const boughtSlots = (save: SaveV3): number =>
  SAVE_V3_RULES.party.shopUnlock - save.party.slots.filter((s) => s.state === "locked" && s.unlockBy === "shop").length;

// 상점에 늘어놓을 상품. 살 수 없으면 이유를 함께 준다 — 화면이 비활성으로 그린다
export function shopList(save: SaveV3, opts?: DexOptions): ShopItemView[] {
  const out: ShopItemView[] = [];
  const add = (item: ShopItemView): void => {
    out.push({ ...item, affordable: save.points.balance >= item.price });
  };
  // 도구 — 가방에 더 담을 수 있는 개수. 다 찼으면 살 수 없다 (SHOP_V3_RULES.bagMax)
  const bagRoom = (id: string): Pick<ShopItemView, "room" | "blocked"> => {
    const room = Math.max(0, SHOP_V3_RULES.bagMax - (save.bag[id] ?? 0));
    return room > 0 ? { room } : { room, blocked: `가방이 가득 찼어요 (최대 ${SHOP_V3_RULES.bagMax}개)` };
  };

  // 알 — 돌보미집이 가득 차면 살 수 없다. 단일 포켓몬 알은 남은 종이 없으면 살 수 없다
  const daycareFull = save.eggs.length >= EGG_V3_RULES.maxEggs;
  for (const kind of Object.keys(eggs(opts))) {
    if (isMetaKey(kind)) continue;
    const price = eggPrice(kind, opts);
    if (price === null) continue;
    add({
      id: kind,
      name: eggName(kind, opts) ?? kind,
      note: eggNote(kind, opts) ?? "",
      price,
      category: "egg",
      affordable: false,
      blocked: !canGiveEgg(save, kind, opts) ? "모두 모았어요" : daycareFull ? "돌보미집이 가득 찼어요" : undefined,
    });
  }

  // 포켓몬 — 해금한 종만
  for (const slug of save.dex.unlocked) {
    const price = speciesPrice(slug, opts);
    if (price === null) continue;
    add({ id: slug, name: petName(slug), note: "종 지정 구매 · 새 개체", price, category: "pokemon", affordable: false });
  }

  // 도구 — 상점에 파는 것만
  for (const [id, item] of Object.entries(items(opts))) {
    if (isMetaKey(id) || item.price === null) continue;
    add({ id, name: item.ko, note: "가방에 담긴다", price: item.price, category: "tool", affordable: false, ...bagRoom(id) });
  }

  // 진화용 도구 — 종류와 무관하게 같은 값이다
  for (const [id, item] of Object.entries(evoItems(opts))) {
    if (isMetaKey(id)) continue;
    const price = toolPrice(id, opts);
    if (price === null) continue;
    add({ id, name: item.ko, note: `대상 ${item.targets.length}종`, price, category: "evolution", affordable: false, ...bagRoom(id) });
  }

  // 파티 칸 — 순서마다 값이 다르다
  const bought = boughtSlots(save);
  const price = slotPrice(bought);
  add({
    id: "party-slot",
    name: "파티 칸 +1",
    note: `구매 ${bought} / ${SAVE_V3_RULES.party.shopUnlock}`,
    price: price ?? 0,
    category: "slot",
    affordable: false,
    blocked: price === null ? "더 살 수 있는 칸이 없어요" : undefined,
  });

  return out;
}

// 도감 번호 하나에 슬러그가 여럿이면 기본형만 남긴다.
// 폼 슬러그는 `arceus-bug` 처럼 기본형 뒤에 접미사가 붙으므로 가장 짧은 것이 기본형이다.
// 슬러그에 하이픈이 있는지로는 가릴 수 없다 — `ho-oh` `porygon-z` 처럼 기본형에도 하이픈이 있다.
function baseForms(rows: Record<string, SpeciesEntry>): { slug: string; dex: number }[] {
  const byDex = new Map<number, string>();
  for (const [slug, row] of Object.entries(rows)) {
    if (isMetaKey(slug) || !row.dex) continue;
    const kept = byDex.get(row.dex);
    if (kept == null || slug.length < kept.length || (slug.length === kept.length && slug < kept)) byDex.set(row.dex, slug);
  }
  return [...byDex.entries()].map(([dex, slug]) => ({ slug, dex }));
}

// 도감 항목 — 도감 번호 순. 상태는 획득 · 해금 · 미해금 셋이다
export function dexList(save: SaveV3, opts?: DexOptions): DexEntry[] {
  const obtained = new Set(save.dex.obtained);
  const unlocked = new Set(save.dex.unlocked);
  const shiny = new Set(save.dex.shinyObtained);
  const out: DexEntry[] = [];
  for (const { slug, dex } of baseForms(species(opts))) {
    out.push({
      slug,
      dex,
      name: petName(slug),
      state: obtained.has(slug) ? "obtained" : unlocked.has(slug) ? "unlocked" : "locked",
      shiny: shiny.has(slug),
      condition: save.dex.discovered[slug] ?? null,
    });
  }
  out.sort((a, b) => a.dex - b.dex);
  return out;
}

// 도구 하나의 이름 — 가방이 모르는 식별자를 만나도 화면이 비지 않게
export const nameOfItem = (id: string, opts?: DexOptions): string => toolName(id, opts) ?? id;

// 진화용 도구인가 — data/evo-items.json 에 있으면 그렇다
export const isEvoItem = (id: string, opts?: DexOptions): boolean => evoItems(opts)[id] != null;
