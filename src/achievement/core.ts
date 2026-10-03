// 업적 달성 판정과 보상 수령 — 규칙은 docs/specs/game.md "파티 칸과 업적", 이름·분류·조건·보상은 data/achievements.json
//
// 조건은 데이터의 cond 로 적는다. 판정과 진행도는 여기서 한다 (2026-10-03 업적 개선, worklog/records/achievements/record.md)
//   dex       얻은 종 수 dex.obtained ≥ count. 도감 탭 머리의 `획득` 수와 같다(리전폼·특수 폼 포함)
//   region    도감 번호 from~to 를 모두 얻었다. 번호마다 기본형 하나를 얻으면 된다. 리전폼·특수 폼은 세지 않는다
//   species   적은 종을 모두 얻었다(dex.obtained). 종마다 그 슬러그 그대로 본다 — 다른 모습(오리진폼)은 세지 않는다
//   shiny     이로치로 얻은 종 수 dex.shinyObtained ≥ count
//   level     개체 하나를 기준 레벨 이상으로 레벨업했다. 거래 전후 저장을 비교한다 —
//             교환으로 받은 개체는 거래 전에 없으므로 받는 순간은 세지 않는다 (2026-09-27)
//   affinity  친밀도가 value 이상인 개체가 있다
//   evolve    진화 횟수 counts.evolved ≥ count
//   mega      메가스톤이 생긴 종 수 dex.megaOpened ≥ count
//   hatch     알에서 포켓몬이 나온 횟수 counts.hatched ≥ count
//   single    얻은 단일 포켓몬 종 수 ≥ count (src/dex/obtain.ts singleSpecies)
//   find      줍기 횟수 find.seq ≥ count
//   work      에이전트와 함께 일한 누적 시간 totals.workMs ≥ hours
//   streak    이어서 앱이 돈 날 수 counts.streak ≥ days. 하루를 거르면 1 로 돌아간다
//   trade     끝난 교환 횟수 counts.traded ≥ count
//   shown     파티의 개체를 count 마리 이상 동시에 꺼냈다. 숨긴 채 배치만 한 것은 아니다
//   party     파티 칸에 든 포켓몬 수 ≥ count. 숨긴 개체도 센다
// 옛 업적 네 개(show-two · starter-final · work-100h · party-three)는 키와 뜻을 그대로 둔다. 이미 달성·수령한 저장을 그대로 인정한다.
//   starter-final 의 키는 옛 조건(첫 포켓몬 최종 진화)의 이름이다 (2026-09-27)
// 보상은 다섯 종류다
//   party-slot        업적으로 여는 파티 칸 하나를 연다
//   { pokemon }       그 종의 새 개체 하나 — 상점 구매와 같은 경로(성격 무작위, 이로치 아님, 빈 파티 칸 없으면 박스).
//                     업적 보상 종은 모두 단일 포켓몬이다 (2026-10-03 사용자 결정 "업적에서 구하는 포켓몬들도 단일종으로", src/shop/catalog.ts singleSpecies).
//                     이미 얻은 종이면 개체를 주지 않고 수령만 기록한다 (docs/specs/game.md "단일 포켓몬")
//   { points }        포인트
//   { egg }           그 종류의 알 하나를 돌보미집에 넣는다. 빈 칸이 없거나 남은 종이 없으면 받지 못한다
//   { item, count? }  도구. 가방 상한으로 막지 않는다(우편 선물과 같다)
// 달성은 한 번 기록하면 되돌리지 않는다. 두 마리를 다시 숨겨도, 이어진 날이 끊겨도 달성은 남는다.
// 보상은 업적창에서 사용자가 직접 받는다. 업적당 한 번만 받는다.
import { loadJson, isMetaKey, type DexOptions } from "../dex/data.js";
import type { CountsV3, SaveV3 } from "../shared/save-v3";
import { localDate } from "../shared/clock.js";
import { openSlot } from "../party/slots.js";
import { countParty, slotsOfPreset } from "../party/presets.js";
import { rollGender } from "../dex/gender.js";
import { randomNature } from "../dex/natures.js";
import { regionalOf } from "../dex/regional.js";
import { profile } from "../dex/species.js";
import { hasRoom, newPet, nextPetId, placeNew, recordDex } from "../party/create.js";
import { rewardSpecies, singleSpecies } from "../dex/obtain.js";
import { achievementTable, type AchievementCond, type AchievementDef, type AchievementGroup } from "../dex/tables.js";
import { canGiveEgg, newEgg } from "../egg/pool.js";
import { ACHIEVEMENT_RULES } from "./rules.js";
import { EGG_RULES } from "../egg/rules.js";
import type { Rand } from "../egg/hatch";
import type { ReasonOf } from "../shared/names/reasons.js";

