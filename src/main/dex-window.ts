// 도감 기기 창 — 관리 창 옆에 붙어 한 종의 도감 항목을 보이는 창. 문서는 src/renderer/dex.html
//
// 관리 창의 도감 칸을 누르면 뜬다. 관리 창 격자 아래에 상세를 끼우던 방식은 격자를 다시 그려 스크롤이 튀었다 (worklog/records/play-bugs/record.md).
// 폭은 고정, 높이는 렌더러가 그린 높이다. 관리 창 내용 영역의 오른쪽 위에 붙인다. 오른쪽에 자리가 없으면 왼쪽에 붙인다.
// 관리 창을 옮기면 따라간다. 관리 창이 닫히면 같이 닫힌다(parent). 창은 하나만 둔다
// 파티 상세의 `도감 보기` 로 열면 파티 상세 기기 창 옆에 붙는다 — 관리 창과 파티 상세 기기 창을 한 덩어리로 보고 그 옆(2026-10-01 사용자 결정 "옆에 그 포켓몬 상세도감기기를 띄울까")
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { DexDetail, EvoNodeView } from "../shared/model/detail";
import type { DexDeviceChannel } from "../shared/ipc/devices";
import type { DexDeviceView } from "../shared/model/devices";
import { windowIcon } from "./paths.js";
import { webPreferencesOf } from "./window-options.js";
import { createGenGate } from "./device-gen.js";

const CH = {
  show: "dexdev:show",
  size: "dexdev:size",
  step: "dexdev:step",
  cry: "dexdev:cry",
  close: "dexdev:close",
} satisfies Record<string, DexDeviceChannel>;

// Figma `Dex Device` 폭. 높이는 첫 그림 전 어림값이다
export const DEX_WINDOW = { width: 380, height: 508 };

export interface DexWindowOptions {
  preload: string;
  html: string;
  detail: (slug: string) => DexDetail | null;
  portrait: (slug: string) => Promise<string | null>;
  tree: (slug: string) => EvoNodeView | null; // 진화 트리 — 상점 구매 창과 같다 (2026-09-30 사용자 결정 도감 상세 A안)
  portraits: (slugs: string[]) => Promise<Record<string, string>>; // 트리 종들의 그림을 한 번에
  cry: (slug: string) => Promise<string | null>;
  volume: () => number; // 울음소리 음량 0~1
  onStep: (delta: -1 | 1) => void; // 이전·다음 — 순서는 관리 창 목록이 정한다
  onClosed: (gen: number) => void; // 닫혔다 — 새 세대 번호를 관리 창에 준다
}

export interface DexWindow {
  show: (parent: BrowserWindow, slug: string, gen: unknown, beside?: number) => Promise<void>; // gen 이 지금 세대 번호가 아니면 버린다. beside 는 관리 창 옆에 먼저 붙은 창의 폭(파티 상세 기기 창) — 0 이면 관리 창 옆
  close: () => void;
  resetGen: () => void; // 관리 창 문서를 새로 읽었다 — 세대 번호를 0 으로
}

// 붙일 자리 — 관리 창 내용 영역 옆. 화면 오른쪽 끝을 넘으면 왼쪽에 붙인다
export function dockAt(parent: { x: number; y: number; width: number; height: number }, area: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): { x: number; y: number; side: "right" | "left" } {
  const right = parent.x + parent.width;
  const side = right + size.width <= area.x + area.width || parent.x - size.width < area.x ? "right" : "left";
  const x = side === "right" ? right : parent.x - size.width;
  const y = Math.max(area.y, Math.min(parent.y, area.y + area.height - size.height));
  return { x, y, side };
}

// 사용자가 연 기기 창에 키보드 초점을 준다 — 옆 창을 한 번 더 누르지 않아도 방향키·Esc 가 먹게
// - show(): 숨은 창을 보이고 앞으로. mac 은 key 창, Windows 는 활성 창이 된다
// - focus(): 이미 보이는 창도 key·활성 창으로. 관리 창을 누른 직후라 앱이 앞에 있어 OS 가 막지 않는다
// - webContents.focus(): 문서 안 초점까지. keydown 을 document 에서 받는다
export function bringUp(w: BrowserWindow): void {
  if (!w.isVisible()) w.show();
  w.focus();
  w.webContents.focus();
}

