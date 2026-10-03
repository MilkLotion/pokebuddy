// 샌드박스 preload — 렌더러에 window.pokebuddy(StageBridge)·pokebuddyManage·pokebuddyBanner·pokebuddyAlert 등을 노출한다. 모든 창이 같은 preload 를 쓴다.
// 샌드박스라 electron 만 require 할 수 있다 — 우리 모듈은 끌어오지 않고 타입만 import() 식으로 본다 (이 파일은 모듈이 아닌 스크립트).
// 채널 글자는 창마다 표 하나에 적는다 — 다리 함수 이름 → [방향, 채널]. 표가 계약(src/shared/ipc/)과 맞는지는 satisfies 가 검사한다:
// 계약에 있는데 표에 없는 다리, 표에 있는데 계약에 없는 다리, 이름과 방향·채널의 짝이 틀린 것이 컴파일 오류다
type Contract = import("../shared/ipc/kinds").Contract;
type WireOf<C extends Contract> = import("../shared/ipc/kinds").WireOf<C>;
type BridgeOf<C extends Contract> = import("../shared/ipc/kinds").BridgeOf<C>;
type StageIpc = import("../shared/ipc/stage").StageIpc;
type PickerIpc = import("../shared/ipc/stage").PickerIpc;
type StageBridge = import("../shared/ipc/stage").StageBridge;
type ManageIpc = import("../shared/ipc/manage").ManageIpc;
type ManageBridge = import("../shared/ipc/manage").ManageBridge;
type BannerIpc = import("../shared/ipc/overlays").BannerIpc;
type AlertIpc = import("../shared/ipc/overlays").AlertIpc;
type RegionIpc = import("../shared/ipc/overlays").RegionIpc;
type ScreensIpc = import("../shared/ipc/overlays").ScreensIpc;
type MenuIpc = import("../shared/ipc/overlays").MenuIpc;
type DexDeviceIpc = import("../shared/ipc/devices").DexDeviceIpc;
type PetDeviceIpc = import("../shared/ipc/devices").PetDeviceIpc;
type ShopDeviceIpc = import("../shared/ipc/devices").ShopDeviceIpc;
type BagDeviceIpc = import("../shared/ipc/devices").BagDeviceIpc;
type PartyDeviceIpc = import("../shared/ipc/devices").PartyDeviceIpc;

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

type Wire = Record<string, readonly ["invoke" | "send" | "push", string]>;

