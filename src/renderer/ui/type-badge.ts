// 타입 배지 — Figma `Type Badge` `118:134`. 색은 각 창 CSS 의 `.type[data-type]` 이 타입 키로 고른다. 키가 없으면 무늬 없는 배지
import { el } from "./dom.js";

export function typeBadgeEl(name: string, id?: string): HTMLElement {
  const badge = el("span", "type", name);
  if (id) badge.dataset.type = id;
  return badge;
}
