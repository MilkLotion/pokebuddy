// 도감 기기 창 — 메인이 준 한 종의 항목을 그린다 (src/main/dex-window.ts). Figma `99 · 시안` `579:17691`
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 진화 트리의 종을 누르면 설정창이 그 종의 상세로 바꾼다(2026-10-13)
// 미해금 종은 그림을 검은 실루엣으로 칠하고, 이름·분류·타입·키·몸무게를 ??? 로 둔다
import type { DexDeviceView } from "../../shared/model/devices.js";
import type { DexFormView } from "../../shared/model/detail.js";
import { needBridge } from "../ui/bridge.js";
import { RADIAL, RADIAL_MIN, evoDrawer } from "../ui/evo-tree.js";
import { portraitImg, spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { createCryPlayer } from "../ui/cry.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { createDeviceFrame } from "./device-frame.js";
import { pairsEl } from "./item-face.js";

const api = needBridge("pokebuddyDex");
// 방향키로도 넘긴다. Esc 는 열림 스택을 따른다(device-frame.ts)
const frame = createDeviceFrame({ api, windowName: "dex" });
const device = frame.device;

const UNKNOWN = "???";
const STATE_WORD: Record<string, string> = { obtained: "획득", unlocked: "해금", locked: "미해금" };

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다 (ui/portrait.ts spriteCanvas)
const STAGE = { w: 150, h: 124, maxScale: 2 };

// 울음소리 — 음량은 설정의 소리 크기를 곱한 값(메인이 준다)
const cryPlayer = createCryPlayer(() => api.cry());

// 이로치 보기 — 이로치를 얻은 종만 초상 칸 오른쪽 위에 둥근 단추. 켜면 이로치 초상, 끄면 기본 초상. 종이 바뀌면 끈다
// (2026-10-09 사용자 "이로치 얻은종만 버튼생기게", 단추 모양 "d0으로 하자", Figma 05 `Dex / Device / Shiny Off|On`)
let shinyOn = false;
let shinySlug = "";
let lastView: DexDeviceView | null = null;
// 쪽 — 1쪽 정보, 2쪽 모습(다른 모습이 있는 종만). 바닥 줄 가운데 쪽 점과 `다른 모습 n` 링크가 바꾼다. 다른 종으로 넘겨도 그 종에 다른 모습이 있으면 쪽을 지킨다
// (2026-10-18 사용자 "1페이지 2페이지 느낌", "이 울음소리 있는곳에 페이지 바뀌게", Figma 99 `Draft / 모습 모아 보기`)
let page: 1 | 2 = 1;
let infoHeight = 0; // 1쪽을 그린 높이 — 2쪽이 같은 높이를 쓴다

function render(v: DexDeviceView): void {
  const d = v.detail;
  lastView = v;
  if (d.slug !== shinySlug) {
    shinySlug = d.slug;
    shinyOn = false;
  }
  // 옆 창(링크로 연 도감)은 바닥 줄이 없어 1쪽만 보인다
  const forms = v.beside ? undefined : d.forms;
  if (!forms) page = 1;
  cryPlayer.setVolume(v.volume);
  const locked = d.state === "locked";
  frame.beginDraw(v.side, "도감", locked ? "locked" : undefined, v.kinds);
  device.style.height = "";
  if (page === 2 && forms) {
    drawForms(v, forms);
    return;
  }

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, `No.${String(d.dex).padStart(3, "0")}${d.form ? `-${d.form}` : ""}${d.tag ? `-${d.tag}` : ""}`), el("span", undefined, d.name), el("span", "state", STATE_WORD[d.state] ?? d.state));
  screen.appendChild(bar);

  const entry = el("div", "entry");
  const stage = el("div", "stage");
  const shown = shinyOn && v.shinyPortrait ? v.shinyPortrait : v.portrait;
  if (shown) stage.appendChild(spriteCanvas(shown, STAGE));
  // 울음소리 — 초상 칸 오른쪽 위 음표 둥근 단추. 이로치 단추는 그 아래 (2026-10-18 사용자 "울음소리는 프로필의 우상단에 … 이로치를 아래로 내리고 … 음표아이콘으로")
  // 미해금 종과 설정에서 소리를 끈 동안은 막는다
  if (!v.beside) {
    const cry = buttonEl("cry-toggle", "", () => void cryPlayer.play(), locked || v.volume <= 0);
    cry.appendChild(noteIcon(16));
    cry.title = "울음소리";
    cry.setAttribute("aria-label", "울음소리");
    stage.appendChild(cry);
  }
  if (v.shinyPortrait && !locked) {
    const toggle = buttonEl(shinyOn ? "shiny-toggle on" : "shiny-toggle", "", () => {
      shinyOn = !shinyOn;
      if (lastView) render(lastView);
    });
    toggle.appendChild(shinyIcon(16, shinyOn ? "이로치 모습 끄기" : "이로치 모습 보기"));
    toggle.setAttribute("aria-pressed", String(shinyOn));
    toggle.title = shinyOn ? "기본 모습 보기" : "이로치 모습 보기";
    stage.appendChild(toggle);
  }
  entry.appendChild(stage);
  const info = el("div", "info");
  info.appendChild(el("div", undefined, locked ? UNKNOWN : d.genus || " "));
  const types = el("div", "types");
  if (d.types.length) d.types.forEach((name, i) => types.appendChild(typeBadgeEl(name, d.typeIds[i])));
  else types.appendChild(typeBadgeEl(UNKNOWN));
  info.appendChild(types);
  const measure = pairsEl("measure", [
    ["키", d.height || UNKNOWN],
    ["몸무게", d.weight || UNKNOWN],
  ]);
  info.appendChild(measure);
  entry.appendChild(info);
  screen.appendChild(entry);
  screen.appendChild(el("div", "flavor", locked ? "아직 만나지 못한 포켓몬이다." : d.flavor || "설명이 없는 포켓몬이다."));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  const state = locked ? "미해금" : `이로치 ${d.shiny ? "획득" : "미획득"} · 보유 ${d.owned}마리`;
  // 진화 트리가 있으면 진화 줄 대신 아래 카드로 보인다. 미해금 종도 카드다 — 트리가 없는 종만 진화 줄을 둔다
  const rows: (readonly [string, string])[] = [["상태", state], ["입수처", d.methods]];
  if (!v.tree) rows.push(["진화", d.evolution]);
  rows.push(["특수 기믹", d.gimmick]);
  // 메가진화하는 종 — 얻은 종에만 메가 모습의 이름을 한 줄로 (2026-10-02 사용자 결정 "얻은 종에만", 시안 A, Figma 05 `Dex / Device / Mega` `1380:55226`)
  if (d.mega) rows.push([d.mega.label, d.mega.names]);
  // 다른 모습이 있는 종 — 기록 칸 맨 아래 `모습` 줄의 링크 글자가 2쪽으로 간다 (2026-10-18 사용자 "링크두는건 좋은듯")
  if (forms) rows.push(["모습", ""]);
  const records = pairsEl("records", rows, "value");
  if (d.shopLinks?.length) linkMethods(records, d.methods, d.shopLinks, v.linkOpen);
  if (forms) records.lastElementChild?.querySelector(".value")?.appendChild(buttonEl("link-text", `다른 모습 ${forms.length - 1}`, () => turnTo(2)));
  device.appendChild(records);
  if (v.tree) device.appendChild(evolutionCard(v));

  // 링크 글자로 연 옆 창은 바닥 줄(이전·울음소리·다음)을 두지 않는다 — 넘기기는 지금 기기 창이 한다 (docs/specs/ui-components.md "링크 글자")
  if (v.beside) {
    frame.endDraw();
    return;
  }

  device.appendChild(frame.controlsEl(pageDotsEl(forms)));

  infoHeight = device.offsetHeight;
  frame.endDraw();
}

