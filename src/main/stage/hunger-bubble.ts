// 배고픔·심심함 말풍선의 때 — 그 단계에 들어갈 때 한 번 띄우고, 머무는 동안 되풀이한다.
// 배고픔은 10분, 매우 배고픔은 5분마다 (2026-09-27 사용자 결정 "배고픔 말풍선 은 10분에 한번씩, 매우배고픔은 5분에 한번씩").
// 심심해·지루해도 같은 간격이다 (2026-10-05 돌봄 개편 — 제안을 받아들임)
// 시각은 메모리에만 둔다 — 앱을 다시 켜면 처음부터 센다. Electron 을 모르는 순수 상태기
import { boredStepOf, zoneOf } from "../../state/time";

export const HUNGER_BUBBLE_RULES = {
  repeatMs: { hungry: 10 * 60_000, starving: 5 * 60_000 },
} as const;

export const BORED_BUBBLE_RULES = {
  repeatMs: { bored: 10 * 60_000, tired: 5 * 60_000 },
} as const;

export interface LevelBubbles<L extends string, P> {
  // 지금 말풍선을 띄울 마리 — 무대에 나온 마리만 넘긴다. 넘기지 않은 마리의 기록은 지운다
  due(pets: ReadonlyArray<P>, now: number): Array<{ id: string; level: L }>;
}

// 단계 말풍선 상태기 — levelOf 가 null 이면 단계 밖이다. 단계가 바뀌면 바로, 같은 단계면 repeatMs 마다 다시 띄운다
function createLevelBubbles<L extends string, P extends { id: string }>(levelOf: (pet: P) => L | null, repeatMs: Readonly<Record<L, number>>): LevelBubbles<L, P> {
  const last = new Map<string, { level: L; at: number }>();
  return {
    due(pets, now) {
      const out: Array<{ id: string; level: L }> = [];
      const seen = new Set<string>();
      for (const pet of pets) {
        seen.add(pet.id);
        const level = levelOf(pet);
        if (level === null) {
          last.delete(pet.id); // 단계를 벗어났다 — 다시 들어가면 바로 띄운다
          continue;
        }
        const prev = last.get(pet.id);
        if (prev && prev.level === level && now - prev.at < repeatMs[level]) continue;
        last.set(pet.id, { level, at: now });
        out.push({ id: pet.id, level });
      }
      for (const id of [...last.keys()]) if (!seen.has(id)) last.delete(id);
      return out;
    },
  };
}

type HungerLevel = keyof typeof HUNGER_BUBBLE_RULES.repeatMs;
type BoredLevel = keyof typeof BORED_BUBBLE_RULES.repeatMs;

export function createHungerBubbles(): LevelBubbles<HungerLevel, { id: string; fullness: number }> {
  return createLevelBubbles((pet) => {
    const zone = zoneOf(pet.fullness);
    return zone === "hungry" || zone === "starving" ? zone : null;
  }, HUNGER_BUBBLE_RULES.repeatMs);
}

export function createBoredBubbles(): LevelBubbles<BoredLevel, { id: string; boredom: number }> {
  return createLevelBubbles((pet) => boredStepOf(pet.boredom), BORED_BUBBLE_RULES.repeatMs);
}
