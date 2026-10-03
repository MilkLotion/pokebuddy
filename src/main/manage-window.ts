// 관리 창 — 파티·박스·도감·상점·가방을 보는 창. 문서는 src/renderer/manage.html, 값은 스냅샷이 준다.
//
// 폭은 고정이고 세로만 조절한다. 박스 6열과 도감 5열 격자가 640 폭에 맞춰져 있다 (docs/specs/game.md "관리 창").
// 창을 열 때 흐른 시간을 먼저 적용한다. 그래야 만복도와 쿨타임이 지금 값으로 보인다.
// 창은 하나만 둔다. 다시 열면 이미 떠 있는 창을 앞으로 가져온다.
import { BrowserWindow, clipboard, ipcMain } from "electron";
import type { AccountAction, AccountReply, AccountScreen, PatchNotesView, UpdateAction, UpdateView } from "../shared/model/account";
import type { AgentAction } from "../shared/model/agents";
import type { DisplayView, PortraitAsk } from "../shared/model/snapshot";
import type { MailAction, MailReply, MailScreen } from "../shared/model/mail";
import type { ManageChannel, ManageReply, ManageRequest } from "../shared/ipc/manage";
import type { ManageRoute } from "../shared/model/route";
import type { PetDeviceOpen, ShopDeviceOpen, BagDeviceOpen, PartyDeviceOpen } from "../shared/model/devices";
import type { ScreenView } from "../shared/model/overlays";
import type { TradeScreen } from "../shared/model/trade";
import { WINDOW_V3_RULES } from "../save/rules.js";
import { createGame, type GameV3 } from "./game.js";
import { PATHS, windowIcon } from "./paths.js";
import { webPreferencesOf } from "./windows/options.js";
import { isFromWindow } from "./windows/ipc.js";
import { INPUT_LIMITS } from "./windows/input.js";
import { MEGA_STONE_ICON, createPortraits, portraitKey, type Portraits } from "./portraits.js";
import { createCries, type Cries } from "./cries.js";
import { createDexWindow, type DexWindow } from "./dex-window.js";
import { createPetWindow, PET_WINDOW, type PetWindow } from "./pet-window.js";
import { createShopWindow, type ShopWindow } from "./shop-window.js";
import { createBagWindow, type BagWindow } from "./bag-window.js";
import { createPartyWindow, type PartyWindow } from "./party-window.js";
import { SOUND_RULES, gainOf } from "../state/settings.js";
import fs from "node:fs";
import path from "node:path";

const CH = {
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
  partyOpen: "manage:party-open",
  partyAct: "manage:party-act",
  partyStep: "manage:party-step",
  partyClosed: "manage:party-closed",
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
  petMenu: "manage:pet-menu",
} satisfies Record<string, ManageChannel>;

// 창 조작 단추가 앉는 자리. 색은 헤더와 같아야 이어져 보인다 (`--surface` 와 `--muted`)
// 높이는 헤더(40)보다 1 작다 — 헤더 맨 아래 1px 테두리를 덮지 않아야 단추 아래까지 선이 이어진다
const CHROME = { color: "#ffffff", symbolColor: "#4a6663", height: 39 };
// 모달이 열리면 가림막(`--scrim` rgba(26,51,48,0.45))이 헤더를 덮는다. 창 단추 자리도 그 색을 겹친 값으로 바꾼다
const CHROME_DIM = { color: "#98a3a2", symbolColor: "#344f4c" };

