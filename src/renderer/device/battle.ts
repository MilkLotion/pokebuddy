// 배틀 파티 상세 기기 창 — 메인이 만들어 보낸 배틀 파티 칸 하나를 그린다 (src/view/device-battle.ts, docs/specs/adventure.md "배틀 파티 상세 기기 창")
// Figma 05 `15 모험` `Adventure / Battle Party Device` `1662:3180`(기기 03 `Battle Party Device` `1662:224`)
//   화면  `배틀 파티 N번`·? 단추 → 초상·이름·타입·특성 → 실제 능력치 방사형 그래프
//   흰 판 기술 두 개(큰 기술 칸 + 분류·위력·명중·쿨타임). 사이 가운데에 순서 바꾸기
// 레벨은 보이지 않는다 — 배틀은 50레벨로 계산한다. ? 를 누르면 능력치 기준, 기술 칸을 누르면 기술 설명을 말풍선으로 보인다
// 순서 바꾸기는 관리 창에 돌려보낸다(battle.moves 명령). 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다
import type { BattleDeviceView } from "../../shared/model/devices.js";
import type { BattleSlotView, MoveView } from "../../shared/model/snapshot.js";
import { battleBusyKey } from "../../shared/device-busy.js";
import { needBridge } from "../ui/bridge.js";
import { createCryPlayer } from "../ui/cry.js";
import { buttonEl, el } from "../ui/dom.js";
import { genderIcon } from "../ui/gender-icon.js";
import { movePillEl } from "../ui/move-pill.js";
import { spriteCanvas } from "../ui/portrait.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { createDeviceFrame } from "./device-frame.js";

const api = needBridge("pokebuddyBattle");
const frame = createDeviceFrame({ api, windowName: "battle" });
const device = frame.device;
const cryPlayer = createCryPlayer(() => api.cry());
const STAGE = { w: 88, h: 88, maxScale: 2 };
const SVG = "http://www.w3.org/2000/svg";

// 말풍선 — 한 번에 하나. 다른 개체를 열면 닫는다
let open: "basis" | number | null = null; // basis 는 ? 말풍선, 숫자는 그 순번 기술의 설명
let shownPetId = "";
let last: BattleDeviceView | null = null;

const toggle = (what: "basis" | number): void => {
  open = open === what ? null : what;
  if (last) render(last);
};

// ── 방사형 그래프 — 위에서 시계 방향 여섯 꼭짓점. 가장 높은 값이 바깥 육각형에 닿는다 (Figma 02 `Stat Radar`) ──
const R = { w: 294, h: 192, cx: 147, cy: 96, r: 58 };
const pointAt = (i: number, r: number): [number, number] => {
  const a = ((-90 + 60 * i) * Math.PI) / 180;
  return [R.cx + r * Math.cos(a), R.cy + r * Math.sin(a)];
};
const pathOf = (points: [number, number][]): string => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + " Z";

function svgEl(tag: string, cls: string, d: string): SVGElement {
  const p = document.createElementNS(SVG, tag);
  p.setAttribute("class", cls);
  p.setAttribute("d", d);
  return p;
}

function radarEl(stats: BattleSlotView["stats"]): HTMLElement {
  const box = el("div", "radar");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", `실제 능력치 ${stats.map((s) => `${s.label} ${s.value}`).join(", ")}`);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(R.w));
  svg.setAttribute("height", String(R.h));
  svg.setAttribute("viewBox", `0 0 ${R.w} ${R.h}`);
  svg.setAttribute("aria-hidden", "true");
  for (const f of [1, 2 / 3, 1 / 3]) svg.appendChild(svgEl("path", "grid", pathOf(stats.map((_, i) => pointAt(i, R.r * f)))));
  svg.appendChild(svgEl("path", "grid", stats.map((_, i) => `M${R.cx} ${R.cy} L${pointAt(i, R.r).map((n) => n.toFixed(2)).join(" ")}`).join(" ")));
  const max = Math.max(1, ...stats.map((s) => s.value));
  const shape = pathOf(stats.map((s, i) => pointAt(i, (R.r * s.value) / max)));
  svg.append(svgEl("path", "area", shape), svgEl("path", "edge", shape));
  box.appendChild(svg);
  stats.forEach((s, i) => {
    const [x, y] = pointAt(i, R.r);
    const side = i === 0 || i === 3 ? "center" : i < 3 ? "right" : "left";
    const label = el("div", `stat ${side}`);
    label.append(el("span", undefined, s.label), el("strong", undefined, String(s.value)));
    if (i === 0) Object.assign(label.style, { left: `${x}px`, bottom: `${R.h - y + 4}px` });
    else if (i === 3) Object.assign(label.style, { left: `${x}px`, top: `${y + 4}px` });
    else Object.assign(label.style, { left: `${side === "right" ? x + 8 : x - 8}px`, top: `${y}px` });
    box.appendChild(label);
  });
  return box;
}

