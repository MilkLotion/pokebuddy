// 배틀 창 — 메인이 보낸 판(BattleScreenView)을 시간대로 재생한다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// - 머리 줄(상태 등·LED·제목·✕)과 Esc 닫기는 기기 창 틀(device-frame.ts)을 쓴다. 설정창에 붙지 않아 ◀▶ 넘기기는 없다
// - 재생 계산은 src/shared/battle-timeline.ts. 여기서는 그 상태를 DOM 에 옮긴다. 판 하나의 DOM 은 처음 한 번 만들고 프레임마다 값만 바꾼다
import { dpsOf } from "../../shared/battle-record-text.js";
import type { BattleDpsRow } from "../../shared/model/battle-net.js";
import type { BattleRouletteView, BattleScreenView, BattleSide, BattleStatusKind, BattleUnitView } from "../../shared/model/battle-screen.js";
import type { MoveView } from "../../shared/model/snapshot.js";
import { STATUS_NAME, STAT_CHIP, TIMELINE_RULES, clockText, createTimeline, spriteFrame, type Timeline, type UnitState } from "../../shared/battle-timeline.js";
import type { LookSheets } from "../../shared/model/stage.js";
import { createDeviceFrame } from "../device/device-frame.js";
import { createFieldFx, type FieldFx } from "./field-fx.js";
import { STATUS_COLOR, createStatusFx, type StatusFxMark, type StatusFxUnit } from "./status-fx.js";
import { needBridge } from "../ui/bridge.js";
import { buttonEl, el } from "../ui/dom.js";
import { dpsTableEl, refreshDpsTable } from "../ui/dps-table.js";
import { DEVICE_FONTS } from "../ui/fonts.js";
import { noteIconEl } from "../ui/line-icons.js";
import { movePillEl } from "../ui/move-pill.js";
import { typeIconEl } from "../ui/type-badge.js";

const api = needBridge("pokebuddyBattleScreen");
const frame = createDeviceFrame({
  api: { size: () => {}, step: () => {}, close: () => api.close() },
  windowName: "battle-screen",
  fonts: [...DEVICE_FONTS, '15px "Galmuri14"'],
  canKey: (key) => key === "Escape",
});

const CELL = 28; // 계산 칸(px) — 화면 칸 56
const START_DELAY_MS = 600; // 판을 받은 뒤 재생을 시작하기까지
const RESULT_DELAY_MS = 600; // 판이 끝난 뒤 결과를 띄우기까지
// 룰렛 — 칸이 위에서 아래로 돌다가 왼쪽 릴부터 차례로 멈춘다. 다 멈추면 잠깐 보인 뒤 사라지고 판이 시작된다
const ROULETTE = { rowH: 40, rowMs: 70, spinMs: 1200, gapMs: 500, holdMs: 700 } as const;
const rouletteMs = (reels: BattleRouletteView[]): number => ROULETTE.spinMs + ROULETTE.gapMs * (reels.length - 1) + ROULETTE.holdMs;
// 도는 릴 — 후보가 둘 이상이고 확정이 아니다. 후보 하나·확정·후보 없음은 처음부터 멈춰 있다
const reelSpins = (reel: BattleRouletteView): boolean => reel.candidates.length > 1;

interface CardEls {
  root: HTMLElement;
  hpFill: HTMLElement;
  hpChip: HTMLElement;
  hpText: HTMLElement;
  moves: { root: HTMLElement; fill: HTMLElement }[];
}
interface PetEls {
  root: HTMLElement;
  canvas: HTMLCanvasElement | null; // PMD 그림. 없으면 초상 img
  sheets: LookSheets | null;
  shown: string; // 지금 그린 동작·방향·프레임 — 같으면 다시 그리지 않는다
  hpFill: HTMLElement;
  hpChip: HTMLElement;
  gauge: HTMLElement;
  gaugeBar: HTMLElement; // 쿨타임 바 바탕 — 마비 마디·얼음/잠듦 멈춤 표시
  gaugeTail: HTMLElement; // 쿨타임 바 끝의 풀죽음 1초 몫(회색)
  tags: HTMLElement;
  lefts: { el: HTMLElement; from: number; until: number }[]; // 능력 칩의 남은 시간 줄
  chips: number; // 지금 보이는 칩 수 — 알약·팝 글자를 그만큼 올린다
  overTop: number; // 머리 위 표시(HP 바)의 윗변 — 몸 칸 위에서의 px. 그림 키에 따라 다르다
  over: HTMLElement; // 머리 위 표시 — 모습이 바뀌면 윗변을 다시 둔다
  species: string; // 지금 그리는 모습 — form 이벤트로 바뀐다
}

// 머리 위 칩 하나 — 상태 이상은 색 점 + 이름, 능력 변화는 짧은 이름 + ▲▼단계와 남은 시간 줄
interface TagSpec {
  key: string;
  text: string;
  dot?: string; // 상태 색
  arrow?: { text: string; up: boolean };
  left?: { from: number; until: number };
}
const TAG_MAX = 3; // 넘으면 앞 2개와 +N

let run = 0; // 판 번호 — 새 판이 오면 지난 재생을 멈춘다

