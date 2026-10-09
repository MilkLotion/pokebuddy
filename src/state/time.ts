// 멈춰 있던 시간을 한 번에 적용한다 — 계약은 docs/specs/modules.md "시간 처리 순서", 수치는 docs/specs/balance.md
//
// 순서는 시간 적용 → 값 변경 → 상태 판정 → 배너다. 여기서는 값 변경을 하고 배너 거리를 돌려준다. 상태 판정은 src/tx/settle.ts
// 흐르는 시간은 부르는 쪽이 준다. PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.
// 에이전트가 작업한 시간(workMs)도 부르는 쪽이 준다. 작업 시간 누적(totals.workMs)에 더하고, 심심함을 한 번 더 쌓는다(일할수록 심심해진다).
// 작업 시간으로 친밀도·포인트를 더 쌓지 않는다 (2026-10-05 사용자 결정 "cli 적립2배는 없애고", docs/specs/balance.md "에이전트 작업 시간")
//
// 값 변경 대상
//   파티에 있는 개체   만복도 감소, 심심함 증가, 친밀도 획득, 포인트 적립, 쿨타임, 버프 잔여 시간. 숨겨도 같다
//   다른 프리셋 개체   포인트 적립만 — 0.2배, 버프·손해 없음. 나머지 시간은 멈춘다 (docs/specs/balance.md "적립 배율")
//   박스에 있는 개체   아무것도 하지 않는다. 박스 보관은 시간을 멈춘다
//   알                 준비 남은 시간, 돌봄 쿨타임
//
// 부분 진행은 ms 정수로 쌓는다. 그래서 짧은 틱을 여러 번 돌려도 긴 틱 한 번과 결과가 같다.
// 포인트만 예외다. 적립 속도가 친밀도·만복도·심심함·버프에 달려 있는데 이 값들은 구간 안에서도 바뀐다.
// 구간 시작 시점의 값으로 셈해서 소급을 막는다. 그래서 틱을 잘게 나누면 포인트가 조금 더 정확해진다.
import { tickMega } from "../dex/mega.js";
import { tickFormWork, tickPartyTime } from "../dex/forms.js";
import { BOREDOM_RULES, TIME_RULES } from "./rules.js";
import { PET_RULES } from "../party/rules.js";
import { activePreset, allPresets } from "../party/presets.js";
import type { BuffKind, BuffV3, PetV3, SaveV3 } from "../shared/save-v3";
import type { FullnessZone } from "../shared/save-v3.js";


export interface HungerEnter {
  petId: string;
  zone: FullnessZone; // hungry 또는 starving 에 들어간 순간만 알린다
}

export interface TimeEvents {
  hatchReady: string[]; // 이번에 준비가 끝난 알
  hungerEnter: HungerEnter[]; // 배고픔·매우 배고픔 구간에 들어간 개체
  pointsGained: number;
  affinityGained: { petId: string; gained: number }[];
}

export const zoneOf = (fullness: number): FullnessZone => {
  const { zone } = TIME_RULES;
  if (fullness >= zone.full) return "full";
  if (fullness >= zone.normal) return "normal";
  if (fullness >= zone.hungry) return "hungry";
  return "starving";
};

// 심심함 단계 — 보통이면 null. 심심해(50 이상)·지루해(80 이상) (BOREDOM_RULES.steps)
export type BoredStep = (typeof BOREDOM_RULES.steps)[number]["id"];
export const boredStepOf = (boredom: number): BoredStep | null => BOREDOM_RULES.steps.find((s) => boredom >= s.min)?.id ?? null;

// 말풍선은 배고픔과 매우 배고픔에 들어갈 때만 한 번 띄운다
const NOTIFY_ZONES: readonly FullnessZone[] = ["hungry", "starving"];

const hasBuff = (pet: Pick<PetV3, "buffs">, kind: BuffKind): boolean => pet.buffs.some((b) => b.kind === kind && b.remainMs > 0);

