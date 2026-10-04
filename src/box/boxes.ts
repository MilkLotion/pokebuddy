// 박스 만들기 — 새 박스, 식별자, 기본 개수 채우기. 순수 함수이며 저장을 쓰지 않는다 (규칙표는 src/box/rules.ts)
import type { BoxV3 } from "../shared/save-v3";
import { BOX_RULES } from "./rules.js";

export const newBox = (id: string, name: string): BoxV3 => ({ id, name, slots: Array.from({ length: BOX_RULES.size }, () => null) });

// 다음 박스 식별자 — 지금 있는 `b숫자` 의 가장 큰 번호 다음. 순서를 바꾼 뒤에도 겹치지 않는다
export function nextBoxId(boxes: BoxV3[]): string {
  let max = boxes.length;
  for (const b of boxes) {
    const m = /^b(\d+)$/.exec(b.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `b${max + 1}`;
}

// 박스의 화면 이름 — 저장한 이름이 없으면 자리 번호의 기본 이름(박스 N). 순서를 바꾸면 기본 이름도 자리를 따른다.
// 파티 프리셋 이름(src/party/presets.ts presetName)과 같은 규칙이다 (94 항목 9-5-5)
export const defaultBoxName = (index: number): string => `박스 ${index + 1}`;
export const boxName = (box: Pick<BoxV3, "name">, index: number): string => box.name || defaultBoxName(index);

// 빈 박스 하나를 맨 뒤에 더한다. 상한은 보지 않는다 — 사는 쪽(src/box/slots.ts addBox)이 본다. 이름은 비워 두고 자리 번호로 보인다
export function pushBox(boxes: BoxV3[]): BoxV3 {
  const box = newBox(nextBoxId(boxes), "");
  boxes.push(box);
  return box;
}

// 박스 수를 기본 개수로 맞춘다 — start 개보다 적으면 채운다. 그보다 많은 박스는 그대로 둔다(산 박스, 옛 규칙으로 늘어난 박스).
// 새 저장과 읽기에서만 부른다. 박스는 저절로 늘지 않는다
export function fillBoxes(boxes: BoxV3[]): BoxV3[] {
  while (boxes.length < BOX_RULES.start) pushBox(boxes);
  return boxes;
}
