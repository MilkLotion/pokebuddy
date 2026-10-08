// 메뉴 모델 — 포켓몬 메뉴(무대 우클릭·관리 창 우클릭), 트레이 (설계 30번 D9)
// Electron 을 값으로 가져오지 않는다 — MenuItemConstructorOptions 모양의 객체만 만든다(node 시험 가능). 누르면 할 일(click)은 메인이 넘긴다.
// 메뉴 창의 표현(번호 매기기·화면 모양)은 src/view/menu-view.ts 다(메인 레인 M8-3 에서 src/main/menus.ts 를 옮겼다).
// 문구는 언어 파일(data/i18n)에서. 호칭(펫·동반자)은 쓰지 않고 동사만 (사용자 결정 2026-09-17).
// 우클릭 = 이름·상태 / 밥 주기·놀아주기 / 설정창 열기 세 묶음 (docs/specs/game.md 2026-09-24 전환)
// 클릭 통과는 트레이와 관리 창 설정에 — 켜면 펫을 우클릭할 수 없어 우클릭 메뉴에 있어도 끌 수 없다
import type { MenuItemConstructorOptions } from "electron";
import { NATURE_SHOWN } from "../shared/features.js";
import { formsOf, isFormLocked, riderMissing, shiftRuleOf } from "../dex/forms.js";
import { sellablePet } from "../shop/sell-pet.js";
import { checkCare } from "../state/care.js";
import { boredStepOf, zoneOf } from "../state/time.js";
import { currentTutorial } from "../tutorial/queue.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import { boredText, currentLang, itemName, natureName, petName, t } from "./text.js";
import { waitText } from "../shared/count-text.js";

export interface PetMenuModel {
  name: string;
  nature: string | null; // 성격의 화면 이름 — 세션 샌드박스 펫처럼 없으면 이름만
  status?: string;
  feed?: { enabled: boolean; reason?: string }; // reason 은 메뉴에 적지 않는다 — 첫 돌봄 말풍선이 쓴다
  play?: { enabled: boolean; reason?: string };
  ball?: { enabled: boolean; hidden: boolean }; // 볼 줄의 모양 — 박스 개체는 흐리게, 볼 안의 개체는 `꺼내기`. 없으면 `볼에 넣기`
  forms?: PetMenuForm[]; // 공유 sid 계열·모습 바꾸기 종(로토무)의 모습 — 둘 이상이면 `모습 바꾸기` 줄과 그 옆의 말풍선이 생긴다
  formsLocked?: boolean; // 모습 바꾸기 해금 전(로토무 — 그 개체의 파티 작업 시간) — 줄만 흐리게 두고 말풍선은 없다. 이유는 적지 않는다
  formsCatalog?: boolean; // 도구를 쓰는 묶음(로토무) — 말풍선 머리가 `모습 바꾸기 · 카탈로그 1개를 써요`, 맨 아래 줄이 `로토무 · 원래대로`
  formsItem?: string; // 한 방향 묶음(플라엣테·다투곰)의 도구 이름 — 말풍선 머리가 `모습 바꾸기 · 영원의 꽃 1개를 써요`, 줄은 바뀔 모습 하나다 (2026-10-08)
  move?: { enabled: boolean }; // 옮기기 줄 — 박스 개체에만 둔다
  swap?: { enabled: boolean }; // 교체 줄 — 관리 창에서 연 메뉴(파티·박스 개체)에만 둔다
  sell?: { enabled: boolean }; // 팔기 줄 — 파티·박스 개체 모두
}
export interface PetMenuForm {
  species: string;
  name: string;
  current: boolean; // 지금 모습 — 누를 수 없다
  portrait?: string; // 초상의 data URI
  back?: boolean; // 도구 없이 돌아가는 기본 종 줄(로토무) — 오른쪽 글자가 `원래대로`
  noItem?: boolean; // 도구가 없어 누를 수 없다 — 이유는 적지 않는다
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
  move?(): void; // 옮기기 — 관리 창의 박스 탭에서 그 개체를 든다. 동작이 없으면 줄이 흐리다
  swap?(): void; // 교체 — 관리 창이 교체 화면을 열고 그 개체를 든다. 동작이 없으면 줄이 흐리다
  sell?(): void; // 팔기 — 관리 창이 확인 창을 띄운다. 동작이 없으면 줄이 흐리다
}

// 첫 줄 — "이브이 · 용감". 성격이 없거나 성격을 화면에서 끈 동안(NATURE_SHOWN)은 이름만
export const petLine = (model: Pick<PetMenuModel, "name" | "nature">): string =>
  NATURE_SHOWN && model.nature ? t("menu.pet", { name: model.name, nature: model.nature }) : model.name;

