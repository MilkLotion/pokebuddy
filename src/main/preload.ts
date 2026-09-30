// 샌드박스 preload — 렌더러에 window.pokebuddy(StageBridge)·pokebuddyManage·pokebuddyBanner 를 노출한다. 모든 창이 같은 preload 를 쓴다.
// 샌드박스라 electron 만 require 할 수 있다 — 우리 모듈은 끌어오지 않고 타입만 import() 식으로 본다 (이 파일은 모듈이 아닌 스크립트).
// 채널 이름은 shared/stage.d.ts StageChannel 과 같은 문자열인지 satisfies 로 검사한다 — 메인(stage-window.ts)도 같은 검사를 한다
type StageBridge = import("../shared/stage").StageBridge;
type StageChannel = import("../shared/stage").StageChannel;
type StageInit = import("../shared/stage").StageInit;
type LookSheets = import("../shared/stage").LookSheets;
type StageFrame = import("../shared/stage").StageFrame;
type HoverQuery = import("../shared/stage").HoverQuery;
type PickerPayload = import("../shared/stage").PickerPayload;
type CoachView = import("../shared/stage").CoachView;
type ManageBridge = import("../shared/manage").ManageBridge;
type ManageChannel = import("../shared/manage").ManageChannel;
type ManageRequest = import("../shared/manage").ManageRequest;
type ManageReply = import("../shared/manage").ManageReply;
type Snapshot = import("../shared/manage").Snapshot;
type DexEntry = import("../shared/manage").DexEntry;
type DexDetail = import("../shared/manage").DexDetail;
type ShopDetail = import("../shared/manage").ShopDetail;
type PetDeviceAction = import("../shared/manage").PetDeviceAction;
type PetDeviceChannel = import("../shared/manage").PetDeviceChannel;
type PetDeviceView = import("../shared/manage").PetDeviceView;
type PetDeviceBridge = import("../shared/manage").PetDeviceBridge;
type ShopDeviceAction = import("../shared/manage").ShopDeviceAction;
type ShopDeviceChannel = import("../shared/manage").ShopDeviceChannel;
type ShopDeviceView = import("../shared/manage").ShopDeviceView;
type ShopDeviceBridge = import("../shared/manage").ShopDeviceBridge;
type BagDeviceAction = import("../shared/manage").BagDeviceAction;
type BagDeviceChannel = import("../shared/manage").BagDeviceChannel;
type BagDeviceView = import("../shared/manage").BagDeviceView;
type BagDeviceBridge = import("../shared/manage").BagDeviceBridge;
type AgentReply = import("../shared/manage").AgentReply;
type ManageRoute = import("../shared/manage").ManageRoute;
type TradeScreen = import("../shared/manage").TradeScreen;
type AccountReply = import("../shared/manage").AccountReply;
type AccountScreen = import("../shared/manage").AccountScreen;
type MailReply = import("../shared/manage").MailReply;
type MailScreen = import("../shared/manage").MailScreen;
type UpdateView = import("../shared/manage").UpdateView;
type PatchNotesView = import("../shared/manage").PatchNotesView;
type BannerBridge = import("../shared/manage").BannerBridge;
type BannerChannel = import("../shared/manage").BannerChannel;
type BannerView = import("../shared/manage").BannerView;
type RegionBridge = import("../shared/manage").RegionBridge;
type RegionChannel = import("../shared/manage").RegionChannel;
type RegionInit = import("../shared/manage").RegionInit;
type ScreensBridge = import("../shared/manage").ScreensBridge;
type ScreensChannel = import("../shared/manage").ScreensChannel;
type ScreenOverlayInit = import("../shared/manage").ScreenOverlayInit;
type ScreenView = import("../shared/manage").ScreenView;
type MenuBridge = import("../shared/manage").MenuBridge;
type MenuChannel = import("../shared/manage").MenuChannel;
type MenuView = import("../shared/manage").MenuView;
type DexDeviceBridge = import("../shared/manage").DexDeviceBridge;
type DexDeviceChannel = import("../shared/manage").DexDeviceChannel;
type DexDeviceView = import("../shared/manage").DexDeviceView;

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const CH = {
  init: "stage:init",
  sheets: "stage:sheets",
  frame: "stage:frame",
  hover: "stage:hover",
  clickThrough: "stage:click-through",
  cry: "stage:cry",
  icons: "stage:icons",
  coach: "stage:coach",
  coachAction: "stage:coach-action",
  ready: "stage:ready",
  hit: "stage:hit",
  pointer: "stage:pointer",
  log: "stage:log",
  pickerList: "picker:list",
  pickerStart: "picker:start",
  pickerPortraits: "picker:portraits",
} satisfies Record<string, StageChannel>;

