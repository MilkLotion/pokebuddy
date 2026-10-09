// 전투 개체 만들기 — 앱 쪽. data/*.json 을 BattleData 로 모아 fighter-core 에 넘긴다
// 서버 함수도 같은 fighter-core 와, 같은 방법으로 만든 표(supabase/functions/_shared/battle/battle-data.json)를 쓴다
// 규칙은 docs/specs/adventure.md "배틀 엔진"
import type { DexOptions } from "../dex/data.js";
import { isMetaKey } from "../dex/data.js";
import { megaSlugs, megaOf } from "../dex/mega.js";
import { regionalTable } from "../dex/regional.js";
import { SHIFT_RULES } from "../dex/rules.js";
import { profileOf } from "../dex/species.js";
import { formBattleTable, megaBattleTable, moveTable, speciesAbilityTable, speciesMoveTable, speciesTable, typeChartTable } from "../dex/tables.js";
import type { PetV3 } from "../shared/save-v3";
import type { EngineFighter, EngineMove } from "./engine.js";
import { BATTLE_BASIS, fighterFrom, movesOf, type BattleData, type BattleMoveRow, type FighterSource, type StatBasis } from "./fighter-core.js";
import { tierOf } from "./tier.js";

export type { FighterSource } from "./fighter-core.js";

// data/*.json → BattleData. 기본 데이터 폴더는 한 번만 만든다
let cached: BattleData | null = null;
export function battleData(opts?: DexOptions): BattleData {
  if (!opts && cached) return cached;
  const species: BattleData["species"] = {};
  const abilities = speciesAbilityTable(opts);
  const smoves = speciesMoveTable(opts);
  for (const slug of Object.keys(speciesTable(opts))) {
    if (isMetaKey(slug)) continue;
    const p = profileOf(slug, opts);
    if (!Array.isArray(p.stats) || p.stats.length !== 6) continue;
    const sm = smoves[slug];
    species[slug] = {
      stats: [...p.stats],
      types: [...p.types],
      ability: abilities[slug] ?? null,
      ...(sm?.special ? { special: sm.special } : {}),
      moves: (sm?.moves ?? []) as BattleData["species"][string]["moves"],
      ...(sm?.candidates?.length ? { picks: [...sm.candidates] } : {}),
      tier: tierOf(slug, opts),
    };
  }
  const moves: BattleData["moves"] = {};
  for (const [id, m] of Object.entries(moveTable(opts))) if (!isMetaKey(id) && m && typeof m === "object") moves[id] = m as unknown as BattleMoveRow;
  const mega: BattleData["mega"] = {};
  const mb = megaBattleTable(opts);
  for (const slug of megaSlugs(opts)) {
    const f = megaOf(slug, opts);
    const v = mb[slug];
    if (f && v) mega[slug] = { base: f.base, stats: [...v.stats], types: [...f.types], ability: v.ability };
  }
  const forms: BattleData["forms"] = {};
  for (const [slug, v] of Object.entries(formBattleTable(opts))) if (!isMetaKey(slug)) forms[slug] = v;
  const shift: BattleData["shift"] = {};
  // 한 방향 묶음(도구로 한 번 얻는 모습)은 뺀다 — 배틀 파티가 따로 모습을 가질 수 없다 (src/battle/party.ts battleShiftable)
  for (const [base, list] of Object.entries(regionalTable(opts).shift)) if (!isMetaKey(base) && Array.isArray(list) && !SHIFT_RULES[base]?.oneWay) shift[base] = list.filter((s): s is string => typeof s === "string");
  const data: BattleData = { species, moves, mega, forms, shift, typeChart: typeChartTable(opts) };
  if (!opts) cached = data;
  return data;
}

// 종의 기술 2개 (EngineMove)
export const engineMoves = (species: string, swap: boolean, opts?: DexOptions): EngineMove[] => movesOf(battleData(opts), species, swap);

// 개체 하나 → 전투 개체. 표에 종족값이 없으면 null
export const buildFighter = (src: FighterSource, basis: StatBasis = BATTLE_BASIS, opts?: DexOptions): EngineFighter | null =>
  fighterFrom(battleData(opts), src, basis);

// 배틀 파티의 개체 하나 → 전투 개체 (50레벨·6V). form 은 배틀 파티에서 켠 메가 모습
export const petFighter = (pet: Pick<PetV3, "species" | "moveSwap" | "moves" | "level">, form: string | null, opts?: DexOptions): EngineFighter | null =>
  buildFighter({ species: pet.species, form, moveSwap: pet.moveSwap === true, ...(pet.moves ? { moves: [...pet.moves] } : {}), level: pet.level }, BATTLE_BASIS, opts);

export const battleTypeChart = (opts?: DexOptions): Record<string, Record<string, number>> => battleData(opts).typeChart;
