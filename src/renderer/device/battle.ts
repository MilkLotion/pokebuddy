// 배틀 파티 상세 기기 창 — 메인이 만들어 보낸 배틀 파티 칸 하나를 그린다 (src/view/device-battle.ts, docs/specs/adventure.md "배틀 파티 상세 기기 창")
// Figma 05 `15 모험` `Adventure / Battle Party Device` `1662:3180`(기기 03 `Battle Party Device` `1662:224`)
//   화면  `배틀 파티 N번` → 초상·이름·타입·특성 → 종족값 방사형 그래프(가운데 합계 숫자)
//   특성 줄을 누르면 그 아래에 특성 설명 말풍선(Figma 05 `Adventure / Battle Party Device · Ability Info` `1896:984`)
//   타입 줄 `상세보기` 를 누르면 그 아래에 상성 말풍선 — 방어 | 공격(자기 타입마다) (Figma 99 `Draft / Type Matchup Bubble` `2042:16836`, 2026-10-17)
//   흰 판 기술 두 개(큰 기술 칸 + 분류·위력·명중·쿨타임)
// 레벨은 보이지 않는다 — 배틀은 50레벨로 계산한다. 능력치 기준(50레벨·6V·노력치·도구 없음)은 모험 탭 팁과 배틀 시작 모달이 말한다(2026-10-12 사용자 "상세기기 (?)에는 50레벨 기준을 없애도 되겠다")
// 기술 칸을 누르면 관리 창이 기술 바꾸기 모달을 연다(renderer/manage/move-pick.ts, 2026-10-10). 기술 설명과 순서 바꾸기는 모달에서 한다
// 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다
import type { BattleDeviceView, MatchupLine } from "../../shared/model/devices.js";
import type { BattleSlotView, MoveView } from "../../shared/model/snapshot.js";
import { needBridge } from "../ui/bridge.js";
import { createCryPlayer } from "../ui/cry.js";
import { buttonEl, el } from "../ui/dom.js";
import { genderIcon } from "../ui/gender-icon.js";
import { structureOf } from "../ui/live-draw.js";
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
const MEGA_STONE = { w: 28, h: 28, maxScale: 2 }; // 파티 상세 기기 창과 같은 표식 (device/pet.ts)
const SVG = "http://www.w3.org/2000/svg";

// 말풍선 — 특성 줄의 특성 설명, 타입 줄의 상성. 하나만 연다. 다른 개체를 열면 닫는다
type Bubble = "ability" | "matchup";
let open: Bubble | null = null;
let shownPetId = "";
let last: BattleDeviceView | null = null;

const toggle = (what: Bubble): void => {
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
  box.setAttribute("aria-label", `종족값 ${stats.map((s) => `${s.label} ${s.value}`).join(", ")}`);
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
  // 가운데 합계 — 숫자만 (2026-10-17 사용자 "방사형 그래프 안에 총합숫자만 넣어", "숫자 더 키워도")
  const total = el("div", "total", String(stats.reduce((n, s) => n + s.value, 0)));
  Object.assign(total.style, { left: `${R.cx}px`, top: `${R.cy}px` });
  box.appendChild(total);
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

// 상성 한 줄 — 배율 글자와 타입 아이콘(타입 색 네모에 흰 아이콘, 모달의 상대 칸 .bo-type 과 같은 모양)
function matchupLineEl(line: MatchupLine, icons: Record<string, string | null>): HTMLElement {
  const row = el("div", "mt-row");
  row.appendChild(el("span", "mt-mul", `×${line.mul}`));
  const list = el("div", "mt-types");
  for (const t of line.types) {
    const box = el("span", "mt-type");
    box.dataset.type = t;
    const src = icons[t];
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      box.appendChild(img);
    }
    list.appendChild(box);
  }
  row.appendChild(list);
  row.setAttribute("aria-label", `×${line.mul} ${line.types.length}타입`);
  return row;
}

function matchupEl(v: BattleDeviceView): HTMLElement {
  const bubble = el("div", "bubble matchup-info");
  const defense = el("div", "mt-col");
  defense.appendChild(el("strong", undefined, "방어"));
  for (const line of v.matchup.defense) defense.appendChild(matchupLineEl(line, v.typeIcons));
  const attack = el("div", "mt-col");
  for (const a of v.matchup.attack) {
    const group = el("div", "mt-group");
    group.appendChild(el("strong", undefined, `공격 · ${a.name}`));
    for (const line of a.rows) group.appendChild(matchupLineEl(line, v.typeIcons));
    attack.appendChild(group);
  }
  bubble.append(defense, el("div", "mt-divider"), attack);
  return bubble;
}