const bridge: StageBridge = {
  ready: () => ipcRenderer.send(CH.ready),
  onInit: (cb) => ipcRenderer.on(CH.init, (_e, init: StageInit) => cb(init)),
  onSheets: (cb) => ipcRenderer.on(CH.sheets, (_e, sheets: LookSheets) => cb(sheets)),
  onFrame: (cb) => ipcRenderer.on(CH.frame, (_e, frame: StageFrame) => cb(frame)),
  onHover: (cb) => ipcRenderer.on(CH.hover, (_e, q: HoverQuery) => cb(q)),
  onClickThrough: (cb) => ipcRenderer.on(CH.clickThrough, (_e, on: boolean) => cb(on)),
  onCry: (cb) => ipcRenderer.on(CH.cry, (_e, cry: { uri: string; volume: number }) => cb(cry.uri, cry.volume)),
  onIcons: (cb) => ipcRenderer.on(CH.icons, (_e, icons: Record<string, string>) => cb(icons)),
  onCoach: (cb) => ipcRenderer.on(CH.coach, (_e, coach: CoachView | null) => cb(coach)),
  coachAction: (action) => ipcRenderer.send(CH.coachAction, action),
  hit: (id) => ipcRenderer.send(CH.hit, id),
  pointer: (msg) => ipcRenderer.send(CH.pointer, msg),
  log: (entry) => ipcRenderer.send(CH.log, entry),
  pickerList: () => ipcRenderer.invoke(CH.pickerList) as Promise<PickerPayload>,
  pickerStart: (slug) => ipcRenderer.send(CH.pickerStart, slug),
  pickerPortraits: (slugs) => ipcRenderer.invoke(CH.pickerPortraits, slugs) as Promise<Record<string, string | null>>,
};

contextBridge.exposeInMainWorld("pokebuddy", bridge);

// 관리 창 — 스냅샷과 명령, 그리고 스냅샷에 담지 않는 도감과 CLI 연결
const MANAGE = {
  snapshot: "manage:snapshot",
  command: "manage:command",
  dex: "manage:dex",
  dexDetail: "manage:dex-detail",
  shopDetail: "manage:shop-detail",
  agents: "manage:agents",
  route: "manage:route",
  drawRegion: "manage:draw-region",
  dim: "manage:dim",
  portraits: "manage:portraits",
  icons: "manage:icons",
  art: "manage:art",
  dexOpen: "manage:dex-open",
  dexStep: "manage:dex-step",
  dexClosed: "manage:dex-closed",
  petOpen: "manage:pet-open",
  petStep: "manage:pet-step",
  petAct: "manage:pet-act",
  petClosed: "manage:pet-closed",
  shopOpen: "manage:shop-open",
  shopStep: "manage:shop-step",
  shopAct: "manage:shop-act",
  shopClosed: "manage:shop-closed",
  bagOpen: "manage:bag-open",
  bagStep: "manage:bag-step",
  bagAct: "manage:bag-act",
  bagClosed: "manage:bag-closed",
  trade: "manage:trade",
  copy: "manage:copy",
  account: "manage:account",
  accountView: "manage:account-view",
  update: "manage:update",
  updateView: "manage:update-view",
  notes: "manage:notes",
  screens: "manage:screens",
  identifyScreens: "manage:identify-screens",
  pickScreen: "manage:pick-screen",
  mail: "manage:mail",
  mailView: "manage:mail-view",
  clock: "manage:clock",
} satisfies Record<string, ManageChannel>;

