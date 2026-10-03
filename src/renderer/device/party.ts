// 파티 기기 창 — 교체 화면. 관리 창이 정해 보낸 지금 프리셋의 파티 칸과 프리셋 칩을 그린다 (src/main/party-window.ts).
// Figma 05 `Party / Swap · Open` `1248:2567`. 틀(경첩·윗줄)은 가방·상점 기기 창과 같다.
// 누른 칸과 칩은 관리 창으로 돌려보낸다 — 눌러서 들고 눌러서 놓는 판정과 명령은 관리 창이 한다 (src/renderer/manage/manage.ts onPartyAction)
import type { PartyDeviceSlot, PartyDeviceView } from "../../shared/model/devices.js";
import { portraitImg } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS, whenFontsReady } from "../ui/fonts.js";

const api = window.pokebuddyParty;
const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("party.html 에 #device 가 없다");
const device: HTMLElement = root;

// 빈 칸·잠긴 칸·자물쇠 칩의 그림 — 관리 창의 파티 칸과 같은 +·자물쇠 (src/renderer/manage/manage.ts blankIcon)
const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 6.86H4c-.63 0-1.14.51-1.14 1.14v5.14c0 .63.51 1.15 1.14 1.15h8c.63 0 1.14-.52 1.14-1.15V8c0-.63-.51-1.14-1.14-1.14Z"/><path d="M5.14 6.86V5.14a2.86 2.86 0 0 1 5.72 0v1.72"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.64v8.72M3.64 8h8.72"/></svg>';

// 창 높이 맞추기 — 그린 직후 한 번 알리고, 그 뒤 높이가 바뀔 때마다 다시 알린다 (item-device.ts 와 같다)
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

// 쓰는 글꼴 — 첫 측정 전에 직접 부른다
const fontsReady = whenFontsReady(DEVICE_FONTS.slice(0, 2));

// 방향키는 앞·뒤 프리셋. Esc 는 든 것을 내려놓고, 든 것이 없으면 닫는다 — 판정은 관리 창이 한다
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") api.step(-1);
  else if (e.key === "ArrowRight") api.step(1);
  else if (e.key === "Escape") api.close();
});

function slotCell(s: PartyDeviceSlot): HTMLButtonElement {
  const b = buttonEl("slot", "", () => api.act({ kind: "slot", index: s.index }));
  if (s.state === "pokemon") {
    const face = el("div", "face");
    if (s.art) {
      face.appendChild(portraitImg(s.art));
    }
    b.append(face, el("div", "who", s.name), el("div", "lv", s.level));
    b.title = s.name;
  } else {
    const icon = el("span", "icon");
    icon.innerHTML = s.state === "locked" ? LOCK : PLUS;
    b.append(icon, el("div", "who", s.state === "locked" ? "잠긴 칸" : "빈 칸"));
    if (s.state === "empty") b.appendChild(el("div", "hint", "박스에서 배치"));
  }
  if (s.state === "locked") {
    b.classList.add("locked");
    b.disabled = true;
  }
  b.classList.toggle("held", s.held);
  b.classList.toggle("target", s.target);
  return b;
}

function render(v: PartyDeviceView): void {
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
  top.appendChild(el("div", "title", "파티"));
  const close = buttonEl("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  const panel = el("div", "panel");
  const head = el("div", "panel-head");
  head.append(el("div", "name", v.name), el("div", "note", v.notice));
  panel.appendChild(head);

  const slots = el("div", "slots");
  for (const s of v.slots) slots.appendChild(slotCell(s));
  panel.appendChild(slots);

  const presets = el("div", "presets");
  for (const p of v.presets) {
    const b = buttonEl("", p.owned ? String(p.index + 1) : "", () => api.act({ kind: "preset", index: p.index }));
    b.setAttribute("aria-pressed", String(p.active));
    b.setAttribute("aria-label", p.owned ? `프리셋 ${p.index + 1}` : `프리셋 ${p.index + 1} · 사지 않음`);
    if (!p.owned) {
      b.innerHTML = LOCK;
      b.disabled = true;
    }
    presets.appendChild(b);
  }
  panel.appendChild(presets);
  device.appendChild(panel);

  // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
  sendSize(true);
}

api.onShow((view) => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void fontsReady.then(() => render(view));
});
