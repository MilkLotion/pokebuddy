// 화면 — 지금 화면 목록의 모양, 저장에 두는 화면 가리키기, 화면 번호 순서, 저장된 화면 되찾기, 창 ∩ 디스플레이 (설계는 worklog/records/multi-display/multi-display.md)
// 화면을 다루는 창 도우미(display·screen-picker)와 무대(src/main/stage/layout.ts)가 같이 쓴다. 순수 함수다
// (예전 src/main/layout.ts 안에 있었다. 메인 레인 96-D 에서 무대 자리 계산과 나눴다)
import type { Rect } from "../../shared/geometry";

// 무대 사각형 — 창과 디스플레이의 교집합. 겹치는 곳이 없으면 null (부르는 쪽이 마지막 무대를 유지한다)
export function stageRectOf(target: Rect, display: Rect): Rect | null {
  const x1 = Math.max(target.x, display.x);
  const y1 = Math.max(target.y, display.y);
  const x2 = Math.min(target.x + target.w, display.x + display.w);
  const y2 = Math.min(target.y + target.h, display.y + display.h);
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null;
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

// 지금 화면 하나 — Electron Display 에서 필요한 것만. 좌표는 DIP
export interface ScreenInfo {
  id: number;
  bounds: Rect;
  work: Rect; // 작업 영역 — 메뉴 막대·Dock·작업 표시줄을 뺀 곳
  primary: boolean;
}

// 저장에 두는 화면 가리키기 — id 와 그 화면의 사각형 (src/shared/save-v3.ts ScreenRefV3)
export interface ScreenRef extends Rect {
  id: number;
}

export const screenRefOfInfo = (s: ScreenInfo): ScreenRef => ({ id: s.id, ...s.bounds });

const overlapArea = (a: Rect, b: Rect): number => {
  const cut = stageRectOf(a, b);
  return cut ? cut.w * cut.h : 0;
};

// 화면 번호 순서 — 주 화면이 1, 나머지는 왼쪽에서 오른쪽, 같으면 위에서 아래
export function screenOrder(screens: readonly ScreenInfo[]): ScreenInfo[] {
  return [...screens].sort((a, b) => (a.primary !== b.primary ? (a.primary ? -1 : 1) : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y));
}

// 저장된 화면 → 지금 화면. id 가 같은 화면, 없으면 사각형이 가장 많이 겹치는 화면, 그것도 없으면 주 화면. 화면이 하나도 없으면 null
// id 가 바뀌는 경우(Windows 모니터 재연결 등)는 사각형으로 되찾는다. 저장된 값은 바꾸지 않는다 — 모니터를 다시 꽂으면 돌아온다
export function findScreen(ref: ScreenRef | null, screens: readonly ScreenInfo[]): ScreenInfo | null {
  const primary = screens.find((s) => s.primary) ?? screens[0] ?? null;
  if (!ref) return primary;
  const same = screens.find((s) => s.id === ref.id);
  if (same) return same;
  let best: ScreenInfo | null = null;
  let bestArea = 0;
  for (const s of screens) {
    const area = overlapArea(ref, s.bounds);
    if (area > bestArea) {
      best = s;
      bestArea = area;
    }
  }
  return best ?? primary;
}
