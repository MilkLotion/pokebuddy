// 창 자리 계산 — 순수 함수. Electron 을 모른다 (worklog/records/code-structure/design/10-main.md 3.4절)
// 좌표는 Electron 사각형 모양({x, y, width, height})이다. 화면을 얻는 일은 ./display.ts 가 한다

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Size {
  width: number;
  height: number;
}

// 붙일 자리 — 부모 창 내용 영역 옆. 화면 오른쪽 끝을 넘으면 왼쪽에 붙인다 (기기 창)
export function dockAt(parent: Box, area: Box, size: Size): { x: number; y: number; side: "right" | "left" } {
  const right = parent.x + parent.width;
  const side = right + size.width <= area.x + area.width || parent.x - size.width < area.x ? "right" : "left";
  const x = side === "right" ? right : parent.x - size.width;
  const y = Math.max(area.y, Math.min(parent.y, area.y + area.height - size.height));
  return { x, y, side };
}

// 가운데 위쪽 1/3 — 가로는 가운데, 세로는 남는 높이의 1/3 위치. 남는 높이가 없으면 맨 위 (알림 창, OS 대화상자의 부모)
export function centerSpotOf(area: Box, size: Size): { x: number; y: number } {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - size.height) / 3)),
  };
}

// 오른쪽 아래 모서리 — 가장자리에서 margin 만큼 띄운다 (배너)
export function cornerSpotOf(area: Box, size: Size, margin: number): { x: number; y: number } {
  return { x: area.x + area.width - size.width - margin, y: area.y + area.height - size.height - margin };
}
