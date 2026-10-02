// 무대 BrowserWindow — 테두리 없음 · 배경 투명 · 늘 위 · 따라가는 창 크기. 만들기 · setBounds(무대 사각형) · show/hide ·
// 클릭 통과 · hoverTick · IPC(init/sheets/frame/hover/hit/pointer/click-through) · 렌더러 재시작.
//
// 창은 더 이상 움직이지 않는다 — 마리가 무대 안에서 움직인다. 그래서 1판의 commanded · movedByUs · MOVE_TOLERANCE · DRAG_GRACE ·
// move/moved 이벤트 해석이 전부 없다. 창을 바꾸는 유일한 길은 setStage(무대 사각형) 이고, 사각형이 바뀔 때만 setBounds 를 부른다 —
// 400ms 폴링마다 부르면 mac 에서 깜빡일 수 있다
import fs from "node:fs";
import { BrowserWindow, Menu, ipcMain, screen, type MenuItemConstructorOptions } from "electron";
import type { CoachAction, CoachView, HitReply, LookSheets, PointerMsg, StageChannel, StageFrame, StageInit } from "../shared/stage";
import { sameRect, type Rect, type Size } from "./layout";
import { windowIcon } from "./paths";
import { webPreferencesOf } from "./window-options";

// 채널 이름 — preload 와 같은 문자열인지 satisfies 로 검사
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
} satisfies Record<string, StageChannel>;

// 렌더러가 없을 때(통합 전 실기 확인) 띄우는 빈 투명 문서 — 창이 흰 사각형으로 보이지 않게
const BLANK_URL = "data:text/html,<html><body style='margin:0;background:transparent'></body></html>";

export interface StageWindowOptions {
  debug: boolean;
  preload: string;
  html: string; // src/renderer/stage.html — 없으면 로그 한 줄 뒤 창만 만든다
  log: ((o: Record<string, unknown>) => void) | null;
  onReady(): void; // 렌더러가 떴다(다시 떴다) — 시트·init·마지막 프레임을 다시 보낸다
  onHit(id: HitReply): void; // 커서 밑의 마리 (null 이면 그림 없는 곳)
  onPointer(msg: PointerMsg): void;
  onGone(): void; // 렌더러가 죽었다 — 들고 있던 마리를 놓는다
  onHidden(): void; // 창을 숨겼다 — pointerup 이 오지 않으니 들고 있던 마리를 놓는다
  onCoachAction?(action: CoachAction): void; // 바탕화면 튜토리얼 말풍선의 버튼
}

export interface StageWindow {
  alive(): boolean;
  stage(): Rect | null; // 지금 무대 사각형 (화면 좌표)
  size(): Size; // 무대 크기 — 아직 없으면 0×0
  setStage(rect: Rect): boolean; // 바뀔 때만 setBounds. 바뀌었으면 true (렌더러에 stage:init 도 보낸다)
  setVisible(on: boolean): void;
  raise(): void; // "항상 위"를 다시 걸어 항상 위 창들 맨 앞으로 — 보일 때만 (src/main/keep-on-top.ts)
  owns(w: BrowserWindow): boolean; // 이 무대의 창인가
  isVisible(): boolean;
  setPassing(on: boolean): void;
  hoverTick(held: boolean, ghost: boolean): void;
  sendInit(): void;
  sendSheets(sheets: LookSheets): void;
  sendFrame(frame: StageFrame): void;
  sendClickThrough(on: boolean): void;
  sendCry(uri: string, volume: number): void; // 울음소리 한 번 — 음량 0~1
  sendIcons(icons: Record<string, string>): void; // 말풍선 아이콘 그림 — 열쇠별 data URI
  sendCoach(coach: CoachView | null): void; // 바탕화면 튜토리얼 — 같은 값이면 보내지 않는다. 렌더러가 다시 뜨면 resendCoach
  resendCoach(): void;
  popup(template: MenuItemConstructorOptions[]): void;
  close(): void;
}

