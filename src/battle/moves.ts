// 종의 보유 기술 — data/species-moves.json 의 칸을 data/moves.json 의 값으로 푼다. 칸이 객체면 기본값을 덮는다 (docs/specs/moves.md)
// 개체마다 위아래 순서를 바꿀 수 있다(PetV3.moveSwap). 순서는 화면에만 쓴다 — 배틀에서의 뜻은 배틀 설계 때 정한다
import type { DexOptions } from "../dex/data.js";
import { moveTable, moveTextTable, speciesMoveTable, type MoveClass } from "../dex/tables.js";
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
}

// 종의 기술 — 표 순서. 표에 없는 종이나 기술은 빠진다
export function speciesMoves(slug: string, opts?: DexOptions): MoveInfo[] {
  const cells = speciesMoveTable(opts)[slug]?.moves ?? [];
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
    });
  }
  return out;
}

// 개체의 기술 — 순서를 바꿨으면 거꾸로
export function petMoves(pet: Pick<PetV3, "species" | "moveSwap">, opts?: DexOptions): MoveInfo[] {
  const moves = speciesMoves(pet.species, opts);
  return pet.moveSwap ? moves.reverse() : moves;
}
