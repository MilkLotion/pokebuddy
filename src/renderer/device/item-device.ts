// 상품 기기 창 공통 — 상점(shop.ts)·가방(bag.ts)이 같은 틀을 그린다 (Figma 05 `Shop / Device / …`·`Bag / Device / …`).
// 머리(제목·✕), 화면(머리 줄·그림·분류·둘째 줄·설명), 정보 줄(효과·쓰는 곳), 가운데 조작 칸, 바닥(◀ 이전 · 주 단추 · 다음 ▶).
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다(도감 기기 창 dex.ts 와 같다)

import { spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS, whenFontsReady } from "../ui/fonts.js";

export interface DeviceBridge {
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
}

export interface DeviceFace {
  side: "right" | "left";
  title: string; // 머리 — 상점 · 가방
  kind: string;
  name: string;
  state: string;
  group: string;
  art: string | null;
  spec: [string, string][];
  desc: string;
  rows: [string, string][];
  link?: { label: string; value: string } | null; // 정보 줄 아래의 누르는 줄 — 상점 기기 창의 `나오는 포켓몬`
}

export function pairs(cls: string, rows: [string, string][], valueCls?: string): HTMLElement {
  const box = el("div", cls);
  for (const [key, value] of rows) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", valueCls, value));
    box.appendChild(row);
  }
  return box;
}

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 4배)로 그린다 (ui/portrait.ts spriteCanvas). 도구 그림은 작아서 배율만 크고, 배율은 96 변에 맞춘다
const STAGE = { w: 150, h: 124, maxScale: 4, maxSide: 96 };

// 기기 창 하나 — #device 를 찾아 높이 알림·글꼴·키보드를 붙이고, render 가 틀을 그린다
export function deviceFrame(api: DeviceBridge, htmlName: string): { device: HTMLElement; fontsReady: Promise<unknown>; render: (face: DeviceFace, middle: HTMLElement, go: HTMLButtonElement, onLink?: () => void) => void } {
  const root = document.getElementById("device");
  if (!(root instanceof HTMLElement)) throw new Error(`${htmlName} 에 #device 가 없다`);
  const device: HTMLElement = root;

  // 창 높이 맞추기 — 그린 직후 한 번 알리고, 그 뒤 #device 높이가 바뀔 때마다 다시 알린다 (dex.ts sendSize)
  let sentHeight = -1;
  const sendSize = (force: boolean): void => {
    const h = Math.ceil(device.getBoundingClientRect().height);
    if (!force && h === sentHeight) return;
    sentHeight = h;
    api.size(h);
  };
  new ResizeObserver(() => {
    if (sentHeight >= 0) sendSize(false);
  }).observe(device);

  // 쓰는 글꼴 — 첫 측정 전에 직접 부른다 (dex.ts 와 같다)
  const fontsReady = whenFontsReady(DEVICE_FONTS);

  // 방향키로도 넘긴다. Esc 는 닫는다
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") api.step(-1);
    else if (e.key === "ArrowRight") api.step(1);
    else if (e.key === "Escape") api.close();
  });

  function render(face: DeviceFace, middle: HTMLElement, go: HTMLButtonElement, onLink?: () => void): void {
    device.className = `device${face.side === "left" ? " left" : ""}`;
    device.replaceChildren();
    device.appendChild(el("div", "hinge"));

    const top = el("div", "top");
    top.appendChild(el("div", "light"));
    for (const c of ["#ff6b6b", "#ffd84a", "#6ad06a"]) {
      const led = el("div", "led");
      led.style.background = c;
      top.appendChild(led);
    }
    top.appendChild(el("div", "title", face.title));
    const close = buttonEl("close", "✕", () => api.close());
    close.title = "닫기";
    top.appendChild(close);
    device.appendChild(top);

    // 화면 — 머리 줄(종류·이름·상태), 그림, 분류·둘째 줄, 설명
    const bezel = el("div", "bezel");
    const screen = el("div", "screen");
    const bar = el("div", "bar");
    bar.append(el("span", undefined, face.kind), el("span", undefined, face.name), el("span", "state", face.state));
    screen.appendChild(bar);
    const entry = el("div", "entry");
    const stage = el("div", "stage");
    if (face.art) stage.appendChild(spriteCanvas(face.art, STAGE));
    entry.appendChild(stage);
    const info = el("div", "info");
    info.append(el("div", undefined, face.group || " "), pairs("measure", face.spec));
    entry.appendChild(info);
    screen.appendChild(entry);
    if (face.desc) screen.appendChild(el("div", "flavor", face.desc));
    bezel.appendChild(screen);
    device.appendChild(bezel);

    // 정보 줄 — 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정)
    const records = pairs("records", face.rows, "value");
    // 누르는 줄 — 같은 판 안의 셋째 줄. 글자 끝의 `›` 가 누를 수 있음을 알린다 (Figma 03 `Shop Device` `row/나오는 포켓몬`)
    if (face.link && onLink) {
      const more = buttonEl("more", "", onLink);
      more.append(el("span", "key", face.link.label), el("span", "value", `${face.link.value} ›`));
      records.appendChild(more);
    }
    device.appendChild(records);
    device.appendChild(middle);

    const controls = el("div", "controls");
    controls.append(buttonEl("prev", "◀ 이전", () => api.step(-1)), go, buttonEl("next", "다음 ▶", () => api.step(1)));
    device.appendChild(controls);

    // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
    sendSize(true);
  }

  return { device, fontsReady, render };
}

// 수량 줄 — − · 수 · + · 최대 · 안내
export function qtyRow(q: { count: number; cap: number; hint: string }, set: (qty: number) => void, off = false): HTMLElement {
  const minus = buttonEl("", "−", () => set(q.count - 1));
  minus.disabled = off || q.count <= 1;
  const plus = buttonEl("", "+", () => set(q.count + 1));
  plus.disabled = off || q.count >= q.cap;
  const max = buttonEl("max", "최대", () => set(q.cap));
  max.disabled = off || q.count >= q.cap;
  const row = el("div", "qty");
  row.append(minus, el("span", "count", q.count.toLocaleString("ko-KR")), plus, max, el("span", "hint", q.hint));
  return row;
}

// 바닥 가운데 주 단추 — 처리 중이면 글자 대신 점 세 개(폭 그대로)
export function goButton(label: string, disabled: boolean, busy: boolean, onClick: () => void): HTMLButtonElement {
  const go = buttonEl("go", label, onClick);
  go.disabled = disabled || busy;
  go.classList.toggle("is-busy", busy);
  return go;
}
