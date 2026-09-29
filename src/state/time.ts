// 멈춰 있던 시간을 한 번에 적용한다 — 계약은 docs/specs/modules.md "시간 처리 순서", 수치는 docs/specs/balance.md
//
// 순서는 시간 적용 → 값 변경 → 상태 판정 → 배너다. 여기서는 값 변경과 상태 판정을 하고 배너 거리를 돌려준다.
// 흐르는 시간은 부르는 쪽이 준다. PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.
// 에이전트가 작업한 시간(workMs)도 부르는 쪽이 준다. 그 시간만큼 친밀도와 포인트를 한 번 더 쌓는다.
// 기본 적립에 더하는 추가 이득이며 상한이 없다 (docs/specs/balance.md "에이전트 작업 보너스")
//
// 값 변경 대상
//   파티에 있는 개체   만복도 감소, 기분 감소, 친밀도 획득, 포인트 적립, 밥 쿨타임, 버프 잔여 시간
//   박스에 있는 개체   아무것도 하지 않는다. 박스 보관은 시간을 멈춘다
//   알                 준비 남은 시간, 돌봄 쿨타임
//
// 부분 진행은 ms 정수로 쌓는다. 그래서 짧은 틱을 여러 번 돌려도 긴 틱 한 번과 결과가 같다.
// 포인트만 예외다. 적립 속도가 친밀도에 달려 있는데 친밀도는 구간 안에서도 오른다.
// 구간 시작 시점의 친밀도로 셈해서 소급을 막는다. 그래서 틱을 잘게 나누면 포인트가 조금 더 정확해진다.
import { evaluate } from "../achievement/core.js";
import { unlockByRules } from "../dex/unlocks.js";
import { queueTutorials } from "../tutorial/core.js";
import { MOOD_RULES, TIME_V3_RULES } from "../save/rules.js";
import type { BuffV3, PetV3, SaveV3 } from "../shared/save-v3";

export type FullnessZone = "full" | "normal" | "hungry" | "starving";

export interface HungerEnter {
  petId: string;
  zone: FullnessZone; // hungry 또는 starving 에 들어간 순간만 알린다
}

export interface TickEvents {
  achieved: string[]; // 이번에 달성한 업적
  hatchReady: string[]; // 이번에 준비가 끝난 알
  hungerEnter: HungerEnter[]; // 배고픔·매우 배고픔 구간에 들어간 개체
  pointsGained: number;
  affinityGained: { petId: string; gained: number }[];
}

export const zoneOf = (fullness: number): FullnessZone => {
  const { zone } = TIME_V3_RULES;
  if (fullness >= zone.full) return "full";
  if (fullness >= zone.normal) return "normal";
  if (fullness >= zone.hungry) return "hungry";
  return "starving";
};

// 말풍선은 배고픔과 매우 배고픔에 들어갈 때만 한 번 띄운다
const NOTIFY_ZONES: readonly FullnessZone[] = ["hungry", "starving"];

// 버프의 추가 배율을 더한다. 기준 100 에 든든함 +100, 신남 +50, 들뜸 +20.
// 신남과 들뜸은 곱하지도 더하지도 않는다 — 신남이 있으면 들뜸은 세지 않는다 (제안, 사용자 확인 전)
export function buffPercent(buffs: BuffV3[]): number {
  let sum = 100;
  const seen = new Set<string>();
  const excited = buffs.some((b) => b.kind === "long-play" && b.remainMs > 0);
  for (const b of buffs) {
    if (b.remainMs <= 0 || seen.has(b.kind) || (excited && b.kind === "short-play")) continue;
    seen.add(b.kind);
    sum += TIME_V3_RULES.buffBonusPercent[b.kind] ?? 0;
  }
  return sum;
}

// 친밀도 증가 배율(백분율) — 버프를 더한 값에 만복도 구간의 디버프를 곱한다
export const affinityPercent = (pet: PetV3): number =>
  Math.round((buffPercent(pet.buffs) * TIME_V3_RULES.zonePercent[zoneOf(pet.fullness)]) / 100);

// 남은 시간을 줄인다. 0 아래로 내려가지 않는다
const countDown = (remain: number, elapsed: number): number => Math.max(0, remain - elapsed);

function tickBuffs(pet: PetV3, elapsed: number): void {
  const left: BuffV3[] = [];
  for (const b of pet.buffs) {
    const remainMs = countDown(b.remainMs, elapsed);
    if (remainMs > 0) left.push({ kind: b.kind, remainMs });
  }
  pet.buffs = left;
}

// 파티에 있는 개체 식별자 — 숨겨도 시간은 흐른다
const partyPetIds = (save: SaveV3): string[] =>
  save.party.slots.filter((s) => s.state === "pokemon" && s.petId).map((s) => s.petId as string);