export function createDexWindow(opts: DexWindowOptions): DexWindow {
  let win: BrowserWindow | null = null;
  // 세대 번호 — 닫을 때마다 올린다. 낡은 번호의 show 는 버린다 (src/main/device-gen.ts)
  const gate = createGenGate();
  let owner: BrowserWindow | null = null;
  let slug: string | null = null;
  let focusNext = false; // 사용자가 연 종을 아직 못 보였다 — 첫 높이를 받으면 초점과 함께 보인다
  let height = DEX_WINDOW.height;
  let side: "right" | "left" = "right";
  let beside = 0; // 관리 창 옆에 먼저 붙은 창의 폭 — 0 이면 관리 창에 바로 붙는다

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null);
  const mine = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!alive() && e.sender === win?.webContents;

  function place(): void {
    const w = alive();
    if (!w || !owner || owner.isDestroyed()) return;
    const b = owner.getContentBounds();
    const area = screen.getDisplayMatching(b).workArea;
    // 파티 상세 옆 — 파티 상세 기기 창 자리를 같은 규칙(dockAt)으로 셈해 관리 창과 합친 덩어리 옆에 붙인다.
    // 파티 상세 창의 지금 위치를 읽지 않는다 — 관리 창을 옮길 때 두 창이 따라가는 순서와 상관없이 같은 자리가 나온다
    const pet = beside ? dockAt(b, area, { width: beside, height }) : null;
    const base = pet ? { x: Math.min(b.x, pet.x), y: b.y, width: b.width + beside, height: b.height } : b;
    const at = dockAt(base, area, { width: DEX_WINDOW.width, height });
    side = at.side;
    w.setBounds({ x: at.x, y: at.y, width: DEX_WINDOW.width, height });
  }

  // 붙은 쪽이 바뀌면 경첩 면을 다시 그리도록 다시 보낸다
  const follow = (): void => {
    const was = side;
    place();
    if (side !== was) void send();
  };
  const hideWithOwner = (): void => alive()?.hide();
  // 관리 창을 따라 다시 보일 때는 초점을 빼앗지 않는다
  const showWithOwner = (): void => {
    focusNext = false;
    if (slug) alive()?.showInactive();
  };

  function detach(): void {
    if (!owner || owner.isDestroyed()) return; // 닫힌 창은 듣는 것도 함께 사라진다
    owner.removeListener("move", follow);
    owner.removeListener("resize", follow);
    owner.removeListener("minimize", hideWithOwner);
    owner.removeListener("restore", showWithOwner);
  }

  function attach(parent: BrowserWindow): void {
    if (owner === parent) return;
    detach();
    owner = parent;
    parent.on("move", follow);
    parent.on("resize", follow);
    parent.on("minimize", hideWithOwner);
    parent.on("restore", showWithOwner);
  }

  function create(parent: BrowserWindow): BrowserWindow {
    const w = new BrowserWindow({
      width: DEX_WINDOW.width,
      height,
      show: false,
      parent,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: "pokebuddy",
      icon: windowIcon(),
      webPreferences: webPreferencesOf(opts.preload),
    });
    w.removeMenu();
    w.on("closed", () => {
      win = null;
      slug = null;
      focusNext = false;
      detach();
      owner = null;
      opts.onClosed(gate.bump());
    });
    void w.loadFile(opts.html);
    return w;
  }

  async function send(): Promise<void> {
    const w = alive();
    if (!w || !slug) return;
    const detail = opts.detail(slug);
    if (!detail) return;
    // 미해금 종도 진화 카드를 보인다. 트리 안의 미해금 종은 기기 창이 검은 실루엣과 ??? 로 그린다 (2026-10-02 사용자 결정) — 그림은 모든 종을 보낸다
    const tree = opts.tree(slug);
    const shown: string[] = [];
    const walk = (n: EvoNodeView): void => {
      shown.push(n.slug);
      n.children.forEach(walk);
    };
    if (tree) walk(tree);
    const [portrait, treePortraits] = await Promise.all([opts.portrait(slug), shown.length ? opts.portraits(shown) : Promise.resolve({})]);
    const view: DexDeviceView = { detail, portrait, side, volume: opts.volume(), tree, treePortraits, beside: beside > 0 };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => alive()?.webContents.send(CH.show, view));
    else w.webContents.send(CH.show, view);
  }

  // 채널은 한 번만 건다. 창이 다시 만들어져도 처리기는 하나다
  ipcMain.on(CH.size, (e, h: unknown) => {
    if (!mine(e) || typeof h !== "number" || !Number.isFinite(h)) return;
    height = Math.max(200, Math.min(1200, Math.ceil(h)));
    place();
    const w = alive();
    if (!w || w.isVisible()) return;
    if (focusNext) bringUp(w);
    else w.showInactive();
    focusNext = false;
  });
  ipcMain.on(CH.step, (e, delta: unknown) => {
    if (mine(e) && (delta === 1 || delta === -1)) opts.onStep(delta);
  });
  ipcMain.handle(CH.cry, async (e) => (mine(e) && slug && opts.volume() > 0 ? opts.cry(slug) : null));
  ipcMain.on(CH.close, (e) => {
    if (mine(e)) alive()?.close();
  });

  return {
    // 다른 종을 열 때만 초점을 준다 — 같은 종을 다시 보내는 것은 부화·해금 뒤 새로 읽기다(관리 창 loadDex)
    async show(parent, next, gen, nextBeside = 0) {
      if (!gate.accepts(gen)) return; // 닫힘을 알기 전에 보낸 요청(새로 읽기의 다시 보내기)이다 — 닫은 창을 다시 띄우지 않는다
      const opened = !alive() || next !== slug;
      slug = next;
      beside = nextBeside;
      attach(parent);
      if (!alive()) win = create(parent);
      place();
      const w = alive();
      if (w?.isVisible()) {
        if (opened) bringUp(w);
        focusNext = false;
      } else if (opened) focusNext = true; // 첫 표시 — 렌더러가 높이를 보낸 뒤(size) 보이며 초점을 준다
      await send();
    },
    close() {
      alive()?.close();
    },
    resetGen: () => gate.reset(),
  };
}