// 위아래 화살표 — 교환 화면의 교환 표시와 같은 그림 (renderer/manage/trade-cards.ts tradeSwapMark)
function swapSvg(): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M5 13 V3", "M2 6 L5 3 L8 6", "M11 3 V13", "M8 10 L11 13 L14 10"]) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

function moveEl(m: MoveView, i: number, icon: string | null): HTMLElement {
  const box = el("div", "move");
  const pick = buttonEl("pick", "", () => toggle(i));
  pick.appendChild(movePillEl(m, "large", icon));
  pick.setAttribute("aria-expanded", String(open === i));
  pick.setAttribute("aria-label", `${m.name} 설명 보기`);
  box.append(pick, el("div", "meta", m.meta));
  if (open === i) {
    const bubble = el("div", "bubble move-info");
    bubble.appendChild(el("strong", undefined, m.name));
    if (m.text) bubble.appendChild(el("div", undefined, m.text)); // 설명이 없는 기술은 이름만
    box.appendChild(bubble);
  }
  return box;
}

function render(v: BattleDeviceView): void {
  last = v;
  const slot = v.slot;
  const pet = slot.pet;
  if (!pet) return;
  if (shownPetId !== pet.id) open = null;
  shownPetId = pet.id;
  cryPlayer.setVolume(v.volume);
  frame.beginDraw(v.side, "배틀");

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  // 첫 줄 — `배틀 파티 N번`. 실패하면 이 자리의 글자·색만 실패 문구로 바꾼다(파티 상세와 같은 방식)
  const where = el("div", v.notice ? "where bad" : "where", v.notice || v.caption);
  if (v.notice) where.title = v.notice;
  screen.appendChild(where);
  const help = buttonEl("help", "?", () => toggle("basis"));
  help.setAttribute("aria-label", "능력치 기준");
  help.setAttribute("aria-expanded", String(open === "basis"));
  screen.appendChild(help);
  if (open === "basis") {
    const bubble = el("div", "bubble basis");
    bubble.appendChild(el("strong", undefined, "배틀 능력치 기준"));
    for (const line of v.basis) bubble.appendChild(el("div", "basis-line", `· ${line}`));
    screen.appendChild(bubble);
  }
  const entry = el("div", "entry");
  const portrait = el("div", "portrait");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(spriteCanvas(v.portrait, STAGE));
  portrait.appendChild(stage);
  entry.appendChild(portrait);
  const info = el("div", "info");
  const nameBlock = el("div", "name-block");
  const nameRow = el("div", "name-row");
  const name = el("div", "name", pet.nameParts.name);
  name.title = pet.name;
  nameRow.appendChild(name);
  const sex = genderIcon(pet.gender, 24);
  if (sex) nameRow.appendChild(sex);
  if (pet.shiny) nameRow.appendChild(shinyIcon(24));
  nameBlock.appendChild(nameRow);
  if (pet.nameParts.form) nameBlock.appendChild(el("div", "form", pet.nameParts.form));
  info.appendChild(nameBlock);
  const types = el("div", "types");
  pet.types.forEach((t, i) => types.appendChild(typeBadgeEl(t, pet.typeIds[i])));
  info.appendChild(types);
  // [스펙 미확정] 특성 줄 — 특성을 어떻게 다룰지 정리한 뒤 다시 정한다. 그때까지 보이지 않는다 (모델의 slot.ability 는 그대로 둔다)
  // if (slot.ability) {
  //   const ability = el("div", "ability");
  //   ability.append(el("strong", undefined, "특성"), el("span", undefined, slot.ability));
  //   info.appendChild(ability);
  // }
  entry.appendChild(info);
  screen.appendChild(entry);
  if (slot.stats.length) screen.appendChild(radarEl(slot.stats));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  const moves = el("div", "moves");
  moves.appendChild(el("strong", undefined, "기술"));
  slot.moves.forEach((m, i) => {
    if (i === 1) {
      const row = el("div", "swap-row");
      const swap = buttonEl("swap", "", () => api.act({ kind: "swap", petId: pet.id }));
      swap.appendChild(swapSvg());
      swap.title = "기술 순서 바꾸기";
      swap.setAttribute("aria-label", "기술 순서 바꾸기");
      if (v.busy === battleBusyKey({ kind: "swap", petId: pet.id })) swap.setAttribute("aria-busy", "true");
      row.appendChild(swap);
      moves.appendChild(row);
    }
    moves.appendChild(moveEl(m, i, v.typeIcons[m.typeId] ?? null));
  });
  device.appendChild(moves);

  const cry = buttonEl("cry", "울음소리", () => void cryPlayer.play(), v.volume <= 0);
  device.appendChild(frame.controlsEl(cry));
  frame.endDraw();
}

api.onShow((view) => {
  void frame.fontsReady.then(() => render(view));
});
