// 앱이 그리는 메뉴 창 — Figma `Context Menu` `338:738`. 문서는 src/renderer/menu.html
//
// OS 기본 메뉴는 Windows 에서 체크 표시 자리로 왼쪽을 크게 비운다. 그래서 메뉴를 직접 그린다 (docs/specs/ui-components.md C-21).
// 메뉴 모델은 Electron 메뉴와 같은 모양(MenuItemConstructorOptions)을 받는다 — 화면 값(src/view/menus.ts)이 만든 것을 그대로 쓴다.
// 커서 자리에 띄우고 화면 끝에서는 방향을 뒤집는다. 항목을 고르거나 Esc 를 누르거나 포커스를 잃으면(바깥 클릭) 닫는다.
// inactive 메뉴(Windows 트레이)는 포커스를 가져오지 않는다 — 가져오면 Windows 가 숨겨진 아이콘 창을 닫는다.
//   그래서 바깥 클릭·Esc 는 부르는 쪽이 헬퍼의 입력 감시로 알아채 closeMenu 를 부른다 (helpers/winbounds.ps1).
// 메뉴는 한 번에 하나다. 새로 띄우면 앞의 메뉴를 닫는다
// 말풍선이 달린 항목(포켓몬 메뉴의 `모습 바꾸기`)이 있으면 창을 말풍선 자리까지 넓혀 둔다 — 말풍선은 메뉴 창 안에 그린다.
//   말풍선은 메뉴 오른쪽에 뜬다. 화면 오른쪽에 자리가 없으면 왼쪽에 뜬다. 메뉴 자리는 말풍선과 관계없이 커서 자리다
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import type { MenuChannel } from "../shared/ipc/overlays";
import { menuView, pickOf } from "./menus.js";
import { cursorScreen } from "./windows/display.js";
import { afterLoad, createIpcScope } from "./windows/ipc.js";
import { createOverlayWindow } from "./windows/options.js";

const CH = {
  show: "menu:show",
  size: "menu:size",
  pick: "menu:pick",
  side: "menu:side",
  placed: "menu:placed",
} satisfies Record<string, MenuChannel>;

// 그림자 자리 — menu.html 의 body 여백과 같다
const SHADOW = 8;
// 메뉴와 말풍선 사이 — src/renderer/menu.ts SUB_GAP 과 같다 (Figma 05 `Party / Shared Form Tip` `501:14010`)
const SUB_GAP = 8;

export interface MenuWindowOptions {
  preload: string;
  html: string;
  onPlaced?: (rect: { x: number; y: number; w: number; h: number }) => void; // 메뉴를 띄운 자리(화면 좌표, 그림자 제외)
  onClosed?: () => void;
  inactive?: boolean; // 포커스를 가져오지 않고 띄운다 (Windows 트레이)
}

let current: BrowserWindow | null = null;
let closedAt = 0; // 마지막으로 닫힌 시각 — 아이콘을 다시 눌러 닫은 것인지 가른다

export const menuOpen = (): boolean => current != null && !current.isDestroyed();

// 떠 있는 메뉴를 닫는다 — inactive 메뉴의 바깥 클릭·Esc·아이콘 다시 누르기
export function closeMenu(): void {
  if (current && !current.isDestroyed()) current.close();
}

// 방금(ms 안에) 닫혔는가 — 아이콘을 누른 클릭이 먼저 바깥 클릭으로 메뉴를 닫았을 때 다시 열지 않게
export const closedWithin = (ms: number): boolean => Date.now() - closedAt < ms;

// 떠 있는 메뉴가 보이는 자리(화면 DIP) — 창에서 그림자 여백을 뺀다. 메뉴는 모서리가 커서(트레이 아이콘)에 붙어 뜨므로
// 여백까지 넣으면 아이콘을 다시 누른 클릭이 메뉴 안으로 잡힌다
export function menuBounds(): Electron.Rectangle | null {
  if (!menuOpen()) return null;
  const b = current!.getBounds();
  return { x: b.x + SHADOW, y: b.y + SHADOW, width: b.width - SHADOW * 2, height: b.height - SHADOW * 2 };
}

