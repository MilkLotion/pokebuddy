// 기기 창 명세 다섯 — 채널·폭·열쇠·보낼 값·붙는 기준·단추 검사·울음소리 (worklog/records/code-structure/design/10-main.md 3.5절)
// 창의 동작은 틀(./device-window.ts)이 한다. 렌더러가 보낸 값은 믿지 않는다 — 단추마다 정해진 모양만 넘긴다(isAction)
//
//   도감       관리 창의 도감 칸을 누르면 뜬다. 파티 상세의 `도감 보기` 로 열면 파티 상세 기기 창 옆에 붙는다
//              (관리 창과 파티 상세 기기 창을 한 덩어리로 본다 — 2026-10-01 사용자 결정 "옆에 그 포켓몬 상세도감기기를 띄울까")
//   파티 상세  포켓몬 칸을 누르면 뜬다 (2026-09-28 사용자 "파티상세페이지도 도감상세처럼 옆에 뜨는거로 바꾸자", Figma 05 `Party / Detail Device` `908:23772`)
//   상점       상품 줄·칸을 누르면 뜬다 (2026-10-01 사용자 "상품눌렀을때 무슨상품인지 모르겠어서 파티/도감상세처럼 상품정보다 옆에 창뜨게", Figma 05 `Shop / Device / Tool`)
//   가방       가방 카드를 누르면 뜬다 (2026-10-01 사용자 "가방도 상점참고해서 개선하자", Figma 05 `Bag / Device / Use`)
//   파티 교체  파티 탭의 `교체` 나 빈 파티 칸을 누르면 뜬다 (2026-10-02 사용자 "교체버튼을 누르면 박스화면으로 이동하고 … 창이 뜨면서 파티목록 볼 수 있게", Figma 05 `Party / Swap · Open` `1248:2567`)
import type { DexDetail, EvoNodeView } from "../../shared/model/detail";
import type { BagDeviceChannel, DexDeviceChannel, PartyDeviceChannel, PetDeviceChannel, ShopDeviceChannel } from "../../shared/ipc/devices";
import type {
  BagDeviceAction,
  BagDeviceOpen,
  BagDeviceView,
  DexDeviceView,
  PartyDeviceAction,
  PartyDeviceOpen,
  PartyDeviceView,
  PetDeviceAction,
  PetDeviceOpen,
  PetDeviceView,
  ShopDeviceAction,
  ShopDeviceOpen,
  ShopDeviceView,
} from "../../shared/model/devices";
import { PARTY_RULES } from "../../party/rules.js";
import type { DeviceSpec } from "./device-window.js";
import { isIndexBelow, isQty, isRecord, isShortId, isStep } from "./input.js";
import { dockAt } from "./placement.js";

// 창 크기 — 폭은 Figma 기기 폭, 높이는 첫 그림 전 어림값이다
export const DEVICE_SIZES = {
  dex: { width: 380, height: 508 }, // Figma `Dex Device`
  pet: { width: 380, height: 682 }, // Figma `A안 · 파티 상세 기기`
  shop: { width: 380, height: 594 }, // Figma `Shop / Device / Tool`
  bag: { width: 380, height: 670 }, // Figma `Bag / Device / Use`
  party: { width: 380, height: 508 }, // 다른 기기 창과 같은 폭
} as const;

// ── 도감 ───────────────────────────────────────────────────────────────────────

// beside — 설정창 옆에 먼저 붙은 창(파티 상세 기기 창)의 폭. 0 이면 설정창에 바로 붙는다
export interface DexDeviceOpen {
  slug: string;
  beside: number;
}

export interface DexDeviceDeps {
  detail(slug: string): DexDetail | null;
  tree(slug: string): EvoNodeView | null; // 진화 트리 — 상점 구매 창과 같다 (2026-09-30 사용자 결정 도감 상세 A안)
  portrait(slug: string): Promise<string | null>;
  portraits(slugs: string[]): Promise<Record<string, string>>; // 트리 종들의 그림을 한 번에
  cry(slug: string): Promise<string | null>;
  volume(): number; // 울음소리 음량 0~1
}

export function dexDeviceOf(deps: DexDeviceDeps): DeviceSpec<DexDeviceOpen, DexDeviceView> {
  return {
    channels: { show: "dexdev:show", size: "dexdev:size", step: "dexdev:step", cry: "dexdev:cry", close: "dexdev:close" } satisfies Record<string, DexDeviceChannel>,
    size: DEVICE_SIZES.dex,
    keyOf: (o) => o.slug,
    viewOf(o) {
      const detail = deps.detail(o.slug);
      if (!detail) return null;
      // 미해금 종도 진화 카드를 보인다. 트리 안의 미해금 종은 기기 창이 검은 실루엣과 ??? 로 그린다 (2026-10-02 사용자 결정) — 그림은 모든 종을 보낸다
      const tree = deps.tree(o.slug);
      const shown: string[] = [];
      const walk = (n: EvoNodeView): void => {
        shown.push(n.slug);
        n.children.forEach(walk);
      };
      if (tree) walk(tree);
      return Promise.all([deps.portrait(o.slug), shown.length ? deps.portraits(shown) : Promise.resolve({})]).then(([portrait, treePortraits]) => ({
        detail,
        portrait,
        volume: deps.volume(),
        tree,
        treePortraits,
        beside: o.beside > 0,
      }));
    },
    // 파티 상세 옆 — 파티 상세 기기 창 자리를 같은 규칙(dockAt)으로 셈해 설정창과 합친 덩어리 옆에 붙인다.
    // 파티 상세 창의 지금 위치를 읽지 않는다 — 설정창을 옮길 때 두 창이 따라가는 순서와 상관없이 같은 자리가 나온다
    baseOf(owner, area, o, height) {
      if (!o.beside) return owner;
      const pet = dockAt(owner, area, { width: o.beside, height });
      return { x: Math.min(owner.x, pet.x), y: owner.y, width: owner.width + o.beside, height: owner.height };
    },
    cry: { of: (o) => deps.cry(o.slug), volume: deps.volume },
  };
}