export interface ManageOptions {
  preload: string;
  html: string;
  game?: GameV3; // 시험에서 다른 저장을 꽂는다
  // 명령을 보내는 길. 앱은 커맨드 처리기를 준다 — writer 면 실행기로, reader 면 mailbox 로 간다.
  // 기본값은 없다 — 실행기를 바로 부르는 길을 창이 스스로 만들지 않는다. 개발용 실행기도 자기 길을 준다
  send: (req: ManageRequest) => Promise<ManageReply>;
  route?: ManageRoute; // 열면서 옮겨 갈 곳 — 알림 배너의 `바로가기`
  // 설정의 `영역 그리기`. 영역 그리기 창을 열고 적용한 영역을 저장한다. 없으면 이 기능을 쓸 수 없다
  drawRegion?: () => Promise<ManageReply>;
  display?: () => DisplayView; // 포켓몬 표시·클릭 통과의 지금 값. 저장 밖이라 앱이 준다
  account?: (req: AccountAction) => Promise<AccountReply>; // 계정·클라우드 저장 (src/main/online.ts). 없으면 계정 탭은 쓸 수 없다고 보인다
  update?: (action: UpdateAction) => Promise<UpdateView>; // 버전·업데이트 (src/main/updater.ts). 없으면 설정 바닥에 버전을 그리지 않는다
  notes?: (action: "list" | "seen") => PatchNotesView; // 패치노트 (src/main/patch-notes.ts). 없으면 `패치노트` 단추를 두지 않는다
  // 놀이공간 화면 — 목록·번호 보기·화면에서 고르기 (src/main/windows/screen-picker.ts). 없으면 목록이 비고 고르기를 쓸 수 없다
  screens?: () => ScreenView[];
  identifyScreens?: (on: boolean) => void;
  pickScreen?: () => Promise<ManageReply>;
  mail?: (req: MailAction) => Promise<MailReply | null>; // 우편함 (src/main/mail.ts). 없으면 봉투 단추를 숨긴다. writer 를 놓았으면 null
  petMenu?: (petId: string) => void; // 파티 카드·박스 칸을 누르면 띄우는 포켓몬 메뉴 (src/main/menus.ts petMenu). 없으면 렌더러가 바로 개체 상세를 연다
}

let win: BrowserWindow | null = null;
let wired = false;
let drawRegion: ManageOptions["drawRegion"] = undefined; // 창을 열 때마다 새로 받는다 — 처리기는 한 번만 건다
let display: ManageOptions["display"] = undefined;
let account: ManageOptions["account"] = undefined;
let update: ManageOptions["update"] = undefined;
let notes: ManageOptions["notes"] = undefined;
let screens: ManageOptions["screens"] = undefined;
let identifyScreens: ManageOptions["identifyScreens"] = undefined;
let pickScreen: ManageOptions["pickScreen"] = undefined;
let mail: ManageOptions["mail"] = undefined;
let petMenu: ManageOptions["petMenu"] = undefined;
let dexWin: DexWindow | null = null;
let petWin: PetWindow | null = null;
let shopWin: ShopWindow | null = null;
let bagWin: BagWindow | null = null;
let partyWin: PartyWindow | null = null;

const isRequest = (v: unknown): v is ManageRequest =>
  v != null && typeof v === "object" && typeof (v as { cmd?: unknown }).cmd === "string";

// 표면이 보내지 못하는 명령 — 거래 실행기에만 있는 이름이다 (src/tx/handlers.ts). 명령 이름 표가 생기면 그 표의 표시로 바꾼다
// (worklog/records/code-structure/design/40-contracts-save-online.md `internal`)
const INTERNAL_COMMANDS: ReadonlySet<string> = new Set(["trade.lock", "trade.unlock", "trade.apply"]);
const isInternalCommand = (cmd: string): boolean => cmd.startsWith("mail.") || INTERNAL_COMMANDS.has(cmd);

const isAgentRequest = (v: unknown): v is { name: string; action: AgentAction } => {
  if (v == null || typeof v !== "object") return false;
  const r = v as { name?: unknown; action?: unknown };
  return typeof r.name === "string" && (r.action === "connect" || r.action === "disconnect" || r.action === "check" || r.action === "probe");
};

// 관리 창이 보낸 요청인가. 무대 창·선택 창도 같은 preload 를 쓰므로 보낸 창을 확인한다
const mine = (e: { sender: unknown }): boolean => isFromWindow(win, e);

const DENIED: ManageReply = { ok: false, reason: "denied" };

// 관리 창 문서로 보낸다 — 창이나 문서가 이미 닫혔으면 버린다. 창보다 문서(webContents)가 먼저 없어지는 순간이 있다
function toManage(channel: ManageChannel, ...args: unknown[]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, ...args);
}