// 업적 표의 타입은 src/dex/tables.ts 에 있다 — 도감(src/dex/obtain.ts)도 같은 표를 읽는다
// [임시] 옛 자리의 다시 내보내기 — 가져다 쓰는 쪽(src/tx/snapshot.ts, src/tools)이 새 자리에서 가져오면 지운다
export type { AchievementCond, AchievementDef, AchievementGroup, AchievementReward } from "../dex/tables.js";
// 업적창의 분류 칩 — 순서는 GROUPS
export const GROUPS: readonly AchievementGroup[] = ["dex", "grow", "egg", "find", "together"];

export type ClaimFailure = ReasonOf<"no-achievement" | "not-achieved" | "already-claimed" | "no-locked-slot" | "box-full" | "daycare-full" | "egg-none">;

export interface ClaimResult {
  ok: boolean;
  reason?: ClaimFailure;
  id?: string;
  slotIndex?: number; // 파티 칸 보상이면 연 칸, 포켓몬 보상이면 넣은 파티 칸
  petId?: string; // 포켓몬 보상으로 만든 개체
  toBox?: boolean; // 포켓몬 보상이 박스로 갔다
  points?: number; // 포인트 보상으로 받은 양
  eggId?: string; // 알 보상으로 넣은 알
  item?: { id: string; count: number }; // 도구 보상
  skipped?: boolean; // 단일 포켓몬을 이미 얻어 개체를 주지 않았다
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// 보상을 종류별로 읽는다 — 그 종류가 아니면 null. 손으로 쓰는 데이터라 값의 모양도 본다
const rewardOf = (def: AchievementDef): Record<string, unknown> => (isObj(def.reward) ? def.reward : {});
// 보상으로 주는 종
export const rewardPokemon = (def: AchievementDef): string | null => {
  const v = rewardOf(def).pokemon;
  return typeof v === "string" ? v : null;
};
export const rewardPoints = (def: AchievementDef): number | null => {
  const v = rewardOf(def).points;
  return typeof v === "number" ? v : null;
};
export const rewardEgg = (def: AchievementDef): string | null => {
  const v = rewardOf(def).egg;
  return typeof v === "string" ? v : null;
};
export const rewardItem = (def: AchievementDef): { id: string; count: number } | null => {
  const r = rewardOf(def);
  if (typeof r.item !== "string") return null;
  return { id: r.item, count: typeof r.count === "number" && r.count > 0 ? r.count : 1 };
};

// [임시] 옛 이름 — 이 파일을 나눌 때(D5) achievementTable 을 바로 부른다
const table = achievementTable;

export const defs = (opts?: DexOptions): [string, AchievementDef][] =>
  Object.entries(table(opts)).filter(([id]) => !isMetaKey(id));

export const defOf = (id: string, opts?: DexOptions): AchievementDef | null => (isMetaKey(id) ? null : table(opts)[id] ?? null);

// [임시] 옛 자리의 다시 내보내기 — src/tools 가 새 자리(src/dex/obtain.ts)에서 가져오면 지운다
export { rewardSpecies };

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

// 얻은 기본형의 도감 번호 — 지방 완성이 쓴다. 리전폼·특수 폼(data/regional.json)은 세지 않는다.
// 판정은 1초마다 돈다. 얻은 종 목록이 그대로면 앞의 결과를 다시 쓴다
let dexMemo: { key: string; nums: Set<number> } | null = null;
function obtainedNumbers(save: SaveV3, opts?: DexOptions): Set<number> {
  const list = save.dex.obtained;
  const key = `${opts?.dataDir ?? ""}|${list.length}|${list[list.length - 1] ?? ""}`;
  if (dexMemo?.key === key) return dexMemo.nums;
  const nums = new Set<number>();
  for (const slug of list) {
    if (regionalOf(slug, opts)) continue;
    const dex = profile(slug, opts).dex;
    if (dex) nums.add(dex);
  }
  dexMemo = { key, nums };
  return nums;
}

// 조건의 지금 값 — 셀 수 없는 조건(레벨업·친밀도)은 null
function measure(save: SaveV3, cond: AchievementCond, opts?: DexOptions): number | null {
  switch (cond.kind) {
    case "dex": return save.dex.obtained.length;
    case "region": {
      const nums = obtainedNumbers(save, opts);
      let n = 0;
      for (let d = cond.from; d <= cond.to; d += 1) if (nums.has(d)) n += 1;
      return n;
    }
    case "species": return cond.species.filter((s) => save.dex.obtained.includes(s)).length;
    case "shiny": return save.dex.shinyObtained.length;
    case "evolve": return save.counts.evolved;
    case "mega": return save.dex.megaOpened?.length ?? 0;
    case "hatch": return save.counts.hatched;
    case "single": {
      const singles = singleSpecies(opts);
      return save.dex.obtained.filter((s) => singles.has(s)).length;
    }
    case "find": return save.find?.seq ?? 0;
    case "work": return Math.floor(save.totals.workMs / 3600_000);
    case "streak": return save.counts.streak;
    case "trade": return save.counts.traded;
    case "shown": return shownCount(save);
    case "party": return partyCount(save);
    default: return null;
  }
}

// 조건의 기준 값
function goalOf(cond: AchievementCond): number {
  switch (cond.kind) {
    case "region": return cond.to - cond.from + 1;
    case "species": return cond.species.length;
    case "work": return cond.hours;
    case "streak": return cond.days;
    case "level": return cond.level;
    case "affinity": return cond.value;
    default: return cond.count;
  }
}

const UNIT: Partial<Record<AchievementCond["kind"], string>> = { work: "시간", streak: "일" };
// 진행도를 보이지 않는 조건 — 한 번에 채우는 조건과 옛 업적의 조건
const NO_PROGRESS: readonly AchievementCond["kind"][] = ["level", "affinity", "shown", "party"];

// 업적창의 진행도 — 기준이 2 이상인 셀 수 있는 조건만. 현재 값은 기준을 넘지 않게 보인다
export function progressOf(save: SaveV3, id: string, opts?: DexOptions): { now: number; goal: number; unit: string } | null {
  const cond = defOf(id, opts)?.cond;
  if (!cond || NO_PROGRESS.includes(cond.kind)) return null;
  const goal = goalOf(cond);
  const now = measure(save, cond, opts);
  if (now == null || goal < 2) return null;
  return { now: Math.min(now, goal), goal, unit: UNIT[cond.kind] ?? "" };
}

// 업적 하나의 조건을 지금 채웠는가. prev 는 거래 전 저장이다 — 레벨업처럼 변화를 보는 조건이 쓴다
export function isAchieved(save: SaveV3, id: string, opts?: DexOptions, prev?: SaveV3): boolean {
  const cond = defOf(id, opts)?.cond;
  if (!cond) return false;
  if (cond.kind === "level") return leveledTo(save, prev, cond.level);
  if (cond.kind === "affinity") return save.pets.some((p) => p.affinity >= cond.value);
  const now = measure(save, cond, opts);
  return now != null && now >= goalOf(cond);
}

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
export function evaluate(save: SaveV3, now: number, opts?: DexOptions, prev?: SaveV3): string[] {
  touchDay(save, now);
  const quiet = (save.achRev ?? 0) < ACHIEVEMENT_RULES.rev;
  const fresh: string[] = [];
  for (const [id] of defs(opts)) {
    const row = save.achievements[id];
    if (row?.achievedAt != null) continue; // 한 번 달성하면 되돌리지 않는다
    if (!isAchieved(save, id, opts, prev)) continue;
    save.achievements[id] = { achievedAt: now, claimedAt: row?.claimedAt ?? null, ...(quiet ? { quiet: true as const } : {}) };
    fresh.push(id);
  }
  if (quiet) save.achRev = ACHIEVEMENT_RULES.rev;
  return quiet ? [] : fresh;
}

// 보상 수령 — 업적당 한 번
//   파티 칸   칸 +1 — 첫 잠긴 칸을 연다
//   포켓몬    새 개체를 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 둘 곳이 없으면 받지 못한다(box-full) — 미수령으로 남는다
//   포인트    잔액에 더한다
//   알        돌보미집에 넣는다. 빈 칸이 없으면 daycare-full, 단일 포켓몬 알의 남은 종이 없으면 egg-none — 미수령으로 남는다
//   도구      가방에 더한다
export function claim(save: SaveV3, id: string, now: number, opts?: DexOptions, rand: Rand = Math.random): ClaimResult {
  const def = defOf(id, opts);
  if (!def) return { ok: false, reason: "no-achievement" };
  const row = save.achievements[id];
  if (!row || row.achievedAt == null) return { ok: false, reason: "not-achieved" };
  if (row.claimedAt != null) return { ok: false, reason: "already-claimed" };
  const done = (): void => {
    save.achievements[id] = { achievedAt: row.achievedAt, claimedAt: now };
  };

  const species = rewardPokemon(def);
  if (species) {
    // 단일 포켓몬은 저장마다 한 번만 얻는다 — 옛 규칙의 알이나 우편으로 먼저 얻었으면 개체를 주지 않는다
    if (singleSpecies(opts).has(species) && save.dex.obtained.includes(species)) {
      done();
      return { ok: true, id, skipped: true };
    }
    if (!hasRoom(save)) return { ok: false, reason: "box-full" };
    const petId = nextPetId(save);
    const pet = newPet({ id: petId, species, shiny: false, nature: randomNature(rand, opts).id, gender: rollGender(species, rand, opts), now });
    save.pets.push(pet);
    recordDex(save, species, false);
    const where = placeNew(save, petId) ?? { toBox: true }; // 둘 곳은 위에서 봤다
    done();
    return { ok: true, id, petId, ...where };
  }

  const points = rewardPoints(def);
  if (points != null) {
    save.points.balance += points;
    done();
    return { ok: true, id, points };
  }

  const eggKind = rewardEgg(def);
  if (eggKind) {
    if (save.eggs.length >= EGG_RULES.maxEggs) return { ok: false, reason: "daycare-full" };
    if (!canGiveEgg(save, eggKind, opts)) return { ok: false, reason: "egg-none" };
    const egg = newEgg(save, eggKind, now, opts);
    save.eggs.push(egg);
    done();
    return { ok: true, id, eggId: egg.id };
  }

  const item = rewardItem(def);
  if (item) {
    save.bag[item.id] = (save.bag[item.id] ?? 0) + item.count;
    done();
    return { ok: true, id, item };
  }

  // 업적으로 여는 칸은 첫 프리셋에만 있다 — 다른 프리셋을 적용한 중에도 첫 프리셋의 칸을 연다 (2026-10-02 사용자 결정)
  const i = openSlot(slotsOfPreset(save, 0) ?? save.party.slots, "achievement");
  if (i < 0) return { ok: false, reason: "no-locked-slot" };
  countParty(save);
  done();
  return { ok: true, id, slotIndex: i };
}