// 기술 한 개 — 누르면 기술 바꾸기 모달(고른 칸 없이 열고 상세 칸에 이 기술)
function moveEl(m: MoveView, i: number, icon: string | null, petId: string): HTMLElement {
  const box = el("div", "move");
  const pick = buttonEl("pick", "", () => api.act({ kind: "moves", petId, slot: i }));
  pick.appendChild(movePillEl(m, "large", icon));
  pick.setAttribute("aria-label", `${i + 1}번 기술 ${m.name} 바꾸기`);
  pick.title = "기술 바꾸기";
  box.append(pick, el("div", "meta", m.meta));
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
  frame.beginDraw(v.side, "배틀", undefined, v.kinds);

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  // 첫 줄 — `배틀 파티 N번`. 실패하면 이 자리의 글자·색만 실패 문구로 바꾼다(파티 상세와 같은 방식)
  const where = el("div", v.notice ? "where bad" : "where", v.notice || v.caption);
  if (v.notice) where.title = v.notice;
  screen.appendChild(where);
  const entry = el("div", "entry");
  const portrait = el("div", "portrait");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(spriteCanvas(v.portrait, STAGE));
  portrait.appendChild(stage);
  // 메가스톤 표식 — 초상 오른쪽 아래. 누르면 설정창이 메가진화 창을 연다(배틀 파티의 메가 상태). 켰으면 옅은 바탕
  // (docs/specs/adventure.md "메가진화", Figma 03 `Battle Party Device` `Mega=Off|On`)
  if (pet.mega) {
    const word = pet.mega.kind === "primal" ? "원시회귀" : "메가진화";
    const label = pet.mega.on ? "원래 모습으로" : word;
    const stone = buttonEl(pet.mega.on ? "mega-stone on" : "mega-stone", "", () => api.act({ kind: "mega", petId: pet.id }));
    stone.title = label;
    stone.setAttribute("aria-label", label);
    if (v.megaIcon) stone.appendChild(spriteCanvas(v.megaIcon, MEGA_STONE));
    portrait.appendChild(stone);
  }
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
  // 상성 상세보기 — 누르면 타입 줄 아래에 방어 | 공격 말풍선 (2026-10-17 사용자 "타입적잖아. 거기에 상세보기 두고, 툴팁으로 공격/방어 상성")
  const more = buttonEl("matchup-link", "상세보기", () => toggle("matchup"));
  more.setAttribute("aria-expanded", String(open === "matchup"));
  types.appendChild(more);
  info.appendChild(types);
  let matchup: HTMLElement | null = null;
  if (open === "matchup") {
    matchup = matchupEl(v);
    types.appendChild(matchup);
  }
  // 특성 줄 — 누르면 아래에 특성 이름과 이 게임에서의 동작을 말풍선으로 (docs/specs/adventure.md "배틀 파티 상세 기기 창")
  if (slot.ability) {
    const row = el("div", "ability-row");
    const ability = buttonEl("ability", "", () => toggle("ability"));
    ability.append(el("strong", undefined, "특성"), el("span", undefined, slot.ability.name));
    ability.setAttribute("aria-label", `특성 ${slot.ability.name} 설명`);
    ability.setAttribute("aria-expanded", String(open === "ability"));
    row.appendChild(ability);
    if (open === "ability") {
      const bubble = el("div", "bubble ability-info");
      bubble.append(el("strong", undefined, slot.ability.name), el("div", "ability-text", slot.ability.text));
      row.appendChild(bubble);
    }
    info.appendChild(row);
  }
  entry.appendChild(info);
  screen.appendChild(entry);
  if (slot.stats.length) screen.appendChild(radarEl(slot.stats));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 기술 두 개 — 순서 바꾸기는 기술 바꾸기 모달에만 있다(2026-10-17 사용자 "기술 위아래 변경은 기기에선 빼도되겠다")
  const moves = el("div", "moves");
  slot.moves.forEach((m, i) => moves.appendChild(moveEl(m, i, v.typeIcons[m.typeId] ?? null, pet.id)));
  device.appendChild(moves);

  const cry = buttonEl("cry", "울음소리", () => void cryPlayer.play(), v.volume <= 0);
  device.appendChild(frame.controlsEl(cry));
  frame.endDraw();
  // 상성 말풍선은 기기 가로 가운데 — 타입 줄이 놓인 자리만큼 왼쪽으로 민다
  if (matchup) {
    const at = types.getBoundingClientRect().left - device.getBoundingClientRect().left;
    matchup.style.left = `${Math.round((device.clientWidth - matchup.offsetWidth) / 2 - at)}px`;
  }
}

// 같은 모델이면 다시 그리지 않는다 — 초상이 빈 canvas 에서 다시 시작하지 않게 (실행 규칙 R4, worklog/records/perf-refactor 1-3).
// 이 창의 값에는 시간으로 바뀌는 것이 없다(src/shared/model/devices.ts BattleDevicePet). 특성 말풍선은 toggle 이 직접 다시 그린다
let renderedStructure = "";
api.onShow((view) => {
  void frame.fontsReady.then(() => {
    const structure = structureOf(view);
    if (structure === renderedStructure) {
      last = view;
      return;
    }
    renderedStructure = structure;
    render(view);
  });
});
