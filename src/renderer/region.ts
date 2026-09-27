// 놀이공간 영역 그리기 — 드래그로 사각형을 그리고 `적용` 하면 메인에 보낸다. 좌표는 창 안 좌표(DIP)다.
// 저장은 메인이 한다. `취소`·Esc 는 아무것도 바꾸지 않는다 (docs/specs/game.md "놀이공간 변경을 취소하면 적용 전 영역을 유지한다")
import type { RegionInit, RegionRect } from "../shared/manage.js";

function need<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`region.html 에 #${id} 가 없다`);
  return el;
}
const veil = need("veil", HTMLElement);
const regionEl = need("region", HTMLElement);
const sizeEl = need("size", HTMLElement);
const toolbar = need("toolbar", HTMLElement);
const message = need("message", HTMLElement);
const redraw = need("redraw", HTMLButtonElement);
const cancel = need("cancel", HTMLButtonElement);
const apply = need("apply", HTMLButtonElement);

const api = window.pokebuddyRegion;
let min = { area: 240 * 160, side: 80 }; // 메인이 init 으로 준다 (src/state/settings.ts REGION_MIN)
let rect: RegionRect | null = null;
let from: { x: number; y: number } | null = null; // 드래그를 시작한 점

const MESSAGE = "드래그해서 활동 영역을 그리세요";

function paint(): void {
  const r = rect;
  veil.hidden = r != null;
  regionEl.hidden = r == null;
  if (!r) {
    apply.disabled = true;
    message.textContent = MESSAGE;
    return;
  }
  regionEl.style.left = `${r.x}px`;
  regionEl.style.top = `${r.y}px`;
  regionEl.style.width = `${r.w}px`;
  regionEl.style.height = `${r.h}px`;
  sizeEl.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
  // 넓이로 본다 — 폭·높이 비율은 자유다. 한 변이 너무 얇으면 포켓몬이 들어가지 않는다
  const thin = r.w < min.side || r.h < min.side;
  const small = r.w * r.h < min.area;
  apply.disabled = thin || small;
  message.textContent = thin ? `폭과 높이를 ${min.side} 이상으로 그리세요` : small ? "조금 더 넓게 그리세요" : MESSAGE;
}

api.onInit((init: RegionInit) => {
  min = init.min;
  rect = init.current;
  paint();
});

// 모서리 네모를 끌면 크기를 바꾼다 — 반대쪽 모서리를 시작점으로 두고 새로 그릴 때와 같은 드래그를 잇는다
function anchorOf(handle: Element, r: RegionRect): { x: number; y: number } {
  const left = handle.classList.contains("nw") || handle.classList.contains("sw");
  const top = handle.classList.contains("nw") || handle.classList.contains("ne");
  return { x: left ? r.x + r.w : r.x, y: top ? r.y + r.h : r.y };
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || toolbar.contains(e.target as Node)) return;
  const handle = (e.target as Element).closest(".handle");
  if (handle && rect) from = anchorOf(handle, rect);
  else {
    from = { x: e.clientX, y: e.clientY };
    rect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
  }
  document.body.setPointerCapture(e.pointerId);
  paint();
});
document.addEventListener("pointermove", (e) => {
  if (!from) return;
  const x = Math.max(0, Math.min(e.clientX, innerWidth));
  const y = Math.max(0, Math.min(e.clientY, innerHeight));
  rect = { x: Math.min(from.x, x), y: Math.min(from.y, y), w: Math.abs(x - from.x), h: Math.abs(y - from.y) };
  paint();
});
document.addEventListener("pointerup", () => {
  from = null;
});

const done = (): void => {
  if (rect && !apply.disabled) api.done(rect);
};
redraw.addEventListener("click", () => {
  rect = null;
  paint();
});
cancel.addEventListener("click", () => api.done(null));
apply.addEventListener("click", done);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") api.done(null);
  else if (e.key === "Enter") done();
});

paint();
