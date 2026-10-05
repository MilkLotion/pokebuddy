// 상품 기기 창의 화면 — 상점(shop.ts)·가방(bag.ts)이 같은 화면을 그린다 (Figma 05 `Shop / Device / …`·`Bag / Device / …`).
// 틀(머리·바닥·높이 알림)은 device-frame.ts. 여기는 화면(머리 줄·그림·분류·둘째 줄·설명), 정보 줄(효과·쓰는 곳), 가운데 조작 칸, 바닥(◀ 이전 · 주 단추 · 다음 ▶)

import { spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { numberText } from "../../shared/count-text.js";
import type { DeviceFrame } from "./device-frame.js";

export interface ItemFace {
  side: "right" | "left";
  title: string; // 머리 — 상점 · 가방
  kind: string;
  name: string;
  state: string;
  group: string;
  art: string | null;
  spec: [string, string][];
  desc: string;
  rows: [string, string][];
  link?: { label: string; value: string } | null; // 정보 줄 아래의 누르는 줄 — 상점 기기 창의 `나오는 포켓몬`
}

// 이름·값 줄 묶음 — 줄마다 `key` 칸과 값 칸
export function pairsEl(cls: string, rows: readonly (readonly [string, string])[], valueCls?: string): HTMLElement {
  const box = el("div", cls);
  for (const [key, value] of rows) {
    const row = el("div");
    row.append(el("span", "key", key), el("span", valueCls, value));
    box.appendChild(row);
  }
  return box;
}

// 그림 자리 — 150×124. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 4배)로 그린다 (ui/portrait.ts spriteCanvas). 도구 그림은 작아서 배율만 크고, 배율은 96 변에 맞춘다
const STAGE = { w: 150, h: 124, maxScale: 4, maxSide: 96 };

// 틀 안에 상품 화면을 그린다 — 머리 줄부터 바닥 줄까지, 끝에 높이를 알린다
export function drawItemFace(frame: DeviceFrame, face: ItemFace, middle: HTMLElement, go: HTMLButtonElement, onLink?: () => void): void {
  const device = frame.device;
  frame.beginDraw(face.side, face.title);

  // 화면 — 머리 줄(종류·이름·상태), 그림, 분류·둘째 줄, 설명
  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  const bar = el("div", "bar");
  bar.append(el("span", undefined, face.kind), el("span", undefined, face.name), el("span", "state", face.state));
  screen.appendChild(bar);
  const entry = el("div", "entry");
  const stage = el("div", "stage");
  if (face.art) stage.appendChild(spriteCanvas(face.art, STAGE));
  entry.appendChild(stage);
  const info = el("div", "info");
  info.append(el("div", undefined, face.group || " "), pairsEl("measure", face.spec));
  entry.appendChild(info);
  screen.appendChild(entry);
  if (face.desc) screen.appendChild(el("div", "flavor", face.desc));
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 정보 줄 — 효과·쓰는 곳 두 줄 (2026-10-01 사용자 결정)
  const records = pairsEl("records", face.rows, "value");
  // 누르는 줄 — 같은 판 안의 셋째 줄. 글자 끝의 `›` 가 누를 수 있음을 알린다 (Figma 03 `Shop Device` `row/나오는 포켓몬`)
  if (face.link && onLink) {
    const more = buttonEl("more", "", onLink);
    more.append(el("span", "key", face.link.label), el("span", "value", `${face.link.value} ›`));
    records.appendChild(more);
  }
  device.appendChild(records);
  device.appendChild(middle);
  device.appendChild(frame.controlsEl(go));
  frame.endDraw();
}

// 수량 줄 — − · 수 · + · 최대 · 안내
// 수량 칸 — 숫자를 눌러 직접 적을 수 있다. Enter·칸 밖으로 나가면 1~최대로 맞춰 보낸다. Esc 는 적던 것을 버린다
// 기기 창은 새 보기마다 통째로 다시 그린다 — 적는 중이면 그 글자와 초점을 새 칸에 옮긴다 (한 창에 수량 칸은 하나다)
let qtyDraft: string | null = null;
export function qtyRowEl(q: { count: number; cap: number; hint: string }, set: (qty: number) => void, off = false): HTMLElement {
  const minus = buttonEl("", "−", () => set(q.count - 1));
  minus.disabled = off || q.count <= 1;
  const plus = buttonEl("", "+", () => set(q.count + 1));
  plus.disabled = off || q.count >= q.cap;
  const max = buttonEl("max", "최대", () => set(q.cap));
  max.disabled = off || q.count >= q.cap;
  const count = document.createElement("input");
  count.className = "count";
  count.type = "text";
  count.inputMode = "numeric";
  count.setAttribute("aria-label", "수량");
  count.disabled = off;
  count.value = qtyDraft ?? numberText(q.count);
  const commit = (): void => {
    if (qtyDraft === null) return;
    const n = Number.parseInt(qtyDraft.replace(/[^0-9]/g, ""), 10);
    qtyDraft = null;
    const next = Number.isFinite(n) ? Math.min(Math.max(n, 1), Math.max(q.cap, 1)) : q.count;
    count.value = numberText(next);
    if (next !== q.count) set(next);
  };
  // 눌러서 들어오면 숫자를 통째로 골라 바로 새로 적게 한다. 다시 그린 칸으로 넘어온 초점은 적던 자리 그대로다
  // 밖에서 눌러 들어오면 숫자를 통째로 골라 바로 새로 적게 한다. 이미 적는 중에 누르면 커서만 옮긴다
  let wasIn = false;
  count.addEventListener("mousedown", () => {
    wasIn = document.activeElement === count;
  });
  count.addEventListener("click", () => {
    if (!wasIn && qtyDraft === null) count.select();
  });
  count.addEventListener("input", () => {
    count.value = count.value.replace(/[^0-9]/g, "");
    qtyDraft = count.value;
  });
  count.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
      count.blur();
    } else if (e.key === "Escape") {
      qtyDraft = null;
      count.value = numberText(q.count);
      count.blur();
    }
  });
  count.addEventListener("blur", () => {
    if (count.isConnected) commit(); // 다시 그리느라 떼어 낸 칸은 적던 것을 새 칸으로 넘긴다
  });
  if (qtyDraft !== null && !off) {
    queueMicrotask(() => {
      if (!count.isConnected) return;
      count.focus();
      count.setSelectionRange(count.value.length, count.value.length);
    });
  } else qtyDraft = null;
  const row = el("div", "qty");
  row.append(minus, count, plus, max, el("span", "hint", q.hint));
  return row;
}

// 결과 상자 — 상점 합계·가방 미리보기·결과·실패를 같은 자리에서 글자와 색만 바꿔 보인다 (docs/specs/ui-components.md "결과·실패 표시").
// 늘 두 줄 높이다. 둘째 줄이 없어도 자리를 두고, 길면 한 줄에서 말줄임하고 전체는 가리키면 보인다 (2026-10-05 사용자 "고정시켜줘")
export function totalBoxEl(v: { lead: string; line: string; tone: "" | "ok" | "bad" | "warn" }): HTMLElement {
  const box = el("div", v.tone ? `total ${v.tone}` : "total");
  const lead = el("strong", undefined, v.lead);
  const line = el("div", "line", v.line);
  if (v.lead) lead.title = v.lead;
  if (v.line) line.title = v.line;
  box.append(lead, line);
  return box;
}

// 바닥 가운데 주 단추 — 처리 중이면 글자 대신 점 세 개(폭 그대로)
export function goButtonEl(label: string, disabled: boolean, busy: boolean, onClick: () => void): HTMLButtonElement {
  const go = buttonEl("go", label, onClick);
  go.disabled = disabled || busy;
  go.classList.toggle("is-busy", busy);
  return go;
}
