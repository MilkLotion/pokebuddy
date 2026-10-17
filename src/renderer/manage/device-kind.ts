// 기기 종류 탭 — 같은 대상을 다른 기기로 같은 자리에서 본다 (docs/specs/ui-components.md "기기 종류 탭", 2026-10-17 사용자 확정)
// - 탭마다 본래 기기가 있다(파티·박스 → 파티 상세, 도감 → 도감, 모험 → 배틀, 상점 → 상점, 가방 → 가방). 머리 탭으로 바꾸면 swapped 에 둔다
// - 대상은 연 탭이 고른 것 그대로다(개체·종·배틀 칸·상품·도구). 기기 연결 다섯은 여기에 "지금 띄울 것"을 묻는다 — 연결마다 사본을 두지 않는다
// - 탭 자리는 고정이다: 포켓몬 기기 파티|도감|배틀, 도구 기기 상점|가방. 지금 기기만 current, 볼 수 없는 기기는 disabled
// - 다른 탭의 고른 값(도감 칸·배틀 칸·상품·도구)은 그 파일을 import 하지 않고 고리로 받는다 — 연결 파일들이 이 파일을 import 한다
import type { DeviceKind, DeviceKindTab } from "../../shared/model/devices.js";
import type { PetView } from "../../shared/model/snapshot.js";
import type { TabId } from "./dialog-types.js";
import { boxPets, partyPets, petInView, ui } from "./state.js";

const HOME: Record<TabId, DeviceKind> = { party: "pet", box: "pet", dex: "dex", adventure: "battle", shop: "shop", bag: "bag" };
const POKEMON: readonly DeviceKind[] = ["pet", "dex", "battle"];
const ITEM: readonly DeviceKind[] = ["shop", "bag"];
const TOOL_CATEGORIES = new Set(["tool", "evolution"]); // 가방에 들어가는 상품 — 상품 id 가 곧 도구 id 다 (src/view/device-art.ts shopIconKey)

export interface DeviceKindHooks {
  dexPick(): string | null; // 도감 탭의 고른 종
  battleSlot(): number | null; // 모험 탭의 고른 배틀 칸
  shopPick(): string | null; // 상점 탭의 고른 상품
  bagPick(): string | null; // 가방 탭의 고른 도구
  closeSubject(tab: TabId): void; // 보이던 기기 창을 닫았다 — 그 탭의 고른 것을 비운다
  redraw(): void;
}
let hooks: DeviceKindHooks | null = null;
export function setDeviceKindHooks(next: DeviceKindHooks): void {
  hooks = next;
}
function hooksOf(): DeviceKindHooks {
  if (!hooks) throw new Error("device-kind.ts 의 고리가 걸리지 않았다 — setDeviceKindHooks 를 먼저 부른다");
  return hooks;
}

let swapped: DeviceKind | null = null; // 머리 탭으로 바꾼 기기. null 이면 탭의 본래 기기

export const shownKind = (): DeviceKind => swapped ?? HOME[ui.tab];

// 탭을 나갔다·상세 보기로 왔다 — 다음에는 본래 기기로 연다
export function resetKind(): void {
  swapped = null;
}

// 연 탭이 고른 것이 있다 — 없으면 기기 창을 띄우지 않는다
function hasSubject(): boolean {
  const h = hooksOf();
  switch (ui.tab) {
    case "party":
    case "box":
      return ui.detailPet != null;
    case "dex":
      return h.dexPick() != null;
    case "adventure":
      return h.battleSlot() != null;
    case "shop":
      return h.shopPick() != null;
    case "bag":
      return h.bagPick() != null;
  }
}

// 대상 개체 — 파티·박스는 고른 개체, 모험은 그 칸의 개체, 도감은 그 종의 내 개체(파티 → 박스 순 첫 개체)
function subjectPet(): PetView | null {
  const h = hooksOf();
  if (ui.tab === "party" || ui.tab === "box") return ui.detailPet ? petInView(ui.detailPet) : null;
  if (ui.tab === "adventure") {
    const slot = h.battleSlot();
    return slot == null ? null : (ui.view?.battle.slots[slot]?.pet ?? null);
  }
  if (ui.tab === "dex") {
    const slug = h.dexPick();
    return slug ? ([...partyPets(), ...boxPets()].find((p) => p.species === slug) ?? null) : null;
  }
  return null;
}

// 대상 종 — 도감 탭은 고른 칸, 그 밖은 대상 개체의 종
function subjectSpecies(): string | null {
  return ui.tab === "dex" ? hooksOf().dexPick() : (subjectPet()?.species ?? null);
}

