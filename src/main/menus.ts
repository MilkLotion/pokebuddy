// 우클릭·트레이 메뉴의 항목 — Electron 을 import 하지 않고 MenuItemConstructorOptions 모양의 객체만 돌려준다 (node 시험 가능).
// 문구는 언어 파일(lib/i18n)에서. 호칭(펫·동반자)은 쓰지 않고 동사만 (사용자 결정 2026-09-17).
// 우클릭 = 이름·상태 / 밥 주기·놀아주기 / 설정창 열기 세 묶음 (docs/specs/game.md 2026-09-24 전환)
// 클릭 통과는 트레이와 관리 창 설정에 — 켜면 펫을 우클릭할 수 없어 우클릭 메뉴에 있어도 끌 수 없다
import type { MenuItemConstructorOptions } from "electron";
import type { MenuSubView, MenuView } from "../shared/manage";
import { NATURE_SHOWN } from "../dex/natures";
import { t } from "./text";

export interface PetMenuModel {
  name: string;
  nature: string | null; // 성격의 화면 이름 — 세션 샌드박스 펫처럼 없으면 이름만
  status?: string;
  feed?: { enabled: boolean; reason?: string }; // reason 은 메뉴에 적지 않는다 — 첫 돌봄 말풍선이 쓴다 (src/main/app.ts)
  play?: { enabled: boolean; reason?: string };
  ball?: { enabled: boolean; hidden: boolean }; // 볼 줄의 모양 — 박스 개체는 흐리게, 볼 안의 개체는 `꺼내기`. 없으면 `볼에 넣기`
  forms?: PetMenuForm[]; // 공유 sid 계열의 모습 — 둘 이상이면 `모습 바꾸기` 줄과 그 옆의 말풍선이 생긴다
  move?: { enabled: boolean }; // 옮기기 줄 — 박스 개체에만 둔다
  sell?: { enabled: boolean }; // 팔기 줄 — 파티·박스 개체 모두
}
export interface PetMenuForm {
  species: string;
  name: string;
  current: boolean; // 지금 모습 — 누를 수 없다
  portrait?: string; // 초상의 data URI
}
export interface TrayMenuModel {
  hidden: boolean;
  ghost: boolean; // 클릭 통과
}
// 트레이 — 앱 전체 조작
export interface MenuActions {
  toggleHidden(): void;
  quit(): void;
  toggleGhost?(): void;
}
// 포켓몬 메뉴 — 그 포켓몬 조작만. 숨기기·종료 같은 앱 전체 조작은 받지 않는다
export interface PetMenuActions {
  feed?(): void;
  play?(): void;
  ball?(): void; // 이 포켓몬만 볼에 넣는다·꺼낸다 — 저장에 있는 개체일 때만
  detail?(): void; // 그 포켓몬의 개체 상세를 연다
  form?(species: string): void; // 모습 말풍선에서 고른 모습 — 바꾸기 확인 창을 띄운다
  move?(): void; // [임시] 기능 개발 예정 — 동작이 없으면 줄이 흐리다 (worklog/records/box-improve/record.md)
  sell?(): void; // [임시] 기능 개발 예정 — 동작이 없으면 줄이 흐리다
}

// 첫 줄 — "이브이 · 용감". 성격이 없거나 성격을 화면에서 끈 동안(NATURE_SHOWN)은 이름만
export const petLine = (model: Pick<PetMenuModel, "name" | "nature">): string =>
  NATURE_SHOWN && model.nature ? t("menu.pet", { name: model.name, nature: model.nature }) : model.name;

