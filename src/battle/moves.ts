// 종의 보유 기술 — data/species-moves.json 의 칸을 data/moves.json 의 값으로 푼다. 칸이 객체면 기본값을 덮는다 (docs/specs/moves.md)
// 개체마다 위아래 순서를 바꿀 수 있다(PetV3.moveSwap). 마지막 진화체는 기본 2개 + 후보 4개 가운데 2개를 골라 둔다(PetV3.moves, 2026-10-10)
// 메가 모습은 자기 기본 2개·후보 4개가 있다(data/mega-moves.json). 메가를 켜면 그 줄과 PetV3.megaMoves 를 쓰고, 끄면 종 줄과 PetV3.moves 로 돌아간다 (2026-10-22)
import type { DexOptions } from "../dex/data.js";
import { megaMoveTable, moveTable, moveTextTable, speciesMoveTable, type MoveClass, type MoveEffects, type SpeciesMoveCell, type SpeciesMoveRow } from "../dex/tables.js";
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

// 기술 줄 — 메가 모습(mega)이 켜져 있고 그 모습의 줄이 있으면 메가 줄, 아니면 종 줄
export function moveRowOf(slug: string, mega: string | null = null, opts?: DexOptions): SpeciesMoveRow | undefined {
  return (mega ? megaMoveTable(opts)[mega] : undefined) ?? speciesMoveTable(opts)[slug];
}

// 메가 줄을 쓰는가 — 메가가 켜져 있고 그 모습의 줄이 있다
export const usesMegaRow = (mega: string | null | undefined, opts?: DexOptions): mega is string => !!mega && !!megaMoveTable(opts)[mega];

// 종의 기술 — 표 순서. 표에 없는 종이나 기술은 빠진다
export function speciesMoves(slug: string, opts?: DexOptions, mega: string | null = null): MoveInfo[] {
  return movesFrom(moveRowOf(slug, mega, opts)?.moves ?? [], opts);
}

// 고를 수 있는 기술 — 기본 2개 뒤에 후보 4개. 진화 전 종과 킬가르도 밖의 특수 종은 기본 2개뿐이다 (docs/specs/moves.md "기술 고르기")
export function moveOptions(slug: string, opts?: DexOptions, mega: string | null = null): MoveInfo[] {
  const row = moveRowOf(slug, mega, opts);
  if (!row) return [];
  return movesFrom(row.special && row.special !== "stance" ? row.moves : [...row.moves, ...(row.candidates ?? [])], opts);
}

// 1번 칸에 고정한 기술 — 킬가르도(stance)의 킹실드. 엔진의 src/battle/fighter-core.ts fixedMoveOfRow 와 같다
export function fixedMoveOf(slug: string, opts?: DexOptions): string | null {
  const row = speciesMoveTable(opts)[slug];
  const first = row?.special === "stance" ? row.moves[0] : undefined;
  return first == null ? null : typeof first === "string" ? first : first.id;
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

// 개체가 고른 기술 2개가 그 종에서 쓸 수 있는가 — 고를 수 있는 기술 안의 서로 다른 2개. 고정 기술이 있으면 1번이 그 기술이다
// 엔진의 src/battle/fighter-core.ts validPicks 와 같은 규칙이다
export function pickedIn(options: readonly MoveInfo[], chosen: readonly string[] | undefined, fixed: string | null = null): MoveInfo[] | null {
  if (!chosen || chosen.length !== 2 || chosen[0] === chosen[1]) return null;
  if (fixed && chosen[0] !== fixed) return null;
  const got = chosen.map((id) => options.find((m) => m.id === id));
  return got.every((m): m is MoveInfo => m != null) ? got : null;
}

// 개체가 고른 기술 2개 — 메가 줄을 쓰면 그 모습의 megaMoves, 아니면 moves
export const chosenMovesOf = (pet: Pick<PetV3, "moves" | "megaMoves">, mega: string | null = null, opts?: DexOptions): [string, string] | undefined =>
  usesMegaRow(mega, opts) ? pet.megaMoves?.[mega] : pet.moves;

// 개체의 기술 — 고른 2개가 있으면 그 순서로, 없으면 기본 2개(순서를 바꿨으면 거꾸로). mega 는 배틀 파티에서 켠 메가 모습
// 메가 줄의 기본 2개는 moveSwap 을 따르지 않는다 — moveSwap 은 종 줄의 순서다
export function petMoves(pet: Pick<PetV3, "species" | "moveSwap" | "moves" | "megaMoves">, opts?: DexOptions, mega: string | null = null): MoveInfo[] {
  const fixed = fixedMoveOf(pet.species, opts);
  const picked = pickedIn(moveOptions(pet.species, opts, mega), chosenMovesOf(pet, mega, opts), fixed);
  if (picked) return picked;
  const moves = speciesMoves(pet.species, opts, mega);
  return pet.moveSwap && !fixed && !usesMegaRow(mega, opts) ? moves.reverse() : moves;
}
