// 도감 기기 창 — 메인이 준 한 종의 항목을 그린다 (src/main/dex-window.ts). Figma `99 · 시안` `579:17691`
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 미해금 종은 그림을 검은 실루엣으로 칠하고, 이름·분류·타입·키·몸무게를 ??? 로 둔다
import type { DexDeviceView } from "../../shared/model/devices.js";
import { needBridge } from "../ui/bridge.js";
import { RADIAL, RADIAL_MIN, evoDrawer } from "../ui/evo-tree.js";
import { portraitImg, spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { createCryPlayer } from "../ui/cry.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { createDeviceFrame } from "./device-frame.js";
import { pairsEl } from "./item-face.js";

const api = needBridge("pokebuddyDex");
// 방향키로도 넘긴다. Esc 는 닫는다. 파티 상세 옆에 붙은 창은 넘기지 않는다
let besideNow = false;
const frame = createDeviceFrame({ api, windowName: "dex", canKey: (key) => !(besideNow && key !== "Escape") });
const device = frame.device;

const UNKNOWN = "???";
const STATE_WORD: Record<string, string> = { obtained: "획득", unlocked: "해금", locked: "미해금" };

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다 (ui/portrait.ts spriteCanvas)
const STAGE = { w: 150, h: 124, maxScale: 2 };

// 울음소리 — 음량은 설정의 소리 크기를 곱한 값(메인이 준다)
const cryPlayer = createCryPlayer(() => api.cry());

function render(v: DexDeviceView): void {
  const d = v.detail;
  cryPlayer.setVolume(v.volume);
  const locked = d.state === "locked";
  frame.beginDraw(v.side, "도감", locked ? "locked" : undefined);

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, `No.${String(d.dex).padStart(3, "0")}${d.form ? `-${d.form}` : ""}${d.tag ? `-${d.tag}` : ""}`), el("span", undefined, d.name), el("span", "state", STATE_WORD[d.state] ?? d.state));
  screen.appendChild(bar);

  const entry = el("div", "entry");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(spriteCanvas(v.portrait, STAGE));
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
  device.appendChild(pairsEl("records", rows, "value"));
  if (v.tree) device.appendChild(evolutionCard(v));

  besideNow = v.beside;
  // 파티 상세 옆에 붙은 창은 바닥 단추 줄을 두지 않는다 — 울음소리는 파티 상세에 있고, 넘기기는 파티 상세가 한다 (2026-10-01 사용자 "이 도감상세에는 울음소리 없어도 될듯")
  if (v.beside) {
    frame.endDraw();
    return;
  }
  const cry = buttonEl("cry", "울음소리", () => void cryPlayer.play());
  // 미해금 종은 울음소리도 숨긴다. 설정에서 소리를 끄면 막는다
  cry.disabled = locked || v.volume <= 0;
  device.appendChild(frame.controlsEl(cry));

  frame.endDraw();
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
  }, { lockedName: "???" });
  if (!tree.children.length) card.appendChild(el("div", "evo-none", "진화하지 않는 포켓몬이에요"));
  else card.appendChild(tree.children.length >= RADIAL_MIN ? draw.evoRadial(tree, DEX_RADIAL) : draw.evoTree(tree));
  return card;
}

frame.showWith((cb) => api.onShow(cb), render);
