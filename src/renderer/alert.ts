// 알림 창 — 메인이 준 제목·강조 줄·설명·단추를 그리고, 누른 단추를 알린다 (src/main/alert-window.ts)
//
// 단추에 처음 포커스를 두지 않는다 — Enter 로 뜻하지 않은 답을 고르지 않게. Esc 는 취소 단추(메인이 고른다)
import type { AlertView } from "../shared/model/overlays.js";

function need<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`alert: #${id} 없음`);
  return el;
}

const alertEl = need("alert", HTMLElement);
const titleEl = need("title", HTMLElement);
const leadEl = need("lead", HTMLElement);
const detailEl = need("detail", HTMLElement);
const actionsEl = need("actions", HTMLElement);

const FONTS = ["15px Galmuri14", "12px Galmuri11", "700 12px Galmuri11"] as const;

const api = window.pokebuddyAlert;
let answered = false;

const answer = (index: number | null): void => {
  if (answered) return;
  answered = true;
  api.pick(index);
};

api.onShow((view: AlertView) => {
  titleEl.textContent = view.title;
  leadEl.textContent = view.lead;
  detailEl.textContent = view.detail;
  detailEl.hidden = !view.detail;
  actionsEl.replaceChildren(
    ...view.buttons.map((b) => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = b.label;
      if (b.primary) el.className = "primary";
      el.addEventListener("click", () => answer(b.index));
      return el;
    }),
  );
  alertEl.hidden = false;
  // 상자에 포커스 — 화면 읽기 프로그램이 알리고 Esc 를 받는다. 단추에는 두지 않는다
  alertEl.focus();
  // 쓰는 글꼴을 읽은 뒤 잰다 — 대체 글꼴 줄바꿈으로 창 높이를 맞추지 않게(검수 4). 읽지 못해도 잰다
  void Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => []))).then(() => {
    requestAnimationFrame(() => api.size(Math.ceil(alertEl.getBoundingClientRect().height)));
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.preventDefault();
  answer(null);
});
