// 시간 틱 반영 — 흐른 시간을 적용하고(src/state/time.ts applyTime) 후처리 사슬(./settle.ts)을 돈다. 저장 쓰기는 부르는 쪽이 한다
import { applyTime, type TimeEvents, type TimeInput } from "../state/time.js";
import type { SaveV3 } from "../shared/save-v3";
import { applySettle } from "./settle.js";

export interface TickEvents extends TimeEvents {
  achieved: string[]; // 이번에 달성한 업적
}

// 흐른 시간 elapsedMs 를 적용한 뒤 상태 판정을 다시 본다. 틱은 메가 풀기를 하지 않는다
export function applyTimeAndSettle(save: SaveV3, elapsedMs: number, now: number, input: TimeInput = {}): TickEvents {
  const events: TickEvents = { achieved: [], ...applyTime(save, elapsedMs, now, input) }; // 필드 순서는 옛 결과와 같다
  if (Math.max(0, Math.round(elapsedMs)) === 0) return events; // 흐른 시간이 없으면 판정도 하지 않는다
  events.achieved = applySettle(save, now, { revertMega: false }).achieved;
  return events;
}
