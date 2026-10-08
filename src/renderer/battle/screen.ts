// 배틀 창 — 메인이 보낸 판(BattleScreenView)을 시간대로 재생한다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// - 머리 줄(상태 등·LED·제목·✕)과 Esc 닫기는 기기 창 틀(device-frame.ts)을 쓴다. 설정창에 붙지 않아 ◀▶ 넘기기는 없다
// - 재생 계산은 src/shared/battle-timeline.ts. 여기서는 그 상태를 DOM 에 옮긴다. 판 하나의 DOM 은 처음 한 번 만들고 프레임마다 값만 바꾼다
import type { BattleScreenView, BattleSide, BattleUnitView } from "../../shared/model/battle-screen.js";
import type { MoveView } from "../../shared/model/snapshot.js";
import { TIMELINE_RULES, clockText, createTimeline, spriteFrame, type Timeline, type UnitState } from "../../shared/battle-timeline.js";
import type { LookSheets } from "../../shared/model/stage.js";
import { createDeviceFrame } from "../device/device-frame.js";
import { needBridge } from "../ui/bridge.js";
import { buttonEl, el } from "../ui/dom.js";
import { DEVICE_FONTS } from "../ui/fonts.js";
import { movePillEl } from "../ui/move-pill.js";

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
  tags: HTMLElement;
}

let run = 0; // 판 번호 — 새 판이 오면 지난 재생을 멈춘다

