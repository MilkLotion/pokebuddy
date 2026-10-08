// 전투 개체 만들기 — 종(메가 모습 포함)·기술 순서·능력치 기준을 엔진이 받는 값(EngineFighter)으로 바꾼다
// 엔진(./engine.ts)은 데이터 파일을 읽지 않으므로 표 읽기는 여기서 한다. 규칙은 docs/specs/adventure.md "배틀 엔진"
import type { DexOptions } from "../dex/data.js";
import { megaOf } from "../dex/mega.js";
import { profileOf } from "../dex/species.js";
import { formBattleTable, megaBattleTable, moveTable, speciesAbilityTable, speciesMoveTable, typeChartTable } from "../dex/tables.js";
import type { PetV3 } from "../shared/save-v3";
import { ENGINE_RULES, type EngineFighter, type EngineMove } from "./engine.js";
import { BATTLE_RULES } from "./rules.js";
import { realStat, type StatBasis } from "./stats.js";

const BATTLE_BASIS: StatBasis = { level: BATTLE_RULES.level, iv: BATTLE_RULES.iv, ev: BATTLE_RULES.ev };
const SPECIALS = new Set(["wall", "reflect", "sketch", "transform", "stance"]);
const SCHOOLING_LEVEL = 60; // 약어리 어군 해금 레벨 (docs/specs/moves.md "모습이 바뀌는 종")

export interface FighterSource {
  species: string; // 기본 종
  form?: string | null; // 배틀에서 켠 메가 모습 슬러그
  moveSwap?: boolean;
  level?: number; // 개체의 실제 레벨 — 약어리 어군 해금에 쓴다. 없으면 해금 전
}

const ceilTick = (sec: number): number => Math.ceil((sec * 1000) / ENGINE_RULES.tickMs) * ENGINE_RULES.tickMs;

// 종의 기술 2개 — 칸이 객체면 기본값을 덮는다. 표에 없는 기술은 빠진다
export function engineMoves(species: string, swap: boolean, opts?: DexOptions): EngineMove[] {
  const table = moveTable(opts);
  const out: EngineMove[] = [];
  for (const cell of speciesMoveTable(opts)[species]?.moves ?? []) {
    const id = typeof cell === "string" ? cell : cell.id;
    const base = table[id];
    if (!base) continue;
    const row = typeof cell === "string" ? base : { ...base, ...cell };
    out.push({
      id,
      type: row.type,
      class: row.class,
      power: row.class === "status" ? null : (row.power ?? null),
      accuracy: row.accuracy ?? null,
      priority: row.priority ?? 0,
      cooldownMs: ceilTick(row.cooldown ?? 6),
      hits: row.hits ?? null,
      traits: row.traits ?? [],
      effects: row.effects ?? {},
    });
  }
  return swap ? out.reverse() : out;
}

// 사거리 — 종족값 특수공격이 공격보다 높으면 원거리, 같거나 낮으면 근접 (2026-10-08 사용자 결정, 메가 모습은 메가 종족값)
export const rangeOf = (base: readonly number[]): number => (base[3]! > base[1]! ? ENGINE_RULES.rangedRange : ENGINE_RULES.meleeRange);

// 개체 하나 → 전투 개체. 표에 종족값이 없으면 null
export function buildFighter(src: FighterSource, basis: StatBasis = BATTLE_BASIS, opts?: DexOptions): EngineFighter | null {
  const mega = src.form ? megaOf(src.form, opts) : null;
  const shown = mega ? src.form! : src.species;
  const baseStats = megaBattleTable(opts)[shown]?.stats ?? profileOf(src.species, opts).stats;
  if (!Array.isArray(baseStats) || baseStats.length !== 6) return null;
  const real = (six: readonly number[]): number[] => six.map((b, i) => realStat(b, i, basis));
  const ability = megaBattleTable(opts)[shown]?.ability ?? speciesAbilityTable(opts)[src.species] ?? null;
  const special = speciesMoveTable(opts)[src.species]?.special;
  const alt = mega ? undefined : formBattleTable(opts)[src.species];
  return {
    species: shown,
    types: mega ? mega.types : profileOf(src.species, opts).types,
    level: basis.level,
    stats: real(baseStats),
    moves: engineMoves(src.species, src.moveSwap === true, opts),
    ability,
    special: special && SPECIALS.has(special) ? (special as EngineFighter["special"]) : null,
    range: rangeOf(baseStats),
    altForm: alt ? { species: alt.form, stats: real(alt.stats) } : null,
    schoolingReady: (src.level ?? 0) >= SCHOOLING_LEVEL,
  };
}

// 배틀 파티의 개체 하나 → 전투 개체 (50레벨·6V). form 은 배틀 파티에서 켠 메가 모습
export const petFighter = (pet: Pick<PetV3, "species" | "moveSwap" | "level">, form: string | null, opts?: DexOptions): EngineFighter | null =>
  buildFighter({ species: pet.species, form, moveSwap: pet.moveSwap === true, level: pet.level }, BATTLE_BASIS, opts);

export const battleTypeChart = (opts?: DexOptions): Record<string, Record<string, number>> => typeChartTable(opts);
