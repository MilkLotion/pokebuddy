// 도감 기기 창 — 메인이 준 한 종의 항목을 그린다 (src/main/dex-window.ts). Figma `99 · 시안` `579:17691`
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 미해금 종은 그림을 검은 실루엣으로 칠하고, 이름·분류·타입·키·몸무게를 ??? 로 둔다
import type { DexDeviceView } from "../shared/manage.js";

const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("dex.html 에 #device 가 없다");
const device: HTMLElement = root;
const api = window.pokebuddyDex;

const UNKNOWN = "???";
const STATE_WORD: Record<string, string> = { obtained: "획득", unlocked: "해금", locked: "미해금" };

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

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다. 도트가 번지지 않게 정수 배만 쓴다
const STAGE = { w: 150, h: 124, maxScale: 2 };

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
    const scale = Math.max(1, Math.min(STAGE.maxScale, Math.floor(STAGE.w / w), Math.floor(STAGE.h / h)));
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

let audio: HTMLAudioElement | null = null;
let volume = 0; // 설정의 소리 크기를 곱한 울음소리 음량 (메인이 준다)

async function playCry(): Promise<void> {
  const uri = await api.cry();
  if (!uri) return;
  audio?.pause();
  audio = new Audio(uri);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
}

function render(v: DexDeviceView): void {
  const d = v.detail;
  volume = v.volume;
  const locked = d.state === "locked";
  device.className = `device${v.side === "left" ? " left" : ""}${locked ? " locked" : ""}`;
  device.replaceChildren();

  device.appendChild(el("div", "hinge"));

  const top = el("div", "top");
  top.appendChild(el("div", "light"));
  for (const c of ["#ff6b6b", "#ffd84a", "#6ad06a"]) {
    const led = el("div", "led");
    led.style.background = c;
    top.appendChild(led);
  }
  top.appendChild(el("div", "title", "도감"));
  const close = button("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, `No.${String(d.dex).padStart(3, "0")}`), el("span", undefined, d.name), el("span", "state", STATE_WORD[d.state] ?? d.state));
  screen.appendChild(bar);

  const entry = el("div", "entry");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(sprite(v.portrait));
  entry.appendChild(stage);
  const info = el("div", "info");
  info.appendChild(el("div", undefined, locked ? UNKNOWN : d.genus || " "));
  const types = el("div", "types");
  if (d.types.length)
    d.types.forEach((name, i) => {
      const badge = el("span", "type", name);
      const id = d.typeIds[i];
      if (id) badge.dataset.type = id;
      types.appendChild(badge);
    });
  else types.appendChild(el("span", "type", UNKNOWN));
  info.appendChild(types);
  const measure = el("div", "measure");
  for (const [key, value] of [
    ["키", d.height],
    ["몸무게", d.weight],
  ] as const) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", undefined, value || UNKNOWN));
    measure.appendChild(row);
  }
  info.appendChild(measure);
  entry.appendChild(info);
  screen.appendChild(entry);
  screen.appendChild(el("div", "flavor", locked ? "아직 만나지 못한 포켓몬이다." : d.flavor || "설명이 없는 포켓몬이다."));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  const records = el("div", "records");
  const state = locked ? "미해금" : `이로치 ${d.shiny ? "획득" : "미획득"} · 보유 ${d.owned}마리`;
  for (const [key, value] of [
    ["상태", state],
    ["입수처", d.methods],
    ["진화", d.evolution],
    ["특수 기믹", d.gimmick],
  ] as const) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", "value", value));
    records.appendChild(row);
  }
  device.appendChild(records);

  const controls = el("div", "controls");
  const cry = button("cry", "울음소리", () => void playCry());
  // 미해금 종은 울음소리도 숨긴다. 설정에서 소리를 끄면 막는다
  cry.disabled = locked || v.volume <= 0;
  controls.append(
    button("prev", "◀ 이전", () => api.step(-1)),
    cry,
    button("next", "다음 ▶", () => api.step(1)),
  );
  device.appendChild(controls);

  api.size(device.getBoundingClientRect().height);
}

// 방향키로도 넘긴다. Esc 는 닫는다
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") api.step(-1);
  else if (e.key === "ArrowRight") api.step(1);
  else if (e.key === "Escape") api.close();
});

api.onShow((view) => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void document.fonts.ready.then(() => render(view));
});
