// 업적 달성 판정과 보상 수령 — 규칙은 docs/specs/game.md "파티 칸과 업적", 이름과 보상은 data/achievements.json
//
// 조건은 코드가 판정한다. 업적마다 보는 것이 달라서 데이터로 적을 수 없다.
//   show-two        파티의 두 마리를 동시에 꺼냈다. 숨긴 채 배치만 한 것은 아니다
//   starter-final   포켓몬 한 마리를 처음으로 기준 레벨(data 의 level, 50) 이상으로 레벨업했다
//                   키는 옛 조건(첫 포켓몬 최종 진화)의 이름이다. 이미 달성·수령한 저장을 그대로 인정하려고 두었다 (2026-09-27)
//                   레벨업은 거래 전후 저장을 비교해 본다. 교환으로 받은 개체는 거래 전에 없으므로 받는 순간은 세지 않는다
//   work-100h       에이전트와 함께 일한 누적 시간 totals.workMs ≥ data 의 hours(100) — 보상 라프라스
//   party-three     파티 칸에 든 포켓몬 수 ≥ data 의 count(3). 숨긴 개체도 센다 — 보상 메타몽
//                   두 업적은 옛 해금 규칙(work · party)을 옮긴 것이다. 기준 값은 옛 규칙과 같다 (2026-09-29 사용자 결정)
// 보상은 두 종류다
//   party-slot      업적으로 여는 파티 칸 하나를 연다
//   { pokemon }     그 종의 새 개체 하나 — 상점 구매와 같은 경로(성격 무작위, 이로치 아님, 빈 파티 칸 없으면 박스)
// 달성은 한 번 기록하면 되돌리지 않는다. 두 마리를 다시 숨겨도 달성은 남는다.
// 보상은 업적창에서 사용자가 직접 받는다. 업적당 한 번만 받는다.
import { loadJson, isMetaKey, type DexOptions } from "../dex/data.js";
import type { SaveV3 } from "../shared/save-v3";
import { openSlot } from "../party/slots.js";
import { randomNature } from "../dex/natures.js";
import { newPet, nextPetId, recordDex } from "../party/create.js";
import { placeNew } from "../shop/buy.js";
import type { Rand } from "../egg/hatch";

export type AchievementReward = "party-slot" | { pokemon: string };

export interface AchievementDef {
  ko: string;
  en?: string; // 영어 이름 — 다른 데이터(도구·알)처럼 함께 둔다. 화면은 지금 한국어만 쓴다
  desc?: string; // 이름만으로 조건이 드러나면 두지 않는다 — 업적창에 설명 줄이 그려지지 않는다
  reward: AchievementReward;
  level?: number; // starter-final 의 기준 레벨
  hours?: number; // work-100h 의 기준 시간
  count?: number; // party-three 의 기준 마리 수
}

export type ClaimFailure = "no-achievement" | "not-achieved" | "already-claimed" | "no-locked-slot";

export interface ClaimResult {
  ok: boolean;
  reason?: ClaimFailure;
  id?: string;
  slotIndex?: number; // 파티 칸 보상이면 연 칸, 포켓몬 보상이면 넣은 파티 칸
  petId?: string; // 포켓몬 보상으로 만든 개체
  toBox?: boolean; // 포켓몬 보상이 박스로 갔다
}

// 보상으로 주는 종 — 포켓몬 보상이 아니면 null
export const rewardPokemon = (def: AchievementDef): string | null =>
  typeof def.reward === "object" && def.reward !== null && typeof def.reward.pokemon === "string" ? def.reward.pokemon : null;

const table = (opts?: DexOptions): Record<string, AchievementDef> => loadJson<Record<string, AchievementDef>>("achievements.json", opts);

export const defs = (opts?: DexOptions): [string, AchievementDef][] =>
  Object.entries(table(opts)).filter(([id]) => !isMetaKey(id));

export const defOf = (id: string, opts?: DexOptions): AchievementDef | null => (isMetaKey(id) ? null : table(opts)[id] ?? null);

