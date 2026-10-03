// 화면 얻기 — Electron screen 을 부르는 곳을 한 파일로 모은다 (worklog/records/code-structure/design/10-main.md 3.4절)
// 사각형 계산(옆에 붙이기·가운데·모서리)은 ./placement.ts, 무대의 화면 계산은 ../layout.ts 다
import { screen, type Point, type Rectangle } from "electron";
import { screenOrder, type ScreenInfo } from "../layout";

// 지금 화면들 — 번호 순 (주 화면이 1). 좌표는 DIP
export function screensNow(): ScreenInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  const rect = (r: Rectangle) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  return screenOrder(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: rect(d.bounds), work: rect(d.workArea), primary: d.id === primary })));
}

// 주 화면의 작업 영역 — 메뉴 막대·Dock·작업 표시줄을 뺀 곳
export const primaryWorkArea = (): Rectangle => screen.getPrimaryDisplay().workArea;

// 그 사각형이 가장 많이 걸친 화면의 작업 영역
export const workAreaAt = (rect: Rectangle): Rectangle => screen.getDisplayMatching(rect).workArea;

// 커서와 커서가 있는 화면
export function cursorScreen(): { point: Point; bounds: Rectangle; workArea: Rectangle } {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  return { point, bounds: display.bounds, workArea: display.workArea };
}
