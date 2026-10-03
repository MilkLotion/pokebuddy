// 줍기 쓰기 — 주운 마리마다 저장에 넣는다(src/find/pickup.ts applyHits). 시간 적용은 하지 않는다 — 다음 틱이 한다
import type { DexOptions } from "../dex/data";
import { applyHits } from "../find/pickup.js";
import type { Rand } from "../shared/rand.js";
import type { FindRecordV3, SaveV3 } from "../shared/save-v3";

// 이번에 주운 기록을 돌려준다. 주운 것이 있으면 저장 시각을 적는다 — 쓰기는 부르는 쪽이 한다
export function applyFindHits(save: SaveV3, petIds: readonly string[], now: number, rand: Rand, opts?: DexOptions): FindRecordV3[] {
  const found = applyHits(save, petIds, now, rand, opts);
  if (found.length) save.savedAt = now;
  return found;
}