// ── 파티 상세 ──────────────────────────────────────────────────────────────────

export interface PetDeviceDeps {
  portrait(slug: string, shiny: boolean): Promise<string | null>;
  megaIcon(): Promise<string | null>; // 메가스톤 표식 그림(키스톤)
  cry(slug: string): Promise<string | null>;
  volume(): number; // 울음소리 음량 0~1
}

const PET_DIALOGS = new Set(["evolve", "nature", "mega"]);
const PET_CMDS = new Set(["feed", "play", "party.show", "party.hide", "pet.set"]);

function isPetAction(v: unknown): v is PetDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (!isShortId(a.petId)) return false; // 누른 개체 — 관리 창이 지금 개체와 같은지 본다
  if (a.kind === "dialog") return typeof a.dialog === "string" && PET_DIALOGS.has(a.dialog);
  if (a.kind === "tutorial") return a.action === "done" || a.action === "skip";
  if (a.kind === "dex") return true;
  if (a.kind === "cmd") return typeof a.cmd === "string" && PET_CMDS.has(a.cmd) && (a.args === undefined || (typeof a.args === "object" && a.args !== null));
  return false;
}

export function petDeviceOf(deps: PetDeviceDeps): DeviceSpec<PetDeviceOpen, PetDeviceView, PetDeviceAction> {
  return {
    channels: { show: "petdev:show", size: "petdev:size", step: "petdev:step", cry: "petdev:cry", close: "petdev:close", act: "petdev:act" } satisfies Record<string, PetDeviceChannel>,
    size: DEVICE_SIZES.pet,
    keyOf: (o) => o.pet.id,
    // 메가 모습이면 그 초상이다 (PetView.look)
    viewOf: (o) =>
      Promise.all([deps.portrait(o.pet.look, o.pet.shiny), o.pet.mega ? deps.megaIcon() : null]).then(([portrait, megaIcon]) => ({ ...o, portrait, megaIcon, volume: deps.volume() })),
    isAction: isPetAction,
    cry: { of: (o) => deps.cry(o.pet.species), volume: deps.volume },
  };
}

// ── 상점·가방·파티 교체 — 관리 창이 정한 값에 붙은 쪽만 더해 보낸다 ─────────────────

function isShopAction(v: unknown): v is ShopDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (!isShortId(a.productId)) return false;
  if (a.kind === "qty") return isQty(a.qty);
  return a.kind === "buy" || a.kind === "pool";
}

export const SHOP_DEVICE: DeviceSpec<ShopDeviceOpen, ShopDeviceView, ShopDeviceAction> = {
  channels: { show: "shopdev:show", size: "shopdev:size", step: "shopdev:step", close: "shopdev:close", act: "shopdev:act" } satisfies Record<string, ShopDeviceChannel>,
  size: DEVICE_SIZES.shop,
  keyOf: (o) => o.productId,
  viewOf: (o) => o,
  isAction: isShopAction,
};

function isBagAction(v: unknown): v is BagDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (!isShortId(a.itemId)) return false;
  if (a.kind === "mode") return a.mode === "use" || a.mode === "sell";
  if (a.kind === "target") return isShortId(a.petId);
  if (a.kind === "qty") return isQty(a.qty);
  if (a.kind === "preset") return isStep(a.delta);
  return a.kind === "go";
}

export const BAG_DEVICE: DeviceSpec<BagDeviceOpen, BagDeviceView, BagDeviceAction> = {
  channels: { show: "bagdev:show", size: "bagdev:size", step: "bagdev:step", close: "bagdev:close", act: "bagdev:act" } satisfies Record<string, BagDeviceChannel>,
  size: DEVICE_SIZES.bag,
  keyOf: (o) => o.itemId,
  viewOf: (o) => o,
  isAction: isBagAction,
};

function isPartyAction(v: unknown): v is PartyDeviceAction {
  if (!isRecord(v)) return false;
  const a = v;
  if (a.kind !== "slot" && a.kind !== "preset") return false;
  return isIndexBelow(a.index, PARTY_RULES.total); // 파티 칸은 늘 여섯 (src/party/rules.ts)
}

export const PARTY_DEVICE: DeviceSpec<PartyDeviceOpen, PartyDeviceView, PartyDeviceAction> = {
  channels: { show: "partydev:show", size: "partydev:size", step: "partydev:step", close: "partydev:close", act: "partydev:act" } satisfies Record<string, PartyDeviceChannel>,
  size: DEVICE_SIZES.party,
  // 창은 하나다 — 열쇠가 늘 같아 내용을 다시 보내도 초점을 빼앗지 않는다
  keyOf: () => "party",
  viewOf: (o) => o,
  isAction: isPartyAction,
};
