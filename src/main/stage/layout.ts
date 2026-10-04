// 무대 위 자리 계산 — 순수 함수. 좌표계는 "무대 안 좌표"(DIP, 무대 좌상단이 0,0)
//
// 무대 사각형 = 따라가는 창(target) ∩ 그 창이 있는 디스플레이 — 화면 밖 부분은 보이지도 않고 GPU 만 먹는다.
// 그래서 무대 코드는 처음부터 "무대 ≠ 창" 을 전제로 짠다 — anchor(창을 무대 안 좌표로 옮긴 사각형)와 stage(무대 크기)를 따로 받는다.
// 창이 디스플레이 안에 다 들어 있으면 anchor = {0,0,stage.w,stage.h} 라 1판 계산과 같다
//
// 집(Pet.home = {dx,dy})의 뜻은 1판과 같다 — 따라가는 창의 오른쪽 아래 모서리 기준, 몸 좌상단의 오프셋.
//   x = anchor.right − body.w + dx,  y = anchor.bottom − body.h + dy,  그 뒤 무대 안에 가둔다
//   창 크기가 바뀌면 오른쪽 아래에 붙어 따라오고, 집이 무대 밖이면 가둔 자리가 집이다.
//   가두기 전 자리를 집으로 삼으면, 창을 줄여 집이 밖에 걸렸을 때 산책 오프셋이 가두기에 먹혀 걷는 그림만 나오고 제자리인 구간이 생긴다 (옛 main.js homeSpot)
// 자리는 전부 "몸"(작업 동작을 뺀 칸 × 배율)으로 계산한다 — 작업 동작이 그림 칸을 키워도 펫이 서는 자리는 그대로다 (옛 main.js bodySize)
import type { RoamBox } from "../../motion/types";
import type { Rect, Size } from "../../shared/geometry";
import { findScreen, screenOrder, stageRectOf, type ScreenInfo, type ScreenRef } from "../windows/screens.js";
export interface Spot {
  x: number;
  y: number;
}
export interface Home {
  dx: number;
  dy: number;
}

export const STAGE_RULES = {
  tickMs: 40, // 무대 틱 — 25fps (옛 buddy/body.js TICK_MS)
  statePollMs: 500, // 훅 상태 폴링 (옛 STATE_POLL_MS)
  // playMs — 놀아주기는 옆으로 걸어가 그 자리에서 폴짝 뛴다. 커서를 따라가지 않는다 (화면 전체 놀이공간에서 커서 밑에 붙어 클릭을 막았다)
  care: { maxStepMs: 80, speedPerZoom: 0.075, arrivalPx: 3, eatMs: 2000, playMs: 3000, durationMs: 12_000, foodOffsetPx: 80 },
  stackRatio: 0.8, // 여러 마리를 나란히 둘 때 몸 너비 대비 간격 (옛 STACK_RATIO)

};

// ── 여러 화면 (2026-09-28) ─────────────────────────────────────────────────────
// 놀이공간 방식 — 모든 화면(화면마다 무대 창 하나) · 한 화면(고른 화면) · 영역 지정(그린 영역). 설계는 worklog/records/multi-display/record.md

// 무대 창 하나 — key 는 화면 id. target 은 놀이공간(화면 좌표), rect 는 무대 창 사각형(= target ∩ 화면)
export interface PlayLane {
  key: string;
  screen: ScreenInfo;
  target: Rect;
  rect: Rect;
}

const laneOf = (screen: ScreenInfo, target: Rect): PlayLane | null => {
  const rect = stageRectOf(target, screen.bounds);
  return rect ? { key: String(screen.id), screen, target: { ...target }, rect } : null;
};

// 놀이공간 → 무대 창 목록. 모든 화면은 화면마다 하나(번호 순), 한 화면·영역 지정은 하나다
export function playLanes(area: { mode: string; rect: Rect | null; screen: ScreenRef | null }, screens: readonly ScreenInfo[]): PlayLane[] {
  if (!screens.length) return [];
  if (area.mode === "all") return screenOrder(screens).flatMap((s) => laneOf(s, s.work) ?? []);
  if (area.mode === "region" && area.rect) {
    let best: PlayLane | null = null;
    for (const s of screenOrder(screens)) {
      const lane = laneOf(s, area.rect);
      if (lane && (!best || lane.rect.w * lane.rect.h > best.rect.w * best.rect.h)) best = lane;
    }
    // 놀이공간은 그린 영역 그대로다(무대 창만 화면 안으로 자른다) — 여러 화면 전의 계산과 같다
    if (best) return [best];
  }
  const chosen = area.mode === "screen" ? findScreen(area.screen, screens) : findScreen(null, screens);
  const lane = chosen ? laneOf(chosen, chosen.work) : null;
  return lane ? [lane] : [];
}

