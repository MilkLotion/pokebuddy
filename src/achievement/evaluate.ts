// 업적 달성 판정 — 1초 틱과 거래 뒤에 부른다. 달성은 한 번 기록하면 되돌리지 않는다
import { type DexOptions } from "../dex/data.js";
import type { SaveV3 } from "../shared/save-v3";
import { localDate } from "../shared/clock.js";
import { ACHIEVEMENT_RULES } from "./rules.js";
import { achievementDefs } from "./defs.js";
import { isAchieved } from "./progress.js";

// 앱이 돈 날을 센다 — 어제도 돌았으면 이어지고, 하루 이상 걸렀으면 1 부터 다시 센다
function touchDay(save: SaveV3, now: number): void {
  const counts = save.counts;
  const today = localDate(now);
  if (counts.day === today) return;
  counts.streak = counts.day === localDate(now - 24 * 3600_000) ? counts.streak + 1 : 1;
  counts.day = today;
}

// 달성을 기록한다. 이번에 새로 달성한 업적을 돌려준다 — 배너가 쓴다
// prev 를 주지 않으면(시간 흐름) 레벨업 조건은 달성하지 않는다. 시간만으로는 레벨이 오르지 않는다
// 업적 목록의 판(achRev)이 낮은 저장은 옛 저장이다. 이미 채운 조건이 한꺼번에 달성되므로 그 판정만 조용히 기록한다 —
// 배너를 띄우지 않고 업적 아이콘의 점만 켠다 (src/notify/queue.ts pendingOf)
export function evaluateAchievements(save: SaveV3, now: number, opts?: DexOptions, prev?: SaveV3): string[] {
  touchDay(save, now);
  const quiet = (save.achRev ?? 0) < ACHIEVEMENT_RULES.rev;
  const fresh: string[] = [];
  for (const [id] of achievementDefs(opts)) {
    const row = save.achievements[id];
    if (row?.achievedAt != null) continue; // 한 번 달성하면 되돌리지 않는다
    if (!isAchieved(save, id, opts, prev)) continue;
    save.achievements[id] = { achievedAt: now, claimedAt: row?.claimedAt ?? null, ...(quiet ? { quiet: true as const } : {}) };
    fresh.push(id);
  }
  if (quiet) save.achRev = ACHIEVEMENT_RULES.rev;
  return quiet ? [] : fresh;
}
