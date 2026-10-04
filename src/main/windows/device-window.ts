// 기기 창 틀 — 설정창 옆에 붙어 무엇 하나를 보이는 창(도감·파티 상세·상점·가방·파티 교체)의 공통 동작 (worklog/records/code-structure/design/10-main.md 3.5절)
//
// 무엇을 보일지는 설정창이 고른 값으로 정한다 — 도감은 종을, 파티 상세·상점·가방·파티 교체는 고른 값을 받아 메인이 모델을 만든다(src/view/device-*.ts). 누른 단추와 이전·다음은 설정창으로 돌려보낸다 — 명령과 대화상자는 설정창이 처리한다.
// 폭은 고정, 높이는 렌더러가 그린 높이다. 설정창 내용 영역 옆에 붙인다. 오른쪽에 자리가 없으면 왼쪽에 붙인다.
// 설정창을 옮기면 따라가고, 최소화하면 같이 숨고, 닫히면 같이 닫힌다(parent). 종류마다 창은 하나만 둔다.
// 창마다 다른 것(채널·폭·열쇠·보낼 값·붙는 기준·단추 검사·울음소리)은 명세(src/main/windows/devices.ts)가 준다
import { BrowserWindow, type Rectangle } from "electron";
import { createGenGate } from "./device-gen.js";
import { workAreaAt } from "./display.js";
import { deviceHeightOf, isStep } from "./input.js";
import { createIpcScope } from "./ipc.js";
import { transparentOptionsOf } from "./options.js";
import { dockAt } from "./placement.js";

export type DeviceSide = "right" | "left";

export interface DeviceChannels {
  show: string;
  size: string;
  step: string;
  close: string;
  act?: string; // 누르는 단추가 있는 창만
  cry?: string; // 울음소리를 내는 창만
  coach?: string; // 튜토리얼 코치마크를 띄우는 창만 — 떴다·사라졌다를 알린다
}

export interface DeviceSpec<Open, View extends { side: DeviceSide }, Action = never> {
  channels: DeviceChannels;
  size: { width: number; height: number }; // 폭 고정. 높이는 첫 그림 전 어림값
  keyOf(open: Open): string; // 다른 것을 열었는가 — 다를 때만 초점을 준다
  // 보낼 값(붙은 쪽 side 는 틀이 보낼 때 더한다). null 이면 보내지 않는다.
  // 비동기여도 된다 — 그림을 읽는 동안 다른 것이 오거나 창이 바뀌면 틀이 늦은 값을 버린다
  viewOf(open: Open): Omit<View, "side"> | null | Promise<Omit<View, "side"> | null>;
  // 붙을 기준 사각형 — 없으면 설정창 내용 영역. 도감의 "파티 상세 옆"이 쓴다
  baseOf?(owner: Rectangle, area: Rectangle, open: Open, height: number): Rectangle;
  isAction?(v: unknown): v is Action; // act 채널의 값 검사 — 렌더러가 보낸 값은 믿지 않는다
  cry?: { of(open: Open): Promise<string | null>; volume(): number }; // cry 채널 — 음량이 0 이면 내지 않는다
}

export interface DeviceHooks<Action> {
  onStep(delta: -1 | 1): void; // 이전·다음 — 순서는 설정창이 정한다
  onAct?(action: Action): void; // 누른 단추 — 설정창이 처리한다
  onCoach?(on: boolean): void; // 코치마크가 떴다·사라졌다. 창이 닫히면 false
  onClosed(gen: number): void; // 닫혔다 — 새 세대 번호를 설정창에 준다
}

export interface DeviceWindow<Open> {
  show(parent: BrowserWindow, open: Open, gen: unknown): void; // gen 이 지금 세대 번호가 아니면 버린다
  close(): void;
  // 설정창 문서를 새로 읽었다 — 떠 있던 창을 없애고 세대 번호를 0 으로. 닫힘 알림(세대 번호 올림)은 보내지 않는다.
  // close() 뒤 세대 번호만 0 으로 돌리면 늦게 오는 closed 가 번호를 1 로 올려, 0 에서 시작하는 새 문서의 열기 요청을 버린다
  discard(): void;
}

// 사용자가 연 기기 창에 키보드 초점을 준다 — 옆 창을 한 번 더 누르지 않아도 방향키·Esc 가 먹게
// - show(): 숨은 창을 보이고 앞으로. mac 은 key 창, Windows 는 활성 창이 된다
// - focus(): 이미 보이는 창도 key·활성 창으로. 설정창을 누른 직후라 앱이 앞에 있어 OS 가 막지 않는다
// - webContents.focus(): 문서 안 초점까지. keydown 을 document 에서 받는다
function bringUp(w: BrowserWindow): void {
  if (!w.isVisible()) w.show();
  w.focus();
  w.webContents.focus();
}

