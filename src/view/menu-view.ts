// 메뉴 창의 표현 — 메뉴 모델(MenuItemConstructorOptions 모양) → 메뉴 창이 그리는 모양(MenuView), 고른 번호 → 모델의 항목.
// view/menus.ts 와 다른 점: 그쪽은 "무슨 항목이 있나"(포켓몬 메뉴·트레이·점프 목록의 모델)를 만들고, 이 파일은 그 모델을 메뉴 창
// (src/main/menus/menu-window.ts)이 그릴 모양으로 바꾸고 고른 번호를 항목으로 되돌린다. Electron 을 값으로 가져오지 않는다 (node 시험 가능)
// (예전 src/main/menus.ts. 메인 레인 M8-3 에서 화면 값으로 옮겼다)
import type { MenuItemConstructorOptions } from "electron";
import type { MenuSubView, MenuView } from "../shared/model/overlays";

// 메뉴 모델 → 화면 모양. 체크 항목은 켜졌을 때 오른쪽에 `켜짐` 을 붙인다. 글이 없는 항목은 뺀다.
// 누를 수 없고 동작도 없는 항목은 상태 줄이다 — sublabel 을 둘째 줄로 보인다. 누르는 항목의 sublabel 은 오른쪽 짧은 글이다.
// 하위 줄이 있는 항목은 말풍선(sub)을 단다. 하위 줄의 번호는 subId 로 만든다 — 메뉴 창이 그 번호로 동작을 찾는다 (pickOf)
const SUB_BASE = 1000;
export const subId = (parent: number, row: number): number => (parent + 1) * SUB_BASE + row;
// 고른 번호 → 모델의 항목. 하위 줄 번호면 그 줄을 준다
export function pickOf(template: MenuItemConstructorOptions[], id: number): MenuItemConstructorOptions | undefined {
  if (id < SUB_BASE) return template[id];
  const rows = template[Math.floor(id / SUB_BASE) - 1]?.submenu;
  return Array.isArray(rows) ? rows[id % SUB_BASE] : undefined;
}
function subView(parent: number, m: MenuItemConstructorOptions): MenuSubView | null {
  if (!Array.isArray(m.submenu) || !m.submenu.length) return null;
  return {
    title: m.toolTip ?? m.label ?? "",
    rows: m.submenu.map((row, i) => ({
      id: subId(parent, i),
      label: row.label ?? "",
      note: row.sublabel ?? "",
      current: row.enabled === false,
      ...(typeof row.icon === "string" ? { icon: row.icon } : {}),
    })),
  };
}
export function menuView(template: MenuItemConstructorOptions[], on: string): MenuView[] {
  const out: MenuView[] = [];
  template.forEach((m, id) => {
    if (m.type === "separator") {
      // 맨 앞·연속 구분선은 두지 않는다
      if (out.length && out[out.length - 1]?.kind !== "separator") out.push({ kind: "separator" });
      return;
    }
    if (!m.label || m.visible === false) return;
    const sub = subView(id, m);
    if (m.enabled === false && !m.click && !sub) {
      out.push({ kind: "status", title: m.label, ...(m.sublabel ? { caption: m.sublabel } : {}) });
      return;
    }
    const hint = m.type === "checkbox" && m.checked ? on : m.sublabel || undefined;
    out.push({ kind: "item", id, label: m.label, disabled: m.enabled === false || (!m.click && !sub), ...(hint ? { hint } : {}), ...(sub ? { sub } : {}) });
  });
  while (out.length && out[out.length - 1]?.kind === "separator") out.pop();
  return out;
}