const manage: ManageBridge = {
  snapshot: () => ipcRenderer.invoke(MANAGE.snapshot) as Promise<Snapshot | null>,
  command: (req: ManageRequest) => ipcRenderer.invoke(MANAGE.command, req) as Promise<ManageReply>,
  dex: () => ipcRenderer.invoke(MANAGE.dex) as Promise<DexEntry[]>,
  dexDetail: (slug: string) => ipcRenderer.invoke(MANAGE.dexDetail, slug) as Promise<DexDetail | null>,
  shopDetail: (productId: string) => ipcRenderer.invoke(MANAGE.shopDetail, productId) as Promise<ShopDetail | null>,
  agents: (req) => ipcRenderer.invoke(MANAGE.agents, req) as Promise<AgentReply>,
  onRoute: (cb) => ipcRenderer.on(MANAGE.route, (_e, route: ManageRoute) => cb(route)),
  drawRegion: () => ipcRenderer.invoke(MANAGE.drawRegion) as Promise<ManageReply>,
  screens: () => ipcRenderer.invoke(MANAGE.screens) as Promise<ScreenView[]>,
  identifyScreens: (on) => ipcRenderer.send(MANAGE.identifyScreens, on),
  pickScreen: () => ipcRenderer.invoke(MANAGE.pickScreen) as Promise<ManageReply>,
  dim: (on) => ipcRenderer.send(MANAGE.dim, on),
  portraits: (asks) => ipcRenderer.invoke(MANAGE.portraits, asks) as Promise<Record<string, string | null>>,
  icons: (keys) => ipcRenderer.invoke(MANAGE.icons, keys) as Promise<Record<string, string | null>>,
  art: () => ipcRenderer.invoke(MANAGE.art) as Promise<Record<string, string>>,
  dexOpen: (slug, gen, beside) => ipcRenderer.send(MANAGE.dexOpen, slug, gen, beside === true),
  onDexStep: (cb) => ipcRenderer.on(MANAGE.dexStep, (_e, delta: -1 | 1) => cb(delta)),
  onDexClosed: (cb) => ipcRenderer.on(MANAGE.dexClosed, (_e, gen: number) => cb(gen)),
  petOpen: (open, gen) => ipcRenderer.send(MANAGE.petOpen, open, gen),
  onPetStep: (cb) => ipcRenderer.on(MANAGE.petStep, (_e, delta: -1 | 1) => cb(delta)),
  onPetAct: (cb) => ipcRenderer.on(MANAGE.petAct, (_e, action: PetDeviceAction) => cb(action)),
  onPetClosed: (cb) => ipcRenderer.on(MANAGE.petClosed, (_e, gen: number) => cb(gen)),
  shopOpen: (open, gen) => ipcRenderer.send(MANAGE.shopOpen, open, gen),
  onShopStep: (cb) => ipcRenderer.on(MANAGE.shopStep, (_e, delta: -1 | 1) => cb(delta)),
  onShopAct: (cb) => ipcRenderer.on(MANAGE.shopAct, (_e, action: ShopDeviceAction) => cb(action)),
  onShopClosed: (cb) => ipcRenderer.on(MANAGE.shopClosed, (_e, gen: number) => cb(gen)),
  bagOpen: (open, gen) => ipcRenderer.send(MANAGE.bagOpen, open, gen),
  onBagStep: (cb) => ipcRenderer.on(MANAGE.bagStep, (_e, delta: -1 | 1) => cb(delta)),
  onBagAct: (cb) => ipcRenderer.on(MANAGE.bagAct, (_e, action: BagDeviceAction) => cb(action)),
  onBagClosed: (cb) => ipcRenderer.on(MANAGE.bagClosed, (_e, gen: number) => cb(gen)),
  onTrade: (cb) => ipcRenderer.on(MANAGE.trade, (_e, screen: TradeScreen) => cb(screen)),
  copyText: (text) => ipcRenderer.send(MANAGE.copy, text),
  account: (req) => ipcRenderer.invoke(MANAGE.account, req) as Promise<AccountReply>,
  onAccount: (cb) => ipcRenderer.on(MANAGE.accountView, (_e, screen: AccountScreen) => cb(screen)),
  update: (action) => ipcRenderer.invoke(MANAGE.update, action) as Promise<UpdateView | null>,
  onUpdate: (cb) => ipcRenderer.on(MANAGE.updateView, (_e, view: UpdateView) => cb(view)),
  notes: (action) => ipcRenderer.invoke(MANAGE.notes, action) as Promise<PatchNotesView | null>,
  mail: (req) => ipcRenderer.invoke(MANAGE.mail, req) as Promise<MailReply | null>,
  onMail: (cb) => ipcRenderer.on(MANAGE.mailView, (_e, screen: MailScreen) => cb(screen)),
  onClock: (cb) => ipcRenderer.on(MANAGE.clock, (_e, tick: { now: number }) => cb(tick)), // 앱 전역 1초 시계 (src/main/clock.ts)
};