// 지금 세는 버프 — 남은 시간이 있는 것, 같은 버프는 한 번
export function activeBuffs(buffs: BuffV3[]): BuffKind[] {
  return [...new Set(buffs.filter((b) => b.remainMs > 0).map((b) => b.kind))];
}

// 버프의 추가 배율을 더한다. 기준 100 에 든든함 +60, 신남 +60
export const buffPercent = (buffs: BuffV3[]): number => 100 + activeBuffs(buffs).reduce((sum, kind) => sum + (TIME_RULES.buffBonusPercent[kind] ?? 0), 0);

// 친밀도 증가 배율(백분율) — 버프를 더한 값에 만복도 구간의 디버프를 곱한다 (2026-10-05 "친밀도 오르는 비율은 기존처럼 유지")
export const affinityPercent = (pet: PetV3): number =>
  Math.round((buffPercent(pet.buffs) * TIME_RULES.zonePercent[zoneOf(pet.fullness)]) / 100);

// 포인트 적립 배율의 내역 — 켜진 버프(+), 만복도 구간·심심함 단계의 손해(−). 파티 상세 기기 창의 `포인트 적립` 줄이 보인다 (src/view/pet.ts)
// 친밀도와 상관없이 건다 (2026-10-05 사용자 결정 — 돌봄 개편, 그 전의 "친밀도 100 일 때만 돌봄 보너스" 를 대신한다)
export type PointPartKind = BuffKind | "hungry" | "starving" | BoredStep;
export function pointParts(pet: PetV3): { kind: PointPartKind; percent: number }[] {
  const parts: { kind: PointPartKind; percent: number }[] = [];
  for (const kind of activeBuffs(pet.buffs)) {
    const percent = TIME_RULES.buffBonusPercent[kind] ?? 0;
    if (percent > 0) parts.push({ kind, percent });
  }
  const zone = zoneOf(pet.fullness);
  const hunger = TIME_RULES.zonePointPenalty[zone];
  if (hunger > 0 && (zone === "hungry" || zone === "starving")) parts.push({ kind: zone, percent: -hunger });
  const step = BOREDOM_RULES.steps.find((s) => pet.boredom >= s.min);
  if (step) parts.push({ kind: step.id, percent: -step.penalty });
  return parts;
}

// 포인트 적립 배율(백분율) — 100 + 버프 − 손해. 곱하지 않고 더한다. 바닥 10 (2026-10-05 사용자 결정 "더하는 방식으로")
export const pointPercent = (pet: PetV3): number =>
  Math.max(TIME_RULES.pointFloorPercent, 100 + pointParts(pet).reduce((sum, part) => sum + part.percent, 0));

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

// 적용하지 않은 프리셋의 개체 식별자 — 포인트만 쌓는다
function otherPresetPetIds(save: SaveV3): Set<string> {
  const ids = new Set<string>();
  const active = activePreset(save);
  for (const { preset, slots } of allPresets(save)) {
    if (preset === active) continue;
    for (const s of slots) if (s.state === "pokemon" && s.petId) ids.add(s.petId);
  }
  return ids;
}

export interface TimeInput {
  workMs?: number; // 이 구간 중 에이전트가 작업한 시간. 흐른 시간을 넘지 않는다
}

// 마지막 틱 뒤로 흐른 시간 — 상한(TIME_RULES.maxElapsedMs, 30초)을 넘는 틈은 앱 종료·절전·잠금으로 보고 버린다. 시각이 뒤로 가면 0
export const elapsedSince = (save: Pick<SaveV3, "lastTickAt">, now: number): number => Math.min(TIME_RULES.maxElapsedMs, Math.max(0, now - save.lastTickAt));

