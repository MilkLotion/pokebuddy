// 기기 창 틀 — 기기 창 다섯(pet·dex·shop·bag·party)이 같은 뼈대를 쓴다
// - #device 찾기, 높이 알림, 글꼴 기다리기, 키보드(◀·▶·Esc), 머리 줄(경첩·LED 셋·제목·✕), 바닥 줄(◀ 이전 · 가운데 · 다음 ▶)
// - 창마다 다른 것은 옵션으로 받는다(글꼴, 막을 키, 높이가 바뀐 뒤 할 일). 화면 본문은 창이 그린다
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS, whenFontsReady } from "../ui/fonts.js";

// 기기 창 다리의 공통 부분 — shared/ipc/devices.ts DeviceIpc 의 size·step·close
export interface DeviceBridge {
  size(height: number): void;
  step(delta: -1 | 1): void;
  close(): void;
}

export type DeviceKey = "ArrowLeft" | "ArrowRight" | "Escape";

export interface DeviceFrameOptions {
  api: DeviceBridge;
  windowName: string; // 던지는 문구용 — "pet"
  fonts?: readonly string[]; // 기본 DEVICE_FONTS
  canKey?: (key: DeviceKey) => boolean; // false 면 그 키를 무시한다
  onResized?: () => void; // 높이가 바뀌어 다시 알린 직후
}

export interface DeviceFrame {
  device: HTMLElement;
  fontsReady: Promise<unknown>;
  // #device 를 비우고 className(left·extraClass), 경첩, 머리 줄(LED 셋·제목·✕)을 그린다
  beginDraw(side: "left" | "right", title: string, extraClass?: string): void;
  // 바닥 줄 — ◀ 이전 · middle · 다음 ▶
  controlsEl(middle: HTMLElement): HTMLElement;
  // 그린 뒤 높이를 알린다. 같은 높이여도 보낸다(숨은 새 창은 이 값을 받아야 보인다)
  endDraw(): void;
  // onShow 연결 — 글꼴을 기다린 뒤 draw 를 부른다
  showWith<V>(subscribe: (cb: (view: V) => void) => void, draw: (view: V) => void): void;
}

const LED_COLORS = ["#ff6b6b", "#ffd84a", "#6ad06a"] as const;

export function createDeviceFrame(opts: DeviceFrameOptions): DeviceFrame {
  const { api } = opts;
  const root = document.getElementById("device");
  if (!(root instanceof HTMLElement)) throw new Error(`${opts.windowName}.html 에 #device 가 없다`);
  const device: HTMLElement = root;

  // 창 높이 맞추기 — 그린 직후 한 번 알리고, 그 뒤 #device 높이가 바뀔 때마다 다시 알린다
  // - 늦게 온 글꼴로 줄바꿈이 늘어도 창이 따라간다. 안 하면 아래가 잘린다 (worklog/records/features-0930/record.md 6번)
  // - ResizeObserver 는 한 프레임에 한 번 부른다. 지난번과 같은 높이면 보내지 않는다
  // - #device 는 폭 고정·높이 내용 기준이다. 창 크기가 바뀌어도 #device 높이는 그대로라 다시 불리지 않는다
  let sentHeight = -1;
  const sendSize = (force: boolean): boolean => {
    const h = Math.ceil(device.getBoundingClientRect().height);
    if (!force && h === sentHeight) return false;
    sentHeight = h;
    api.size(h);
    return true;
  };
  // 첫 그리기 전(sentHeight < 0)에는 보내지 않는다 — 빈 #device 높이로 숨은 새 창이 먼저 보이면 안 된다
  new ResizeObserver(() => {
    if (sentHeight >= 0 && sendSize(false)) opts.onResized?.();
  }).observe(device);

  // 쓰는 글꼴 — 빈 문서는 글꼴을 아직 요청하지 않아 fonts.ready 가 바로 끝난다. 첫 측정 전에 직접 부른다
  // - 실패해도 그리기는 한다. 늦게 오면 위 ResizeObserver 가 높이를 고친다
  const fontsReady = whenFontsReady(opts.fonts ?? DEVICE_FONTS);

  // 방향키로도 넘긴다. Esc 는 닫는다. canKey 가 false 면 그 키는 무시한다
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Escape") return;
    if (e.target instanceof HTMLInputElement) return; // 수량 칸에 적는 중 — 방향키는 글자 사이를 옮기고 Esc 는 적던 것을 버린다 (item-face.ts qtyRowEl)
    if (opts.canKey && !opts.canKey(e.key)) return;
    if (e.key === "ArrowLeft") api.step(-1);
    else if (e.key === "ArrowRight") api.step(1);
    else api.close();
  });

  function beginDraw(side: "left" | "right", title: string, extraClass?: string): void {
    device.className = `device${side === "left" ? " left" : ""}${extraClass ? ` ${extraClass}` : ""}`;
    device.replaceChildren();
    device.appendChild(el("div", "hinge"));
    const top = el("div", "top");
    top.appendChild(el("div", "light"));
    for (const c of LED_COLORS) {
      const led = el("div", "led");
      led.style.background = c;
      top.appendChild(led);
    }
    top.appendChild(el("div", "title", title));
    const close = buttonEl("close", "✕", () => api.close());
    close.title = "닫기";
    top.appendChild(close);
    device.appendChild(top);
  }

  function controlsEl(middle: HTMLElement): HTMLElement {
    const controls = el("div", "controls");
    controls.append(buttonEl("prev", "◀ 이전", () => api.step(-1)), middle, buttonEl("next", "다음 ▶", () => api.step(1)));
    return controls;
  }

  function endDraw(): void {
    sendSize(true);
  }

  function showWith<V>(subscribe: (cb: (view: V) => void) => void, draw: (view: V) => void): void {
    // 글꼴을 읽은 뒤에 재야 높이가 맞는다
    subscribe((view) => void fontsReady.then(() => draw(view)));
  }

  return { device, fontsReady, beginDraw, controlsEl, endDraw, showWith };
}