export function createDeviceWindow<Open extends object, View extends { side: DeviceSide }, Action = never>(
  files: { preload: string; html: string },
  spec: DeviceSpec<Open, View, Action>,
  hooks: DeviceHooks<Action>,
): DeviceWindow<Open> {
  const CH = spec.channels;
  const width = spec.size.width;
  let win: BrowserWindow | null = null;
  const closing = new WeakSet<BrowserWindow>(); // 닫히는 중인 창 — 다시 쓰지 않고 새로 만든다
  let owner: BrowserWindow | null = null;
  let current: Open | null = null;
  let focusNext = false; // 사용자가 연 것을 아직 못 보였다 — 첫 높이를 받으면 초점과 함께 보인다
  let height = spec.size.height;
  let side: DeviceSide = "right";
  // 세대 번호 — 닫을 때마다 올린다. 낡은 번호의 show 는 버린다 (src/main/windows/device-gen.ts)
  const gate = createGenGate();

  const alive = (): BrowserWindow | null => (win && !win.isDestroyed() && !win.webContents.isDestroyed() && !closing.has(win) ? win : null);
  // 채널은 한 번만 건다. 창이 다시 만들어져도 처리기는 하나다
  const scope = createIpcScope((sender) => !!alive() && sender === win?.webContents);

  function place(): void {
    const w = alive();
    if (!w || !owner || owner.isDestroyed()) return;
    const b = owner.getContentBounds();
    const area = workAreaAt(b);
    const base = spec.baseOf && current ? spec.baseOf(b, area, current, height) : b;
    const at = dockAt(base, area, { width, height });
    side = at.side;
    w.setBounds({ x: at.x, y: at.y, width, height });
  }

  // 붙은 쪽이 바뀌면 경첩 면을 다시 그리도록 다시 보낸다
  const follow = (): void => {
    const was = side;
    place();
    if (side !== was) send();
  };
  const hideWithOwner = (): void => alive()?.hide();
  // 설정창을 따라 다시 보일 때는 초점을 빼앗지 않는다
  const showWithOwner = (): void => {
    focusNext = false;
    if (current) alive()?.showInactive();
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
    const w = new BrowserWindow({ ...transparentOptionsOf(files.preload), width, height, parent, minimizable: false, maximizable: false, title: "pokebuddy" });
    w.removeMenu();
    w.on("close", () => closing.add(w));
    w.on("closed", () => {
      if (win !== w) return; // 닫히는 동안 새 창을 만들었다 — 그 창의 상태는 두고 간다
      win = null;
      current = null;
      focusNext = false;
      detach();
      owner = null;
      if (CH.coach) hooks.onCoach?.(false); // 창과 함께 코치마크도 사라졌다
      hooks.onClosed(gate.bump());
    });
    void w.loadFile(files.html);
    return w;
  }

  // 보낼 값이 바로 나오면 그 자리에서, 그림을 기다려야 하면 기다린 뒤에 보낸다
  function send(): void {
    const w = alive();
    const open = current;
    if (!w || !open) return;
    const body = spec.viewOf(open);
    if (body instanceof Promise) void body.then((late) => deliver(w, open, late));
    else deliver(w, open, body);
  }

  function deliver(w: BrowserWindow, open: Open, body: Omit<View, "side"> | null): void {
    if (!body) return;
    if (open !== current || w !== alive()) return; // 그림을 읽는 동안 다른 것이 왔다 — 늦은 값으로 덮지 않는다
    const view = { ...body, side } as View;
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", () => alive()?.webContents.send(CH.show, view));
    else w.webContents.send(CH.show, view);
  }

  scope.on(CH.size, (_e, h) => {
    const next = deviceHeightOf(h);
    if (next == null) return;
    height = next;
    place();
    const w = alive();
    if (!w || w.isVisible()) return;
    // 설정창이 최소화돼 있으면 따라 숨어 있는다 — 기기 창만 혼자 뜨지 않게
    if (!owner || owner.isDestroyed() || owner.isMinimized()) return;
    if (focusNext) bringUp(w);
    else w.showInactive();
    focusNext = false;
  });
  scope.on(CH.step, (_e, delta) => {
    if (isStep(delta)) hooks.onStep(delta);
  });
  scope.on(CH.close, () => alive()?.close());
  const act = CH.act;
  if (act && spec.isAction) {
    const isAction = spec.isAction;
    scope.on(act, (_e, action) => {
      if (isAction(action)) hooks.onAct?.(action);
    });
  }
  const coach = CH.coach;
  if (coach) scope.on(coach, (_e, on) => hooks.onCoach?.(on === true));
  const cry = CH.cry;
  if (cry && spec.cry) {
    const sound = spec.cry;
    scope.handle(cry, null, async () => (current && sound.volume() > 0 ? sound.of(current) : null));
  }

  return {
    // 다른 것을 열 때만 초점을 준다 — 같은 것을 다시 보내는 것은 새로 읽기·단추 뒤 갱신이다
    show(parent, next, gen) {
      if (!gate.accepts(gen)) return; // 닫힘을 알기 전에 보낸 요청이다 — 닫은 창을 다시 띄우지 않는다
      const opened = !alive() || !current || spec.keyOf(next) !== spec.keyOf(current);
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
    discard() {
      const w = alive();
      if (w) {
        win = null; // closed 처리기가 이 창을 지난 창으로 보고 넘어간다 — 세대 번호를 올리지 않는다
        current = null;
        focusNext = false;
        detach();
        owner = null;
        if (CH.coach) hooks.onCoach?.(false);
        w.destroy();
      }
      gate.reset();
    },
  };
}
