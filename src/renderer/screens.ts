// 놀이공간 화면 번호 덮개 — 화면마다 창 하나가 뜬다. 보기만 할 때는 번호만, 고를 때는 눌러서 이 화면을 고른다(Esc 취소).
// 저장은 메인이 한다 (src/main/screen-picker.ts)
import type { ScreenOverlayInit } from "../shared/model/overlays.js";

function need<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`screens.html 에 #${id} 가 없다`);
  return el;
}
const numberEl = need("number", HTMLElement);
const labelEl = need("label", HTMLElement);
const hintEl = need("hint", HTMLElement);

const api = window.pokebuddyScreens;
let picking = false;

api.onInit((init: ScreenOverlayInit) => {
  picking = init.pick;
  document.body.classList.toggle("pick", init.pick);
  numberEl.textContent = String(init.number);
  labelEl.textContent = [`화면 ${init.number}`, init.primary ? "주 화면" : "", `${init.w}×${init.h}`].filter(Boolean).join(" · ");
  hintEl.hidden = !init.pick;
});

document.addEventListener("click", () => {
  if (picking) api.pick();
});
document.addEventListener("keydown", (e) => {
  if (picking && e.key === "Escape") api.cancel();
});