// 채널을 한 번만 건다. 창을 여러 번 열어도 처리기는 하나다
function wire(game: GameV3, send: (req: ManageRequest) => Promise<ManageReply>, preload: string, html: string): void {
  if (wired) return;
  wired = true;
  ipcMain.handle(CH.snapshot, (e) => {
    if (!mine(e)) return null;
    game.tick(); // 본 값이 지금 값이 되도록 먼저 시간을 적용한다
    const view = game.view();
    return view && display ? { ...view, display: display() } : view;
  });
  ipcMain.handle(CH.dex, (e) => (mine(e) ? game.dex() : []));
  ipcMain.handle(CH.dexDetail, (e, slug: unknown) => (mine(e) && typeof slug === "string" ? game.dexDetail(slug) : null));
  ipcMain.handle(CH.shopDetail, (e, id: unknown) => (mine(e) && typeof id === "string" ? game.shopDetail(id) : null));
  ipcMain.handle(CH.agents, (e, req: unknown) => {
    if (!mine(e)) return { ...DENIED, list: [], platform: process.platform, node: null };
    return game.agents(isAgentRequest(req) ? req : undefined);
  });
  // 초상 — 요청 모양을 검사하고 한 번에 너무 많이 받지 않는다 (도감 한 화면 분량)
  let portraits: Portraits | null = null;
  // 앱 안 그림 폴더 — 설치본은 sprites/, 개발 중에는 scripts/fetch-sprites.cjs 가 받아 둔 .cache/sprites/
  const bundled = (): string => {
    const packed = path.join(PATHS.project, "sprites");
    return fs.existsSync(packed) ? packed : path.join(PATHS.project, ".cache", "sprites");
  };
  ipcMain.handle(CH.portraits, async (e, asks: unknown) => {
    if (!mine(e) || !Array.isArray(asks)) return {};
    const list = asks
      .filter((a): a is PortraitAsk => a != null && typeof a === "object" && typeof (a as PortraitAsk).slug === "string")
      .slice(0, INPUT_LIMITS.portraitAsks)
      .map((a) => ({ slug: a.slug, shiny: a.shiny === true }));
    portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
    return portraits.get(list);
  });
  ipcMain.handle(CH.icons, async (e, keys: unknown) => {
    if (!mine(e) || !Array.isArray(keys)) return {};
    portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
    return portraits.icons(keys.filter((k): k is string => typeof k === "string").slice(0, INPUT_LIMITS.iconKeys));
  });
  // 디스크에 있는 그림 전부 — 관리 창이 첫 화면 전에 한 번 부른다
  ipcMain.handle(CH.art, (e) => {
    if (!mine(e)) return {};
    portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
    return portraits.all();
  });
  // 도감 기기 창 — 칸을 누르면 띄우고, 이전·다음은 관리 창 목록 순서를 따른다
  let cries: Cries | null = null;
  dexWin = createDexWindow({
    preload,
    html: path.join(path.dirname(html), "dex.html"),
    detail: (slug) => game.dexDetail(slug),
    portrait: async (slug) => {
      portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
      return (await portraits.get([{ slug, shiny: false }]))[slug] ?? null;
    },
    tree: (slug) => {
      const detail = game.shopDetail(slug); // 상점 구매 창의 포켓몬 상세와 같은 사슬 (src/tx/shop-detail.ts)
      return detail?.kind === "pokemon" ? detail.tree : null;
    },
    portraits: async (slugs) => {
      portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
      const got = await portraits.get(slugs.map((slug) => ({ slug, shiny: false })));
      const out: Record<string, string> = {};
      for (const slug of slugs) {
        const uri = got[slug];
        if (uri) out[slug] = uri;
      }
      return out;
    },
    cry: (slug) => (cries ??= createCries(path.join(PATHS.home, "cries"))).get(slug),
    volume: () => {
      const s = game.read()?.settings;
      return s ? gainOf(s, SOUND_RULES.cryMax) : 0;
    },
    onStep: (delta) => toManage(CH.dexStep, delta),
    // 관리 창을 닫으면 자식인 기기 창도 같이 닫힌다. 그때는 관리 창 문서가 먼저 없어져 보낼 곳이 없다
    onClosed: (gen) => toManage(CH.dexClosed, gen),
  });
  // 파티 상세 기기 창 — 관리 창이 개체를 정해 보낸다. 누른 단추·이전·다음은 관리 창으로 돌려보낸다
  petWin = createPetWindow({
    preload,
    html: path.join(path.dirname(html), "pet.html"),
    portrait: async (slug, shiny) => {
      portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
      return (await portraits.get([{ slug, shiny }]))[portraitKey({ slug, shiny })] ?? null;
    },
    megaIcon: async () => {
      portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
      return (await portraits.icons([MEGA_STONE_ICON]))[MEGA_STONE_ICON] ?? null;
    },
    cry: (slug) => (cries ??= createCries(path.join(PATHS.home, "cries"))).get(slug),
    volume: () => {
      const s = game.read()?.settings;
      return s ? gainOf(s, SOUND_RULES.cryMax) : 0;
    },
    onStep: (delta) => toManage(CH.petStep, delta),
    onAct: (action) => toManage(CH.petAct, action),
    onClosed: (gen) => toManage(CH.petClosed, gen),
  });
  // 상점 기기 창 — 관리 창이 상품을 정해 보낸다. 수량·구매·이전·다음은 관리 창으로 돌려보낸다
  shopWin = createShopWindow({
    preload,
    html: path.join(path.dirname(html), "shop.html"),
    onStep: (delta) => toManage(CH.shopStep, delta),
    onAct: (action) => toManage(CH.shopAct, action),
    onClosed: (gen) => toManage(CH.shopClosed, gen),
  });
  // 가방 기기 창 — 관리 창이 도구를 정해 보낸다. 사용·판매·파티 고르기·수량·이전·다음은 관리 창으로 돌려보낸다
  bagWin = createBagWindow({
    preload,
    html: path.join(path.dirname(html), "bag.html"),
    onStep: (delta) => toManage(CH.bagStep, delta),
    onAct: (action) => toManage(CH.bagAct, action),
    onClosed: (gen) => toManage(CH.bagClosed, gen),
  });
  // 파티 기기 창(교체 화면) — 관리 창이 지금 프리셋의 칸을 정해 보낸다. 누른 칸·칩은 관리 창으로 돌려보낸다
  partyWin = createPartyWindow({
    preload,
    html: path.join(path.dirname(html), "party.html"),
    onStep: (delta) => toManage(CH.partyStep, delta),
    onAct: (action) => toManage(CH.partyAct, action),
    onClosed: (gen) => toManage(CH.partyClosed, gen),
  });
  ipcMain.on(CH.partyOpen, (e, open: unknown, gen: unknown) => {
    if (!win || !mine(e)) return;
    const slots = open && typeof open === "object" ? (open as { slots?: unknown }).slots : undefined;
    if (Array.isArray(slots)) partyWin?.show(win, open as PartyDeviceOpen, gen);
    else partyWin?.close();
  });
  // 여는 요청에는 관리 창이 마지막으로 받은 세대 번호(gen)가 실려 온다 — 낡은 번호면 기기 창이 버린다 (src/main/windows/device-gen.ts)
  ipcMain.on(CH.petOpen, (e, open: unknown, gen: unknown) => {
    if (!win || !mine(e)) return;
    const pet = open && typeof open === "object" ? (open as { pet?: { species?: unknown; id?: unknown } }).pet : undefined;
    if (pet && typeof pet.species === "string" && typeof pet.id === "string") void petWin?.show(win, open as PetDeviceOpen, gen);
    else petWin?.close();
  });
  ipcMain.on(CH.shopOpen, (e, open: unknown, gen: unknown) => {
    if (!win || !mine(e)) return;
    const id = open && typeof open === "object" ? (open as { productId?: unknown }).productId : undefined;
    if (typeof id === "string") shopWin?.show(win, open as ShopDeviceOpen, gen);
    else shopWin?.close();
  });
  ipcMain.on(CH.bagOpen, (e, open: unknown, gen: unknown) => {
    if (!win || !mine(e)) return;
    const id = open && typeof open === "object" ? (open as { itemId?: unknown }).itemId : undefined;
    if (typeof id === "string") bagWin?.show(win, open as BagDeviceOpen, gen);
    else bagWin?.close();
  });
  ipcMain.on(CH.dexOpen, (e, slug: unknown, gen: unknown, beside: unknown) => {
    if (!win || !mine(e)) return;
    // beside — 파티 상세의 `도감 보기`. 관리 창과 파티 상세 기기 창을 한 덩어리로 보고 그 옆에 붙인다
    if (typeof slug === "string") void dexWin?.show(win, slug, gen, beside === true ? PET_WINDOW.width : 0);
    else dexWin?.close();
  });
  ipcMain.on(CH.dim, (e, on: unknown) => {
    if (!win || !mine(e)) return;
    const c = on === true ? CHROME_DIM : CHROME;
    try {
      win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: CHROME.height });
    } catch {
      // 창 단추를 OS 가 그리지 않는 곳(mac 등)에서는 할 일이 없다
    }
  });
  // 교환 링크 복사 — 관리 창이 보낸 짧은 글자만 받는다
  ipcMain.on(CH.copy, (e, text: unknown) => {
    if (!win || !mine(e)) return;
    if (typeof text === "string" && text.length <= INPUT_LIMITS.copyChars) clipboard.writeText(text);
  });
  // 계정 — 요청 모양은 action 문자열만 확인한다. 값의 검사는 src/online/account.ts 가 한다
  ipcMain.handle(CH.account, async (e, req: unknown): Promise<AccountReply | null> => {
    if (!mine(e)) return null;
    if (!account) return null;
    if (req == null || typeof req !== "object" || typeof (req as { action?: unknown }).action !== "string") return null;
    return account(req as AccountAction);
  });
  // 우편함 — 정한 세 동작만 받는다. 편지 id 는 짧은 글자만. 선물 값은 렌더러에서 받지 않는다
  ipcMain.handle(CH.mail, async (e, req: unknown): Promise<MailReply | null> => {
    if (!mine(e) || !mail) return null;
    const r = req as { action?: unknown; id?: unknown } | null;
    if (!r || typeof r !== "object") return null;
    if (r.action === "refresh") return mail({ action: "refresh" });
    if ((r.action === "read" || r.action === "claim") && typeof r.id === "string" && /^[0-9a-f-]{36}$/i.test(r.id)) return mail({ action: r.action, id: r.id });
    return null;
  });
  // 업데이트 — 정한 세 동작만 받는다
  ipcMain.handle(CH.update, async (e, action: unknown): Promise<UpdateView | null> => {
    if (!mine(e) || !update) return null;
    if (action !== "status" && action !== "check" && action !== "install") return null;
    return update(action);
  });
  ipcMain.handle(CH.notes, (e, action: unknown): PatchNotesView | null => {
    if (!mine(e) || !notes) return null;
    if (action !== "list" && action !== "seen") return null;
    return notes(action);
  });
  // 포켓몬 메뉴 — 개체 식별자만 받는다. 띄웠으면 true, 띄울 길이 없으면 false
  ipcMain.handle(CH.petMenu, (e, petId: unknown): boolean => {
    if (!mine(e) || !petMenu || typeof petId !== "string" || petId.length > 64) return false;
    petMenu(petId);
    return true;
  });
  ipcMain.handle(CH.screens, (e): ScreenView[] => (mine(e) && screens ? screens() : []));
  ipcMain.on(CH.identifyScreens, (e, on: unknown) => {
    if (!win || !mine(e)) return;
    identifyScreens?.(on === true);
  });
  ipcMain.handle(CH.pickScreen, async (e): Promise<ManageReply> => {
    if (!mine(e)) return DENIED;
    if (!pickScreen) return { ok: false, reason: "not-ready" };
    return pickScreen();
  });
  ipcMain.handle(CH.drawRegion, async (e): Promise<ManageReply> => {
    if (!mine(e)) return DENIED;
    if (!drawRegion) return { ok: false, reason: "not-ready" };
    return drawRegion();
  });
  ipcMain.handle(CH.command, async (e, req: unknown): Promise<ManageReply> => {
    if (!mine(e)) return DENIED;
    if (!isRequest(req)) return { ok: false, reason: "bad-request" };
    // 우편함 넣기와 교환의 잠금·반영은 메인의 우편함·교환 세션만 실행기에 낸다 — 받은 길(send)이 명령 처리기를 거치지 않아도(개발용 실행기) 막는다
    if (isInternalCommand(req.cmd)) return { ok: false, reason: "unknown-cmd" };
    game.tick();
    return send(req);
  });
}

