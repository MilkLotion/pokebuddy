// 화면이 읽는 목록 — 상점 상품과 도감 항목. 스냅샷과 같은 태도로 화면이 바로 그릴 값만 준다.
//
// 상점은 스냅샷에 함께 담는다(포켓몬 상품은 해금한 알 종이라 수백 줄이다). 도감은 1089종이라 탭을 열 때만 따로 부른다.
// 값의 출처는 한 곳이다. 가격은 `src/shop/catalog.ts`, 이름은 이름표, 상태는 저장이 가진다.
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { petName } from "../main/text.js";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules.js";
import { canGiveEgg, isSingleEgg, singleLeft, eggName, eggNote, eggPrice, slotPrice, speciesPrice, toolName, toolPrice } from "../shop/catalog.js";
import type { DexEntry, ShopItemView } from "../shared/manage";
import { evoItemNote } from "./shop-detail.js";
import { isRegional, regionalOf } from "../dex/regional.js";
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
    return room > 0 ? { room } : { room, blocked: `${SHOP_V3_RULES.bagMax}개까지만 살 수 있어요` };
  };

  // 알 — 돌보미집이 가득 차면 살 수 없다. 단일 포켓몬 알은 남은 종이 없으면 살 수 없다.
  // room 은 한 번에 살 수 있는 개수 — 빈 칸 수, 단일 포켓몬 알이면 (남은 종 수 − 기다리는 같은 알 수)까지 (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
  const daycareFull = save.eggs.length >= EGG_V3_RULES.maxEggs;
  const daycareRoom = Math.max(0, EGG_V3_RULES.maxEggs - save.eggs.length);
  const eggRoom = (kind: string): number => {
    if (!isSingleEgg(kind, opts)) return daycareRoom;
    const waiting = save.eggs.filter((e) => e.kind === kind).length;
    return Math.max(0, Math.min(daycareRoom, singleLeft(save, kind, opts).length - waiting));
  };
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
      room: eggRoom(kind),
      blocked: !canGiveEgg(save, kind, opts) ? "모두 모았어요" : daycareFull ? "돌보미집이 가득 찼어요" : undefined,
    });
  }

  // 포켓몬 — 해금한 종 가운데 상점에서 파는 종(알에서 얻을 수 있는 종). 도감 번호 순 (2026-09-29 사용자 결정)
  // 같은 번호면 기본형, 리전폼 순번 순이다
  const dexNo = (slug: string): number => species(opts)[slug]?.dex ?? Number.MAX_SAFE_INTEGER;
  const formNo = (slug: string): number => regionalOf(slug, opts)?.no ?? 0;
  const sold = save.dex.unlocked
    .map((slug) => ({ slug, price: speciesPrice(slug, opts) }))
    .filter((row): row is { slug: string; price: number } => row.price !== null)
    .sort((a, b) => dexNo(a.slug) - dexNo(b.slug) || formNo(a.slug) - formNo(b.slug) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const { slug, price } of sold) add({ id: slug, name: petName(slug), note: "", price, category: "pokemon", affordable: false, dex: species(opts)[slug]?.dex, ...formFields(slug, opts) });

  // 도구 — 상점에 파는 것만
  for (const [id, item] of Object.entries(items(opts))) {
    if (isMetaKey(id) || item.price === null) continue;
    add({ id, name: item.ko, note: "", price: item.price, category: "tool", affordable: false, ...bagRoom(id) });
  }

  // 진화용 도구 — 종류와 무관하게 같은 값이다
  for (const [id, item] of Object.entries(evoItems(opts))) {
    if (isMetaKey(id)) continue;
    const price = toolPrice(id, opts);
    if (price === null) continue;
    // 설명은 진화 전 종 이름 — "피카츄·레어코일 외 5종" (2026-09-30 사용자 결정, src/tx/shop-detail.ts evoItemNote)
    add({ id, name: item.ko, note: evoItemNote(save, id, opts), price, category: "evolution", affordable: false, ...bagRoom(id) });
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

// 리전폼 항목의 폼 순번·지방 — 리전폼이 아니면 빈 객체
function formFields(slug: string, opts?: DexOptions): { form?: number; region?: string } {
  const form = regionalOf(slug, opts);
  return form ? { form: form.no, region: form.region } : {};
}

// 도감 번호 하나에 슬러그가 여럿이면 기본형만 남긴다. 리전폼(src/dex/regional.ts)은 다른 종이라 따로 남긴다.
// 폼 슬러그는 `arceus-bug` 처럼 기본형 뒤에 접미사가 붙으므로 가장 짧은 것이 기본형이다.
// 슬러그에 하이픈이 있는지로는 가릴 수 없다 — `ho-oh` `porygon-z` 처럼 기본형에도 하이픈이 있다.
function baseForms(rows: Record<string, SpeciesEntry>, opts?: DexOptions): { slug: string; dex: number }[] {
  const byDex = new Map<number, string>();
  const regional: { slug: string; dex: number }[] = [];
  for (const [slug, row] of Object.entries(rows)) {
    if (isMetaKey(slug) || !row.dex) continue;
    if (isRegional(slug, opts)) {
      regional.push({ slug, dex: row.dex });
      continue;
    }
    const kept = byDex.get(row.dex);
    if (kept == null || slug.length < kept.length || (slug.length === kept.length && slug < kept)) byDex.set(row.dex, slug);
  }
  return [...[...byDex.entries()].map(([dex, slug]) => ({ slug, dex })), ...regional];
}

// 도감 항목 — 도감 번호 순. 상태는 획득 · 해금 · 미해금 셋이다
export function dexList(save: SaveV3, opts?: DexOptions): DexEntry[] {
  const obtained = new Set(save.dex.obtained);
  const unlocked = new Set(save.dex.unlocked);
  const shiny = new Set(save.dex.shinyObtained);
  const out: DexEntry[] = [];
  for (const { slug, dex } of baseForms(species(opts), opts)) {
    out.push({
      slug,
      dex,
      ...formFields(slug, opts),
      name: petName(slug),
      state: obtained.has(slug) ? "obtained" : unlocked.has(slug) ? "unlocked" : "locked",
      shiny: shiny.has(slug),
    });
  }
  out.sort((a, b) => a.dex - b.dex || (a.form ?? 0) - (b.form ?? 0));
  return out;
}

// 도구 하나의 이름 — 가방이 모르는 식별자를 만나도 화면이 비지 않게
export const nameOfItem = (id: string, opts?: DexOptions): string => toolName(id, opts) ?? id;

// 진화용 도구인가 — data/evo-items.json 에 있으면 그렇다
export const isEvoItem = (id: string, opts?: DexOptions): boolean => evoItems(opts)[id] != null;
