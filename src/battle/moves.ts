// 종의 보유 기술 — data/species-moves.json 의 칸을 data/moves.json 의 값으로 푼다. 칸이 객체면 기본값을 덮는다 (docs/specs/moves.md)
// 개체마다 위아래 순서를 바꿀 수 있다(PetV3.moveSwap). 마지막 진화체는 기본 2개 + 후보 4개 가운데 2개를 골라 둔다(PetV3.moves, 2026-10-10)
import type { DexOptions } from "../dex/data.js";
import { moveTable, moveTextTable, speciesMoveTable, type MoveClass, type MoveEffects, type SpeciesMoveCell } from "../dex/tables.js";
import type { PetV3 } from "../shared/save-v3";

export interface MoveInfo {
  id: string;
  name: string; // 한국어 이름
  type: string;
  class: MoveClass;
  power: number | null; // 변화기는 null
  accuracy: number | null; // null 이면 반드시 맞는다
  cooldown: number | null; // 초
  text: string | null; // 원작 설명. 없는 기술은 null
  priority?: number; // 원작 선공도
  hits?: [number, number]; // 연속기의 [최소, 최대] 타수
  traits?: string[]; // 성질 — contact(접촉) 등
  effects?: MoveEffects; // 부담과 효과 (docs/specs/moves.md "부담과 효과")
}

// 종의 기술 — 표 순서. 표에 없는 종이나 기술은 빠진다
export function speciesMoves(slug: string, opts?: DexOptions): MoveInfo[] {
  return movesFrom(speciesMoveTable(opts)[slug]?.moves ?? [], opts);
}

// 고를 수 있는 기술 — 기본 2개 뒤에 후보 4개. 진화 전 종과 특수 종은 기본 2개뿐이다 (docs/specs/moves.md "기술 고르기")
export function moveOptions(slug: string, opts?: DexOptions): MoveInfo[] {
  const row = speciesMoveTable(opts)[slug];
  if (!row) return [];
  return movesFrom(row.special ? row.moves : [...row.moves, ...(row.candidates ?? [])], opts);
}

function movesFrom(cells: readonly SpeciesMoveCell[], opts?: DexOptions): MoveInfo[] {
  const table = moveTable(opts);
  const texts = moveTextTable(opts);
  const out: MoveInfo[] = [];
  for (const cell of cells) {
    const id = typeof cell === "string" ? cell : cell.id;
    const base = table[id];
    if (!base) continue;
    const row = typeof cell === "string" ? base : { ...base, ...cell };
    out.push({
      id,
      name: row.ko,
      type: row.type,
      class: row.class,
      power: row.class === "status" ? null : (row.power ?? null),
      accuracy: row.accuracy ?? null,
      cooldown: row.cooldown ?? null,
      text: texts[id] ?? null,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.hits ? { hits: row.hits } : {}),
      ...(row.traits ? { traits: row.traits } : {}),
      ...(row.effects ? { effects: row.effects } : {}),
    });
  }
  return out;
}

// 개체가 고른 기술 2개가 그 종에서 쓸 수 있는가 — 고를 수 있는 기술 안의 서로 다른 2개. 엔진의 src/battle/fighter-core.ts validPicks 와 같은 규칙이다
export function pickedIn(options: readonly MoveInfo[], chosen: readonly string[] | undefined): MoveInfo[] | null {
  if (!chosen || chosen.length !== 2 || chosen[0] === chosen[1]) return null;
  const got = chosen.map((id) => options.find((m) => m.id === id));
  return got.every((m): m is MoveInfo => m != null) ? got : null;
}

// 개체의 기술 — 고른 2개가 있으면 그 순서로, 없으면 기본 2개(순서를 바꿨으면 거꾸로)
export function petMoves(pet: Pick<PetV3, "species" | "moveSwap" | "moves">, opts?: DexOptions): MoveInfo[] {
  const picked = pickedIn(moveOptions(pet.species, opts), pet.moves);
  if (picked) return picked;
  const moves = speciesMoves(pet.species, opts);
  return pet.moveSwap ? moves.reverse() : moves;
}