export function createStageWindow(opts: StageWindowOptions): StageWindow {
  const { debug, log } = opts;
  let win: BrowserWindow | null = new BrowserWindow({
    width: 1,
    height: 1,
    show: false, // 첫 배치 전 깜빡임 방지
    frame: false,
    transparent: true,
    acceptFirstMouse: true, // 포커스 없는 창이라 매번 "첫 클릭"이다 — 삼키지 말고 렌더러로 보낸다 (mac)
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true, // 동반자는 항상 위
    fullscreenable: false,
    focusable: false, // 클릭해도 터미널 포커스를 뺏지 않음
    // mac 은 focusable:false 만으로는 클릭이 앱을 활성화한다 — 뒤에 열어 둔 설정창이 앞으로 올라오고 터미널 포커스도 빠진다.
    // panel 은 NSWindowStyleMaskNonactivatingPanel 을 붙여 눌러도 앱을 활성화하지 않는다 (2026-09-28 사용자 "맥에서는 화면에 있는 포켓몬 클릭을 해도 설정창이 열리네")
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    icon: windowIcon(), // Windows 작업 표시줄·작업 관리자용 로고 (없으면 undefined — 기본)
    webPreferences: webPreferencesOf(opts.preload, {
      // 숨었다 보일 때 애니메이션 타이머가 멈추지 않게 스로틀링을 끈다 — 단 Windows 는 켜 둔다.
      // Windows 에서 끄면 렌더러가 숨김 상태로 가지 않아, 창을 숨길 때 내려간 입력용 자식 창
      // (Chrome_RenderWidgetHostHWND)이 다시 보일 때 올라오지 않는다. 그러면 누르기가 부모 창에 떨어지고,
      // 포커스를 받지 않는 창(focusable:false)이라 Chromium 이 누르기를 버린다(MA_NOACTIVATEANDEAT) — 떼기만 온다.
      // 켜 두면 숨은 동안만 타이머가 초당 1회로 느려지고, 다시 보이면 곧바로 제 속도로 돈다 (최소 시험 창으로 확인)
      backgroundThrottling: process.platform === "win32",
      // 울음소리 — 메뉴에서 고른 놀아주기처럼 무대 창에 사용자 동작이 없어도 소리를 낸다 (Chromium 자동 재생 제한)
      autoplayPolicy: "no-user-gesture-required",
    }),
  });
  let stageRect: Rect | null = null;
  let passing: boolean | null = null; // 지금 클릭을 아래 창으로 통과시키는 중인가 — setIgnoreMouseEvents 의 마지막 값
  let coach: CoachView | null = null; // 마지막으로 보낸 튜토리얼 — 렌더러가 다시 뜨면 다시 보낸다
  let coachKey = "null";
  let loaded = false; // 문서를 실제로 읽었나 (렌더러가 없으면 false — IPC 를 보내도 받는 이가 없다)

  // Space(데스크탑)를 옮겨도 따라온다 — 늘 보이는 펫이 만들어진 Space 에 남으면 사라진 것처럼 보인다
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // "항상 위"를 건다 — 부를 때마다 SetWindowPos(HWND_TOPMOST) 를 다시 보내 풀린 것을 되살리고 항상 위 창들 맨 앞으로 올린다.
  // Windows 는 수준을 pop-up-menu 로 준다. 기본 수준(floating)이면 Electron 이 부를 때마다 창을 주 화면 작업 표시줄 바로 뒤에 끼운다.
  // 주 화면에 전체 화면 창이 앞에 오면 Windows 가 작업 표시줄의 "항상 위"를 풀고, 그 뒤에 끼운 무대도 "항상 위"를 잃어 거의 모든 창 밑으로 간다
  // (2026-10-02 실험, worklog/records/stage-visibility/record.md). 전체 화면 창 위에도 무대가 보인다 — 2026-10-02 사용자 결정 "그렇게 보이게 둬".
  // mac 은 창 수준이 층을 제대로 나눠 기본 수준 그대로 둔다
  const pinTop = (): void => {
    if (process.platform === "win32") win!.setAlwaysOnTop(true, "pop-up-menu");
    else win!.setAlwaysOnTop(true);
  };
  pinTop();

  const mine = (sender: unknown): boolean => !!win && !win.isDestroyed() && sender === win.webContents;
  const onReady = (e: Electron.IpcMainEvent): void => {
    if (!mine(e.sender)) return;
    log?.({ stage: "ready" });
    opts.onReady();
  };
  const onHit = (e: Electron.IpcMainEvent, id: unknown): void => {
    if (!mine(e.sender)) return;
    opts.onHit(typeof id === "string" ? id : null);
  };
  const onPointer = (e: Electron.IpcMainEvent, msg: unknown): void => {
    if (!mine(e.sender) || !msg || typeof msg !== "object") return;
    const m = msg as PointerMsg;
    if (typeof m.type !== "string" || typeof m.id !== "string") return;
    // 디버그 — 렌더러가 넘긴 포인터가 메인까지 오는지 (끄는 동안의 drag 는 너무 잦아 뺀다)
    if (debug && m.type !== "drag") log?.({ pointer: m.type, id: m.id });
    opts.onPointer({ type: m.type, id: m.id, x: Number(m.x) || 0, y: Number(m.y) || 0 });
  };
  // 렌더러 진단(시트 디코드 실패 등) — POKEBUDDY_DEBUG 로그에 from:"renderer" 로 남긴다
  const onLog = (e: Electron.IpcMainEvent, entry: unknown): void => {
    if (!mine(e.sender) || !entry || typeof entry !== "object") return;
    log?.({ from: "renderer", ...(entry as Record<string, unknown>) });
  };
  const onCoachAction = (e: Electron.IpcMainEvent, msg: unknown): void => {
    if (!mine(e.sender) || !msg || typeof msg !== "object") return;
    const m = msg as CoachAction;
    if (typeof m.id !== "string" || (m.action !== "done" && m.action !== "skip")) return;
    opts.onCoachAction?.({ id: m.id, action: m.action });
  };
  ipcMain.on(CH.ready, onReady);
  ipcMain.on(CH.coachAction, onCoachAction);
  ipcMain.on(CH.hit, onHit);
  ipcMain.on(CH.pointer, onPointer);
  ipcMain.on(CH.log, onLog);

  if (debug) {
    // Electron 44 부터 인자가 객체 하나 — 예전 위치 인자는 경고를 낸다
    win.webContents.on("console-message", (details) => log?.({ renderer: details.message }));
  }
  // 렌더러가 죽거나 다시 뜨면 들고 있던 포인터도 사라진다
  win.webContents.on("render-process-gone", () => opts.onGone());
  // 창이 파괴돼도 win 은 null 이 되지 않는다 — 비워 둬야 곳곳의 alive() 가 파괴된 창을 거른다
  win.on("closed", () => {
    win = null;
    ipcMain.removeListener(CH.ready, onReady);
    ipcMain.removeListener(CH.coachAction, onCoachAction);
    ipcMain.removeListener(CH.hit, onHit);
    ipcMain.removeListener(CH.pointer, onPointer);
    ipcMain.removeListener(CH.log, onLog);
  });

  if (fs.existsSync(opts.html)) {
    loaded = true;
    void win.loadFile(opts.html);
  } else {
    // C 단위의 무대 문서가 아직 없다 — 창 생성·따라가기·종료만 확인할 수 있게 빈 문서로 산다
    process.stderr.write(`무대 문서가 없음: ${opts.html} — 빈 창으로 뜬다 (그림 없음)\n`);
    void win.loadURL(BLANK_URL);
  }

  const alive = (): boolean => !!win && !win.isDestroyed();
  const send = (channel: StageChannel, payload: unknown): void => {
    if (!alive() || !loaded) return;
    win!.webContents.send(channel, payload);
  };
  const size = (): Size => (stageRect ? { w: stageRect.w, h: stageRect.h } : { w: 0, h: 0 });
  const initPayload = (): StageInit => ({ size: size(), debug });

  function setPassing(on: boolean): void {
    if (!alive() || on === passing) return;
    passing = on;
    win!.setIgnoreMouseEvents(on, { forward: true });
    log?.({ passing: on });
  }

  return {
    alive,
    stage: () => stageRect,
    size,

    setStage(rect) {
      if (!alive() || rect.w < 1 || rect.h < 1 || sameRect(rect, stageRect)) return false;
      const bounds = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
      win!.setBounds(bounds, false);
      // resizable:false 창이 크기 변경을 거부하면(Windows 에서 가능) 잠깐 풀고 다시
      const got = win!.getBounds();
      if (got.width !== bounds.width || got.height !== bounds.height) {
        win!.setResizable(true);
        win!.setBounds(bounds, false);
        win!.setResizable(false);
      }
      stageRect = { ...rect };
      send(CH.init, initPayload());
      if (debug) log?.({ stage: "bounds", ...rect, got: win!.getBounds() });
      return true;
    },

    setVisible(on) {
      if (!alive()) return;
      if (on && !win!.isVisible()) {
        win!.showInactive(); // 포커스를 빼앗지 않고 표시
        pinTop(); // 숨었다 나오는 동안 "항상 위"가 풀렸어도 다시 건다
        win!.webContents.invalidate(); // 숨어 있는 동안 멈춘 화면 갱신을 되살림
      }
      if (!on && win!.isVisible()) {
        opts.onHidden(); // 숨으면 pointerup 이 오지 않는다
        win!.hide();
      }
    },
    isVisible: () => alive() && win!.isVisible(),

    // Chromium 은 "항상 위" 값을 기억만 하고 창의 실제 상태를 다시 읽지 않는다 — 풀려도 isAlwaysOnTop() 은 true 다.
    // 그래서 주기마다 다시 건다(pinTop). 수준은 만들 때와 같다
    raise() {
      if (alive() && win!.isVisible()) pinTop();
    },
    owns: (w) => alive() && w === win,

    setPassing,

    // 그림 위만 클릭을 받는다 — 무대가 창만큼 커서 투명한 곳이 아래 창의 클릭을 막지 않게.
    // 커서가 무대 위에 있으면 렌더러에 자리를 묻고, 마리 위가 아니라는 답(stage:hit null)이면 클릭을 아래 창으로 통과시킨다.
    // 렌더러의 마우스 이벤트를 기다리지 않고 메인이 커서를 본다 — 통과 중에는 마우스 이벤트가 오지 않고,
    // 펫이 걷거나 그림이 바뀌어 커서 밑이 달라져도 이벤트는 생기지 않는다
    hoverTick(held, ghost) {
      // 클릭 통과(고스트)를 켰으면 늘 통과다. 숨어 있으면 입력이 오지 않으니 건드리지 않는다
      if (!alive() || ghost || !win!.isVisible()) return;
      if (held) {
        setPassing(false); // 들고 있는 동안 통과로 바뀌면 떼기가 아래 창으로 간다
        return;
      }
      const p = screen.getCursorScreenPoint();
      const b = win!.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
        setPassing(true);
        return;
      }
      send(CH.hover, { x: p.x - b.x, y: p.y - b.y });
    },

    sendInit: () => send(CH.init, initPayload()),
    sendSheets: (sheets) => send(CH.sheets, sheets),
    sendFrame: (frame) => send(CH.frame, frame),
    sendClickThrough: (on) => send(CH.clickThrough, on),
    sendCry: (uri, volume) => send(CH.cry, { uri, volume }),
    sendIcons: (icons) => send(CH.icons, icons),
    sendCoach(next) {
      const key = JSON.stringify(next);
      if (key === coachKey) return;
      coachKey = key;
      coach = next;
      send(CH.coach, next);
    },
    resendCoach: () => send(CH.coach, coach),

    // 우클릭 — 네이티브 메뉴. 프레임 없는 창이라 렌더러가 그리지 않고 메인이 띄운다
    popup(template) {
      if (!alive()) return;
      Menu.buildFromTemplate(template).popup({ window: win! });
    },

    close() {
      if (alive()) win!.close();
    },
  };
}