// 모든 화면 방식의 개체 배분 — 사는 화면이 있으면 그 화면(없어졌으면 findScreen 규칙으로 대신), 없으면 개체가 가장 적은 화면.
// 개수가 같으면 번호가 앞인 화면. 저장하지 않는다 — 같은 파티·같은 화면이면 늘 같은 결과다. 끌어다 놓아야 사는 화면이 저장된다
export function assignScreens(pets: readonly { id: string; screen: ScreenRef | null }[], screens: readonly ScreenInfo[]): Map<string, number> {
  const out = new Map<string, number>();
  const order = screenOrder(screens);
  if (!order.length) return out;
  const count = new Map<number, number>(order.map((s) => [s.id, 0]));
  for (const p of pets) {
    if (!p.screen) continue;
    const s = findScreen(p.screen, order);
    if (!s) continue;
    out.set(p.id, s.id);
    count.set(s.id, (count.get(s.id) ?? 0) + 1);
  }
  for (const p of pets) {
    if (out.has(p.id)) continue;
    let pick = order[0]!;
    for (const s of order) if ((count.get(s.id) ?? 0) < (count.get(pick.id) ?? 0)) pick = s;
    out.set(p.id, pick.id);
    count.set(pick.id, (count.get(pick.id) ?? 0) + 1);
  }
  return out;
}

// 화면 좌표의 사각형을 무대 안 좌표로
export const toLocal = (rect: Rect, stage: Rect): Rect => ({ x: rect.x - stage.x, y: rect.y - stage.y, w: rect.w, h: rect.h });

// 몸이 무대 밖으로 나가지 않도록 가둔다 — 몸이 무대보다 크면 좌상단에 맞춘다
export function clampInStage(x: number, y: number, body: Size, stage: Size): Spot {
  const maxX = Math.max(0, stage.w - body.w);
  const maxY = Math.max(0, stage.h - body.h);
  return {
    x: Math.round(Math.min(Math.max(x, 0), maxX)),
    y: Math.round(Math.min(Math.max(y, 0), maxY)),
  };
}

// 기본 자리를 몸 한 칸 옆으로 — 옛 세션 펫과 같은 창에 함께 뜨면 겹치지 않게 두었던 값이다.
// 저장된 집은 이 값을 더해 저장하고 빼서 쓴다(homeOf · homeSpot). 없애면 저장된 자리가 한 칸씩 밀리므로 그대로 둔다
// (2026-09-27 세션 모드 삭제, 옛 main.js stackShift)
export const stackShift = (body: Size): number => Math.round(body.w * STAGE_RULES.stackRatio);

// 집 자리 — 창 오른쪽 아래 기준 오프셋을 무대 안에 가둔 것
export function homeSpot(home: Home, body: Size, anchor: Rect, stage: Size, shift = 0): Spot {
  return clampInStage(anchor.x + anchor.w - body.w + home.dx - shift, anchor.y + anchor.h - body.h + home.dy, body, stage);
}

// 산책할 수 있는 오프셋 범위 — 몸이 무대 안에 머무는 만큼. 집이 밖이면 0 을 포함하게 넓혀 집에는 늘 돌아올 수 있다.
// 몸이 무대보다 크면 [0,0] 이 되어 걷지 않는다
export function roamBox(spot: Spot, body: Size, stage: Size): RoamBox {
  return {
    minX: Math.min(0, 0 - spot.x), // 0 - x 로 써서 -0 이 나오지 않게 (deepStrictEqual · JSON 이 가른다)
    maxX: Math.max(0, stage.w - body.w - spot.x),
    minY: Math.min(0, 0 - spot.y),
    maxY: Math.max(0, stage.h - body.h - spot.y),
  };
}

// 놓인 자리 → 집 오프셋 (저장할 값). 창 오른쪽 아래 기준 — 작업 동작이 칸을 키우기 전과 같은 값이다
export function homeOf(spot: Spot, body: Size, anchor: Rect, shift = 0): Home {
  return { dx: spot.x - (anchor.x + anchor.w - body.w) + shift, dy: spot.y - (anchor.y + anchor.h - body.h) };
}

export const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