// 대상의 배틀 파티 칸 — 모험은 고른 칸, 개체는 그 개체가 든 칸, 도감은 그 종이 든 첫 칸. 없으면 null (종 보기가 들어오면 바뀐다)
function subjectBattleSlot(): number | null {
  if (ui.tab === "adventure") return hooksOf().battleSlot();
  const slots = ui.view?.battle.slots ?? [];
  if (ui.tab === "dex") {
    const slug = hooksOf().dexPick();
    return slots.find((s) => s.pet && s.pet.species === slug)?.index ?? null;
  }
  const id = subjectPet()?.id;
  return id ? (slots.find((s) => s.pet?.id === id)?.index ?? null) : null;
}

// 대상 상품 — 상점은 고른 상품, 가방은 그 도구를 파는 상품
function subjectProduct(): string | null {
  const h = hooksOf();
  if (ui.tab === "shop") return h.shopPick();
  const id = ui.tab === "bag" ? h.bagPick() : null;
  return id && ui.view?.shop.some((p) => p.id === id) ? id : null;
}

// 대상 도구 — 가방은 고른 도구, 상점은 도구·진화 도구 상품이고 1개 이상 가졌을 때 그 도구
function subjectItem(): string | null {
  const h = hooksOf();
  if (ui.tab === "bag") return h.bagPick();
  const id = ui.tab === "shop" ? h.shopPick() : null;
  const product = id ? ui.view?.shop.find((p) => p.id === id) : undefined;
  if (!product || !TOOL_CATEGORIES.has(product.category)) return null;
  return ui.view?.bag.some((i) => i.id === product.id && i.count > 0) ? product.id : null;
}

function canShow(kind: DeviceKind): boolean {
  if (kind === "pet") return subjectPet() != null;
  if (kind === "dex") return subjectSpecies() != null;
  if (kind === "battle") return subjectBattleSlot() != null;
  if (kind === "shop") return subjectProduct() != null;
  return subjectItem() != null;
}

// 머리의 종류 탭 — 지금 기기가 속한 묶음의 고정 순서
export function kindsOf(): DeviceKindTab[] {
  const now = shownKind();
  const group = POKEMON.includes(now) ? POKEMON : ITEM;
  return group.map((id) => ({ id, current: id === now, disabled: id !== now && !canShow(id) }));
}

// 머리 탭을 눌렀다 — 볼 수 있는 기기면 같은 자리에서 바꾼다. 앞 기기 연결은 띄울 것이 없어져 닫히고, 뒤 연결이 연다
export function swapKind(to: DeviceKind): void {
  if (to === shownKind() || !hasSubject() || !canShow(to)) return;
  const group = POKEMON.includes(shownKind()) ? POKEMON : ITEM;
  if (!group.includes(to)) return; // 다른 묶음(포켓몬 ↔ 도구)으로는 바꾸지 않는다
  swapped = to === HOME[ui.tab] ? null : to;
  hooksOf().redraw();
}

// 본문 맞추기 — 고른 것이 없어졌거나 바꾼 기기를 더 볼 수 없으면(도구를 다 썼다 등) 본래 기기로 돌아간다
export function fixKind(): void {
  if (swapped && (!hasSubject() || !canShow(swapped))) swapped = null;
}

// 기기 창이 닫혔다(✕·Esc·메인이 닫음). 그 기기가 지금 보이던 것이면 탭의 고른 것을 비우고 true(다시 그린다).
// 머리 탭으로 바꿔 닫힌 앞 기기면 false — 고른 것을 그대로 둔다
export function deviceClosed(kind: DeviceKind): boolean {
  if (kind !== shownKind() || !hasSubject()) return false;
  swapped = null;
  hooksOf().closeSubject(ui.tab);
  return true;
}

// 기기 연결이 띄울 것 — 지금 기기가 그 종류일 때만. 아니면 null(닫는다)
export const petTarget = (): string | null => (shownKind() === "pet" ? (subjectPet()?.id ?? null) : null);
export const dexTarget = (): string | null => (shownKind() === "dex" && hasSubject() ? subjectSpecies() : null);
export const battleTarget = (): number | null => (shownKind() === "battle" && hasSubject() ? subjectBattleSlot() : null);
export const shopTarget = (): string | null => (shownKind() === "shop" ? subjectProduct() : null);
export const bagTarget = (): string | null => (shownKind() === "bag" ? subjectItem() : null);
