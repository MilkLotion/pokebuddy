// 상품 기기 창 공통 — 상점(shop.ts)·가방(bag.ts)이 같은 틀을 그린다 (Figma 05 `Shop / Device / …`·`Bag / Device / …`).
// 머리(제목·✕), 화면(머리 줄·그림·분류·둘째 줄·설명), 정보 줄(효과·쓰는 곳), 가운데 조작 칸, 바닥(◀ 이전 · 주 단추 · 다음 ▶).
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다(도감 기기 창 dex.ts 와 같다)

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
}

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
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

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 4배)로 그린다. 도감 기기 창 sprite 와 같다(도구 그림은 작아서 배율만 크다)
const STAGE = { w: 150, h: 124, maxScale: 4, maxSide: 96 };

export function sprite(uri: string, maxSide = STAGE.maxSide): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = 0;
  out.height = 0;
  const img = new Image();
  img.onload = () => {
    const src = document.createElement("canvas");
    src.width = img.naturalWidth;
    src.height = img.naturalHeight;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(img, 0, 0);
    const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if ((data[(y * width + x) * 4 + 3] ?? 0) >= 128) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const scale = Math.max(1, Math.min(STAGE.maxScale, Math.floor(maxSide / w), Math.floor(maxSide / h)));
    out.width = Math.min(w * scale, STAGE.w);
    out.height = Math.min(h * scale, STAGE.h);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, x0, y0, w, h, (out.width - w * scale) / 2, (out.height - h * scale) / 2, w * scale, h * scale);
  };
  img.src = uri;
  return out;
}

// 기기 창 하나 — #device 를 찾아 높이 알림·글꼴·키보드를 붙이고, render 가 틀을 그린다
export function deviceFrame(api: DeviceBridge, htmlName: string): { device: HTMLElement; fontsReady: Promise<unknown>; render: (face: DeviceFace, middle: HTMLElement, go: HTMLButtonElement) => void } {
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
  const fontsReady: Promise<unknown> = Promise.allSettled(
    ['400 12px "Galmuri11"', '700 12px "Galmuri11"', '400 10px "Galmuri9"'].map((f) => document.fonts.load(f)),
  ).then(() => document.fonts.ready);

  // 방향키로도 넘긴다. Esc 는 닫는다
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") api.step(-1);
    else if (e.key === "ArrowRight") api.step(1);
    else if (e.key === "Escape") api.close();
  });

  function render(face: DeviceFace, middle: HTMLElement, go: HTMLButtonElement): void {
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
    const close = button("close", "✕", () => api.close());
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
    if (face.art) stage.appendChild(sprite(face.art));
    entry.appendChild(stage);
    const info = el("div", "info");
    info.append(el("div", undefined, face.group || " "), pairs("measure", face.spec));
    entry.appendChild(info);
    screen.appendChild(entry);
    if (face.desc) screen.appendChild(el("div", "flavor", face.desc));
    bezel.appendChild(screen);
    device.appendChild(bezel);

    // 정보 줄 — 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정)
    device.appendChild(pairs("records", face.rows, "value"));
    device.appendChild(middle);

    const controls = el("div", "controls");
    controls.append(button("prev", "◀ 이전", () => api.step(-1)), go, button("next", "다음 ▶", () => api.step(1)));
    device.appendChild(controls);

    // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
    sendSize(true);
  }

  return { device, fontsReady, render };
}

// 수량 줄 — − · 수 · + · 최대 · 안내
export function qtyRow(q: { count: number; cap: number; hint: string }, set: (qty: number) => void, off = false): HTMLElement {
  const minus = button("", "−", () => set(q.count - 1));
  minus.disabled = off || q.count <= 1;
  const plus = button("", "+", () => set(q.count + 1));
  plus.disabled = off || q.count >= q.cap;
  const max = button("max", "최대", () => set(q.cap));
  max.disabled = off || q.count >= q.cap;
  const row = el("div", "qty");
  row.append(minus, el("span", "count", q.count.toLocaleString("ko-KR")), plus, max, el("span", "hint", q.hint));
  return row;
}

// 바닥 가운데 주 단추 — 처리 중이면 글자 대신 점 세 개(폭 그대로)
export function goButton(label: string, disabled: boolean, busy: boolean, onClick: () => void): HTMLButtonElement {
  const go = button("go", label, onClick);
  go.disabled = disabled || busy;
  go.classList.toggle("is-busy", busy);
  return go;
}
