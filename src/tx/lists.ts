// 화면이 읽는 목록 — 상점 상품과 도감 항목. 스냅샷과 같은 태도로 화면이 바로 그릴 값만 준다.
//
// 상점은 스냅샷에 함께 담는다(포켓몬 상품은 해금한 알 종이라 수백 줄이다). 도감은 1089종이라 탭을 열 때만 따로 부른다.
// 값의 출처는 한 곳이다. 가격은 `src/shop/catalog.ts`, 이름은 이름표, 상태는 저장이 가진다.
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { petName } from "../main/text.js";
import { EGG_V3_RULES, SAVE_V3_RULES, SHOP_V3_RULES } from "../save/rules.js";
import { canGiveEgg, isSingleEgg, singleLeft, eggName, eggNote, eggPrice, slotPrice, speciesPrice, toolName, toolPrice } from "../shop/catalog.js";
import type { DexEntry, ItemAbout, ShopAbout, ShopItemView } from "../shared/manage";
import { evoItemNote } from "./shop-detail.js";
import { isRegional, regionalOf } from "../dex/regional.js";
import { MINT_ID, MINT_RETIRED } from "../bag/mint.js";
import { activePreset, presetBuyable, presetCount, presetName, shopSlots } from "../party/presets.js";
import { boxBuyable } from "../box/slots.js";
import type { SaveV3 } from "../shared/save-v3";

interface EggEntry {
  ko: string;
  bonus?: Record<string, number>; // 포켓몬 대신 다른 알이 나올 확률
}