// 포켓몬 메뉴 — 무대의 우클릭과 관리 창의 파티 카드·박스 칸 누르기가 같은 메뉴를 쓴다 (2026-10-02 사용자 결정)
// 그 포켓몬 관련 항목만 둔다 — 잠시 숨기기(전체)·종료는 트레이에만 (2026-09-28 사용자 결정)
// 첫 항목은 이름·상태 두 줄이다 (sublabel 이 둘째 줄). 못 하는 항목은 흐리게만 둔다 — 이유는 적지 않는다 (Figma `Context Menu` `338:738`)
// 묶음: 이름·상태 / 밥 주기·놀아주기·볼에 넣기·상세 보기·모습 바꾸기·옮기기 / 팔기 (Figma `Context Menu` `338:738`, 2026-10-02 사용자 확인)
// 볼에 넣기와 상세 보기 사이에는 구분선을 두지 않는다 (2026-10-02 사용자 결정 "구분선 없애자")
// 박스 개체는 밥 주기·놀아주기·볼에 넣기가 흐리다. 옮기기는 박스 개체에만, 팔기는 파티·박스 모두에 있다.
// 모습 바꾸기는 누르는 동작이 없고 하위 줄(submenu)만 있다 — 눌러도 메뉴가 닫히지 않고 옆에 말풍선으로 뜬다.
//   하위 줄의 sublabel 은 `지금`·`바꾸기`, icon 은 초상의 data URI, 줄 머리(toolTip)는 말풍선의 첫 줄이다
export function petMenu(model: PetMenuModel, act: PetMenuActions): MenuItemConstructorOptions[] {
  const forms = model.forms && model.forms.length > 1 ? model.forms : null;
  return [
    { label: petLine(model), ...(model.status ? { sublabel: model.status } : {}), enabled: false },
    { type: "separator" },
    ...(model.feed ? [{ label: t("menu.feed"), enabled: model.feed.enabled, click: () => act.feed?.() }] : []),
    ...(model.play ? [{ label: t("menu.play"), enabled: model.play.enabled, click: () => act.play?.() }] : []),
    ...(act.ball ? [{ label: t(model.ball?.hidden ? "menu.unball" : "menu.ball"), enabled: model.ball?.enabled !== false, click: () => act.ball?.() }] : []),
    ...(act.detail ? [{ label: t("menu.detail"), click: () => act.detail?.() }] : []),
    ...(forms
      ? [
          {
            label: t("menu.form"),
            toolTip: t("menu.form.title"),
            submenu: forms.map((f) => ({
              label: f.name,
              sublabel: t(f.current ? "menu.form.now" : "menu.form.go"),
              enabled: !f.current,
              ...(f.portrait ? { icon: f.portrait } : {}),
              click: () => act.form?.(f.species),
            })),
          },
        ]
      : []),
    ...(model.move ? [{ label: t("menu.move"), enabled: model.move.enabled && !!act.move, click: () => act.move?.() }] : []),
    ...(model.sell ? [{ type: "separator" as const }, { label: t("menu.sell"), enabled: model.sell.enabled && !!act.sell, click: () => act.sell?.() }] : []),
  ];
}

// 튜토리얼이 고르게 할 항목만 남기고 나머지 누르는 항목을 흐리게(사용 안 함) 둔다. 이름·상태 줄은 그대로다.
// 첫 돌봄 2/2 가 쓴다 (Figma `579:17015`, worklog/records/game-runtime/record.md "첫 돌봄 튜토리얼의 피드백")
export function lockExcept(template: MenuItemConstructorOptions[], keep: readonly string[]): MenuItemConstructorOptions[] {
  return template.map((m) => ((m.click || m.submenu) && !keep.includes(String(m.label)) ? { ...m, enabled: false } : m));
}

// 트레이 — 잠시 숨기기 / 클릭 통과 / 종료. 설정창 열기는 부르는 쪽이 맨 위에 붙인다.
// 이름 줄과 설정 파일 열기는 뺐다 — 관리 창이 그 일을 한다 (worklog/records/game-runtime/record.md "트레이 메뉴와 표시 설정의 설계")
export function trayMenu(model: TrayMenuModel, act: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: t(model.hidden ? "menu.show" : "menu.hide"), click: () => act.toggleHidden() },
    { label: t("menu.ghost"), type: "checkbox", checked: model.ghost, click: () => act.toggleGhost?.() },
    { type: "separator" },
    { label: t("menu.quit"), click: () => act.quit() },
  ];
}

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
