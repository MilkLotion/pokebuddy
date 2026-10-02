// 파티 상세 기기 창 — 관리 창 옆에 붙어 개체 하나의 상세를 보이는 창. 문서는 src/renderer/pet.html
//
// 도감 기기 창(src/main/dex-window.ts)과 같은 방식이다. 관리 창에서 포켓몬 칸을 누르면 뜬다(2026-09-28 사용자 "파티상세페이지도 도감상세처럼
// 옆에 뜨는거로 바꾸자", A안 기기형 — Figma 05 `Party / Detail Device` `908:23772`(기기 `Party Detail Device` `1262:76637`), worklog/records/party-detail-window/record.md).
// 무엇을 보일지는 관리 창이 정해 보낸다(개체·자리·빈 파티 칸). 누른 단추는 관리 창으로 돌려보낸다 — 명령과 대화상자는 관리 창이 처리한다.
// 폭은 고정, 높이는 렌더러가 그린 높이다. 관리 창을 옮기면 따라가고, 닫히면 같이 닫힌다(parent). 창은 하나만 둔다
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { PetDeviceAction, PetDeviceChannel, PetDeviceOpen, PetDeviceView } from "../shared/manage";
import { bringUp, dockAt } from "./dex-window.js";
import { windowIcon } from "./paths.js";
import { createGenGate } from "./device-gen.js";

const CH = {
  show: "petdev:show",
  size: "petdev:size",
  step: "petdev:step",
  cry: "petdev:cry",
  close: "petdev:close",
  act: "petdev:act",
} satisfies Record<string, PetDeviceChannel>;

// Figma `A안 · 파티 상세 기기` 폭. 높이는 첫 그림 전 어림값이다
export const PET_WINDOW = { width: 380, height: 682 };


export interface PetWindowOptions {
  preload: string;
  html: string;
  portrait: (slug: string, shiny: boolean) => Promise<string | null>;
  megaIcon: () => Promise<string | null>; // 메가스톤 표식 그림(키스톤)
  cry: (slug: string) => Promise<string | null>;
  volume: () => number; // 울음소리 음량 0~1
  onStep: (delta: -1 | 1) => void; // 이전·다음 — 순서는 관리 창이 정한다
  onAct: (action: PetDeviceAction) => void; // 누른 단추 — 관리 창이 처리한다
  onClosed: (gen: number) => void; // 닫혔다 — 새 세대 번호를 관리 창에 준다
}

export interface PetWindow {
  show: (parent: BrowserWindow, open: PetDeviceOpen, gen: unknown) => Promise<void>; // gen 이 지금 세대 번호가 아니면 버린다
  close: () => void;
  resetGen: () => void; // 관리 창 문서를 새로 읽었다 — 세대 번호를 0 으로
}

export function createPetWindow(opts: PetWindowOptions): PetWindow {
  let win: BrowserWindow | null = null;
  const closing = new WeakSet<BrowserWindow>(); // 닫히는 중인 창 — 다시 쓰지 않고 새로 만든다
  let owner: BrowserWindow | null = null;
  let current: PetDeviceOpen | null = null;
  let focusNext = false; // 사용자가 연 개체를 아직 못 보였다 — 첫 높이를 받으면 초점과 함께 보인다
  let height = PET_WINDOW.height;
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
    const at = dockAt(b, area, { width: PET_WINDOW.width, height });
    side = at.side;
    w.setBounds({ x: at.x, y: at.y, width: PET_WINDOW.width, height });
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
      width: PET_WINDOW.width,
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
      webPreferences: { preload: opts.preload },
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

  async function send(): Promise<void> {
    const w = alive();
    const open = current;
    if (!w || !open) return;
    // 메가 모습이면 그 초상이다 (PetView.look)
    const [portrait, megaIcon] = await Promise.all([opts.portrait(open.pet.look, open.pet.shiny), open.pet.mega ? opts.megaIcon() : null]);
    if (open !== current || w !== alive()) return; // 그림을 읽는 동안 다른 개체가 왔다 — 늦은 값으로 덮지 않는다
    const view: PetDeviceView = { ...open, portrait, megaIcon, side, volume: opts.volume() };
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
  ipcMain.handle(CH.cry, async (e) => (mine(e) && current && opts.volume() > 0 ? opts.cry(current.pet.species) : null));
  ipcMain.on(CH.close, (e) => {
    if (mine(e)) alive()?.close();
  });
  ipcMain.on(CH.act, (e, action: unknown) => {
    if (!mine(e) || !isAction(action)) return;
    opts.onAct(action);
  });

  return {
    // 다른 개체를 열 때만 초점을 준다 — 같은 개체를 다시 보내는 것은 새로 읽기·명령 뒤 갱신이다(관리 창 syncPetDevice)
    async show(parent, next, gen) {
      if (!gate.accepts(gen)) return; // 닫힘을 알기 전에 보낸 요청이다 — 닫은 창을 다시 띄우지 않는다
      const opened = !alive() || next.pet.id !== current?.pet.id;
      current = next;
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

// 렌더러가 보낸 값은 믿지 않는다 — 정해진 모양만 넘긴다
const DIALOGS = new Set(["evolve", "nature", "mega"]);
const CMDS = new Set(["feed", "play", "party.show", "party.hide", "pet.set"]);
function isAction(v: unknown): v is PetDeviceAction {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (typeof a.petId !== "string" || !a.petId) return false; // 누른 개체 — 관리 창이 지금 개체와 같은지 본다
  if (a.kind === "dialog") return typeof a.dialog === "string" && DIALOGS.has(a.dialog);
  if (a.kind === "tutorial") return a.action === "done" || a.action === "skip";
  if (a.kind === "dex") return true;
  if (a.kind === "cmd") return typeof a.cmd === "string" && CMDS.has(a.cmd) && (a.args === undefined || (typeof a.args === "object" && a.args !== null));
  return false;
}
