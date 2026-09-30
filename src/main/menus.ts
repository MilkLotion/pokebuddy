// 우클릭·트레이 메뉴의 항목 — Electron 을 import 하지 않고 MenuItemConstructorOptions 모양의 객체만 돌려준다 (node 시험 가능).
// 문구는 언어 파일(lib/i18n)에서. 호칭(펫·동반자)은 쓰지 않고 동사만 (사용자 결정 2026-09-17).
// 우클릭 = 이름·상태 / 밥 주기·놀아주기 / 설정창 열기 세 묶음 (docs/specs/game.md 2026-09-24 전환)
// 클릭 통과는 트레이와 관리 창 설정에 — 켜면 펫을 우클릭할 수 없어 우클릭 메뉴에 있어도 끌 수 없다
import type { MenuItemConstructorOptions } from "electron";
import type { MenuView } from "../shared/manage";
import { NATURE_SHOWN } from "../dex/natures";
import { t } from "./text";

export interface PetMenuModel {
  name: string;
  nature: string | null; // 성격의 화면 이름 — 세션 샌드박스 펫처럼 없으면 이름만
  status?: string;
  feed?: { enabled: boolean; reason?: string };
  play?: { enabled: boolean; reason?: string };
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
// 포켓몬 위 우클릭 — 그 포켓몬 조작만. 숨기기·종료 같은 앱 전체 조작은 받지 않는다
export interface PetMenuActions {
  feed?(): void;
  play?(): void;
  ball?(): void; // 이 포켓몬만 볼에 넣는다 — 파티 개체일 때만
}

// 첫 줄 — "이브이 · 용감". 성격이 없거나 성격을 화면에서 끈 동안(NATURE_SHOWN)은 이름만
export const petLine = (model: Pick<PetMenuModel, "name" | "nature">): string =>
  NATURE_SHOWN && model.nature ? t("menu.pet", { name: model.name, nature: model.nature }) : model.name;

// 우클릭한 포켓몬 관련 항목만 둔다 — 잠시 숨기기(전체)·종료는 트레이에만 (2026-09-28 사용자 결정). 숨긴 동안에는 우클릭할 포켓몬도 없다
// 상세 보기(그 포켓몬의 개체 상세)는 부르는 쪽(app.ts)이 파티 개체일 때 끝에 붙인다
// 첫 항목은 이름·상태 두 줄이다 (sublabel 이 둘째 줄). 밥 주기·놀아주기를 못 하면 흐리게 두고 이유를 오른쪽에 붙인다 (Figma `Context Menu` `338:738`)
export function petMenu(model: PetMenuModel, act: PetMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: petLine(model), ...(model.status ? { sublabel: model.status } : {}), enabled: false },
    { type: "separator" },
    ...(model.feed ? [{ label: t("menu.feed"), ...(model.feed.reason ? { sublabel: model.feed.reason } : {}), enabled: model.feed.enabled, click: () => act.feed?.() }] : []),
    ...(model.play ? [{ label: t("menu.play"), ...(model.play.reason ? { sublabel: model.play.reason } : {}), enabled: model.play.enabled, click: () => act.play?.() }] : []),
    ...(act.ball ? [{ label: t("menu.ball"), click: () => act.ball?.() }] : []),
  ];
}

// 튜토리얼이 고르게 할 항목만 남기고 나머지 누르는 항목을 흐리게(사용 안 함) 둔다. 이름·상태 줄은 그대로다.
// 첫 돌봄 2/2 가 쓴다 (Figma `579:17015`, worklog/records/game-runtime/record.md "첫 돌봄 튜토리얼의 피드백")
export function lockExcept(template: MenuItemConstructorOptions[], keep: readonly string[]): MenuItemConstructorOptions[] {
  return template.map((m) => (m.click && !keep.includes(String(m.label)) ? { ...m, enabled: false } : m));
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
// 누를 수 없고 동작도 없는 항목은 상태 줄이다 — sublabel 을 둘째 줄로 보인다. 누르는 항목의 sublabel 은 오른쪽 짧은 글이다
export function menuView(template: MenuItemConstructorOptions[], on: string): MenuView[] {
  const out: MenuView[] = [];
  template.forEach((m, id) => {
    if (m.type === "separator") {
      // 맨 앞·연속 구분선은 두지 않는다
      if (out.length && out[out.length - 1]?.kind !== "separator") out.push({ kind: "separator" });
      return;
    }
    if (!m.label || m.visible === false) return;
    if (m.enabled === false && !m.click) {
      out.push({ kind: "status", title: m.label, ...(m.sublabel ? { caption: m.sublabel } : {}) });
      return;
    }
    const hint = m.type === "checkbox" && m.checked ? on : m.sublabel || undefined;
    out.push({ kind: "item", id, label: m.label, disabled: m.enabled === false || !m.click, ...(hint ? { hint } : {}) });
  });
  while (out.length && out[out.length - 1]?.kind === "separator") out.pop();
  return out;
}
