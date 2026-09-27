// 배고픔 말풍선의 때 — 배고픔·매우 배고픔 구간에 들어갈 때 한 번 띄우고, 그 구간에 머무는 동안 되풀이한다.
// 배고픔은 10분, 매우 배고픔은 5분마다 (2026-09-27 사용자 결정 "배고픔 말풍선 은 10분에 한번씩, 매우배고픔은 5분에 한번씩").
// 시각은 메모리에만 둔다 — 앱을 다시 켜면 처음부터 센다. Electron 을 모르는 순수 상태기
import { zoneOf } from "../state/time";

export const HUNGER_BUBBLE_RULES = {
  repeatMs: { hungry: 10 * 60_000, starving: 5 * 60_000 },
} as const;

type BubbleZone = keyof typeof HUNGER_BUBBLE_RULES.repeatMs;
const isBubbleZone = (zone: string): zone is BubbleZone => zone in HUNGER_BUBBLE_RULES.repeatMs;

export interface HungerBubbles {
  // 지금 말풍선을 띄울 마리 — 무대에 나온 마리만 넘긴다. 넘기지 않은 마리의 기록은 지운다
  due(pets: ReadonlyArray<{ id: string; fullness: number }>, now: number): Array<{ id: string; zone: BubbleZone }>;
}

export function createHungerBubbles(): HungerBubbles {
  const last = new Map<string, { zone: BubbleZone; at: number }>();
  return {
    due(pets, now) {
      const out: Array<{ id: string; zone: BubbleZone }> = [];
      const seen = new Set<string>();
      for (const pet of pets) {
        seen.add(pet.id);
        const zone = zoneOf(pet.fullness);
        if (!isBubbleZone(zone)) {
          last.delete(pet.id); // 구간을 벗어났다 — 다시 들어가면 바로 띄운다
          continue;
        }
        const prev = last.get(pet.id);
        if (prev && prev.zone === zone && now - prev.at < HUNGER_BUBBLE_RULES.repeatMs[zone]) continue;
        last.set(pet.id, { zone, at: now });
        out.push({ id: pet.id, zone });
      }
      for (const id of [...last.keys()]) if (!seen.has(id)) last.delete(id);
      return out;
    },
  };
}