// 포켓몬 메뉴 — 무대의 우클릭과 관리 창의 파티 카드·박스 칸 누르기가 같은 메뉴를 쓴다 (2026-10-02 사용자 결정)
// 그 포켓몬 관련 항목만 둔다 — 잠시 숨기기(전체)·종료는 트레이에만 (2026-09-28 사용자 결정)
// 첫 항목은 이름·상태 두 줄이다 (sublabel 이 둘째 줄). 못 하는 항목은 흐리게만 둔다 — 이유는 적지 않는다 (Figma `Context Menu` `338:738`)
// 묶음: 이름·상태 / 옮기기·교체 / 밥 주기·놀아주기·볼에 넣기·상세 보기·모습 바꾸기 / 팔기 (Figma `Context Menu` `338:738`)
// 옮기기는 이름·상태 바로 아래에 두고 그 아래에 구분선을 둔다 (2026-10-02 사용자 결정 "옮기기를 포켓몬이름,상태 바로 아래로 옮기고 밑줄")
// 교체는 옮기기 아래에 둔다. 파티 개체는 옮기기가 없어 교체 한 줄이다 (2026-10-09 사용자 "파티,박스에 우클릭 메뉴에 교체 추가", Figma `Show Swap`)
// 볼에 넣기와 상세 보기 사이에는 구분선을 두지 않는다 (2026-10-02 사용자 결정 "구분선 없애자")
// 박스 개체는 밥 주기·놀아주기·볼에 넣기가 흐리다. 옮기기는 박스 개체에만, 팔기는 파티·박스 모두에 있다.
// 모습 바꾸기는 누르는 동작이 없고 하위 줄(submenu)만 있다 — 눌러도 메뉴가 닫히지 않고 옆에 말풍선으로 뜬다.
//   해금 전(formsLocked)이면 하위 줄 없이 흐린 줄 하나다 (docs/specs/game.md "로토무의 모습 바꾸기", Figma `Menu Item` `State=Disabled`)
//   하위 줄의 sublabel 은 `지금`·`바꾸기`, icon 은 초상의 data URI, 줄 머리(toolTip)는 말풍선의 첫 줄이다
export function petMenu(model: PetMenuModel, act: PetMenuActions): MenuItemConstructorOptions[] {
  // 한 방향 묶음(formsItem)은 바뀔 모습 한 줄만 있어도 `모습 바꾸기` 줄을 둔다
  const forms = model.forms && (model.forms.length > 1 || (model.formsItem != null && model.forms.length > 0)) ? model.forms : null;
  // 누를 줄이 하나도 없으면(해금 전, 또는 카탈로그가 없고 지금 기본 종) `모습 바꾸기` 줄을 흐리게 둔다 (Figma 03 `Form Bubble / Rotom`, 2026-10-05)
  const formsOff = !!forms && (model.formsLocked === true || forms.every((f) => f.current || f.noItem));
  return [
    { label: petLine(model), ...(model.status ? { sublabel: model.status } : {}), enabled: false },
    { type: "separator" },
    ...(model.move ? [{ label: t("menu.move"), enabled: model.move.enabled && !!act.move, click: () => act.move?.() }] : []),
    ...(model.swap ? [{ label: t("menu.swap"), enabled: model.swap.enabled && !!act.swap, click: () => act.swap?.() }] : []),
    ...(model.move || model.swap ? [{ type: "separator" as const }] : []),
    ...(model.feed ? [{ label: t("menu.feed"), enabled: model.feed.enabled, click: () => act.feed?.() }] : []),
    ...(model.play ? [{ label: t("menu.play"), enabled: model.play.enabled, click: () => act.play?.() }] : []),
    ...(act.ball ? [{ label: t(model.ball?.hidden ? "menu.unball" : "menu.ball"), enabled: model.ball?.enabled !== false, click: () => act.ball?.() }] : []),
    ...(act.detail ? [{ label: t("menu.detail"), click: () => act.detail?.() }] : []),
    // 흐린 줄도 click 을 둔다 — 누르는 동작도 하위 줄도 없는 비활성 줄은 메뉴 창이 이름·상태 같은 머리 줄로 그린다 (src/view/menu-view.ts)
    ...(forms && formsOff ? [{ label: t("menu.form"), enabled: false, click: () => undefined }] : []),
    ...(forms && !formsOff
      ? [
          {
            label: t("menu.form"),
            toolTip: model.formsItem != null ? t("menu.form.title.item", { item: model.formsItem }) : t(model.formsCatalog ? "menu.form.title.catalog" : "menu.form.title"),
            submenu: forms.map((f) => ({
              label: f.name,
              sublabel: t(f.current ? "menu.form.now" : f.back ? "menu.form.back" : "menu.form.go"),
              enabled: !f.current && !f.noItem,
              ...(f.portrait ? { icon: f.portrait } : {}),
              click: () => act.form?.(f.species),
            })),
          },
        ]
      : []),
    ...(model.sell ? [{ type: "separator" as const }, { label: t("menu.sell"), enabled: model.sell.enabled && !!act.sell, click: () => act.sell?.() }] : []),
  ];
}

