// DPS 표 — 한쪽 파티의 포켓몬별 준 피해·DPS·받은 피해. DPS 높은 순으로 1~3등은 왼쪽, 4~6등은 오른쪽 열이다. 모양은 styles/dps-table.css
// 배틀 창 아래 표(실시간)와 설정창 배틀 상세가 같이 쓴다 (docs/specs/adventure.md "DPS 표", Figma 03 `Battle DPS Table` 1959:20)
// 줄이 6개보다 적어도 빈 줄로 채워 표 높이가 바뀌지 않는다
import { numText, sortDps } from "../../shared/battle-record-text.js";
import type { BattleDpsRow } from "../../shared/model/battle-net.js";
import { el } from "./dom.js";

const COL = 3;
const rowKey = (r: BattleDpsRow): string => `${r.species}|${r.shiny ? 1 : 0}|${r.name}`;

function headEl(): HTMLElement {
  const row = el("div", "dps-row dps-head");
  row.append(el("span", "dps-pic"), el("span", "dps-name", "포켓몬"), el("span", "dps-num", "준 피해"), el("span", "dps-num dps", "DPS"), el("span", "dps-num taken", "받은 피해"));
  return row;
}

function rowEl(r: BattleDpsRow | undefined, portrait: (r: BattleDpsRow) => HTMLElement): HTMLElement {
  const row = el("div", r ? "dps-row" : "dps-row empty");
  if (!r) return row;
  row.dataset.key = rowKey(r);
  const pic = el("span", "dps-pic");
  pic.appendChild(portrait(r));
  row.append(pic, el("span", "dps-name", r.name), el("span", "dps-num", numText(r.dealt)), el("span", "dps-num dps", numText(r.dps)), el("span", "dps-num taken", numText(r.taken)));
  return row;
}

// title — `나`·`상대 · 지우`. portrait — 창마다 초상을 만드는 방법(배틀 창은 받은 그림, 설정창은 art-cache)
export function dpsTableEl(title: string, rows: readonly BattleDpsRow[], portrait: (r: BattleDpsRow) => HTMLElement): HTMLElement {
  const sorted = sortDps(rows);
  const table = el("div", "dps-table");
  const cols = el("div", "dps-cols");
  for (let c = 0; c < 2; c++) {
    const col = el("div", "dps-col");
    col.appendChild(headEl());
    for (let i = 0; i < COL; i++) col.appendChild(rowEl(sorted[c * COL + i], portrait));
    cols.appendChild(col);
  }
  table.append(el("div", "dps-side", title), cols);
  return table;
}

// 그린 표를 고친다 — 같은 포켓몬들이면 줄 요소를 DPS 순서대로 옮기고 숫자 글자만 바꾼다. 포켓몬이 다르면 false(부르는 쪽이 다시 만든다).
// 실시간 표는 숫자와 순위가 거의 매 프레임 바뀐다 — 표와 초상을 다시 만들지 않아 초상이 비지 않는다 (worklog/records/perf-refactor 4-5, G39-2·G58-1)
export function refreshDpsTable(table: HTMLElement, rows: readonly BattleDpsRow[]): boolean {
  const sorted = sortDps(rows);
  const cols = [...table.querySelectorAll<HTMLElement>(".dps-col")];
  const shown = [...table.querySelectorAll<HTMLElement>(".dps-row:not(.dps-head)")];
  if (cols.length !== 2 || shown.length !== COL * 2) return false;
  const byKey = new Map(shown.filter((r) => r.dataset.key).map((r) => [r.dataset.key!, r]));
  const empties = shown.filter((r) => !r.dataset.key);
  if (byKey.size !== sorted.length || sorted.some((r) => !byKey.has(rowKey(r)))) return false;
  const seq = Array.from({ length: COL * 2 }, (_, i) => {
    const r = sorted[i];
    return r ? byKey.get(rowKey(r))! : empties.shift()!;
  });
  seq.forEach((row, i) => {
    const col = cols[Math.floor(i / COL)]!;
    const at = col.children[1 + (i % COL)]; // 0 번은 머리 줄
    if (at !== row) col.insertBefore(row, at ?? null);
    const r = sorted[i];
    if (!r) return;
    const nums = row.querySelectorAll<HTMLElement>(".dps-num");
    [r.dealt, r.dps, r.taken].forEach((v, k) => {
      const text = numText(v);
      const cell = nums[k];
      if (cell && cell.textContent !== text) cell.textContent = text;
    });
  });
  return true;
}
