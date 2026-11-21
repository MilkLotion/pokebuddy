// 메뉴 창의 자리 — 커서 자리에 메뉴를 띄우고, 말풍선은 메뉴 옆에서 작업 영역 안으로만 옮긴다 (src/main/menus/menu-window.ts)
//   메뉴 자리는 말풍선과 관계없이 커서 자리다. 아래가 모자라면 메뉴 높이만큼만 위로 뒤집는다
//   말풍선이 작업 영역 아래로 넘치면 말풍선만 올린다(lift). 메뉴 위 끝보다 올라가면 창 안에서 메뉴를 그만큼 내려 앉힌다(menuDrop)
//   2026-11-22 관찰: 타입:널에서 진화한 실버디는 모습이 19개라 긴 목록 말풍선(약 760)이 됐고,
//   뒤집기 높이에 숨은 말풍선 높이까지 넣어 메뉴가 커서보다 수백 px 위에 떴다
import type { Rect } from "../../shared/geometry";

export interface MenuPlaceInput {
  at: { x: number; y: number }; // 커서(화면 DIP)
  area: Rect; // 커서가 있는 화면의 작업 영역
  menu: { w: number; h: number }; // 그림자 제외
  bubble: { w: number; h: number; top: number } | null; // top — 렌더러가 메뉴 위 끝에서 잰 말풍선 자리(0 이상)
  shadow: number; // 창 가장자리의 그림자 자리
  gap: number; // 메뉴와 말풍선 사이
}

export interface MenuPlace {
  menu: { x: number; y: number }; // 메뉴(그림자 제외)의 화면 자리
  window: Rect; // 메뉴 창(그림자 포함)
  side: "left" | "right" | null; // 말풍선이 뜰 쪽 — 말풍선이 없으면 null
  lift: number; // 말풍선을 렌더러가 잡은 자리보다 올리는 양
  menuDrop: number; // 창 안에서 메뉴를 내려 앉히는 양 — 말풍선이 메뉴 위 끝보다 올라갔을 때
}

export function placeMenu({ at, area, menu, bubble, shadow, gap }: MenuPlaceInput): MenuPlace {
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  let mx = at.x;
  let my = at.y;
  if (mx + menu.w + shadow > right) mx = at.x - menu.w;
  if (my + menu.h + shadow > bottom) my = at.y - menu.h;
  mx = Math.max(area.x + shadow, mx);
  my = Math.max(area.y + shadow, my);
  if (!bubble) {
    return { menu: { x: mx, y: my }, window: { x: mx - shadow, y: my - shadow, w: menu.w + shadow * 2, h: menu.h + shadow * 2 }, side: null, lift: 0, menuDrop: 0 };
  }
  // 말풍선 아래 끝이 작업 영역을 넘는 만큼 올린다. 위 끝은 작업 영역 위로 넘기지 않는다
  const over = my + bubble.top + bubble.h + shadow - bottom;
  const room = my + bubble.top - (area.y + shadow);
  const lift = Math.max(0, Math.min(over, room));
  const top = bubble.top - lift; // 메뉴 위 끝에서 잰 말풍선 자리 — 음수면 메뉴보다 위
  const menuDrop = Math.max(0, -top);
  const height = menuDrop + Math.max(menu.h, top + bubble.h);
  const extra = gap + bubble.w;
  const fitsRight = mx + menu.w + extra + shadow <= right;
  const fitsLeft = mx - extra - shadow >= area.x;
  const side = fitsRight || !fitsLeft ? "right" : "left";
  const x = side === "right" ? mx : mx - extra;
  return { menu: { x: mx, y: my }, window: { x: x - shadow, y: my - menuDrop - shadow, w: menu.w + extra + shadow * 2, h: height + shadow * 2 }, side, lift, menuDrop };
}
