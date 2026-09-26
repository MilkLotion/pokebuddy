// 관리 창 — 파티·박스·도감·상점·가방을 보는 창. 문서는 src/renderer/manage.html, 값은 스냅샷이 준다.
//
// 폭은 고정이고 세로만 조절한다. 박스 6열과 도감 5열 격자가 640 폭에 맞춰져 있다 (docs/specs/s5.md "관리 창").
// 창을 열 때 흐른 시간을 먼저 적용한다. 그래야 만복도와 쿨타임이 지금 값으로 보인다.
// 창은 하나만 둔다. 다시 열면 이미 떠 있는 창을 앞으로 가져온다.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { AgentAction, DisplayView, ManageChannel, ManageReply, ManageRequest, ManageRoute } from "../shared/manage";
import { WINDOW_V3_RULES } from "../save/rules.js";
import { createGame, type GameV3 } from "./game.js";
import { PATHS, windowIcon } from "./paths.js";
import { createPortraits, type PortraitAsk, type Portraits } from "./portraits.js";
import { createCries, type Cries } from "./cries.js";
import { createDexWindow, type DexWindow } from "./dex-window.js";
import fs from "node:fs";
import path from "node:path";

const CH = {
  snapshot: "manage:snapshot",
  command: "manage:command",
  dex: "manage:dex",
  dexDetail: "manage:dex-detail",
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
  // 없으면 실행기를 바로 부른다 (개발용 실행기)
  send?: (req: ManageRequest) => Promise<ManageReply>;
  route?: ManageRoute; // 열면서 옮겨 갈 곳 — 알림 배너의 `바로가기`
  // 설정의 `영역 그리기`. 영역 그리기 창을 열고 적용한 영역을 저장한다. 없으면 이 기능을 쓸 수 없다
  drawRegion?: () => Promise<ManageReply>;
  display?: () => DisplayView; // 포켓몬 표시·클릭 통과의 지금 값. 저장 밖이라 앱이 준다
}

let win: BrowserWindow | null = null;
let wired = false;
let drawRegion: ManageOptions["drawRegion"] = undefined; // 창을 열 때마다 새로 받는다 — 처리기는 한 번만 건다
let display: ManageOptions["display"] = undefined;
let dexWin: DexWindow | null = null;

const isRequest = (v: unknown): v is ManageRequest =>
  v != null && typeof v === "object" && typeof (v as { cmd?: unknown }).cmd === "string";

const isAgentRequest = (v: unknown): v is { name: string; action: AgentAction } => {
  if (v == null || typeof v !== "object") return false;
  const r = v as { name?: unknown; action?: unknown };
  return typeof r.name === "string" && (r.action === "connect" || r.action === "disconnect" || r.action === "check");
};

// 관리 창이 보낸 요청인가. 무대 창·선택 창도 같은 preload 를 쓰므로 보낸 창을 확인한다
const mine = (e: IpcMainInvokeEvent): boolean => !!win && !win.isDestroyed() && e.sender === win.webContents;

const DENIED: ManageReply = { ok: false, reason: "denied" };

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
  ipcMain.handle(CH.agents, (e, req: unknown) => {
    if (!mine(e)) return { ...DENIED, list: [] };
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
      .slice(0, 300)
      .map((a) => ({ slug: a.slug, shiny: a.shiny === true }));
    portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
    return portraits.get(list);
  });
  ipcMain.handle(CH.icons, async (e, keys: unknown) => {
    if (!mine(e) || !Array.isArray(keys)) return {};
    portraits ??= createPortraits(path.join(PATHS.home, "sprites"), bundled());
    return portraits.icons(keys.filter((k): k is string => typeof k === "string").slice(0, 200));
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
    cry: (slug) => (cries ??= createCries(path.join(PATHS.home, "cries"))).get(slug),
    sound: () => game.read()?.settings.sound !== false,
    onStep: (delta) => {
      if (win && !win.isDestroyed()) win.webContents.send(CH.dexStep, delta);
    },
    onClosed: () => {
      if (win && !win.isDestroyed()) win.webContents.send(CH.dexClosed);
    },
  });
  ipcMain.on(CH.dexOpen, (e, slug: unknown) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (typeof slug === "string") void dexWin?.show(win, slug);
    else dexWin?.close();
  });
  ipcMain.on(CH.dim, (e, on: unknown) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const c = on === true ? CHROME_DIM : CHROME;
    try {
      win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: CHROME.height });
    } catch {
      // 창 단추를 OS 가 그리지 않는 곳(mac 등)에서는 할 일이 없다
    }
  });
  ipcMain.handle(CH.drawRegion, async (e): Promise<ManageReply> => {
    if (!mine(e)) return DENIED;
    if (!drawRegion) return { ok: false, reason: "not-ready" };
    return drawRegion();
  });
  ipcMain.handle(CH.command, async (e, req: unknown): Promise<ManageReply> => {
    if (!mine(e)) return DENIED;
    if (!isRequest(req)) return { ok: false, reason: "bad-request" };
    game.tick();
    return send(req);
  });
}

export function openManage(opts: ManageOptions): BrowserWindow {
  drawRegion = opts.drawRegion;
  display = opts.display;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (opts.route) win.webContents.send(CH.route, opts.route);
    return win;
  }
  const game = opts.game ?? createGame();
  wire(game, opts.send ?? (async (req) => game.send(req, "settings")), opts.preload, opts.html);
  win = new BrowserWindow({
    width: WINDOW_V3_RULES.width,
    height: WINDOW_V3_RULES.height,
    minWidth: WINDOW_V3_RULES.width,
    maxWidth: WINDOW_V3_RULES.width,
    minHeight: WINDOW_V3_RULES.minHeight,
    title: "pokebuddy",
    icon: windowIcon(),
    // 제목 표시줄을 숨기고 우리 헤더를 그 자리에 둔다. 창 조작 단추는 OS 가 헤더 위에 겹쳐 그린다.
    // 단추를 직접 그리지 않으므로 Windows 의 맞춤 배치와 키보드 조작이 그대로 남는다 (docs/specs/s5.md "화면 구조")
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: CHROME.color,
      symbolColor: CHROME.symbolColor,
      height: CHROME.height,
    },
    webPreferences: { preload: opts.preload },
  });
  win.on("closed", () => {
    win = null;
  });
  const route = opts.route;
  // 문서를 다 읽은 뒤에 보낸다. 렌더러는 첫 화면을 그린 뒤에 옮긴다
  if (route) win.webContents.once("did-finish-load", () => win?.webContents.send(CH.route, route));
  void win.loadFile(opts.html);
  return win;
}

export function closeManage(): void {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}
