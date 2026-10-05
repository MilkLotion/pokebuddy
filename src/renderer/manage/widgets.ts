// 설정창의 공용 부품 — 탭·대화상자가 같이 쓰는 작은 조각 (P10g). 상태를 갖지 않는다 — 누르면 부르는 쪽이 준 함수를 부른다
import { NATURE_SHOWN } from "../../shared/features.js";
import { buttonEl, el } from "../ui/dom.js";
import { fillBarEl, zoneClassOf } from "../ui/fill-bar.js";
import { closeIconEl } from "../ui/line-icons.js";

// 닫기 단추 — 대화상자 머리·경고 배너가 같이 쓴다. 글자 ✕ 가 아니라 Figma `Icon / Close` `299:166` 선 아이콘이다
// (대화상자는 `Header Icon Button` `295:3083` 안의 아이콘, 경고 배너는 `Alert` Type=Banner 의 아이콘)
export function dialogCloseEl(): HTMLButtonElement {
  const x = buttonEl("dialog-close");
  x.appendChild(closeIconEl());
  return x;
}

// 경고·안내 배너 — Figma 02 Molecules `Alert` `1040:279`
// - tone: bad 오류 · warn 주의 · ok 완료 · info 안내. 바탕 톤과 아이콘으로 가른다
// - 제목이 있으면 Banner(제목 + 설명), 빈 제목이면 Inline 한 줄(폼·대화상자의 짧은 실패)
// - onClose 가 있을 때만 오른쪽 ✕
export type AlertTone = "bad" | "warn" | "ok" | "info";
export function alertEl(tone: AlertTone, title: string, desc = "", onClose?: () => void): HTMLElement {
  const box = el("div", `alert ${tone}${title ? "" : " inline"}`);
  const text = el("div", "alert-text");
  if (title) text.appendChild(el("strong", undefined, title));
  if (desc) text.appendChild(el("span", undefined, desc));
  box.append(el("i", "alert-icon"), text);
  if (onClose) {
    const x = dialogCloseEl();
    x.setAttribute("aria-label", "닫기");
    x.addEventListener("click", onClose);
    box.appendChild(x);
  }
  return box;
}

// 값 막대 하나 — 이름, 현재/최대, 채움
// live — 시간으로만 바뀌는 값이면 그 개체와 필드. 1초 시계가 이 막대만 고친다 (live.ts applyLive)
export function meterEl(label: string, value: number, zone?: string, live?: { pet: string; field: "affinity" | "fullness" }): HTMLElement {
  const box = el("div", "meter");
  if (live) {
    box.dataset.livePet = live.pet;
    box.dataset.liveField = live.field;
  }
  const row = el("div", "row");
  row.append(el("span", undefined, label), el("span", undefined, `${value}/100`));
  box.append(row, fillBarEl(value, zoneClassOf(zone)));
  return box;
}

// 거르개 칩 한 줄 — 도감·상점·설정이 같은 모양을 쓴다.
// current 가 목록이면 여러 칩을 함께 눌린 상태로 둔다 — 설정의 알림 칩처럼 하나씩 켜고 끄는 줄 (2026-10-05)
export function chipsEl(items: { id: string; label: string }[], current: string | readonly string[], pick: (id: string) => void): HTMLElement {
  const row = el("div", "chips");
  const on = (id: string): boolean => (typeof current === "string" ? id === current : current.includes(id));
  for (const it of items) {
    const b = buttonEl("chip", it.label);
    b.setAttribute("aria-pressed", String(on(it.id)));
    b.addEventListener("click", () => pick(it.id));
    row.appendChild(b);
  }
  return row;
}

// 부제가 없으면 부제 줄을 그리지 않는다
export function pageHeadEl(title: string, sub?: string): HTMLElement {
  const box = el("div", "head");
  box.appendChild(el("h1", undefined, title));
  if (sub) box.appendChild(el("div", "sub", sub));
  return box;
}

// 켬·끔 스위치 — Figma `Toggle` `299:3593`
export function switchEl(on: boolean, label: string, run: () => void): HTMLButtonElement {
  const b = buttonEl("switch");
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("aria-label", label);
  b.addEventListener("click", run);
  return b;
}

// 두 칸·네 칸 전환 — 회색 틀 안에서 고른 칸만 흰 면 (docs/specs/ui-components.md C-15)
export function segmentedEl<T extends string>(items: readonly { id: T; label: string }[], current: T, pick: (id: T) => void): HTMLElement {
  const box = el("div", "segmented");
  box.setAttribute("role", "tablist");
  for (const item of items) {
    const b = buttonEl("", item.label);
    b.setAttribute("aria-pressed", String(item.id === current));
    b.addEventListener("click", () => {
      if (item.id !== current) pick(item.id);
    });
    box.appendChild(b);
  }
  return box;
}

// 레벨 줄 — 성격은 스위치(src/shared/features.ts NATURE_SHOWN)가 켜져 있을 때만 붙인다
export const lvNature = (level: number, nature: string): string => (NATURE_SHOWN ? `Lv.${level} · ${nature}` : `Lv.${level}`);

// 설정 한 줄. 조작이 넓으면 이름 아래에 깐다 — 옆에 두면 설명이 좁아져 여러 줄로 접힌다
// 힌트가 없으면 .hint 줄을 만들지 않는다 — 라벨 한 줄만 남는다
export function settingRow(label: string, hint: string | undefined, control: HTMLElement, stack = false): HTMLElement {
  const row = el("div", stack ? "setting stack" : "setting");
  const body = el("div", "body");
  body.appendChild(el("div", "label", label));
  if (hint) body.appendChild(el("div", "hint", hint));
  row.append(body, control);
  return row;
}

// 박스 넘김 줄의 이름 칸 — 이름 길이와 고치는 중인지에 따라 ◀·▶·정렬이 움직이지 않게 12글자 폭으로 고정한다
// (2026-10-01 사용자 "박스 이름에 따라 화살표 위치 바껴 … 최대12글자로 가정하고 구성해야해", Figma 05 `Box / Rename`)
// 파티 탭의 프리셋 넘김 줄도 같은 칸을 쓴다
export function boxNameCell(inner: HTMLElement): HTMLElement {
  const cell = el("div", "box-name-cell");
  cell.appendChild(inner);
  return cell;
}

// 박스 탭의 아이콘 — 16×16, 선 1.5. 고정 그림이다 (Figma 01 `Icon / Menu`·`Icon / House`). 머리 메뉴(box-order.ts)와 돌보미집 단추가 쓴다
export const BOX_ICON = {
  menu: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>',
  house: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8 8 3l5.5 5M4 7v6.5h8V7M7 13.5V10h2v3.5"/></svg>',
} as const;