contextBridge.exposeInMainWorld("pokebuddyManage", manage);

// 알림 배너 창 — 배너 하나를 받고, `바로가기`·`✕` 닫기를 알린다
const BANNER = {
  show: "banner:show",
  go: "banner:go",
  close: "banner:close",
} satisfies Record<string, BannerChannel>;

const banner: BannerBridge = {
  onShow: (cb) => ipcRenderer.on(BANNER.show, (_e, view: BannerView) => cb(view)),
  go: (key) => ipcRenderer.send(BANNER.go, key),
  close: (key) => ipcRenderer.send(BANNER.close, key),
};

contextBridge.exposeInMainWorld("pokebuddyBanner", banner);

// 놀이공간 영역 그리기 창 — 지금 영역을 받고, 적용한 사각형(취소면 null)을 돌려준다
const REGION = {
  init: "region:init",
  done: "region:done",
} satisfies Record<string, RegionChannel>;

const region: RegionBridge = {
  onInit: (cb) => ipcRenderer.on(REGION.init, (_e, init: RegionInit) => cb(init)),
  done: (rect) => ipcRenderer.send(REGION.done, rect),
};

contextBridge.exposeInMainWorld("pokebuddyRegion", region);

// 놀이공간 화면 번호 덮개 창 — 번호를 받고, 이 화면을 골랐는지·취소했는지 알린다
const SCREENS = {
  init: "screens:init",
  pick: "screens:pick",
  cancel: "screens:cancel",
} satisfies Record<string, ScreensChannel>;

const screensBridge: ScreensBridge = {
  onInit: (cb) => ipcRenderer.on(SCREENS.init, (_e, init: ScreenOverlayInit) => cb(init)),
  pick: () => ipcRenderer.send(SCREENS.pick),
  cancel: () => ipcRenderer.send(SCREENS.cancel),
};

contextBridge.exposeInMainWorld("pokebuddyScreens", screensBridge);

// 앱이 그리는 메뉴 창 — 항목을 받고, 그린 크기와 고른 항목을 돌려준다
const MENU = {
  show: "menu:show",
  size: "menu:size",
  pick: "menu:pick",
} satisfies Record<string, MenuChannel>;

const menu: MenuBridge = {
  onShow: (cb) => ipcRenderer.on(MENU.show, (_e, items: MenuView[]) => cb(items)),
  size: (w, h) => ipcRenderer.send(MENU.size, w, h),
  pick: (id) => ipcRenderer.send(MENU.pick, id),
};