export function popupMenu(opts: MenuWindowOptions, template: MenuItemConstructorOptions[], on: string): void {
  if (current && !current.isDestroyed()) current.close();
  const { point: at, workArea: area } = cursorScreen();
  // 재기 전 자리 640 × 480 — 메뉴와 말풍선이 이 폭에 묶이지 않게 넉넉히. 잰 뒤 줄인다
  const win = createOverlayWindow({ preload: opts.preload, layer: "pop-up-menu", bounds: { x: at.x, y: at.y, width: 640, height: 480 }, focusable: !opts.inactive, firstMouse: true, allWorkspaces: true }); // mac — 놀이공간 위 오버레이 창의 같은 옵션 (src/main/windows/options.ts, 94 문서 4-3·4-4)
  current = win;
  const scope = createIpcScope((sender) => !win.isDestroyed() && sender === win.webContents);

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    scope.dispose();
    if (current === win) current = null;
    closedAt = Date.now();
    if (!win.isDestroyed()) win.close();
    opts.onClosed?.();
  };
  const reveal = (): void => {
    if (win.isDestroyed()) return;
    if (opts.inactive) {
      win.showInactive();
      return;
    }
    win.show();
    win.focus(); // 방향키·Enter·Esc 를 받고, 바깥을 누르면 blur 로 닫는다
  };
  // 그린 크기를 받으면 자리를 정한다 — 오른쪽·아래가 모자라면 커서의 왼쪽·위로 뒤집는다
  // sub — 말풍선의 크기와 메뉴 위 끝에서 잰 자리. 있으면 창을 말풍선 쪽으로 넓히고, 렌더러가 자리를 잡은 뒤에 보인다
  const onSize = (w: unknown, h: unknown, sub: unknown): void => {
    if (typeof w !== "number" || typeof h !== "number") return;
    const menuW = Math.ceil(w);
    const menuH = Math.ceil(h);
    const s = sub && typeof sub === "object" ? (sub as { w?: unknown; h?: unknown; top?: unknown }) : null;
    const bubble = s && typeof s.w === "number" && typeof s.h === "number" && typeof s.top === "number" ? { w: Math.ceil(s.w), h: Math.ceil(s.h), top: Math.max(0, Math.floor(s.top)) } : null;
    const height = Math.max(menuH, bubble ? bubble.top + bubble.h : 0) + SHADOW * 2;
    // 메뉴(그림자 제외)의 자리
    let mx = at.x;
    let my = at.y;
    if (mx + menuW + SHADOW > area.x + area.width) mx = at.x - menuW;
    if (my - SHADOW + height > area.y + area.height) my = at.y - (height - SHADOW * 2);
    mx = Math.max(area.x + SHADOW, mx);
    my = Math.max(area.y + SHADOW, my);
    opts.onPlaced?.({ x: mx, y: my, w: menuW, h: menuH });
    if (!bubble) {
      win.setBounds({ x: mx - SHADOW, y: my - SHADOW, width: menuW + SHADOW * 2, height });
      reveal();
      return;
    }
    const extra = SUB_GAP + bubble.w;
    const fitsRight = mx + menuW + extra + SHADOW <= area.x + area.width;
    const fitsLeft = mx - extra - SHADOW >= area.x;
    const side = fitsRight || !fitsLeft ? "right" : "left";
    win.setBounds({ x: (side === "right" ? mx : mx - extra) - SHADOW, y: my - SHADOW, width: menuW + extra + SHADOW * 2, height });
    win.webContents.send(CH.side, side);
  };
  const onPick = (id: unknown): void => {
    close();
    const item = typeof id === "number" ? pickOf(template, id) : undefined;
    if (item?.click && item.enabled !== false) (item.click as () => void)();
  };
  scope.on(CH.size, (_e, w, h, sub) => onSize(w, h, sub));
  scope.on(CH.pick, (_e, id) => onPick(id));
  scope.on(CH.placed, () => reveal());
  win.on("blur", close);
  win.on("closed", close);
  afterLoad(win, () => win.webContents.send(CH.show, menuView(template, on)));
  void win.loadFile(opts.html).catch(close);
}