function barEl(cls: string): { root: HTMLElement; fill: HTMLElement; chip: HTMLElement } {
  const root = el("div", `bar ${cls}`);
  const chip = el("i", "chip");
  const fill = el("i", "fill");
  root.append(chip, fill);
  return { root, fill, chip };
}

// 기술 호버 — 기술 이름과 배틀 수치(분류 · 위력 · 명중 · 쿨타임). 창 아래로 넘치면 아이콘 위에 띄운다
let bubble: HTMLElement | null = null;
function showBubble(anchor: HTMLElement, move: MoveView): void {
  hideBubble();
  const b = el("div", "move-bubble");
  b.append(el("div", "mb-name", move.name), el("div", "mb-meta", move.meta));
  frame.device.appendChild(b);
  const box = frame.device.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const left = Math.min(a.left - box.left - 8, box.width - b.offsetWidth - 8);
  let top = a.bottom - box.top + 6;
  if (top + b.offsetHeight > box.height - 4) top = a.top - box.top - b.offsetHeight - 6;
  b.style.left = `${Math.max(8, left)}px`;
  b.style.top = `${top}px`;
  bubble = b;
}
function hideBubble(): void {
  bubble?.remove();
  bubble = null;
}

// 판 표시 줄의 걸린 효과 칩 — 관련 타입 아이콘 + 이름
function conditionEl(reel: BattleRouletteView, view: BattleScreenView): HTMLElement | null {
  if (!reel.name) return null;
  const chip = el("span", "condition");
  if (reel.type) chip.appendChild(typeIconEl(reel.type, view.typeIcons[reel.type]));
  chip.appendChild(document.createTextNode(reel.name));
  return chip;
}

interface ReelEls {
  reel: BattleRouletteView;
  rows: HTMLElement; // 칸 띠 — translateY 로 돈다
  result: HTMLElement;
  stopAt: number; // 룰렛 시작부터 멈출 때까지(ms). 확정·후보 없음은 0
}

function rouletteRowEl(view: BattleScreenView, c: { side: BattleSide; slot: number }): HTMLElement {
  const u = view.units[c.side][c.slot];
  const row = el("div", "rl-row");
  if (u?.portrait) {
    const img = document.createElement("img");
    img.className = "face";
    img.src = u.portrait;
    img.alt = "";
    row.appendChild(img);
  } else row.appendChild(el("span", "face"));
  const text = el("div", "rl-text");
  text.append(el("div", "rl-name", u?.name ?? ""), el("div", "rl-ability", u?.ability ?? ""));
  row.appendChild(text);
  return row;
}

// 룰렛 패널 — 릴 세 개. 결과 줄은 도는 동안에도 자리를 둔다 (Figma 03 `Roulette Panel`, 02 `Roulette Reel`)
function roulettePanel(view: BattleScreenView, reels: BattleRouletteView[]): { panel: HTMLElement; els: ReelEls[] } {
  const panel = el("div", "roulette");
  const els = reels.map((reel, i) => {
    const box = el("div", "rl-reel");
    const head = el("div", "rl-head");
    head.appendChild(el("span", "rl-label", reel.label));
    const win = el("div", "rl-window");
    const rows = el("div", "rl-rows");
    win.append(el("div", "rl-band"), rows);
    const result = el("div", "rl-result", "—");
    if (!reel.candidates.length) {
      win.appendChild(el("div", "rl-empty", "후보 없음"));
      result.textContent = "없음";
    } else {
      // 칸 띠 — 후보를 여러 번 이어 붙여 도는 동안 끊기지 않게 한다. 멈추면 뽑힌 칸을 가운데에 둔다
      const loop = Math.max(6, reel.candidates.length * 3);
      for (let k = 0; k < loop + 3; k++) rows.appendChild(rouletteRowEl(view, reel.candidates[k % reel.candidates.length]!));
    }
    box.append(head, win, result);
    panel.appendChild(box);
    const spins = reelSpins(reel);
    return { reel, rows, result, stopAt: spins ? ROULETTE.spinMs + ROULETTE.gapMs * i : 0 };
  });
  return { panel, els };
}

function paintReel(r: ReelEls, view: BattleScreenView, elapsed: number): void {
  const n = r.reel.candidates.length;
  if (!n) return;
  const pickedAt = Math.max(0, r.reel.candidates.findIndex((c) => c.side === r.reel.picked?.side && c.slot === r.reel.picked?.slot));
  if (elapsed < r.stopAt) {
    // 위에서 아래로 — 띠를 아래로 민다. 위 칸이 가운데로 내려온다
    const shift = (elapsed / ROULETTE.rowMs) * ROULETTE.rowH;
    const span = n * ROULETTE.rowH;
    const y = (shift % span) - span - ROULETTE.rowH * 2 + ROULETTE.rowH;
    r.rows.style.transform = `translateY(${y}px)`;
    r.rows.classList.add("spinning");
    return;
  }
  // 멈춤 — 뽑힌 칸(띠 안의 n + pickedAt 번째)을 가운데(y 40)에
  r.rows.classList.remove("spinning");
  r.rows.parentElement?.classList.add("stopped"); // 가운데 칸(뽑힌 것)만 진하게
  r.rows.style.transform = `translateY(${ROULETTE.rowH - (n + pickedAt) * ROULETTE.rowH}px)`;
  if (r.result.dataset.done !== "1") {
    r.result.dataset.done = "1";
    r.result.replaceChildren();
    if (r.reel.type) r.result.appendChild(typeIconEl(r.reel.type, view.typeIcons[r.reel.type]));
    r.result.appendChild(document.createTextNode(r.reel.name ?? "—"));
  }
}

