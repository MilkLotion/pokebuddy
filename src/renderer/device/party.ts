// 파티 기기 창 — 교체 화면. 관리 창이 정해 보낸 지금 프리셋의 파티 칸과 프리셋 칩을 그린다 (src/main/party-window.ts).
// Figma 05 `Party / Swap · Open` `1248:2567`. 틀(경첩·윗줄)은 기기 창 틀(device-frame.ts)이다. 바닥 줄은 두지 않는다.
// 누른 칸과 칩은 관리 창으로 돌려보낸다 — 눌러서 들고 눌러서 놓는 판정과 명령은 관리 창이 한다 (src/renderer/manage/manage.ts onPartyAction)
import type { PartyDeviceSlot, PartyDeviceView } from "../../shared/model/devices.js";
import { portraitImg } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS } from "../ui/fonts.js";
import { createDeviceFrame } from "./device-frame.js";
import { lockIconEl, plusIconEl } from "../ui/line-icons.js";

const api = window.pokebuddyParty;
// 글꼴은 Galmuri9 를 쓰지 않아 앞의 둘만 기다린다.
// 방향키는 앞·뒤 프리셋. Esc 는 든 것을 내려놓고, 든 것이 없으면 닫는다 — 판정은 관리 창이 한다
const frame = createDeviceFrame({ api, windowName: "party", fonts: DEVICE_FONTS.slice(0, 2) });
const device = frame.device;

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
    icon.appendChild(s.state === "locked" ? lockIconEl() : plusIconEl()); // 관리 창의 파티 칸과 같은 +·자물쇠
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
  frame.beginDraw(v.side, "파티");

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
      b.replaceChildren(lockIconEl());
      b.disabled = true;
    }
    presets.appendChild(b);
  }
  panel.appendChild(presets);
  device.appendChild(panel);

  frame.endDraw();
}

frame.showWith((cb) => api.onShow(cb), render);
