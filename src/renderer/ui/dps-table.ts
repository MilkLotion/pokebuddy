// DPS 표 — 한쪽 파티의 포켓몬별 준 피해·DPS·받은 피해. DPS 높은 순으로 1~3등은 왼쪽, 4~6등은 오른쪽 열이다. 모양은 styles/dps-table.css
// 배틀 창 아래 표(실시간)와 설정창 배틀 상세가 같이 쓴다 (docs/specs/adventure.md "DPS 표", Figma 03 `Battle DPS Table` 1959:20)
// 줄이 6개보다 적어도 빈 줄로 채워 표 높이가 바뀌지 않는다
import { numText, sortDps } from "../../shared/battle-record-text.js";
import type { BattleDpsRow } from "../../shared/model/battle-net.js";
import { el } from "./dom.js";

const COL = 3;

function headEl(): HTMLElement {
  const row = el("div", "dps-row dps-head");
  row.append(el("span", "dps-pic"), el("span", "dps-name", "포켓몬"), el("span", "dps-num", "준 피해"), el("span", "dps-num dps", "DPS"), el("span", "dps-num taken", "받은 피해"));
  return row;
}

function rowEl(r: BattleDpsRow | undefined, portrait: (r: BattleDpsRow) => HTMLElement): HTMLElement {
  const row = el("div", r ? "dps-row" : "dps-row empty");
  if (!r) return row;
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