export function applyTime(save: SaveV3, elapsedMs: number, now: number, input: TimeInput = {}): TimeEvents {
  const events: TimeEvents = { hatchReady: [], hungerEnter: [], pointsGained: 0, affinityGained: [] };
  const elapsed = Math.max(0, Math.round(elapsedMs));
  save.lastTickAt = now;
  if (elapsed === 0) return events;
  const work = Math.min(elapsed, Math.max(0, Math.round(input.workMs ?? 0)));

  const { fullnessDropMs, affinityGainMs, pointGainMs } = TIME_RULES;
  const inParty = new Set(partyPetIds(save));
  const others = otherPresetPetIds(save);
  let pointWeighted = 0;

  for (const pet of save.pets) {
    // 다른 프리셋 — 포인트만 0.2배로 쌓는다. 버프·손해는 받지 않는다(멈춘 버프·게이지가 계속 남기 때문)
    if (others.has(pet.id)) {
      pointWeighted += Math.round((elapsed * (100 + pet.affinity) * TIME_RULES.otherPresetPointPercent) / 10_000);
      continue;
    }
    if (!inParty.has(pet.id)) continue;
    const before = zoneOf(pet.fullness);

    // 포인트 — 이 구간 동안 가지고 있던 친밀도·만복도·심심함·버프로 셈한다. 구간 중간의 변화를 소급하지 않는다
    pointWeighted += Math.round((elapsed * (100 + pet.affinity) * pointPercent(pet)) / 10_000);

    // 만복도 — 부분 진행을 쌓아 1씩 줄인다. 든든함(프리미엄먹이)이 남은 동안은 줄지 않는다
    if (!hasBuff(pet, "premium-food")) {
      pet.fullnessProgressMs += elapsed;
      const drop = Math.floor(pet.fullnessProgressMs / fullnessDropMs);
      if (drop > 0) {
        pet.fullnessProgressMs -= drop * fullnessDropMs;
        pet.fullness = Math.max(0, pet.fullness - drop);
      }
    }

    // 심심함 — 흐른 시간에 에이전트 작업 시간을 한 번 더 더해 쌓는다. 장난감 신남(long-play)이 남은 동안은 쌓이지 않는다
    if (!hasBuff(pet, "long-play")) {
      pet.boredomProgressMs += elapsed + work;
      const rise = Math.floor(pet.boredomProgressMs / BOREDOM_RULES.riseMs);
      if (rise > 0) {
        pet.boredomProgressMs -= rise * BOREDOM_RULES.riseMs;
        pet.boredom = Math.min(PET_RULES.statMax, pet.boredom + rise);
      }
    }

    // 친밀도 — 버프와 디버프를 반영한 가중 시간으로 쌓는다. 줄어든 만복도를 기준으로 본다
    const percent = affinityPercent(pet);
    pet.affinityProgressMs += Math.round((elapsed * percent) / 100);
    const gain = Math.floor(pet.affinityProgressMs / affinityGainMs);
    if (gain > 0) {
      pet.affinityProgressMs -= gain * affinityGainMs;
      const next = Math.min(PET_RULES.statMax, pet.affinity + gain);
      if (next !== pet.affinity) events.affinityGained.push({ petId: pet.id, gained: next - pet.affinity });
      pet.affinity = next;
    }

    pet.feedCooldownMs = countDown(pet.feedCooldownMs, elapsed);
    pet.playCooldownMs = countDown(pet.playCooldownMs, elapsed);
    tickBuffs(pet, elapsed);
    tickMega(pet, elapsed); // 친밀도 100 뒤 파티에서 보낸 시간 — 메가진화 조건 (src/dex/mega.ts)
    tickFormWork(pet, work); // 파티에서 받은 작업 시간 — 로토무 모습 바꾸기 해금 (src/dex/forms.ts)
    tickPartyTime(pet, elapsed); // 파티에서 보낸 시간 — 개굴닌자 파티 시간 업적 (src/dex/forms.ts)

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

  // 상태 판정(메가스톤·해금·튜토리얼·업적)은 부르는 쪽이 후처리 사슬로 한다 (src/tx/settle.ts, src/tx/tick.ts applyTimeAndSettle)
  return events;
}