// 튜토리얼이 고르게 할 항목만 남기고 나머지 누르는 항목을 흐리게(사용 안 함) 둔다. 이름·상태 줄은 그대로다.
// 첫 돌봄 2/2 가 쓴다 (Figma `579:17015`, worklog/records/game-runtime/game-runtime.md "첫 돌봄 튜토리얼의 피드백")
export function lockExcept(template: MenuItemConstructorOptions[], keep: readonly string[]): MenuItemConstructorOptions[] {
  return template.map((m) => ((m.click || m.submenu) && !keep.includes(String(m.label)) ? { ...m, enabled: false } : m));
}

// 트레이 — 잠시 숨기기 / 클릭 통과 / 종료. 설정창 열기는 trayMenuOf 가 맨 위에 붙인다.
// 이름 줄과 설정 파일 열기는 뺐다 — 관리 창이 그 일을 한다 (worklog/records/game-runtime/game-runtime.md "트레이 메뉴와 표시 설정의 설계")
export function trayMenu(model: TrayMenuModel, act: MenuActions): MenuItemConstructorOptions[] {
  return [
    { label: t(model.hidden ? "menu.show" : "menu.hide"), click: () => act.toggleHidden() },
    { label: t("menu.ghost"), type: "checkbox", checked: model.ghost, click: () => act.toggleGhost?.() },
    { type: "separator" },
    { label: t("menu.quit"), click: () => act.quit() },
  ];
}

// 트레이 전체 — 맨 위의 설정창 열기와 트레이 항목. 상점·도감·가방은 관리 창이 맡는다 (docs/specs/game.md "화면 구조")
export function trayMenuOf(model: TrayMenuModel, act: MenuActions & { openManage(): void }): MenuItemConstructorOptions[] {
  return [{ label: t("menu.manage"), click: () => act.openManage() }, { type: "separator" }, ...trayMenu(model, act)];
}

// 이름 옆 한 줄 — "배고픔 · 심심해". 구간 낱말은 화면 값의 zoneText·boredWord 와 같은 언어 파일 글자다
const petStatus = (pet: { fullness: number; boredom: number }): string => `${t(`zone.${zoneOf(pet.fullness)}`)} · ${boredText(boredStepOf(pet.boredom))}`;

// 메뉴 항목 하나의 모양 — 막혔으면 이유를 준다(메뉴에는 적지 않는다 — 첫 돌봄 말풍선이 쓴다).
// 판정은 돌봄 규칙(src/state/care.ts checkCare) 그대로다. 쿨타임은 남은 시간 글자(waitText — "45초", "3분", "1시간 20분")
function careItem(save: SaveV3, petId: string, kind: "feed" | "play"): { enabled: boolean; reason?: string } {
  const r = checkCare(save, petId, kind);
  if (r.ok) return { enabled: true };
  if (r.reason === "cooldown") return { enabled: false, reason: waitText((r.remainMs ?? 0) / 1000, currentLang()) };
  if (r.reason === "full") return { enabled: false, reason: t("care.full") };
  return { enabled: false };
}

// 포켓몬 메뉴의 모델과 메인이 동작을 잇는 데 쓰는 값
export interface PetMenuState {
  model: PetMenuModel;
  inSave: boolean; // 저장에 있는 개체 — 볼·옮기기·팔기(무대에서 연 메뉴는 상세 보기도)를 잇는다
  hidden: boolean; // 볼 안의 개체 — 볼 줄은 꺼내기
  sale: { price: number } | null; // 팔 수 있으면 값
  firstCare: { keep: string | null; wait: string | null } | null; // 첫 돌봄 튜토리얼 2/2 — 남길 항목 라벨과 말풍선의 대기 글자
}

