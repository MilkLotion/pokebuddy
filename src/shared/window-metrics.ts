// 메인과 렌더러가 같이 읽는 창 숫자 — 메뉴 창의 자리 계산(src/main/menus/menu-window.ts)과 메뉴 그리기(src/renderer/windows/menu.ts)
// CSS 는 가져다 쓰지 못한다 — src/renderer/styles/menu.css 의 body 여백은 주석으로 여기를 가리킨다
export const MENU_METRICS = {
  shadow: 8, // 그림자 자리 — 창 네 변의 여백. menu.css 의 body padding 과 같다
  subGap: 8, // 메뉴와 말풍선 사이 (Figma 05 `Party / Shared Form Tip` `501:14010`)
} as const;
