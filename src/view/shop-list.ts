// 화면이 읽는 목록 — 상점 상품과 도감 항목. 스냅샷과 같은 태도로 화면이 바로 그릴 값만 준다.
//
// 상점은 스냅샷에 함께 담는다(포켓몬 상품은 해금한 알 종이라 수백 줄이다). 도감은 1089종이라 탭을 열 때만 따로 부른다.
// 값의 출처는 한 곳이다. 가격은 `src/shop/catalog.ts`, 이름은 이름표, 상태는 저장이 가진다.
import { type DexOptions, loadJson, isMetaKey } from "../dex/data.js";
import { petName } from "../main/text.js";
import { eggName, speciesPrice, eggNote, eggPrice, slotPrice, toolPrice } from "../shop/catalog.js";
import type { SaveV3 } from "../shared/save-v3";
import { regionalOf } from "../dex/regional.js";
import { EGG_RULES } from "../egg/rules.js";
import { PARTY_RULES } from "../party/rules.js";
import { SHOP_RULES } from "../shop/rules.js";
import { eggPool, isSingleEgg } from "../dex/obtain.js";
import { canGiveEgg, eggRoomOf } from "../egg/pool.js";
import { bagRoomOf } from "../bag/items.js";
import type { EggPoolView, ItemAbout, ShopAbout, ShopItemView } from "../shared/model/snapshot";
import { MINT_ID, MINT_RETIRED } from "../bag/mint.js";
import { activePreset, presetBuyable, presetCount, presetName, shopSlots } from "../party/presets.js";
import { boxBuyable } from "../box/slots.js";
import { itemAbout } from "./bag.js";
import { evoItemNote } from "./shop-detail.js";
import { eggTable, itemTable, evoItemTable, speciesTable } from "../dex/tables.js";
import { BOX_RULES } from "../box/rules.js";
import { formFields } from "./dex-list.js";

// 상점에 늘어놓을 상품. 살 수 없으면 이유를 함께 준다 — 화면이 비활성으로 그린다
export function shopList(save: SaveV3, opts?: DexOptions): ShopItemView[] {
  const out: ShopItemView[] = [];
  const add = (item: ShopItemView): void => {
    out.push({ ...item, affordable: save.points.balance >= item.price });
  };
  // 도구 — 가방에 더 담을 수 있는 개수. 다 찼으면 살 수 없다 (BAG_RULES.max)
  // blocked 는 상점 기기 창 머리의 짧은 상태 글자다. 목록 줄은 바꾸지 않는다 (2026-10-02 사용자 결정 — 문구가 바뀌면 레이아웃이 깨진다)
  const bagRoom = (id: string): Pick<ShopItemView, "room" | "blocked"> => {
    const room = bagRoomOf(save, id);
    return room > 0 ? { room } : { room, blocked: "가방 가득" };
  };

  // 상점 기기 창 설명 — 정보 줄은 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정 "records에는 효과,쓰는곳 만 적어")
  const owned = (id: string): [string, string] => ["보유", `${(save.bag[id] ?? 0).toLocaleString("ko-KR")}개`];
  const readyMin = Math.round(EGG_RULES.readyMs / 60_000);
  const eggAbout = (kind: string): ShopAbout => {
    // 다른 알이 나오는 알 — 확률 숫자는 적지 않는다 (2026-10-02 사용자 결정 "일정확률로 특별한 알")
    const bonus = Object.values(eggTable(opts)[kind]?.bonus ?? {}).some((p) => p > 0);
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
  const daycareFull = save.eggs.length >= EGG_RULES.maxEggs;
  const eggRoom = (kind: string): number => eggRoomOf(save, kind, opts);
  // 종 목록이 정해진 알의 후보 — 얻었는지와 함께. 랜덤알은 목록이 없다
  const got = new Set(save.dex.obtained);
  const poolOf = (kind: string): { pool?: EggPoolView } => {
    const list = eggPool(kind, opts);
    if (!list) return {};
    const entries = list.map((slug) => ({ slug, dex: speciesTable(opts)[slug]?.dex ?? 0, ...(regionalOf(slug, opts) ? { form: regionalOf(slug, opts)?.no } : {}), name: petName(slug), obtained: got.has(slug) }));
    entries.sort((a, b) => a.dex - b.dex || (a.form ?? 0) - (b.form ?? 0)); // 도감 번호 순 — 도감과 같다
    return { pool: { single: isSingleEgg(kind, opts), entries } };
  };
  for (const kind of Object.keys(eggTable(opts))) {
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
      ...poolOf(kind),
      blocked: !canGiveEgg(save, kind, opts) ? "모두 모았어요" : daycareFull ? "돌보미집 가득" : undefined,
    });
  }

  // 포켓몬 — 해금한 종 가운데 상점에서 파는 종(알에서 얻을 수 있는 종). 도감 번호 순 (2026-09-29 사용자 결정)
  // 같은 번호면 기본형, 리전폼 순번 순이다
  const dexNo = (slug: string): number => speciesTable(opts)[slug]?.dex ?? Number.MAX_SAFE_INTEGER;
  const formNo = (slug: string): number => regionalOf(slug, opts)?.no ?? 0;
  const sold = save.dex.unlocked
    .map((slug) => ({ slug, price: speciesPrice(slug, opts) }))
    .filter((row): row is { slug: string; price: number } => row.price !== null)
    .sort((a, b) => dexNo(a.slug) - dexNo(b.slug) || formNo(a.slug) - formNo(b.slug) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const { slug, price } of sold) add({ id: slug, name: petName(slug), note: "", price, category: "pokemon", affordable: false, dex: speciesTable(opts)[slug]?.dex, ...formFields(slug, opts) });

  // 도구 — 상점에 파는 것만
  for (const [id, item] of Object.entries(itemTable(opts))) {
    if (isMetaKey(id) || item.price === null) continue;
    if (MINT_RETIRED && id === MINT_ID) continue; // 성격민트 은퇴 (src/bag/mint.ts)
    // 상점의 쓰는 곳은 어디서 쓰는지까지 — 가방은 파티 개체에게만 쓴다 (2026-10-01 사용자 결정 "파티를 기준으로만 사용할 수 있게 하자")
    const about: ShopAbout = { ...(itemAbout(save, id, opts) as ItemAbout), spec: owned(id), where: "가방 › 사용 · 파티 포켓몬" };
    add({ id, name: item.ko, note: "", price: item.price, category: "tool", affordable: false, about, ...bagRoom(id) });
  }

  // 진화용 도구 — 종류와 무관하게 같은 값이다
  for (const [id, item] of Object.entries(evoItemTable(opts))) {
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
    price: price ?? SHOP_RULES.slotPrice,
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
  const { start, max } = PARTY_RULES.presets;
  const count = presetCount(save);
  const can = presetBuyable(save);
  add({
    id: "party-preset",
    name: "파티 프리셋 +1",
    note: `구매 ${count - start} / ${max - start} · 칸 ${can.open} / ${can.need}`,
    price: SHOP_RULES.presetPrice,
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
    price: SHOP_RULES.boxPrice,
    category: "slot",
    affordable: false,
    about: {
      group: "박스",
      spec: ["구매", `${boxes.bought} / ${boxes.total}`],
      desc: `박스가 하나 늘어난다. 박스 하나에 포켓몬을 ${BOX_RULES.size}마리 보관한다.`,
      effect: `박스 +1 · ${BOX_RULES.size}칸`,
      where: "박스 탭 · 맨 뒤에 생김",
    },
    blocked: boxes.ok ? undefined : "더 살 수 있는 박스가 없어요",
  });

  return out;
}
