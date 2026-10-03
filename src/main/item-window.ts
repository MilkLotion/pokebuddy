// 상품 기기 창 — 관리 창 옆에 붙어 상점 상품·가방 도구 하나를 보이는 창의 공통 틀. 상점(src/main/shop-window.ts)·가방(src/main/bag-window.ts)이 쓴다
//
// 파티 상세 기기 창(src/main/pet-window.ts)과 같은 방식이다. 무엇을 보일지는 관리 창이 정해 보낸다. 누른 단추는 관리 창으로 돌려보낸다.
// 폭은 고정, 높이는 렌더러가 그린 높이다. 관리 창을 옮기면 따라가고, 닫히면 같이 닫힌다(parent). 종류마다 창은 하나만 둔다
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { bringUp } from "./dex-window.js";
import { dockAt } from "./windows/placement.js";
import { windowIcon } from "./paths.js";
import { webPreferencesOf } from "./windows/options.js";
import { createGenGate } from "./device-gen.js";

export interface ItemWindowChannels {
  show: string;
  size: string;
  step: string;
  close: string;
  act: string;
}

export interface ItemWindowOptions<Open, Action> {
  preload: string;
  html: string;
  channels: ItemWindowChannels;
  size: { width: number; height: number }; // 폭 고정. 높이는 첫 그림 전 어림값
  keyOf: (open: Open) => string; // 다른 것을 열었는가 — 다를 때만 초점을 준다
  isAction: (v: unknown) => v is Action; // 렌더러가 보낸 값은 믿지 않는다 — 정해진 모양만 넘긴다
  onStep: (delta: -1 | 1) => void; // 이전·다음 — 순서는 관리 창이 정한다
  onAct: (action: Action) => void; // 누른 단추 — 관리 창이 처리한다
  onClosed: (gen: number) => void; // 닫혔다 — 새 세대 번호를 관리 창에 준다
}

export interface ItemWindow<Open> {
  show: (parent: BrowserWindow, open: Open, gen: unknown) => void; // gen 이 지금 세대 번호가 아니면 버린다
  close: () => void;
  resetGen: () => void; // 관리 창 문서를 새로 읽었다 — 세대 번호를 0 으로
}

export function createItemWindow<Open extends object, Action>(opts: ItemWindowOptions<Open, Action>): ItemWindow<Open> {
  const CH = opts.channels;
  const SIZE = opts.size;
  let win: BrowserWindow | null = null;
  const closing = new WeakSet<BrowserWindow>(); // 닫히는 중인 창 — 다시 쓰지 않고 새로 만든다
  let owner: BrowserWindow | null = null;
  let current: Open | null = null;
  let focusNext = false; // 사용자가 연 것을 아직 못 보였다 — 첫 높이를 받으면 초점과 함께 보인다
  let height = SIZE.height;
  let side: "right" | "left" = "right";
  // 세대 번호 — 닫을 때마다 올린다. 낡은 번호의 show 는 버린다 (src/main/device-gen.ts)
  const gate = createGenGate();

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() && !closing.has(win) ? win : null);
  const mine = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => !!alive() && e.sender === win?.webContents;

  function place(): void {
    const w = alive();
    if (!w || !owner || owner.isDestroyed()) return;
    const b = owner.getContentBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const at = dockAt(b, area, { width: SIZE.width, height });
    side = at.side;
    w.setBounds({ x: at.x, y: at.y, width: SIZE.width, height });
  }

  // 붙은 쪽이 바뀌면 경첩 면을 다시 그리도록 다시 보낸다
  const follow = (): void => {
    const was = side;
    place();
    if (side !== was) send();
  };
  const hideWithOwner = (): void => alive()?.hide();
  // 관리 창을 따라 다시 보일 때는 초점을 빼앗지 않는다
  const showWithOwner = (): void => {
    focusNext = false;
    if (current) alive()?.showInactive();
  };

  function detach(): void {
    if (!owner || owner.isDestroyed()) return;
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
      width: SIZE.width,
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
    w.on("close", () => closing.add(w));
    w.on("closed", () => {
      if (win !== w) return; // 닫히는 동안 새 창을 만들었다 — 그 창의 상태는 두고 간다
      win = null;
      current = null;
      focusNext = false;
      detach();
      owner = null;
      opts.onClosed(gate.bump());
    });
    void w.loadFile(opts.html);
    return w;
  }

  function send(): void {
    const w = alive();
    if (!w || !current) return;
    const view = { ...current, side };
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => alive()?.webContents.send(CH.show, view));
    else w.webContents.send(CH.show, view);
  }

  ipcMain.on(CH.size, (e, h: unknown) => {
    if (!mine(e) || typeof h !== "number" || !Number.isFinite(h)) return;
    height = Math.max(200, Math.min(1200, Math.ceil(h)));
    place();
    // 관리 창이 최소화돼 있으면 따라 숨어 있는다 — 기기 창만 혼자 뜨지 않게
    const w = alive();
    if (!w || w.isVisible() || !owner || owner.isDestroyed() || owner.isMinimized()) return;
    if (focusNext) bringUp(w);
    else w.showInactive();
    focusNext = false;
  });
  ipcMain.on(CH.step, (e, delta: unknown) => {
    if (mine(e) && (delta === 1 || delta === -1)) opts.onStep(delta);
  });
  ipcMain.on(CH.close, (e) => {
    if (mine(e)) alive()?.close();
  });
  ipcMain.on(CH.act, (e, action: unknown) => {
    if (!mine(e) || !opts.isAction(action)) return;
    opts.onAct(action);
  });

  return {
    // 다른 것을 열 때만 초점을 준다 — 같은 것을 다시 보내는 것은 새로 읽기·단추 뒤 갱신이다(관리 창 syncShopDevice·syncBagDevice)
    show(parent, next, gen) {
      if (!gate.accepts(gen)) return; // 닫힘을 알기 전에 보낸 요청이다 — 닫은 창을 다시 띄우지 않는다
      const opened = !alive() || !current || opts.keyOf(next) !== opts.keyOf(current);
      current = next;
      attach(parent);
      if (!alive()) win = create(parent);
      place();
      const w = alive();
      if (w?.isVisible()) {
        if (opened) bringUp(w);
        focusNext = false;
      } else if (opened) focusNext = true; // 첫 표시 — 렌더러가 높이를 보낸 뒤(size) 보이며 초점을 준다
      send();
    },
    close() {
      alive()?.close();
    },
    resetGen: () => gate.reset(),
  };
}