function cardEl(u: BattleUnitView | null, view: BattleScreenView): CardEls | null {
  if (!u) {
    return null;
  }
  const root = el("div", "card");
  const who = el("div", "who");
  if (u.portrait) {
    const img = document.createElement("img");
    img.className = "face";
    img.src = u.portrait;
    img.alt = "";
    img.draggable = false;
    who.appendChild(img);
  } else who.appendChild(el("span", "face"));
  const nameBlock = el("div", "name-block");
  const types = el("div", "types");
  for (const t of u.types) types.appendChild(typeIconEl(t, view.typeIcons[t]));
  nameBlock.append(el("div", "name", u.name), types);
  who.appendChild(nameBlock);
  const hpRow = el("div", "hp-row");
  const hp = barEl(u.side === 0 ? "mine" : "opp");
  hp.root.style.flex = "1";
  const hpText = el("span", "hp-text", "100%");
  hpRow.append(hp.root, hpText);
  const movesRow = el("div", "moves");
  const moves = u.moves.map((m) => {
    const box = el("div", "move");
    const icon = typeIconEl(m.typeId, view.typeIcons[m.typeId]);
    icon.addEventListener("mouseenter", () => showBubble(icon, m));
    icon.addEventListener("mouseleave", hideBubble);
    const bar = barEl("cool");
    box.append(icon, bar.root);
    movesRow.appendChild(box);
    return { root: box, fill: bar.fill };
  });
  root.append(who, hpRow, movesRow);
  return { root, hpFill: hp.fill, hpChip: hp.chip, hpText, moves };
}

// 시트 그림 — data URI 하나에 Image 하나. 판이 바뀌어도 같은 그림은 다시 읽지 않는다
const sheetImages = new Map<string, HTMLImageElement>();
function sheetImage(uri: string): HTMLImageElement {
  let img = sheetImages.get(uri);
  if (!img) {
    img = new Image();
    img.src = uri;
    sheetImages.set(uri, img);
  }
  return img;
}