export interface TimeInput {
  workMs?: number; // 이 구간 중 에이전트가 작업한 시간. 흐른 시간을 넘지 않는다
}

export function applyTime(save: SaveV3, elapsedMs: number, now: number, input: TimeInput = {}): TickEvents {
  const events: TickEvents = { achieved: [], hatchReady: [], hungerEnter: [], pointsGained: 0, affinityGained: [] };
  const elapsed = Math.max(0, Math.round(elapsedMs));
  save.lastTickAt = now;
  if (elapsed === 0) return events;
  const work = Math.min(elapsed, Math.max(0, Math.round(input.workMs ?? 0)));
  const earning = elapsed + work; // 친밀도·포인트를 쌓는 시간. 작업한 시간은 두 번 센다

  const { fullnessDropMs, affinityGainMs, pointGainMs } = TIME_V3_RULES;
  const inParty = new Set(partyPetIds(save));
  let pointWeighted = 0;

  for (const pet of save.pets) {
    if (!inParty.has(pet.id)) continue;
    const before = zoneOf(pet.fullness);

    // 포인트 — 이 구간 동안 가지고 있던 친밀도로 셈한다. 구간 중간에 오른 친밀도를 소급하지 않는다
    pointWeighted += Math.round((earning * (100 + pet.affinity)) / 100);

    // 만복도 — 부분 진행을 쌓아 1씩 줄인다
    pet.fullnessProgressMs += elapsed;
    const drop = Math.floor(pet.fullnessProgressMs / fullnessDropMs);
    if (drop > 0) {
      pet.fullnessProgressMs -= drop * fullnessDropMs;
      pet.fullness = Math.max(0, pet.fullness - drop);
    }

    // 친밀도 — 버프와 디버프를 반영한 가중 시간으로 쌓는다. 줄어든 만복도를 기준으로 본다
    const percent = affinityPercent(pet);
    pet.affinityProgressMs += Math.round((earning * percent) / 100);
    // 오늘 작업 보너스로 쌓은 친밀도 진행(ms). 저장은 정수만 받으므로 ms 로 둔다.
    // 친밀도로 보일 때는 affinityGainMs 로 나눈다 (docs/specs/game.md "오늘 날짜의 파티 전체 작업 적립")
    if (work > 0) pet.daily.work += Math.round((work * percent) / 100);
    const gain = Math.floor(pet.affinityProgressMs / affinityGainMs);
    if (gain > 0) {
      pet.affinityProgressMs -= gain * affinityGainMs;
      const next = Math.min(100, pet.affinity + gain);
      if (next !== pet.affinity) events.affinityGained.push({ petId: pet.id, gained: next - pet.affinity });
      pet.affinity = next;
    }

    // 기분 — 부분 진행을 쌓아 1씩 줄인다. 줄어든 만복도의 구간으로 배율을 정한다. 보이기만 하는 값이다
    pet.moodProgressMs += Math.round((elapsed * MOOD_RULES.zonePercent[zoneOf(pet.fullness)]) / 100);
    const moodDrop = Math.floor(pet.moodProgressMs / MOOD_RULES.dropMs);
    if (moodDrop > 0) {
      pet.moodProgressMs -= moodDrop * MOOD_RULES.dropMs;
      pet.mood = Math.max(0, pet.mood - moodDrop);
    }

    pet.feedCooldownMs = countDown(pet.feedCooldownMs, elapsed);
    pet.playCooldownMs = countDown(pet.playCooldownMs, elapsed);
    pet.playWindowMs = countDown(pet.playWindowMs, elapsed);
    if (pet.playWindowMs === 0) pet.playStreak = 0; // 창이 닫히면 처음부터 다시 센다
    tickBuffs(pet, elapsed);

    const after = zoneOf(pet.fullness);
    if (after !== before && NOTIFY_ZONES.includes(after)) events.hungerEnter.push({ petId: pet.id, zone: after });
  }

  save.totals.workMs += work;
  save.points.progressMs += pointWeighted;
  const points = Math.floor(save.points.progressMs / pointGainMs);
  if (points > 0) {
    save.points.progressMs -= points * pointGainMs;
    save.points.balance += points;
    events.pointsGained = points;
  }

  // 알 — 준비 시간. 준비가 끝나도 직접 열어야 부화한다
  for (const egg of save.eggs) {
    const was = egg.ready;
    egg.remainMs = countDown(egg.remainMs, elapsed);
    if (egg.remainMs === 0) egg.ready = true;
    if (!was && egg.ready) events.hatchReady.push(egg.id);
  }

  // 상태 판정 — 배너 순서는 부화 → 진화 → 업적이다. 진화 판정은 아직 없다
  unlockByRules(save, now);
  queueTutorials(save, now);
  events.achieved = evaluate(save, now);
  return events;
}
