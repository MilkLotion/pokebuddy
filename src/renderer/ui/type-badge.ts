// 타입 배지 — Figma `Type Badge` `118:134`. 색은 각 창 CSS 의 `.type[data-type]` 이 타입 키로 고른다. 키가 없으면 무늬 없는 배지
import { el } from "./dom.js";

export function typeBadgeEl(name: string, id?: string): HTMLElement {
  const badge = el("span", "type", name);
  if (id) badge.dataset.type = id;
  return badge;
}

// 타입 아이콘 — 타입 색 네모에 흰 타입 아이콘(styles/type-badge.css `.type-icon`). 그림(data URI)이 없으면 색 네모만
export function typeIconEl(type: string, uri: string | null | undefined): HTMLElement {
  const box = el("span", "type-icon");
  box.dataset.type = type;
  if (uri) {
    const img = document.createElement("img");
    img.src = uri;
    img.alt = "";
    img.draggable = false;
    box.appendChild(img);
  }
  return box;
}
