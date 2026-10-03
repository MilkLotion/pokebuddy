// 도감 기기 창 — 메인이 준 한 종의 항목을 그린다 (src/main/dex-window.ts). Figma `99 · 시안` `579:17691`
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 미해금 종은 그림을 검은 실루엣으로 칠하고, 이름·분류·타입·키·몸무게를 ??? 로 둔다
import type { DexDeviceView } from "../../shared/model/devices.js";
import { RADIAL, RADIAL_MIN, evoDrawer } from "../ui/evo-tree.js";
import { portraitImg, spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS, whenFontsReady } from "../ui/fonts.js";
import { createCryPlayer } from "../ui/cry.js";
import { typeBadgeEl } from "../ui/type-badge.js";

const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("dex.html 에 #device 가 없다");
const device: HTMLElement = root;
const api = window.pokebuddyDex;

// 창 높이 맞추기 — 그린 직후 한 번 알리고, 그 뒤 #device 높이가 바뀔 때마다 다시 알린다
// - 늦게 온 글꼴로 줄바꿈이 늘어도 창이 따라간다. 안 하면 아래가 잘린다 (worklog/records/features-0930/record.md 6번)
// - ResizeObserver 는 한 프레임에 한 번 부른다. 지난번과 같은 높이면 보내지 않는다
// - #device 는 폭 고정·높이 내용 기준이다. 창 크기가 바뀌어도 #device 높이는 그대로라 다시 불리지 않는다
let sentHeight = -1;
function sendSize(force: boolean): void {
  const h = Math.ceil(device.getBoundingClientRect().height);
  if (!force && h === sentHeight) return;
  sentHeight = h;
  api.size(h);
}
// 첫 render() 전(sentHeight < 0)에는 보내지 않는다 — 빈 #device 높이로 숨은 새 창이 먼저 보이면 안 된다
new ResizeObserver(() => {
  if (sentHeight >= 0) sendSize(false);
}).observe(device);

// 쓰는 글꼴 — 빈 문서는 글꼴을 아직 요청하지 않아 fonts.ready 가 바로 끝난다. 첫 측정 전에 직접 부른다
// - 굵기별로 파일이 따로다: Galmuri11 400·700, Galmuri9 400 (dex.html @font-face)
// - 실패해도 그리기는 한다. 늦게 오면 위 ResizeObserver 가 높이를 고친다
const fontsReady = whenFontsReady(DEVICE_FONTS);

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
  const close = buttonEl("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, `No.${String(d.dex).padStart(3, "0")}${d.form ? `-${d.form}` : ""}`), el("span", undefined, d.name), el("span", "state", STATE_WORD[d.state] ?? d.state));
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
  // 진화 트리가 있으면 진화 줄 대신 아래 카드로 보인다. 미해금 종도 카드다 — 트리가 없는 종만 진화 줄을 둔다
  const rows: (readonly [string, string])[] = [["상태", state], ["입수처", d.methods]];
  if (!v.tree) rows.push(["진화", d.evolution]);
  rows.push(["특수 기믹", d.gimmick]);
  // 메가진화하는 종 — 얻은 종에만 메가 모습의 이름을 한 줄로 (2026-10-02 사용자 결정 "얻은 종에만", 시안 A, Figma 05 `Dex / Device / Mega` `1380:55226`)
  if (d.mega) rows.push([d.mega.label, d.mega.names]);
  for (const [key, value] of rows) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", "value", value));
    records.appendChild(row);
  }
  device.appendChild(records);
  if (v.tree) device.appendChild(evolutionCard(v));

  besideNow = v.beside;
  // 파티 상세 옆에 붙은 창은 바닥 단추 줄을 두지 않는다 — 울음소리는 파티 상세에 있고, 넘기기는 파티 상세가 한다 (2026-10-01 사용자 "이 도감상세에는 울음소리 없어도 될듯")
  if (v.beside) {
    sendSize(true);
    return;
  }
  const controls = el("div", "controls");
  const cry = buttonEl("cry", "울음소리", () => void cryPlayer.play());
  // 미해금 종은 울음소리도 숨긴다. 설정에서 소리를 끄면 막는다
  cry.disabled = locked || v.volume <= 0;
  controls.append(
    buttonEl("prev", "◀ 이전", () => api.step(-1)),
    cry,
    buttonEl("next", "다음 ▶", () => api.step(1)),
  );
  device.appendChild(controls);

  // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
  sendSize(true);
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

// 방향키로도 넘긴다. Esc 는 닫는다. 파티 상세 옆에 붙은 창은 넘기지 않는다
let besideNow = false;
document.addEventListener("keydown", (e) => {
  if (besideNow && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
  if (e.key === "ArrowLeft") api.step(-1);
  else if (e.key === "ArrowRight") api.step(1);
  else if (e.key === "Escape") api.close();
});

api.onShow((view) => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void fontsReady.then(() => render(view));
});
