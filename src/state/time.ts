// 멈춰 있던 시간을 한 번에 적용한다 — 계약은 docs/specs/modules.md "시간 처리 순서", 수치는 docs/specs/balance.md
//
// 순서는 시간 적용 → 값 변경 → 상태 판정 → 배너다. 여기서는 값 변경을 하고 배너 거리를 돌려준다. 상태 판정은 src/tx/settle.ts
// 흐르는 시간은 부르는 쪽이 준다. PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.
// 에이전트가 작업한 시간(workMs)도 부르는 쪽이 준다. 작업 시간 누적(totals.workMs)에만 더한다 — 업적과 로토무 모습 바꾸기가 쓴다.
// 작업 시간으로 친밀도·포인트를 더 쌓지 않는다 (2026-10-05 사용자 결정 "cli 적립2배는 없애고", docs/specs/balance.md "에이전트 작업 시간")
//
// 값 변경 대상
//   파티에 있는 개체   만복도 감소, 기분 감소, 친밀도 획득, 포인트 적립, 밥 쿨타임, 버프 잔여 시간. 숨겨도 같다
//   다른 프리셋 개체   포인트 적립만 — 0.2배, 돌봄 보너스 없음. 나머지 시간은 멈춘다 (docs/specs/balance.md "적립 배율")
//   박스에 있는 개체   아무것도 하지 않는다. 박스 보관은 시간을 멈춘다
//   알                 준비 남은 시간, 돌봄 쿨타임
//
// 부분 진행은 ms 정수로 쌓는다. 그래서 짧은 틱을 여러 번 돌려도 긴 틱 한 번과 결과가 같다.
// 포인트만 예외다. 적립 속도가 친밀도·기분·버프에 달려 있는데 이 값들은 구간 안에서도 바뀐다.
// 구간 시작 시점의 값으로 셈해서 소급을 막는다. 그래서 틱을 잘게 나누면 포인트가 조금 더 정확해진다.
import { tickMega } from "../dex/mega.js";
import { tickFormWork } from "../dex/forms.js";
import { MOOD_RULES, TIME_RULES } from "./rules.js";
import { PET_RULES } from "../party/rules.js";
import { activePreset, allPresets } from "../party/presets.js";
import type { BuffV3, PetV3, SaveV3 } from "../shared/save-v3";
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
    sum += TIME_RULES.buffBonusPercent[b.kind] ?? 0;
  }
  return sum;
}

// 친밀도 증가 배율(백분율) — 버프를 더한 값에 만복도 구간의 디버프를 곱한다
export const affinityPercent = (pet: PetV3): number =>
  Math.round((buffPercent(pet.buffs) * TIME_RULES.zonePercent[zoneOf(pet.fullness)]) / 100);

// 돌봄 보너스 — 포인트 적립 배율(백분율). 친밀도가 100 인 개체만 받는다 (2026-10-02 사용자 결정, docs/specs/balance.md "돌봄 보너스")
// 기분 단계 보너스와 버프 보너스를 더한다. 배고픔은 포인트를 직접 깎지 않는다 — 기분 감소 배율로만 작용한다
export function carePercent(pet: PetV3): number {
  return 100 + careParts(pet).reduce((sum, part) => sum + part.percent, 0);
}

// 돌봄 보너스의 내역 — 기분 단계, 그다음 켜진 버프. 파티 상세 기기 창의 `포인트 적립` 줄이 보인다 (src/tx/snapshot.ts)
// 버프는 buffPercent 와 같은 규칙으로 센다 — 같은 버프는 한 번, 신남이 있으면 들뜸은 세지 않는다
export function careParts(pet: PetV3): { kind: "mood" | BuffV3["kind"]; percent: number }[] {
  if (pet.affinity < 100) return [];
  const parts: { kind: "mood" | BuffV3["kind"]; percent: number }[] = [];
  const mood = MOOD_RULES.pointBonus.find((b) => pet.mood >= b.min)?.percent ?? 0;
  if (mood > 0) parts.push({ kind: "mood", percent: mood });
  const excited = pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0);
  const seen = new Set<string>();
  for (const b of pet.buffs) {
    if (b.remainMs <= 0 || seen.has(b.kind) || (excited && b.kind === "short-play")) continue;
    seen.add(b.kind);
    const percent = TIME_RULES.buffBonusPercent[b.kind] ?? 0;
    if (percent > 0) parts.push({ kind: b.kind, percent });
  }
  return parts;
}

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
    // 다른 프리셋 — 포인트만 0.2배로 쌓는다. 돌봄 보너스는 받지 않는다(멈춘 버프가 계속 남기 때문)
    if (others.has(pet.id)) {
      pointWeighted += Math.round((elapsed * (100 + pet.affinity) * TIME_RULES.otherPresetPointPercent) / 10_000);
      continue;
    }
    if (!inParty.has(pet.id)) continue;
    const before = zoneOf(pet.fullness);

    // 포인트 — 이 구간 동안 가지고 있던 친밀도로 셈한다. 구간 중간에 오른 친밀도를 소급하지 않는다.
    // 돌봄 보너스도 구간 시작 시점의 기분과 버프로 셈한다
    pointWeighted += Math.round((elapsed * (100 + pet.affinity) * carePercent(pet)) / 10_000);

    // 만복도 — 부분 진행을 쌓아 1씩 줄인다
    pet.fullnessProgressMs += elapsed;
    const drop = Math.floor(pet.fullnessProgressMs / fullnessDropMs);
    if (drop > 0) {
      pet.fullnessProgressMs -= drop * fullnessDropMs;
      pet.fullness = Math.max(0, pet.fullness - drop);
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

    // 기분 — 부분 진행을 쌓아 1씩 줄인다. 줄어든 만복도의 구간으로 배율을 정한다
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
    tickMega(pet, elapsed); // 친밀도 100 뒤 파티에서 보낸 시간 — 메가진화 조건 (src/dex/mega.ts)
    tickFormWork(pet, work); // 파티에서 받은 작업 시간 — 로토무 모습 바꾸기 해금 (src/dex/forms.ts)

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