// 표에서 다리를 만든다. invoke 는 답을 기다리고, send 는 보내기만 하고, push 는 콜백을 받아 메인이 보낼 때마다 부른다.
// 인자와 반환의 타입은 계약이 정한다(BridgeOf)
function bridgeOf<C extends Contract>(wire: WireOf<C>): BridgeOf<C> {
  const out: Record<string, unknown> = {};
  for (const [method, [kind, channel]] of Object.entries(wire as Wire)) {
    if (kind === "invoke") out[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
    else if (kind === "send") out[method] = (...args: unknown[]) => ipcRenderer.send(channel, ...args);
    else out[method] = (cb: (...args: unknown[]) => void) => ipcRenderer.on(channel, (_e, ...args: unknown[]) => cb(...args));
  }
  return out as BridgeOf<C>;
}

// 무대 창과 선택 창 — 같은 다리(window.pokebuddy)를 쓴다
const STAGE = {
  ready: ["send", "stage:ready"],
  onInit: ["push", "stage:init"],
  onSheets: ["push", "stage:sheets"],
  onFrame: ["push", "stage:frame"],
  onHover: ["push", "stage:hover"],
  onClickThrough: ["push", "stage:click-through"],
  onCry: ["push", "stage:cry"],
  onIcons: ["push", "stage:icons"],
  onCoach: ["push", "stage:coach"],
  coachAction: ["send", "stage:coach-action"],
  hit: ["send", "stage:hit"],
  pointer: ["send", "stage:pointer"],
  log: ["send", "stage:log"],
} as const satisfies WireOf<StageIpc>;

const PICKER = {
  pickerList: ["invoke", "picker:list"],
  pickerStart: ["send", "picker:start"],
  pickerPortraits: ["invoke", "picker:portraits"],
} as const satisfies WireOf<PickerIpc>;

const stageBridge = bridgeOf<StageIpc>(STAGE);
const bridge: StageBridge = {
  ...stageBridge,
  ...bridgeOf<PickerIpc>(PICKER),
  // [임시] 계약과 1:1 이 아닌 다리 — 메인이 보낸 { uri, volume } 을 인자 둘로 푼다. 렌더러가 cry 를 통째로 받게 되면 걷는다
  onCry: (cb) => stageBridge.onCry((cry) => cb(cry.uri, cry.volume)),
};

contextBridge.exposeInMainWorld("pokebuddy", bridge);

// 설정창 — 스냅샷과 명령, 스냅샷에 담지 않는 도감과 CLI 연결, 기기 창 다섯과의 연결
const MANAGE = {
  snapshot: ["invoke", "manage:snapshot"],
  command: ["invoke", "manage:command"],
  dex: ["invoke", "manage:dex"],
  dexDetail: ["invoke", "manage:dex-detail"],
  shopDetail: ["invoke", "manage:shop-detail"],
  agents: ["invoke", "manage:agents"],
  onRoute: ["push", "manage:route"],
  petMenu: ["invoke", "manage:pet-menu"],
  drawRegion: ["invoke", "manage:draw-region"],
  screens: ["invoke", "manage:screens"],
  identifyScreens: ["send", "manage:identify-screens"],
  pickScreen: ["invoke", "manage:pick-screen"],
  dim: ["send", "manage:dim"],
  portraits: ["invoke", "manage:portraits"],
  icons: ["invoke", "manage:icons"],
  art: ["invoke", "manage:art"],
  dexOpen: ["send", "manage:dex-open"],
  onDexStep: ["push", "manage:dex-step"],
  onDexClosed: ["push", "manage:dex-closed"],
  petOpen: ["invoke", "manage:pet-open"],
  onPetStep: ["push", "manage:pet-step"],
  onPetAct: ["push", "manage:pet-act"],
  onPetClosed: ["push", "manage:pet-closed"],
  shopOpen: ["invoke", "manage:shop-open"],
  onShopStep: ["push", "manage:shop-step"],
  onShopAct: ["push", "manage:shop-act"],
  onShopClosed: ["push", "manage:shop-closed"],
  bagOpen: ["invoke", "manage:bag-open"],
  onBagStep: ["push", "manage:bag-step"],
  onBagAct: ["push", "manage:bag-act"],
  onBagClosed: ["push", "manage:bag-closed"],
  partyOpen: ["invoke", "manage:party-open"],
  onPartyAct: ["push", "manage:party-act"],
  onPartyStep: ["push", "manage:party-step"],
  onPartyClosed: ["push", "manage:party-closed"],
  onTrade: ["push", "manage:trade"],
  copyText: ["send", "manage:copy"],
  account: ["invoke", "manage:account"],
  onAccount: ["push", "manage:account-view"],
  update: ["invoke", "manage:update"],
  onUpdate: ["push", "manage:update-view"],
  notes: ["invoke", "manage:notes"],
  mail: ["invoke", "manage:mail"],
  onMail: ["push", "manage:mail-view"],
  onClock: ["push", "manage:clock"], // 앱 전역 1초 시계 (src/main/clock.ts)
} as const satisfies WireOf<ManageIpc>;

const manageBridge = bridgeOf<ManageIpc>(MANAGE);
const manage: ManageBridge = {
  ...manageBridge,
  // [임시] 계약과 1:1 이 아닌 다리 — beside 를 참·거짓으로 고쳐 보낸다. 열기 인자가 { slug, beside } 한 값이 되면 걷는다
  dexOpen: (slug, gen, beside) => manageBridge.dexOpen(slug, gen, beside === true),
};

contextBridge.exposeInMainWorld("pokebuddyManage", manage);

// 알림 배너 창 — 배너 하나를 받고, `바로가기`·`✕` 닫기를 알린다
const BANNER = {
  onShow: ["push", "banner:show"],
  go: ["send", "banner:go"],
  close: ["send", "banner:close"],
} as const satisfies WireOf<BannerIpc>;

contextBridge.exposeInMainWorld("pokebuddyBanner", bridgeOf<BannerIpc>(BANNER));

// 알림 창 — 내용을 받고, 그린 크기와 누른 단추를 알린다 (src/main/windows/alert-window.ts)
const ALERT = {
  onShow: ["push", "alert:show"],
  size: ["send", "alert:size"],
  pick: ["send", "alert:pick"],
} as const satisfies WireOf<AlertIpc>;

contextBridge.exposeInMainWorld("pokebuddyAlert", bridgeOf<AlertIpc>(ALERT));

// 놀이공간 영역 그리기 창 — 지금 영역을 받고, 적용한 사각형(취소면 null)을 돌려준다
const REGION = {
  onInit: ["push", "region:init"],
  done: ["send", "region:done"],
} as const satisfies WireOf<RegionIpc>;

contextBridge.exposeInMainWorld("pokebuddyRegion", bridgeOf<RegionIpc>(REGION));

// 놀이공간 화면 번호 덮개 창 — 번호를 받고, 이 화면을 골랐는지·취소했는지 알린다
const SCREENS = {
  onInit: ["push", "screens:init"],
  pick: ["send", "screens:pick"],
  cancel: ["send", "screens:cancel"],
} as const satisfies WireOf<ScreensIpc>;

contextBridge.exposeInMainWorld("pokebuddyScreens", bridgeOf<ScreensIpc>(SCREENS));

// 앱이 그리는 메뉴 창 — 항목을 받고, 그린 크기와 고른 항목을 돌려준다
const MENU = {
  onShow: ["push", "menu:show"],
  size: ["send", "menu:size"],
  onSide: ["push", "menu:side"],
  placed: ["send", "menu:placed"],
  pick: ["send", "menu:pick"],
} as const satisfies WireOf<MenuIpc>;

contextBridge.exposeInMainWorld("pokebuddyMenu", bridgeOf<MenuIpc>(MENU));

// 기기 창 다섯 — 접두사만 다른 같은 틀이다. 값 하나를 받고, 그린 높이와 이전·다음·닫기를 보낸다
const deviceWire = <P extends string>(prefix: P) =>
  ({
    onShow: ["push", `${prefix}:show`],
    size: ["send", `${prefix}:size`],
    step: ["send", `${prefix}:step`],
    close: ["send", `${prefix}:close`],
  }) as const;

// 도감 기기 창 — 한 종의 항목. 울음소리를 부른다
const DEX = { ...deviceWire("dexdev"), cry: ["invoke", "dexdev:cry"] } as const satisfies WireOf<DexDeviceIpc>;

contextBridge.exposeInMainWorld("pokebuddyDex", bridgeOf<DexDeviceIpc>(DEX));

// 파티 상세 기기 창 — 개체 하나. 울음소리와 누른 단추
const PET = { ...deviceWire("petdev"), cry: ["invoke", "petdev:cry"], act: ["send", "petdev:act"] } as const satisfies WireOf<PetDeviceIpc>;

contextBridge.exposeInMainWorld("pokebuddyPet", bridgeOf<PetDeviceIpc>(PET));

// 상점 기기 창 — 상품 하나. 누른 단추(수량·구매)
const SHOP = { ...deviceWire("shopdev"), act: ["send", "shopdev:act"] } as const satisfies WireOf<ShopDeviceIpc>;

contextBridge.exposeInMainWorld("pokebuddyShop", bridgeOf<ShopDeviceIpc>(SHOP));

// 가방 기기 창 — 도구 하나. 누른 단추(사용·판매 전환, 파티 고르기, 수량, 사용·팔기)
const BAG = { ...deviceWire("bagdev"), act: ["send", "bagdev:act"] } as const satisfies WireOf<BagDeviceIpc>;

contextBridge.exposeInMainWorld("pokebuddyBag", bridgeOf<BagDeviceIpc>(BAG));

// 파티 기기 창(교체 화면) — 지금 프리셋의 파티 칸과 프리셋 칩. 누른 칸·칩
const PARTY = { ...deviceWire("partydev"), act: ["send", "partydev:act"] } as const satisfies WireOf<PartyDeviceIpc>;

contextBridge.exposeInMainWorld("pokebuddyParty", bridgeOf<PartyDeviceIpc>(PARTY));
