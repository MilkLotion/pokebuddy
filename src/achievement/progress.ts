// 업적 조건의 지금 값과 진행도 — 조건의 뜻은 src/achievement/defs.ts 머리말
import { type DexOptions } from "../dex/data.js";
import { hasObtained } from "../dex/record.js";
import { isSingleSpecies } from "../dex/forms.js";
import type { SaveV3 } from "../shared/save-v3";
import { regionalOf } from "../dex/regional.js";
import { profileOf } from "../dex/species.js";
import { singleSpecies } from "../dex/obtain.js";
import { type AchievementCond } from "../dex/tables.js";
import { defOf } from "./defs.js";

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
    const dex = profileOf(slug, opts).dex;
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
    case "species": return cond.species.filter((s) => hasObtained(save, s)).length;
    case "shiny": return save.dex.shinyObtained.length;
    case "evolve": return save.counts.evolved;
    case "mega": return save.dex.megaOpened?.length ?? 0;
    case "hatch": return save.counts.hatched;
    case "single": {
      const singles = singleSpecies(opts);
      return save.dex.obtained.filter((s) => isSingleSpecies(s, opts, singles)).length; // 진화 계열 기준 (94 항목 9-3-7)
    }
    case "find": return save.find?.seq ?? 0;
    case "work": return Math.floor(save.totals.workMs / 3600_000);
    case "agent": return save.totals.workMs > 0 ? 1 : 0;
    case "streak": return save.counts.streak;
    case "trade": return save.counts.traded;
    case "shown": return shownCount(save);
    case "party": return partyCount(save);
    case "pet-party": return Math.floor(Math.max(0, ...save.pets.filter((p) => p.species === cond.species).map((p) => p.partyMs ?? 0)) / 3600_000);
    default: return null;
  }
}

// 조건의 기준 값
function goalOf(cond: AchievementCond): number {
  switch (cond.kind) {
    case "region": return cond.to - cond.from + 1;
    case "species": return cond.species.length;
    case "work": return cond.hours;
    case "pet-party": return cond.hours;
    case "streak": return cond.days;
    case "level": return cond.level;
    case "affinity": return cond.value;
    default: return cond.count;
  }
}

const UNIT: Partial<Record<AchievementCond["kind"], string>> = { work: "시간", "pet-party": "시간", streak: "일" };
// 진행도를 보이지 않는 조건 — 한 번에 채우는 조건과 옛 업적의 조건
const NO_PROGRESS: readonly AchievementCond["kind"][] = ["level", "affinity", "shown", "party", "agent"];

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
