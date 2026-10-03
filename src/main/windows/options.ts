// 창 옵션 — 모든 창이 같은 보안 옵션과 같은 투명 창 키를 쓰게 한 곳에서 만든다 (worklog/records/code-structure/design/10-main.md 3.1절)
//
// contextIsolation·sandbox 를 기본값에 기대지 않고 적는다. 렌더러는 preload 가 낸 다리만 쓴다.
// 투명 창 아홉 종류(무대·기기 창·알림·배너·메뉴·영역·화면 덮개)가 같은 값을 쓰는 키는 transparentOptionsOf 한 곳이다.
// 오버레이(테두리 없음·항상 위·옮길 수 없음)는 createOverlayWindow 가 만들고 층을 건다. 창마다 넘기는 값은 그 창의 지금 값 그대로다
import { BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle, type WebPreferences } from "electron";
import { windowIcon } from "./files.js";

// 항상 위 층 — screen-saver 는 무대 창·배너보다 위(알림·영역·화면 덮개), pop-up-menu 는 배너·메뉴
export type WindowLayer = "screen-saver" | "pop-up-menu";

type WebExtra = Pick<WebPreferences, "backgroundThrottling" | "autoplayPolicy">;

// preload 가 null 이면 문서를 읽지 않는 창이다 (OS 대화상자의 부모)
export function webPreferencesOf(preload: string | null, extra: WebExtra = {}): WebPreferences {
  return { ...(preload ? { preload } : {}), contextIsolation: true, sandbox: true, ...extra };
}

// 투명 창이 같은 값을 쓰는 키 — 처음엔 숨기고, 테두리·그림자·크기 바꾸기·전체 화면·작업 표시줄이 없다
export function transparentOptionsOf(preload: string | null, extra: WebExtra = {}): BrowserWindowConstructorOptions {
  return {
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    icon: windowIcon(),
    webPreferences: webPreferencesOf(preload, extra),
  };
}

export interface OverlaySpec {
  preload: string | null; // null 은 문서를 읽지 않는 창(OS 대화상자의 부모)
  layer: WindowLayer;
  bounds?: Partial<Rectangle>;
  focusable?: boolean; // 없으면 Electron 기본값
  firstMouse?: boolean; // acceptFirstMouse — mac 에서 첫 클릭을 삼키지 않는다
  allWorkspaces?: boolean; // mac 의 다른 앱 전체 화면 Space 위에도 보인다
  icon?: false; // 아이콘을 붙이지 않는다 (OS 대화상자의 부모 — 지금 그대로)
}

// 오버레이 창 — 투명 창 키에 옮기기·최소화·최대화를 막고 항상 위로. 만든 뒤 층을 건다
export function createOverlayWindow(spec: OverlaySpec): BrowserWindow {
  const base = transparentOptionsOf(spec.preload);
  if (spec.icon === false) delete base.icon;
  const win = new BrowserWindow({
    ...base,
    ...(spec.bounds ?? {}),
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    ...(spec.focusable !== undefined ? { focusable: spec.focusable } : {}),
    ...(spec.firstMouse ? { acceptFirstMouse: true } : {}),
  });
  win.setAlwaysOnTop(true, spec.layer);
  if (spec.allWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return win;
}