function petEl(u: BattleUnitView, sheets: LookSheets | null, zoom: number): PetEls {
  const root = el("div", "pet");
  let canvas: HTMLCanvasElement | null = null;
  let overTop = -6;
  if (sheets) {
    // 크기 2단계 — 시트 칸 × 배율. 몸(56) 가운데에 칸 가운데를 맞춘다. 머리 위 표시는 몸 칸 위에 둔다
    canvas = document.createElement("canvas");
    canvas.className = "sprite pmd";
    canvas.width = Math.round(sheets.cell.w * zoom);
    canvas.height = Math.round(sheets.cell.h * zoom);
    canvas.style.left = `${Math.round(CELL - canvas.width / 2)}px`;
    canvas.style.top = `${Math.round(CELL - canvas.height / 2)}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.imageSmoothingEnabled = false;
    root.appendChild(canvas);
    for (const sh of Object.values(sheets.anims)) sheetImage(sh.dataUrl);
    overTop = Math.round(CELL - (sheets.body.h * zoom) / 2 - 14);
  } else if (u.portrait) {
    const img = document.createElement("img");
    img.className = "sprite";
    img.src = u.portrait;
    img.alt = u.name;
    img.draggable = false;
    root.appendChild(img);
  }
  const over = el("div", "overhead");
  const tags = el("div", "tags");
  const hp = barEl(u.side === 0 ? "mine" : "opp");
  const gauge = barEl("cool");
  const tail = el("i", "tail");
  gauge.root.appendChild(tail);
  over.append(tags, hp.root, gauge.root);
  over.style.top = `${overTop}px`;
  root.appendChild(over);
  return { root, canvas, sheets, shown: "", hpFill: hp.fill, hpChip: hp.chip, gauge: gauge.fill, gaugeBar: gauge.root, gaugeTail: tail, tags, lefts: [], chips: 0, overTop, over, species: u.species };
}

// 모습이 바뀌면(form 이벤트 — 킬가르도·메로엣타·약어리·캐스퐁 등) 그 모습의 PMD 그림으로 바꾼다. 그림이 없으면 지금 그림 그대로
function setPetLook(pet: PetEls, species: string, sheets: LookSheets | null, zoom: number): void {
  pet.species = species;
  if (!sheets || !pet.canvas) return;
  pet.sheets = sheets;
  pet.shown = "";
  pet.canvas.width = Math.round(sheets.cell.w * zoom);
  pet.canvas.height = Math.round(sheets.cell.h * zoom);
  pet.canvas.style.left = `${Math.round(CELL - pet.canvas.width / 2)}px`;
  pet.canvas.style.top = `${Math.round(CELL - pet.canvas.height / 2)}px`;
  const ctx = pet.canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
  for (const sh of Object.values(sheets.anims)) sheetImage(sh.dataUrl);
  pet.overTop = Math.round(CELL - (sheets.body.h * zoom) / 2 - 14);
  pet.over.style.top = `${pet.overTop}px`;
}

const pct = (v: number): string => `${Math.max(0, Math.min(100, v * 100))}%`;

function draw(view: BattleScreenView): void {
  const myRun = ++run;
  hideBubble();
  frame.beginDraw("right", view.title, "battle-screen");
  const device = frame.device;
  const timeline: Timeline = createTimeline(view);

  // 판 표시 줄 — 걸린 효과 칩(룰렛 결과가 오면 채운다) · 남은 시간 · 배속
  let speed = 1;
  const hud = el("div", "hud");
  const conditions = el("div", "conditions");
  const clock = el("div", "clock", clockText(view.maxMs, 0));
  const speedBox = el("div", "speed");
  const speedButtons = [1, 2].map((s) => {
    // 글자는 x1·x2 (2026-10-10 사용자 "1배, 2배 말고 x1, x2", Figma 02 `Battle HUD` 1920:26)
    const b = buttonEl(s === 1 ? "on" : "", `x${s}`, () => {
      speed = s;
      speedButtons.forEach((x, i) => x.classList.toggle("on", i + 1 === s));
    });
    speedBox.appendChild(b);
    return b;
  });
  // 배속 오른쪽 노트 단추 — 배틀 로그 창을 연다 (docs/specs/adventure.md "배틀 로그", Figma 02 `Battle HUD` `log`)
  const logButton = buttonEl("log-open", undefined, () => api.logOpen());
  logButton.append(noteIconEl());
  logButton.title = "배틀 로그";
  logButton.setAttribute("aria-label", "배틀 로그");
  const right = el("div", "right");
  right.append(speedBox, logButton);
  hud.append(conditions, clock, right);

  // 몸통 — 카드 2×3 · 전장 · 카드 2×3
  const body = el("div", "body");
  const cards: [(CardEls | null)[], (CardEls | null)[]] = [[], []];
  const sideEl = (side: BattleSide): HTMLElement => {
    const box = el("div", "side");
    const grid = el("div", "cards");
    // 상대 카드는 전장 배치대로 2 1 / 4 3 / 6 5 — 상대는 거울로 서고 앞 열(2·4·6)이 가운데 쪽 (2026-10-14 사용자 "배치대로 2,1 4,3 6,5")
    const order = side === 1 ? [1, 0, 3, 2, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const slot of order) {
      const c = cardEl(view.units[side][slot] ?? null, view);
      cards[side][slot] = c;
      grid.appendChild(c ? c.root : el("div", "card empty"));
    }
    box.append(el("div", "side-name", view.sideNames[side]), grid);
    return box;
  };
  // 전장 — 바탕은 board(둥근 모서리로 자름), 포켓몬·연출은 그 위 arena(자르지 않음 — 위쪽 끝의 머리 위 표시·알약이 잘리지 않게). 장애물·처음 자리 표시는 없다(2026-10-09)
  const arena = el("div", "arena");
  const board = el("div", "board");
  arena.appendChild(board);

  // 날씨·필드·오라 연출 층 — 필드는 바닥 위·포켓몬 아래, 날씨·오라는 포켓몬 위·알약 아래 (field-fx.ts)
  const fxUnder = el("div", "field-layer");
  arena.appendChild(fxUnder);
  const pets: [(PetEls | null)[], (PetEls | null)[]] = [[], []];
  for (const side of [0, 1] as const) {
    view.units[side].forEach((u, slot) => {
      if (!u) return;
      const p = petEl(u, view.sprites[u.look] ?? null, view.zoom);
      pets[side][slot] = p;
      arena.appendChild(p.root);
    });
  }
  // 모습 바뀜 — 칸마다 form 이벤트(시각순). t 시점의 모습은 그때까지의 마지막 form, 없으면 처음 모습(되감기에도 맞다)
  const formLog = new Map<string, { t: number; species: string }[]>();
  // 메타몽 변신 — copy 이벤트(from 은 상대 쪽 칸)도 모습 바뀜으로 본다. 그림은 그 상대 칸의 그림 키다(이미 받은 그림)
  // (2026-10-11 사용자 "메타몽 변신안함" — 엔진은 능력치·타입·기술을 따라 했지만 화면은 form 만 보아 그림이 메타몽 그대로였다)
  const copyKey = new Map<string, string>(); // "side:slot" → 따라 한 상대의 그림 키
  for (const e of view.events) {
    if (e.kind === "copy" && e.from >= 0) {
      const src = view.units[e.side === 0 ? 1 : 0][e.from];
      if (!src) continue;
      const key = `${e.side}:${e.slot}`;
      copyKey.set(key, src.look);
      formLog.set(key, [...(formLog.get(key) ?? []), { t: e.t, species: src.species }]);
      continue;
    }
    if (e.kind !== "form") continue;
    const key = `${e.side}:${e.slot}`;
    formLog.set(key, [...(formLog.get(key) ?? []), { t: e.t, species: e.species }]);
  }
  const lookAt = (side: 0 | 1, slot: number, t: number): string | null => {
    const list = formLog.get(`${side}:${slot}`);
    if (!list) return null;
    let shown = view.units[side][slot]?.species ?? null;
    for (const x of list) if (x.t <= t) shown = x.species;
    return shown;
  };
  const statusFx = createStatusFx(arena); // 몸 위 연출 — 포켓몬 위, 날씨·오라 층 아래 (status-fx.ts)
  const fxOver = el("div", "field-layer");
  arena.appendChild(fxOver);
  const fx = el("div", "fx");
  arena.appendChild(fx);
  body.append(sideEl(0), arena, sideEl(1));
  // 아래 DPS 표 — 재생 시각까지의 누적 피해. 값이 바뀔 때만 다시 그린다 (2026-10-12 사용자 "배틀에서의dps표를 화면밑에 확장하자")
  const dpsPanel = el("div", "dps-panel");
  device.append(hud, body, dpsPanel);
  frame.endDraw();

  let dpsKey = "";
  function paintDps(t: number): void {
    const steps = view.damage.steps;
    let lo = 0;
    let hi = steps.length - 1;
    let at = -1; // t 이하의 마지막 단계
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid]!.t <= t) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const step = at >= 0 ? steps[at]! : null;
    const faces = new Map<BattleDpsRow, BattleUnitView>();
    const sides = ([0, 1] as const).map((side) =>
      view.units[side].flatMap((u, slot) => {
        if (!u) return [];
        const fainted = view.damage.faints[side][slot];
        const activeMs = fainted !== null && fainted !== undefined && fainted <= t ? fainted : t;
        const dealt = step?.dealt[side][slot] ?? 0;
        const row: BattleDpsRow = { species: u.species, shiny: false, name: u.name, dealt, taken: step?.taken[side][slot] ?? 0, dps: dpsOf(dealt, activeMs) };
        faces.set(row, u);
        return [row];
      }),
    );
    const key = sides.map((rows) => rows.map((r) => `${r.dealt}/${r.taken}/${r.dps}`).join(",")).join("|");
    if (key === dpsKey) return;
    dpsKey = key;
    const face = (r: BattleDpsRow): HTMLElement => {
      const uri = faces.get(r)?.portrait;
      if (!uri) return el("span", "dps-face");
      const img = document.createElement("img");
      img.className = "dps-face";
      img.src = uri;
      img.alt = "";
      return img;
    };
    // 줄 순서가 그대로면 숫자 글자만 고친다 — 표와 초상을 다시 만들지 않는다 (R4)
    const tables = [...dpsPanel.children] as HTMLElement[];
    if (tables.length === 2 && tables.every((tb, i) => refreshDpsTable(tb, sides[i]!))) return;
    dpsPanel.replaceChildren(dpsTableEl(view.sideNames[0], sides[0]!, face), dpsTableEl(view.sideNames[1], sides[1]!, face));
  }

  // 기술 이름 → 기술 칸 값 (기술 알약)
  const moveById = new Map<string, MoveView>();
  for (const side of view.units) for (const u of side) u?.moves.forEach((m) => moveById.set(m.id, m));

  function paintUnit(side: BattleSide, slot: number, s: UnitState, t: number): void {
    const u = view.units[side][slot];
    if (!u) return;
    const hp = s.maxHp > 0 ? s.hp / s.maxHp : 0;
    const chip = !s.fainted && t < s.chipUntil && s.maxHp > 0 ? s.chipHp / s.maxHp : hp; // 기절하면 깎인 몫을 남기지 않는다
    const card = cards[side][slot];
    if (card) {
      card.hpFill.style.width = pct(hp);
      card.hpChip.style.width = pct(chip);
      const text = s.fainted ? "기절" : `${Math.ceil(hp * 100)}%`;
      if (card.hpText.textContent !== text) card.hpText.textContent = text;
      card.root.classList.toggle("fainted", s.fainted);
      card.root.classList.toggle("acting", !s.fainted && t - s.actAt < TIMELINE_RULES.actMs);
      const g = s.fainted ? 0 : timeline.gauge(s, t);
      card.moves.forEach((m, i) => {
        m.root.classList.toggle("later", i !== s.turn);
        m.fill.style.width = i === s.turn ? pct(g) : "0%";
      });
    }
    const pet = pets[side][slot];
    if (pet) {
      const look = lookAt(side, slot, t);
      if (look && look !== pet.species) setPetLook(pet, look, view.sprites[u.formLooks[look] ?? copyKey.get(`${side}:${slot}`) ?? u.look] ?? null, view.zoom);
      const at = timeline.posOf(s, t);
      pet.root.style.transform = `translate(${at.x * CELL}px, ${at.y * CELL}px)`;
      pet.root.classList.toggle("fainted", s.fainted);
      if (pet.canvas && pet.sheets) {
        const f = spriteFrame(pet.sheets, s, t, view.field.stepMs);
        const key = f ? `${f.anim}|${f.row}|${f.col}` : "";
        if (f && key !== pet.shown) {
          const img = sheetImage(f.sheet.dataUrl);
          const ctx = pet.canvas.getContext("2d");
          if (ctx && img.complete && img.naturalWidth) {
            pet.shown = key;
            ctx.clearRect(0, 0, pet.canvas.width, pet.canvas.height);
            // 칸 가운데에 프레임 가운데를 맞춘다 — 동작마다 프레임 크기가 다르다
            const w = f.sheet.fw * view.zoom;
            const h = f.sheet.fh * view.zoom;
            ctx.drawImage(img, f.col * f.sheet.fw, f.row * f.sheet.fh, f.sheet.fw, f.sheet.fh, Math.round((pet.canvas.width - w) / 2), Math.round((pet.canvas.height - h) / 2), w, h);
          }
        }
      }
      pet.hpFill.style.width = pct(hp);
      pet.hpChip.style.width = pct(chip);
      pet.gauge.style.width = pct(s.fainted ? 0 : timeline.gauge(s, t));
      // 쿨타임 바 — 마비는 노란 마디, 얼음·잠듦은 멈춤 색, 풀죽음은 끝 1초를 회색으로
      const major = s.major && (s.major.until === null || t < s.major.until) ? s.major.kind : null;
      pet.gaugeBar.classList.toggle("slow", major === "paralysis");
      pet.gaugeBar.classList.toggle("held", major === "freeze" || major === "sleep");
      const span = s.gaugeTo !== null ? s.gaugeTo - s.gaugeFrom : 0;
      pet.gaugeTail.style.width = s.gaugeTail > 0 && span > 0 && !s.fainted ? pct(s.gaugeTail / span) : "0%";
      paintTags(pet, s, major, t);
    }
  }

  // 머리 위 칩 — 큰 상태 이상 → 혼란 → 풀죽음 → 능력 변화 → 충전. TAG_MAX 를 넘으면 앞 2개와 +N
  function paintTags(pet: PetEls, s: UnitState, major: BattleStatusKind | null, t: number): void {
    const specs: TagSpec[] = [];
    if (major) specs.push({ key: major, text: STATUS_NAME[major] ?? major, dot: STATUS_COLOR[major] });
    if (s.confused && (s.confused.until === null || t < s.confused.until)) specs.push({ key: "confusion", text: STATUS_NAME.confusion ?? "", dot: STATUS_COLOR.confusion });
    if (s.flinched) specs.push({ key: "flinch", text: STATUS_NAME.flinch ?? "", dot: STATUS_COLOR.flinch });
    for (const c of timeline.statChips(s, t)) {
      specs.push({ key: `s${c.stat}:${c.stage}:${c.from}`, text: STAT_CHIP[c.stat] ?? "", arrow: { text: `${c.stage > 0 ? "▲" : "▼"}${Math.abs(c.stage)}`, up: c.stage > 0 }, ...(c.until !== null ? { left: { from: c.from, until: c.until } } : {}) });
    }
    if (s.charging) specs.push({ key: "charge", text: "충전" });
    const shown = specs.length > TAG_MAX ? [...specs.slice(0, TAG_MAX - 1), { key: `+${specs.length - TAG_MAX + 1}`, text: `+${specs.length - TAG_MAX + 1}` }] : specs;
    const key = shown.map((x) => x.key).join("|");
    if (pet.tags.dataset.key !== key) {
      pet.tags.dataset.key = key;
      pet.lefts = [];
      pet.tags.replaceChildren(
        ...shown.map((x) => {
          const tag = el("span", "tag");
          if (x.dot) {
            const d = el("i", "dot");
            d.style.background = x.dot;
            tag.appendChild(d);
          }
          tag.appendChild(document.createTextNode(x.text));
          if (x.arrow) tag.appendChild(el("span", x.arrow.up ? "up" : "down", x.arrow.text));
          if (x.left) {
            const line = el("i", "left");
            tag.appendChild(line);
            pet.lefts.push({ el: line, ...x.left });
          }
          return tag;
        }),
      );
      pet.chips = shown.length;
    }
    for (const l of pet.lefts) l.el.style.width = pct(1 - (t - l.from) / Math.max(1, l.until - l.from));
  }

  // 연출 — 기술·특성 알약은 그 포켓몬 위에, 피해 숫자는 맞은 포켓몬 위에서 떠오르며 사라진다
  // 칩이 있으면 칩 줄 위로, 특성 알약이 떠 있으면 그 위로 올린다
  const CHIP_LIFT = 16;
  const PILL_LIFT = 17;
  // 떠 있는 연출 — 타임라인 항목(같은 판 동안 같은 객체)마다 요소 하나. 프레임마다 새로 만들지 않고 자리·투명도만 고친다.
  // 새로 만든 타입 아이콘 img 가 디코드 전에 비어 보이지 않게 한다 (worklog/records/perf-refactor 4-5, G39-1·G53-1, R4)
  const fxEls = new Map<object, HTMLElement>();
  function paintFx(t: number, state: ReturnType<Timeline["seek"]>): void {
    const live = new Set<object>();
    const order: HTMLElement[] = []; // 겹침 순서 — 예전처럼 기술 알약 → 특성 → 피해 숫자 차례
    const fxEl = (item: object, make: () => HTMLElement): HTMLElement => {
      live.add(item);
      let n = fxEls.get(item);
      if (!n) {
        n = make();
        fxEls.set(item, n);
      }
      order.push(n);
      return n;
    };
    const abilities = timeline.abilities(t);
    const head = (side: BattleSide, slot: number): { x: number; y: number; pill: number } | null => {
      const s = state.units[side][slot];
      if (!s) return null;
      const at = timeline.posOf(s, t);
      const pet = pets[side][slot];
      const chips = pet?.chips ? CHIP_LIFT : 0;
      const pill = abilities.some((a) => a.side === side && a.slot === slot) ? PILL_LIFT : 0;
      // 머리 위 표시 윗변 — 그림이 큰 종은 더 높다. 칩이 있으면 칩 줄 위
      return { x: at.x * CELL + CELL, y: at.y * CELL + Math.min(-10, (pet?.overTop ?? 0) - 2) - chips, pill };
    };
    for (const c of timeline.casts(t)) {
      const m = moveById.get(c.move);
      const h = head(c.side, c.slot);
      if (!m || !h) continue;
      const pill = fxEl(c, () => {
        const made = movePillEl(m, "small", view.typeIcons[m.typeId] ?? null);
        made.classList.add("cast");
        return made;
      });
      pill.style.left = `${h.x}px`;
      pill.style.top = `${h.y - 22}px`;
    }
    for (const a of abilities) {
      const h = head(a.side, a.slot);
      if (!h) continue;
      const k = (t - a.t) / TIMELINE_RULES.abilityMs;
      const pill = fxEl(a, () => el("div", "ability", a.name));
      pill.style.left = `${h.x + (k < 0.15 ? (1 - k / 0.15) * (a.side === 0 ? -14 : 14) : 0)}px`;
      pill.style.top = `${h.y - 22}px`;
      pill.style.opacity = String(k < 0.12 ? k / 0.12 : k > 0.8 ? (1 - k) / 0.2 : 1);
    }
    for (const p of timeline.pops(t)) {
      const h = head(p.side, p.slot);
      if (!h) continue;
      const k = (t - p.t) / TIMELINE_RULES.popMs;
      const n = fxEl(p, () => {
        const made = el("div", `pop ${p.kind}`);
        if (p.label) made.appendChild(el("span", "label", p.label));
        made.appendChild(document.createTextNode(p.text));
        if (p.status) made.style.setProperty("--st", STATUS_COLOR[p.status] ?? "");
        return made;
      });
      n.style.left = `${h.x}px`;
      n.style.top = `${h.y - h.pill - (p.kind === "super" ? 34 : 20) - (p.label ? 12 : 0) - k * 16}px`;
      n.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    // 수명이 끝난 연출을 걷고, 차례가 어긋난 요소만 제자리에 끼운다 — 떠 있는 요소는 다시 붙이지 않는다
    for (const [item, n] of [...fxEls]) {
      if (live.has(item)) continue;
      n.remove();
      fxEls.delete(item);
    }
    order.forEach((n, i) => {
      const here = fx.children[i];
      if (here !== n) fx.insertBefore(n, here ?? null);
    });
  }

  // 몸 위 연출 — 걸려 있는 동안과 순간(걸림·5초 판정·풀림·능력 꺾쇠). 움직임 줄이기면 그리지 않는다
  function paintStatus(t: number, state: ReturnType<Timeline["seek"]>): void {
    if (stillFx) return;
    const units: StatusFxUnit[] = [];
    // 몸 가운데와 반높이 — 머리 위 표시는 몸 윗변 14px 위에 있다(petEl overTop)
    const center = (side: BattleSide, slot: number): { x: number; y: number; r: number } | null => {
      const s = state.units[side][slot];
      if (!s) return null;
      const at = timeline.posOf(s, t);
      const top = (pets[side][slot]?.overTop ?? -6) + 14;
      return { x: at.x * CELL + CELL, y: at.y * CELL + CELL, r: Math.max(13, CELL - top) };
    };
    for (const side of [0, 1] as const) {
      state.units[side].forEach((s, slot) => {
        if (!s || s.fainted) return;
        const c = center(side, slot);
        if (!c) return;
        const major = s.major && (s.major.until === null || t < s.major.until) ? s.major : null;
        const confused = !!s.confused && (s.confused.until === null || t < s.confused.until);
        if (!major && !confused && !s.flinched) return;
        units.push({ ...c, major: major?.kind ?? null, majorAt: major?.at ?? 0, confused, flinched: s.flinched });
      });
    }
    const marks: StatusFxMark[] = [];
    for (const m of timeline.marks(t)) {
      const c = center(m.side, m.slot);
      if (c) marks.push({ ...c, kind: m.kind, status: m.status, t: m.t });
    }
    statusFx.draw(t, units, marks, TIMELINE_RULES.markMs);
  }

  function showResult(): void {
    const scrim = el("div", "result-scrim");
    const box = el("div", "result");
    const ok = buttonEl("r-ok", view.result.confirm, () => api.close());
    const foot = el("div", "r-foot");
    foot.appendChild(ok);
    // 보상 줄·안내 줄이 없는 판(친선 배틀)은 그 줄을 두지 않는다
    box.append(el("div", "r-title", view.result.title), ...(view.result.lead ? [el("div", "r-lead", view.result.lead)] : []), ...(view.result.detail ? [el("div", "r-detail", view.result.detail)] : []), foot);
    scrim.appendChild(box);
    device.appendChild(scrim);
    ok.focus();
  }

  // 룰렛 — 엔진이 룰렛을 준 판만. 다 멈추면 패널을 지우고 판 표시 줄에 걸린 효과 칩을 둔다
  // 도는 릴이 하나도 없으면 패널 없이 바로 시작한다 — 칩과 전장 연출이 처음부터 걸려 있다
  const reels = view.roulette;
  const spinning = (reels ?? []).some(reelSpins);
  const rouletteStart = performance.now() + START_DELAY_MS;
  let roulette: { panel: HTMLElement; els: ReelEls[] } | null = null;
  if (reels && spinning) {
    roulette = roulettePanel(view, reels);
    arena.appendChild(roulette.panel);
    for (const r of roulette.els) paintReel(r, view, 0);
  }
  // 룰렛이 멈춘 뒤 판이 끝날 때까지 — OS 움직임 줄이기가 켜져 있으면 한 장면만 그리고 멈춘다
  let fieldFx: FieldFx | null = null;
  const stillFx = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const kindOf = (key: BattleRouletteView["key"]): string | null => reels?.find((r) => r.key === key)?.kind ?? null;
  const finishRoulette = (): void => {
    roulette?.panel.remove();
    roulette = null;
    conditions.replaceChildren(...(reels ?? []).map((r) => conditionEl(r, view)).filter((c): c is HTMLElement => c !== null));
    if (reels) {
      fieldFx = createFieldFx(fxUnder, fxOver, { weather: kindOf("weather"), field: kindOf("field"), aura: kindOf("aura") });
      if (stillFx) fieldFx?.draw(2000);
    }
  };
  if (reels && !spinning) finishRoulette();

  // 재생 — 프레임마다 흐른 시간 × 배속만큼 판 시계를 민다
  let t = 0;
  let last = rouletteStart + (reels && spinning ? rouletteMs(reels) : 0);
  let resultShown = false;
  let paintedAt = -1; // 마지막으로 칠한 판 시각
  // 배틀 로그 — 재생 시각까지의 줄 수를 메인에 알린다. 바뀔 때만 보낸다
  let logShown = -1;
  let logIndex = 0;
  const sendLog = (shown: number): void => {
    while (logIndex < view.log.length && view.log[logIndex]!.t <= shown) logIndex++;
    if (logIndex === logShown) return;
    logShown = logIndex;
    api.logAt(logIndex);
  };
  const tick = (now: number): void => {
    if (myRun !== run) return;
    if (roulette) {
      const elapsed = now - rouletteStart;
      for (const r of roulette.els) paintReel(r, view, Math.max(0, elapsed));
      if (reels && elapsed >= rouletteMs(reels)) finishRoulette();
    }
    if (now > last) {
      t = Math.min(view.endMs + RESULT_DELAY_MS, t + (now - last) * speed);
      last = now;
    }
    const shown = Math.min(t, view.endMs);
    // 판 시계가 끝에 멈춘 뒤(결과를 기다리거나 결과가 뜬 동안)는 같은 값이다 — 다시 칠하지 않는다 (worklog/records/perf-refactor 4-5, G39-4)
    if (shown >= view.endMs && paintedAt === shown) {
      if (t >= view.endMs + RESULT_DELAY_MS && !resultShown) {
        resultShown = true;
        showResult();
      }
      requestAnimationFrame(tick);
      return;
    }
    paintedAt = shown;
    const state = timeline.seek(shown);
    for (const side of [0, 1] as const) state.units[side].forEach((s, slot) => s && paintUnit(side, slot, s, shown));
    paintStatus(shown, state);
    paintFx(shown, state);
    paintDps(shown);
    sendLog(shown);
    if (fieldFx && !stillFx) fieldFx.draw(shown);
    const c = clockText(view.maxMs, shown);
    if (clock.textContent !== c) clock.textContent = c;
    if (t >= view.endMs + RESULT_DELAY_MS && !resultShown) {
      resultShown = true;
      showResult();
    }
    requestAnimationFrame(tick);
  };
  // 첫 자리를 그린 뒤 시작한다
  const first = timeline.seek(0);
  for (const side of [0, 1] as const) first.units[side].forEach((s, slot) => s && paintUnit(side, slot, s, 0));
  paintDps(0);
  requestAnimationFrame(tick);
}

// 준비 중 — 판을 받기 전. 머리 줄 제목과 가운데 `배틀을 준비하고 있어요` + 처리 중 점 셋. 판이 오면 draw 가 같은 창을 바꾼다
// (2026-10-10 사용자 "포켓몬들사라지고 로딩하고 배틀시작으로", Figma 04 `Battle Loading`, 05 `Battle / Window · 준비 중`)
function drawLoading(title: string): void {
  run += 1; // 지난 재생을 멈춘다
  hideBubble();
  frame.beginDraw("right", title, "battle-screen");
  const box = el("div", "bs-loading");
  box.setAttribute("role", "status");
  box.append(el("strong", undefined, "배틀을 준비하고 있어요"), el("span", "bs-loading-dots"));
  frame.device.appendChild(box);
  frame.endDraw();
}

frame.showWith<BattleScreenView>((cb) => api.onShow(cb), draw);
frame.showWith<string>((cb) => api.onLoading(cb), drawLoading);
api.ready();