function turnTo(next: 1 | 2): void {
  if (page === next) return;
  page = next;
  if (lastView) render(lastView);
}

// 바닥 줄 가운데 — 쪽 점. 지금 쪽만 LED 색. 다른 모습이 없는 종은 빈 칸(줄 모양을 지킨다) (Figma 99 `Draft / Device Controls · Pages`)
function pageDotsEl(forms: DexFormView[] | undefined): HTMLElement {
  const box = el("div", "pages");
  if (!forms) return box;
  box.setAttribute("role", "tablist");
  for (const [n, label] of [[1, "정보"], [2, "모습"]] as const) {
    const dot = buttonEl(page === n ? "page-dot on" : "page-dot", "", () => turnTo(n));
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-selected", String(page === n));
    dot.setAttribute("aria-label", `${n}쪽 ${label}`);
    dot.title = label;
    box.appendChild(dot);
  }
  return box;
}

// 2쪽 — 그 종의 모습 격자. 머리 줄은 1쪽과 같고, 요약 줄(`얻음 n · 모습 m`) 아래 칸이 화면을 채운다. 높이는 1쪽과 같다(같은 창에서 바뀌어도 창 크기가 그대로)
// 얻은 모습은 초상, 못 얻은 모습은 검은 실루엣과 ???. 지금 보는 모습은 톤 바탕. 칸을 누르면 그 모습의 1쪽 (Figma 99 `Draft / Dex Device · 모습 모아 보기`)
function drawForms(v: DexDeviceView, forms: DexFormView[]): void {
  const d = v.detail;
  const bezel = el("div", "bezel forms-bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, `No.${String(d.dex).padStart(3, "0")}`), el("span", undefined, `${(forms[0]?.name ?? UNKNOWN).replace(/\(.*\)$/, "")} · 모습`), el("span", "state", `${forms.filter((f) => f.obtained).length}/${forms.length}`));
  screen.appendChild(bar);
  screen.appendChild(el("div", "forms-summary", `얻음 ${forms.filter((f) => f.obtained).length} · 모습 ${forms.length}`));
  const grid = el("div", "form-grid");
  for (const f of forms) {
    const card = buttonEl(`form-card${f.current ? " on" : ""}${f.obtained ? "" : " locked"}`, "", () => {
      page = 1;
      api.act({ kind: "form", slug: f.slug });
    });
    const uri = v.treePortraits[f.slug];
    const art = el("span", "form-art");
    if (uri) art.appendChild(portraitImg(uri, "art"));
    card.append(art, el("span", "form-name", f.label), el("span", "form-no", `#${String(d.dex).padStart(4, "0")}`));
    card.setAttribute("aria-pressed", String(f.current));
    grid.appendChild(card);
  }
  screen.appendChild(grid);
  bezel.appendChild(screen);
  device.appendChild(bezel);
  device.appendChild(frame.controlsEl(pageDotsEl(forms)));
  // 1쪽과 같은 높이 — 모습이 많으면(비비용 20·마휘핑 63) 칸 자리만 스크롤한다
  if (infoHeight) device.style.height = `${infoHeight}px`;
  frame.endDraw();
}

// 음표 그림 — 울음소리 단추 (Figma 99 `cry-button`). 색은 글자색을 따른다
function noteIcon(size: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M6 2h7v2H8v7.5A2.5 2.5 0 1 1 6 9.05V2z");
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

// 입수처의 알 이름을 링크 글자로 — 누르면 그 알 상품의 상점 기기 창을 옆 창으로 연다. 옆 창이 떠 있는 동안 그 링크는 톤 바탕(.on)
// (docs/specs/ui-components.md "링크 글자", Figma 01 `Link Text`). 입수처 줄은 기록 칸의 둘째 줄이다
function linkMethods(records: HTMLElement, text: string, links: { label: string; productId: string }[], open: string | null): void {
  const value = records.children[1]?.querySelector(".value");
  if (!value) return;
  value.replaceChildren();
  let rest = text;
  while (rest) {
    const hit = links.map((l) => ({ l, at: rest.indexOf(l.label) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (!hit) {
      value.append(rest);
      break;
    }
    if (hit.at > 0) value.append(rest.slice(0, hit.at));
    const link = buttonEl(hit.l.productId === open ? "link-text on" : "link-text", hit.l.label, () => api.act({ kind: "shop", productId: hit.l.productId }));
    link.setAttribute("aria-pressed", String(hit.l.productId === open));
    value.appendChild(link);
    rest = rest.slice(hit.at + hit.l.label.length);
  }
}

// 진화 카드 — 기록 칸 아래. 상점 구매 창과 같은 트리를 기기 폭에 맞춰 그린다 (2026-09-30 사용자 결정 "도감상세는 a.", Figma 05 `Dex / Device / Unlocked` `1091:23559`)
// 지금 종은 톤 바탕과 굵은 이름. 진화하지 않는 종은 한 줄 안내
const DEX_RADIAL = { ...RADIAL, width: 314 };
function evolutionCard(v: DexDeviceView): HTMLElement {
  const card = el("div", "evo-card");
  card.appendChild(el("div", "evo-label", "진화"));
  const tree = v.tree!;
  // 해금한 종만 이름을 보인다. 미해금 종은 검은 실루엣과 ??? — 진화 조건은 보인다 (2026-10-02 사용자 "진화트리 다 실루엣으로 보이게. 이름만 ???")
  const draw = evoDrawer((slug, cls) => {
    const box = el("span", cls);
    const uri = v.treePortraits[slug];
    if (uri) box.appendChild(portraitImg(uri, "art"));
    return box;
  }, { lockedName: "???", onPick: (slug) => api.act({ kind: "pick", slug }) });
  if (!tree.children.length) card.appendChild(el("div", "evo-none", "진화하지 않는 포켓몬이에요"));
  else card.appendChild(tree.children.length >= RADIAL_MIN ? draw.evoRadial(tree, DEX_RADIAL) : draw.evoTree(tree));
  return card;
}

frame.showWith((cb) => api.onShow(cb), render);
