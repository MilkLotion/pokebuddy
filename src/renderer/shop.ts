// 상점 기기 창 — 관리 창이 정해 보낸 상품 하나를 그린다 (src/main/shop-window.ts). Figma 05 `Shop / Device / Tool`
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 수량·구매는 관리 창으로 돌려보낸다(관리 창이 명령을 보낸다)
import type { ShopDeviceView } from "../shared/manage.js";

const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("shop.html 에 #device 가 없다");
const device: HTMLElement = root;
const api = window.pokebuddyShop;

// 창 높이 맞추기 — 도감 기기 창과 같다 (src/renderer/dex.ts sendSize)
let sentHeight = -1;
function sendSize(force: boolean): void {
  const h = Math.ceil(device.getBoundingClientRect().height);
  if (!force && h === sentHeight) return;
  sentHeight = h;
  api.size(h);
}
new ResizeObserver(() => {
  if (sentHeight >= 0) sendSize(false);
}).observe(device);

// 쓰는 글꼴 — 첫 측정 전에 직접 부른다 (dex.ts 와 같다)
const fontsReady: Promise<unknown> = Promise.allSettled(
  ['400 12px "Galmuri11"', '700 12px "Galmuri11"', '400 10px "Galmuri9"'].map((f) => document.fonts.load(f)),
).then(() => document.fonts.ready);

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 4배)로 그린다. 도감 기기 창 sprite 와 같다(도구 그림은 작아서 배율만 크다)
const STAGE = { w: 150, h: 124, maxScale: 4, maxSide: 96 };

function sprite(uri: string): HTMLCanvasElement {
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
    const scale = Math.max(1, Math.min(STAGE.maxScale, Math.floor(STAGE.maxSide / w), Math.floor(STAGE.maxSide / h)));
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

function pairs(cls: string, rows: [string, string][], valueCls?: string): HTMLElement {
  const box = el("div", cls);
  for (const [key, value] of rows) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", valueCls, value));
    box.appendChild(row);
  }
  return box;
}

function render(v: ShopDeviceView): void {
  device.className = `device${v.side === "left" ? " left" : ""}`;
  device.replaceChildren();
  device.appendChild(el("div", "hinge"));

  const top = el("div", "top");
  top.appendChild(el("div", "light"));
  for (const c of ["#ff6b6b", "#ffd84a", "#6ad06a"]) {
    const led = el("div", "led");
    led.style.background = c;
    top.appendChild(led);
  }
  top.appendChild(el("div", "title", "상점"));
  const close = button("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  // 화면 — 머리 줄(종류·이름·상태), 그림, 분류·가격·보유, 설명
  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, v.kind), el("span", undefined, v.name), el("span", "state", v.state));
  screen.appendChild(bar);
  const entry = el("div", "entry");
  const stage = el("div", "stage");
  if (v.art) stage.appendChild(sprite(v.art));
  entry.appendChild(stage);
  const info = el("div", "info");
  info.append(el("div", undefined, v.group || " "), pairs("measure", v.spec));
  entry.appendChild(info);
  screen.appendChild(entry);
  if (v.desc) screen.appendChild(el("div", "flavor", v.desc));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 정보 줄 — 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정)
  device.appendChild(pairs("records", v.rows, "value"));

  // 구매 칸 — 수량(여러 개 살 수 있을 때)과 합계 상자. 실패·막힘은 합계 상자가 빨강으로 바뀐다
  const card = el("div", "buy-card");
  card.appendChild(el("div", "buy-label", "구매"));
  if (v.qty) {
    const { count, cap, hint } = v.qty;
    const act = (qty: number): void => api.act({ productId: v.productId, kind: "qty", qty });
    const minus = button("", "−", () => act(count - 1));
    minus.disabled = count <= 1;
    const plus = button("", "+", () => act(count + 1));
    plus.disabled = count >= cap;
    const max = button("max", "최대", () => act(cap));
    max.disabled = count >= cap;
    const qty = el("div", "qty");
    qty.append(minus, el("span", "count", count.toLocaleString("ko-KR")), plus, max, el("span", "hint", hint));
    card.appendChild(qty);
  }
  const total = el("div", v.total.tone === "bad" ? "total bad" : "total");
  total.appendChild(el("strong", undefined, v.total.lead));
  if (v.total.line) total.appendChild(el("div", undefined, v.total.line));
  card.appendChild(total);
  if (v.daycare) card.appendChild(button("daycare", "돌보미집 보기 ›", () => api.act({ productId: v.productId, kind: "daycare" })));
  device.appendChild(card);

  const controls = el("div", "controls");
  const buy = button("buy", v.buy.label, () => api.act({ productId: v.productId, kind: "buy" }));
  buy.disabled = v.buy.disabled || v.buy.busy;
  buy.classList.toggle("is-busy", v.buy.busy);
  controls.append(button("prev", "◀ 이전", () => api.step(-1)), buy, button("next", "다음 ▶", () => api.step(1)));
  device.appendChild(controls);

  // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
  sendSize(true);
}

// 방향키로도 넘긴다. Esc 는 닫는다
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") api.step(-1);
  else if (e.key === "ArrowRight") api.step(1);
  else if (e.key === "Escape") api.close();
});

api.onShow((view) => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void fontsReady.then(() => render(view));
});