contextBridge.exposeInMainWorld("pokebuddyMenu", menu);

// 도감 기기 창 — 한 종의 항목을 받고, 그린 높이와 이전·다음·울음소리·닫기를 보낸다
const DEX = {
  show: "dexdev:show",
  size: "dexdev:size",
  step: "dexdev:step",
  cry: "dexdev:cry",
  close: "dexdev:close",
} satisfies Record<string, DexDeviceChannel>;

const dex: DexDeviceBridge = {
  onShow: (cb) => ipcRenderer.on(DEX.show, (_e, view: DexDeviceView) => cb(view)),
  size: (h) => ipcRenderer.send(DEX.size, h),
  step: (delta) => ipcRenderer.send(DEX.step, delta),
  cry: () => ipcRenderer.invoke(DEX.cry) as Promise<string | null>,
  close: () => ipcRenderer.send(DEX.close),
};

contextBridge.exposeInMainWorld("pokebuddyDex", dex);

// 파티 상세 기기 창 — 개체 하나를 받고, 그린 높이와 이전·다음·울음소리·닫기·누른 단추를 보낸다
const PET = {
  show: "petdev:show",
  size: "petdev:size",
  step: "petdev:step",
  cry: "petdev:cry",
  close: "petdev:close",
  act: "petdev:act",
} satisfies Record<string, PetDeviceChannel>;

const pet: PetDeviceBridge = {
  onShow: (cb) => ipcRenderer.on(PET.show, (_e, view: PetDeviceView) => cb(view)),
  size: (h) => ipcRenderer.send(PET.size, h),
  step: (delta) => ipcRenderer.send(PET.step, delta),
  cry: () => ipcRenderer.invoke(PET.cry) as Promise<string | null>,
  close: () => ipcRenderer.send(PET.close),
  act: (action) => ipcRenderer.send(PET.act, action),
};

contextBridge.exposeInMainWorld("pokebuddyPet", pet);

// 상점 기기 창 — 상품 하나를 받고, 그린 높이와 이전·다음·닫기·누른 단추(수량·구매)를 보낸다
const SHOP = {
  show: "shopdev:show",
  size: "shopdev:size",
  step: "shopdev:step",
  close: "shopdev:close",
  act: "shopdev:act",
} satisfies Record<string, ShopDeviceChannel>;

const shop: ShopDeviceBridge = {
  onShow: (cb) => ipcRenderer.on(SHOP.show, (_e, view: ShopDeviceView) => cb(view)),
  size: (h) => ipcRenderer.send(SHOP.size, h),
  step: (delta) => ipcRenderer.send(SHOP.step, delta),
  close: () => ipcRenderer.send(SHOP.close),
  act: (action) => ipcRenderer.send(SHOP.act, action),
};

contextBridge.exposeInMainWorld("pokebuddyShop", shop);

// 가방 기기 창 — 도구 하나를 받고, 그린 높이와 이전·다음·닫기·누른 단추(사용·판매 전환, 파티 고르기, 수량, 사용·팔기)를 보낸다
const BAG = {
  show: "bagdev:show",
  size: "bagdev:size",
  step: "bagdev:step",
  close: "bagdev:close",
  act: "bagdev:act",
} satisfies Record<string, BagDeviceChannel>;

const bag: BagDeviceBridge = {
  onShow: (cb) => ipcRenderer.on(BAG.show, (_e, view: BagDeviceView) => cb(view)),
  size: (h) => ipcRenderer.send(BAG.size, h),
  step: (delta) => ipcRenderer.send(BAG.step, delta),
  close: () => ipcRenderer.send(BAG.close),
  act: (action) => ipcRenderer.send(BAG.act, action),
};

contextBridge.exposeInMainWorld("pokebuddyBag", bag);