// 모습 줄 — 도구를 쓰는 묶음(로토무)은 다섯 모습 다음 맨 아래에 기본 종을 `원래대로` 로 둔다. 도구가 없으면 모습 줄을 흐리게 (2026-10-05 사용자 결정)
function menuForms(save: SaveV3, pet: PetV3, icons: Record<string, string>): PetMenuForm[] {
  const rule = shiftRuleOf(pet.species);
  const have = rule ? (save.bag[rule.item] ?? 0) > 0 : true;
  const rows = formsOf(pet).map((slug): PetMenuForm => ({
    species: slug,
    name: petName(slug),
    current: slug === pet.species,
    ...(icons[slug] ? { portrait: icons[slug] } : {}),
    ...(rule && slug === rule.base ? { back: true } : {}),
    // 도구가 없거나(로토무카탈로그), 그 모습에 있어야 하는 말이 없으면(버드렉스(백마 탄 모습) — 블리자포스) 줄이 흐리다
    ...((rule && slug !== rule.base && !have) || riderMissing(save, slug) ? { noItem: true } : {}),
  }));
  // 한 방향 묶음(플라엣테·다투곰)은 바뀔 모습만 — 지금 모습 줄과 `원래대로` 줄이 없다 (2026-10-08 사용자 지시 "모습바꾸기 말풍선에 플라엣테(영원의 꽃) 만 있어야지")
  if (rule?.oneWay) return rows.filter((f) => !f.current);
  return rule ? [...rows.filter((f) => !f.back), ...rows.filter((f) => f.back)] : rows;
}

// 무대에 나온 개체는 stagePet(종·성격)이 있다. 관리 창에서 연 메뉴는 저장의 값만으로 만든다. 만들 수 없으면 null
export function petMenuOf(
  save: SaveV3 | null,
  petId: string,
  o: { origin: "stage" | "manage"; stagePet: { species: string; nature?: string | null } | null; formIcons: Record<string, string>; now: number },
): PetMenuState | null {
  const pet = save?.pets.find((row) => row.id === petId) ?? null;
  if (!o.stagePet && !(o.origin === "manage" && pet)) return null;
  const nature = o.stagePet?.nature ?? pet?.nature ?? null;
  const base = { name: petName(o.stagePet?.species ?? pet?.species ?? ""), nature: nature ? natureName(nature) : null };
  if (!save || !pet) return { model: base, inSave: false, hidden: false, sale: null, firstCare: null };
  const slot = save.party.slots.find((s) => s.petId === petId) ?? null;
  const off: { enabled: boolean; reason?: string } = { enabled: false };
  // 팔 수 있는가 — 단일 포켓몬·알에 없는 종·교환에 올린 개체·마지막 한 마리는 못 판다 (src/shop/sell-pet.ts)
  const sale = sellablePet(save, petId);
  const feed = slot ? careItem(save, petId, "feed") : off;
  const play = slot ? careItem(save, petId, "play") : off;
  const model: PetMenuModel = {
    ...base,
    status: petStatus(pet),
    feed,
    play,
    ball: { enabled: slot != null, hidden: slot?.hidden === true },
    forms: menuForms(save, pet, o.formIcons),
    ...(isFormLocked(pet) ? { formsLocked: true } : {}),
    ...(shiftRuleOf(pet.species) && !shiftRuleOf(pet.species)?.oneWay ? { formsCatalog: true } : {}),
    ...(shiftRuleOf(pet.species)?.oneWay ? { formsItem: itemName(shiftRuleOf(pet.species)!.item) } : {}),
    // 옮기기는 박스 개체에만 있다. 팔 수 없는 개체는 팔기가 흐리다 — 이유는 적지 않는다 (2026-10-02 사용자 결정)
    ...(slot ? {} : { move: { enabled: true } }),
    // 교체는 관리 창에서 연 메뉴에만 있다 — 무대의 포켓몬은 파티 개체라 교체 화면으로 가는 길을 두지 않는다
    ...(o.origin === "manage" ? { swap: { enabled: true } } : {}),
    sell: { enabled: sale.ok },
  };
  // 첫 돌봄 튜토리얼 중이면 우클릭 메뉴에서 고른 돌봄이 튜토리얼을 끝낸다 — 다른 곳의 돌봄은 끝내지 않는다 (src/tutorial/conditions.ts onlyAtStart).
  // 밥 주기만 누르게 둔다. 밥 주기를 못 하는 때(쿨타임·배부름)는 놀아주기를 대신 남긴다.
  // 둘 다 못 하면 모두 잠그고, 쉬는 중(쿨타임)일 때만 남은 시간을 말풍선에 붙인다 — 배부름 같은 다른 이유면 "곧"
  let firstCare: PetMenuState["firstCare"] = null;
  if (o.origin === "stage" && currentTutorial(save, o.now)?.id === "first-care") {
    const keep = feed.enabled ? t("menu.feed") : play.enabled ? t("menu.play") : null;
    const cooling = (kind: "feed" | "play", item: { reason?: string }): string | null => {
      const r = checkCare(save, petId, kind);
      return !r.ok && r.reason === "cooldown" ? (item.reason ?? null) : null;
    };
    firstCare = { keep, wait: keep ? null : (cooling("play", play) ?? cooling("feed", feed) ?? t("coach.first-care.wait.soon")) };
  }
  return { model, inSave: true, hidden: slot?.hidden === true, sale: sale.ok ? { price: sale.price } : null, firstCare };
}