function typeIconEl(type: string, icons: BattleScreenView["typeIcons"]): HTMLElement {
  const box = el("span", "type-icon");
  box.dataset.type = type;
  const uri = icons[type];
  if (uri) {
    const img = document.createElement("img");
    img.src = uri;
    img.alt = "";
    img.draggable = false;
    box.appendChild(img);
  }
  return box;
}

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
  for (const t of u.types) types.appendChild(typeIconEl(t, view.typeIcons));
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
    const icon = typeIconEl(m.typeId, view.typeIcons);
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
  over.append(tags, hp.root, gauge.root);
  over.style.top = `${overTop}px`;
  root.appendChild(over);
  return { root, canvas, sheets, shown: "", hpFill: hp.fill, hpChip: hp.chip, gauge: gauge.fill, tags };
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
    const b = buttonEl(s === 1 ? "on" : "", `${s}배`, () => {
      speed = s;
      speedButtons.forEach((x, i) => x.classList.toggle("on", i + 1 === s));
    });
    speedBox.appendChild(b);
    return b;
  });
  hud.append(conditions, clock, speedBox);

  // 몸통 — 카드 2×3 · 전장 · 카드 2×3
  const body = el("div", "body");
  const cards: [(CardEls | null)[], (CardEls | null)[]] = [[], []];
  const sideEl = (side: BattleSide): HTMLElement => {
    const box = el("div", "side");
    const grid = el("div", "cards");
    for (let slot = 0; slot < 6; slot++) {
      const c = cardEl(view.units[side][slot] ?? null, view);
      cards[side][slot] = c;
      grid.appendChild(c ? c.root : el("div", "card empty"));
    }
    box.append(el("div", "side-name", view.sideNames[side]), grid);
    return box;
  };
  // 전장 — 바탕·장애물은 board(둥근 모서리로 자름), 포켓몬·연출은 그 위 arena(자르지 않음 — 위쪽 끝의 머리 위 표시·알약이 잘리지 않게)
  const arena = el("div", "arena");
  const board = el("div", "board");
  arena.appendChild(board);
  board.append(el("div", "zone mine"), el("div", "zone opp"));
  const start = view.events.find((e) => e.kind === "start");
  if (start && start.kind === "start") {
    for (const o of start.obstacles) {
      const ob = el("div", "obstacle");
      ob.style.left = `${o.x * CELL}px`;
      ob.style.top = `${o.y * CELL}px`;
      ob.style.width = ob.style.height = `${o.size * CELL}px`;
      board.appendChild(ob);
    }
  }
  const pets: [(PetEls | null)[], (PetEls | null)[]] = [[], []];
  for (const side of [0, 1] as const) {
    view.units[side].forEach((u, slot) => {
      if (!u) return;
      const p = petEl(u, view.sprites[u.species] ?? null, view.zoom);
      pets[side][slot] = p;
      arena.appendChild(p.root);
    });
  }
  const fx = el("div", "fx");
  arena.appendChild(fx);
  body.append(sideEl(0), arena, sideEl(1));
  device.append(hud, body);
  frame.endDraw();

  // 기술 이름 → 기술 칸 값 (기술 알약)
  const moveById = new Map<string, MoveView>();
  for (const side of view.units) for (const u of side) u?.moves.forEach((m) => moveById.set(m.id, m));

  function paintUnit(side: BattleSide, slot: number, s: UnitState, t: number): void {
    const u = view.units[side][slot];
    if (!u) return;
    const hp = u.maxHp > 0 ? s.hp / u.maxHp : 0;
    const chip = !s.fainted && t < s.chipUntil && u.maxHp > 0 ? s.chipHp / u.maxHp : hp; // 기절하면 깎인 몫을 남기지 않는다
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
      const tags: string[] = [];
      if (s.stat && t < s.stat.until) tags.push(`${s.stat.stage > 0 ? "▲" : "▼"}${Math.abs(s.stat.stage)}`);
      if (s.charging) tags.push("충전");
      const key = tags.join("|");
      if (pet.tags.dataset.key !== key) {
        pet.tags.dataset.key = key;
        pet.tags.replaceChildren(...tags.map((x) => el("span", "tag", x)));
      }
    }
  }

  // 연출 — 기술 알약은 그 포켓몬 위에, 피해 숫자는 맞은 포켓몬 위에서 떠오르며 사라진다
  function paintFx(t: number, state: ReturnType<Timeline["seek"]>): void {
    const nodes: HTMLElement[] = [];
    const head = (side: BattleSide, slot: number): { x: number; y: number } | null => {
      const s = state.units[side][slot];
      if (!s) return null;
      const at = timeline.posOf(s, t);
      return { x: at.x * CELL + CELL, y: at.y * CELL - 10 };
    };
    for (const c of timeline.casts(t)) {
      const m = moveById.get(c.move);
      const h = head(c.side, c.slot);
      if (!m || !h) continue;
      const pill = movePillEl(m, "small", view.typeIcons[m.typeId] ?? null);
      pill.classList.add("cast");
      pill.style.left = `${h.x}px`;
      pill.style.top = `${h.y - 22}px`;
      nodes.push(pill);
    }
    for (const p of timeline.pops(t)) {
      const h = head(p.side, p.slot);
      if (!h) continue;
      const k = (t - p.t) / TIMELINE_RULES.popMs;
      const n = el("div", `pop ${p.kind}`, p.text);
      n.style.left = `${h.x}px`;
      n.style.top = `${h.y - (p.kind === "super" ? 34 : 20) - k * 16}px`;
      n.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
      nodes.push(n);
    }
    fx.replaceChildren(...nodes);
  }

  function showResult(): void {
    const scrim = el("div", "result-scrim");
    const box = el("div", "result");
    const ok = buttonEl("r-ok", view.result.confirm, () => api.close());
    const foot = el("div", "r-foot");
    foot.appendChild(ok);
    box.append(el("div", "r-title", view.result.title), el("div", "r-lead", view.result.lead), el("div", "r-detail", view.result.detail), foot);
    scrim.appendChild(box);
    device.appendChild(scrim);
    ok.focus();
  }

  // 재생 — 프레임마다 흐른 시간 × 배속만큼 판 시계를 민다
  let t = 0;
  let last = performance.now() + START_DELAY_MS;
  let resultShown = false;
  const tick = (now: number): void => {
    if (myRun !== run) return;
    if (now > last) {
      t = Math.min(view.endMs + RESULT_DELAY_MS, t + (now - last) * speed);
      last = now;
    }
    const state = timeline.seek(Math.min(t, view.endMs));
    const shown = Math.min(t, view.endMs);
    for (const side of [0, 1] as const) state.units[side].forEach((s, slot) => s && paintUnit(side, slot, s, shown));
    paintFx(shown, state);
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
  requestAnimationFrame(tick);
}

frame.showWith<BattleScreenView>((cb) => api.onShow(cb), draw);
api.ready();