// 업적 보상으로 주는 종 전부 — 해금 규칙 생성기가 이 종들을 기본형에서 뺀다 (src/tools/build-unlocks.ts)
export const rewardSpecies = (opts?: DexOptions): string[] =>
  defs(opts)
    .map(([, def]) => rewardPokemon(def))
    .filter((slug): slug is string => slug !== null);

// 지금 꺼내 놓은 개체 수 — 숨긴 개체는 세지 않는다
const shownCount = (save: SaveV3): number =>
  save.party.slots.filter((s) => s.state === "pokemon" && s.petId && s.hidden !== true).length;

// 파티 칸에 든 개체 수 — 숨긴 개체도 센다
const partyCount = (save: SaveV3): number => save.party.slots.filter((s) => s.state === "pokemon" && s.petId).length;

// 이번 거래에서 기준 레벨 이상으로 레벨업한 개체가 있는가 — 거래 전에도 있던 같은 개체의 레벨이 올랐을 때만 센다
function leveledTo(save: SaveV3, prev: SaveV3 | undefined, level: number): boolean {
  if (!prev) return false;
  return save.pets.some((p) => {
    const before = prev.pets.find((b) => b.id === p.id);
    return !!before && p.level > before.level && p.level >= level;
  });
}

// 업적 하나의 조건을 지금 채웠는가. prev 는 거래 전 저장이다 — 레벨업처럼 변화를 보는 조건이 쓴다
export function isAchieved(save: SaveV3, id: string, opts?: DexOptions, prev?: SaveV3): boolean {
  if (id === "show-two") return shownCount(save) >= 2;
  if (id === "starter-final") return leveledTo(save, prev, defOf(id, opts)?.level ?? Number.POSITIVE_INFINITY);
  if (id === "work-100h") return save.totals.workMs >= (defOf(id, opts)?.hours ?? Number.POSITIVE_INFINITY) * 3600_000;
  if (id === "party-three") return partyCount(save) >= (defOf(id, opts)?.count ?? Number.POSITIVE_INFINITY);
  return false;
}

// 달성을 기록한다. 이번에 새로 달성한 업적을 돌려준다 — 배너가 쓴다
// prev 를 주지 않으면(시간 흐름) 레벨업 조건은 달성하지 않는다. 시간만으로는 레벨이 오르지 않는다
export function evaluate(save: SaveV3, now: number, opts?: DexOptions, prev?: SaveV3): string[] {
  const fresh: string[] = [];
  for (const [id] of defs(opts)) {
    const row = save.achievements[id];
    if (row?.achievedAt != null) continue; // 한 번 달성하면 되돌리지 않는다
    if (!isAchieved(save, id, opts, prev)) continue;
    save.achievements[id] = { achievedAt: now, claimedAt: row?.claimedAt ?? null };
    fresh.push(id);
  }
  return fresh;
}

// 보상 수령 — 업적당 한 번
//   파티 칸 보상  칸 +1 — 첫 잠긴 칸을 연다
//   포켓몬 보상   새 개체를 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 박스는 가득 차면 새 박스를 더해 늘 들어간다 (src/box/slots.ts putPet)
export function claim(save: SaveV3, id: string, now: number, opts?: DexOptions, rand: Rand = Math.random): ClaimResult {
  const def = defOf(id, opts);
  if (!def) return { ok: false, reason: "no-achievement" };
  const row = save.achievements[id];
  if (!row || row.achievedAt == null) return { ok: false, reason: "not-achieved" };
  if (row.claimedAt != null) return { ok: false, reason: "already-claimed" };

  const species = rewardPokemon(def);
  if (species) {
    const petId = nextPetId(save);
    const pet = newPet({ id: petId, species, shiny: false, nature: randomNature(rand, opts).id, now });
    save.pets.push(pet);
    recordDex(save, species, false);
    const where = placeNew(save, petId);
    save.achievements[id] = { achievedAt: row.achievedAt, claimedAt: now };
    return { ok: true, id, petId, ...where };
  }

  const i = openSlot(save.party.slots, "achievement");
  if (i < 0) return { ok: false, reason: "no-locked-slot" };
  save.achievements[id] = { achievedAt: row.achievedAt, claimedAt: now };
  return { ok: true, id, slotIndex: i };
}