interface ItemEntry {
  ko: string;
  price: number | null;
  group?: string; // 상점 기기 창의 분류·설명·효과 (data/items.json)
  desc?: string;
  effectText?: string;
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

// 상점에 늘어놓을 상품. 살 수 없으면 이유를 함께 준다 — 화면이 비활성으로 그린다
export function shopList(save: SaveV3, opts?: DexOptions): ShopItemView[] {
  const out: ShopItemView[] = [];
  const add = (item: ShopItemView): void => {
    out.push({ ...item, affordable: save.points.balance >= item.price });
  };
  // 도구 — 가방에 더 담을 수 있는 개수. 다 찼으면 살 수 없다 (SHOP_V3_RULES.bagMax)
  // blocked 는 상점 기기 창 머리의 짧은 상태 글자다. 목록 줄은 바꾸지 않는다 (2026-10-02 사용자 결정 — 문구가 바뀌면 레이아웃이 깨진다)
  const bagRoom = (id: string): Pick<ShopItemView, "room" | "blocked"> => {
    const room = Math.max(0, SHOP_V3_RULES.bagMax - (save.bag[id] ?? 0));
    return room > 0 ? { room } : { room, blocked: "가방 가득" };
  };

  // 상점 기기 창 설명 — 정보 줄은 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정 "records에는 효과,쓰는곳 만 적어")
  const owned = (id: string): [string, string] => ["보유", `${(save.bag[id] ?? 0).toLocaleString("ko-KR")}개`];
  const readyMin = Math.round(EGG_V3_RULES.readyMs / 60_000);
  const eggAbout = (kind: string): ShopAbout => {
    // 다른 알이 나오는 알 — 확률 숫자는 적지 않는다 (2026-10-02 사용자 결정 "일정확률로 특별한 알")
    const bonus = Object.values(eggs(opts)[kind]?.bonus ?? {}).some((p) => p > 0);
    return {
      group: "알",
      spec: ["준비", `${readyMin}분`],
      desc: `${eggNote(kind, opts) ?? "포켓몬이 나온다"}. 돌보미집에 두면 ${readyMin}분 뒤 열 수 있다.`,
      effect: bonus ? "포켓몬 1마리 · 일정 확률로 특별한 알" : "포켓몬 1마리",
      where: `돌보미집 · ${readyMin}분 뒤 열기`,
    };
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
      about: eggAbout(kind),
      blocked: !canGiveEgg(save, kind, opts) ? "모두 모았어요" : daycareFull ? "돌보미집 가득" : undefined,
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
    if (MINT_RETIRED && id === MINT_ID) continue; // 성격민트 은퇴 (src/bag/mint.ts)
    // 상점의 쓰는 곳은 어디서 쓰는지까지 — 가방은 파티 개체에게만 쓴다 (2026-10-01 사용자 결정 "파티를 기준으로만 사용할 수 있게 하자")
    const about: ShopAbout = { ...(itemAbout(save, id, opts) as ItemAbout), spec: owned(id), where: "가방 › 사용 · 파티 포켓몬" };
    add({ id, name: item.ko, note: "", price: item.price, category: "tool", affordable: false, about, ...bagRoom(id) });
  }

  // 진화용 도구 — 종류와 무관하게 같은 값이다
  for (const [id, item] of Object.entries(evoItems(opts))) {
    if (isMetaKey(id)) continue;
    const price = toolPrice(id, opts);
    if (price === null) continue;
    // 설명은 진화 전 종 이름 — "피카츄·레어코일 외 5종" (2026-09-30 사용자 결정, src/tx/shop-detail.ts evoItemNote)
    // 기기 창의 `쓰는 곳` 도 같은 문구다 (2026-10-01 사용자 Figma 수정 "쓰는곳에 \"피카츄·레어코일 외 5종\" 이걸 적어야겠네")
    const note = evoItemNote(save, id, opts);
    const about: ShopAbout = { ...(itemAbout(save, id, opts) as ItemAbout), spec: owned(id) };
    add({ id, name: item.ko, note, price, category: "evolution", affordable: false, about, ...bagRoom(id) });
  }

  // 파티 칸 — 늘 같은 값. 적용한 프리셋의 칸을 연다. 프리셋마다 따로 산다 (2026-10-02 사용자 결정)
  const slots = shopSlots(save);
  const price = slotPrice(slots.left);
  const here = presetName(save, activePreset(save));
  add({
    id: "party-slot",
    name: "파티 칸 +1",
    note: `${here} · 구매 ${slots.bought} / ${slots.total}`,
    price: price ?? SHOP_V3_RULES.slotPrice,
    category: "slot",
    affordable: false,
    about: {
      group: "파티 칸",
      spec: ["구매", `${slots.bought} / ${slots.total}`],
      desc: `${here}의 파티 칸이 하나 늘어난다. 늘어난 칸에 포켓몬을 하나 더 꺼내 둘 수 있다.`,
      effect: "파티 칸 +1",
      where: `파티 탭 · ${here} · 사면 바로 열림`,
    },
    blocked: price === null ? "더 살 수 있는 칸이 없어요" : undefined,
  });

  // 파티 프리셋 — 늘 같은 값. 가진 프리셋의 칸을 모두 열어야 산다 (2026-10-02 사용자 결정)
  const { start, max } = SAVE_V3_RULES.party.presets;
  const count = presetCount(save);
  const can = presetBuyable(save);
  add({
    id: "party-preset",
    name: "파티 프리셋 +1",
    note: `구매 ${count - start} / ${max - start} · 칸 ${can.open} / ${can.need}`,
    price: SHOP_V3_RULES.presetPrice,
    category: "slot",
    affordable: false,
    about: {
      group: "파티 프리셋",
      spec: ["구매", `${count - start} / ${max - start}`],
      desc: "파티 프리셋이 하나 늘어난다. 프리셋마다 다른 포켓몬을 넣어 두고 바꿔 가며 꺼낸다.",
      effect: "파티 프리셋 +1 · 파티 칸 2칸",
      where: "파티 탭 · ◀ ▶ 로 바꾸기",
    },
    blocked: can.reason === "preset-max" ? "더 살 수 있는 프리셋이 없어요" : can.reason === "slots-not-full" ? `파티 칸을 모두 열어야 해요 (${can.open} / ${can.need})` : undefined,
  });

  // 박스 — 늘 같은 값. 상한까지 하나씩 산다. 파티 분류에 함께 둔다 (2026-10-02 사용자 결정 "파티분류로 ㅇㅇ")
  const boxes = boxBuyable(save.boxes);
  add({
    id: "box",
    name: "박스 +1",
    note: `구매 ${boxes.bought} / ${boxes.total}`,
    price: SHOP_V3_RULES.boxPrice,
    category: "slot",
    affordable: false,
    about: {
      group: "박스",
      spec: ["구매", `${boxes.bought} / ${boxes.total}`],
      desc: `박스가 하나 늘어난다. 박스 하나에 포켓몬을 ${SAVE_V3_RULES.box.size}마리 보관한다.`,
      effect: `박스 +1 · ${SAVE_V3_RULES.box.size}칸`,
      where: "박스 탭 · 맨 뒤에 생김",
    },
    blocked: boxes.ok ? undefined : "더 살 수 있는 박스가 없어요",
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
  const mega = new Set(save.dex.megaOpened ?? []);
  const out: DexEntry[] = [];
  for (const { slug, dex } of baseForms(species(opts), opts)) {
    out.push({
      slug,
      dex,
      ...formFields(slug, opts),
      name: petName(slug),
      state: obtained.has(slug) ? "obtained" : unlocked.has(slug) ? "unlocked" : "locked",
      shiny: shiny.has(slug),
      ...(mega.has(slug) ? { mega: true as const } : {}),
    });
  }
  out.sort((a, b) => a.dex - b.dex || (a.form ?? 0) - (b.form ?? 0));
  return out;
}

// 도구 하나의 이름 — 가방이 모르는 식별자를 만나도 화면이 비지 않게
export const nameOfItem = (id: string, opts?: DexOptions): string => toolName(id, opts) ?? id;

// 진화용 도구인가 — data/evo-items.json 에 있으면 그렇다
export const isEvoItem = (id: string, opts?: DexOptions): boolean => evoItems(opts)[id] != null;

// 도구 설명 — 상점·가방 기기 창이 같이 쓴다. 모르는 도구면 undefined
// 진화용 도구는 가방에서 쓰지 않는다 — 진화는 파티 상세의 진화 줄에서 한다 (2026-10-01 사용자 결정 "진화아이템에는 사용을 없애자").
// 쓰는 곳은 진화 탭 상품 줄과 같은 진화 전 종 이름이다 (2026-10-01 사용자 Figma 수정)
export function itemAbout(save: SaveV3, id: string, opts?: DexOptions): ItemAbout | undefined {
  if (isEvoItem(id, opts))
    return {
      group: "진화용 도구",
      desc: "정해진 포켓몬을 진화시키는 도구다. 진화는 파티 상세의 진화 줄에서 한다.",
      effect: "바로 진화 · 1개 소모",
      where: evoItemNote(save, id, opts),
    };
  const item = items(opts)[id];
  if (!item) return undefined;
  return { group: item.group ?? "도구", desc: item.desc ?? "", effect: item.effectText ?? "", where: "파티 포켓몬" };
}
