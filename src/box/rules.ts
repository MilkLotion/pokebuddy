// 박스의 규칙표 — 가져오는 것이 없는 파일이다
// 박스 수 — start 개로 시작한다. 저절로 늘지 않고 상점에서 하나씩 사서 max 개까지 늘린다 (2026-10-02 사용자 결정 "기본8개제공, 박스는 추가구매"·"64"). src/box/boxes.ts fillBoxes, src/box/slots.ts addBox
export const BOX_RULES = {
  size: 30,
  firstName: "박스 1",
  start: 8,
  max: 64,
  // 박스 이름 최대 글자 수 — 넘김 줄의 이름 칸은 이 글자 수에 맞춘 고정 폭이다 (2026-10-01 사용자 결정 "최대12글자로 가정하고 구성"). 프리셋 이름도 같다 (2026-10-02 사용자 결정)
  nameMax: 12,
};