export function openManage(opts: ManageOptions): BrowserWindow {
  drawRegion = opts.drawRegion;
  display = opts.display;
  account = opts.account;
  update = opts.update;
  notes = opts.notes;
  screens = opts.screens;
  identifyScreens = opts.identifyScreens;
  pickScreen = opts.pickScreen;
  mail = opts.mail;
  petMenu = opts.petMenu;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (opts.route) win.webContents.send(CH.route, opts.route);
    return win;
  }
  const game = opts.game ?? createGame();
  wire(game, opts.send, opts.preload, opts.html);
  win = new BrowserWindow({
    width: WINDOW_V3_RULES.width,
    height: WINDOW_V3_RULES.height,
    minWidth: WINDOW_V3_RULES.width,
    maxWidth: WINDOW_V3_RULES.width,
    minHeight: WINDOW_V3_RULES.minHeight,
    title: "pokebuddy",
    icon: windowIcon(),
    // 제목 표시줄을 숨기고 우리 헤더를 그 자리에 둔다. 창 조작 단추는 OS 가 헤더 위에 겹쳐 그린다.
    // 단추를 직접 그리지 않으므로 Windows 의 맞춤 배치와 키보드 조작이 그대로 남는다 (docs/specs/game.md "화면 구조")
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: CHROME.color,
      symbolColor: CHROME.symbolColor,
      height: CHROME.height,
    },
    webPreferences: webPreferencesOf(opts.preload),
  });
  win.on("closed", () => {
    win = null;
    identifyScreens?.(false); // 한 화면 목록이 열린 채 닫혀도 번호 덮개가 남지 않게
  });
  // 문서를 (다시) 읽기 시작한다 — 렌더러의 세대 번호가 0 에서 다시 시작하므로 기기 창 번호도 맞춘다
  win.webContents.on("did-start-loading", () => {
    petWin?.resetGen();
    dexWin?.resetGen();
    shopWin?.resetGen();
    bagWin?.resetGen();
    partyWin?.resetGen();
  });
  const route = opts.route;
  // 문서를 다 읽은 뒤에 보낸다. 렌더러는 첫 화면을 그린 뒤에 옮긴다
  if (route) win.webContents.once("did-finish-load", () => win?.webContents.send(CH.route, route));
  void win.loadFile(opts.html);
  return win;
}

// 교환 보기를 관리 창에 밀어 보낸다 — 창이 없으면 버린다. 창을 열면 렌더러가 trade.status 로 다시 받는다
export function pushTrade(screen: TradeScreen): void {
  toManage(CH.trade, screen);
}

// 계정·저장 상태를 관리 창에 밀어 보낸다 — 창이 없으면 버린다
export function pushAccount(screen: AccountScreen): void {
  toManage(CH.accountView, screen);
}

// 버전·업데이트 상태를 관리 창에 밀어 보낸다 — 창이 없으면 버린다
export function pushMail(screen: MailScreen): void {
  toManage(CH.mailView, screen);
}

export function pushUpdate(view: UpdateView): void {
  toManage(CH.updateView, view);
}

// 앱 전역 1초 시계 — 관리 창에 `manage:clock` 을 보낸다. 창이 없으면 버린다 (src/main/clock.ts).
// 기기 창에는 보내지 않는다 — 파티 상세는 관리 창이 새로 읽은 값을 다시 보내고, 도감 항목은 시간과 관계없다
export function pushClock(now: number): void {
  toManage(CH.clock, { now });
}

