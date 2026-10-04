// 기술·특성 데이터 검사 — npm run build 뒤 node dist/tools/check/check-moves.js
//
// data/moves.json · species-moves.json · abilities.json · species-abilities.json 의 짜임새를 본다.
// 계약은 docs/specs/moves.md. 데이터는 손으로 고치므로, 고친 뒤 이 검사로 규칙 위반을 잡는다
//
// 보는 것:
//   1. data/species.defaults.json 의 모든 종에 종 기술·종 특성이 있고, 남는 종이 없다
//   2. special 이 없는 종은 기술 2개다. 기술 id 는 moves.json 에 있고 한 종 안에서 겹치지 않는다
//   3. 칸 타입 — 단일 타입은 두 칸 모두 그 타입, 두 타입은 타입마다 한 칸. 종 타입과 다른 칸(전용기)은 하나까지
//   4. 변화기 칸은 위력을 덮어써 공격기로 쓴다. 예외는 special 종(반사·킬가르도)
//   5. special 은 transform·reflect·sketch·wall·stance 중 하나이고 그에 맞는 칸 수다
//   6. moves.json 의 기술은 한국어·영어 이름, 타입, 분류가 있다. 공격기는 위력과 쿨타임이 있다
//   7. 종 특성은 abilities.json 에 있고, 특성은 한국어 이름과 when(now·later·none)이 있다
// 어긋남이 있으면 모두 찍고 종료 코드 1
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./baseline";

type MoveClass = "physical" | "special" | "status";
type Special = "transform" | "reflect" | "sketch" | "wall" | "stance";

interface MoveEntry {
  ko: string;
  en: string;
  type: string;
  class: MoveClass;
  power?: number;
  hits?: [number, number];
  accuracy: number | null;
  priority?: number;
  cooldown?: number;
}

interface SlotOverride {
  id: string;
  type?: string;
  class?: MoveClass;
  power?: number;
  cooldown?: number;
}

type Slot = string | SlotOverride;

interface SpeciesMoves {
  moves: Slot[];
  special?: Special;
}

interface AbilityEntry {
  ko: string;
  en: string;
  group: string;
  when: "now" | "later" | "none";
  rule: string;
}

interface SpeciesDefault {
  types: string[];
}

const TYPES = new Set(["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"]);

// 특수 종의 칸 수 — reflect 는 카운터·미러코트, stance 는 킹실드·섀도볼
const SPECIAL_SLOTS: Readonly<Record<Special, number>> = { transform: 0, reflect: 2, sketch: 0, wall: 0, stance: 2 };

// _comment 줄을 뺀 표
function readTable<T>(file: string): Record<string, T> {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8")) as Record<string, unknown>;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_")) out[k] = v as T;
  return out;
}

export function moveDataFindings(): string[] {
  const species = readTable<SpeciesDefault>("species.defaults.json");
  const moves = readTable<MoveEntry>("moves.json");
  const speciesMoves = readTable<SpeciesMoves>("species-moves.json");
  const abilities = readTable<AbilityEntry>("abilities.json");
  const speciesAbilities = readTable<string>("species-abilities.json");
  const bad: string[] = [];

  // 6 기술 표 — 특수 종만 쓰는 기술(카운터·미러코트는 받은 피해로 반사)은 위력이 없다
  const specialOnly = new Set<string>();
  for (const e of Object.values(speciesMoves)) if (e.special) for (const s of e.moves) specialOnly.add(typeof s === "string" ? s : s.id);
  for (const e of Object.values(speciesMoves)) if (!e.special) for (const s of e.moves) specialOnly.delete(typeof s === "string" ? s : s.id);
  for (const [id, m] of Object.entries(moves)) {
    if (!m.ko || !m.en) bad.push(`기술 ${id}: 이름 없음`);
    if (!TYPES.has(m.type)) bad.push(`기술 ${id}: 타입 ${m.type}`);
    if (!["physical", "special", "status"].includes(m.class)) bad.push(`기술 ${id}: 분류 ${m.class}`);
    if (m.class !== "status" && !(m.power && m.power > 0) && !specialOnly.has(id)) bad.push(`기술 ${id}: 공격기인데 위력 없음`);
    if (m.class !== "status" && !(m.cooldown && m.cooldown > 0)) bad.push(`기술 ${id}: 공격기인데 쿨타임 없음`);
    if (m.hits && !(m.hits[0] >= 1 && m.hits[1] >= m.hits[0])) bad.push(`기술 ${id}: 타수 ${m.hits.join("~")}`);
  }

  // 1 종 목록
  for (const key of Object.keys(species)) {
    if (!speciesMoves[key]) bad.push(`종 ${key}: 종 기술 없음`);
    if (!speciesAbilities[key]) bad.push(`종 ${key}: 종 특성 없음`);
  }
  for (const key of Object.keys(speciesMoves)) if (!species[key]) bad.push(`종 기술 ${key}: 종 데이터에 없는 종`);
  for (const key of Object.keys(speciesAbilities)) if (!species[key]) bad.push(`종 특성 ${key}: 종 데이터에 없는 종`);

  // 2~5 종 기술
  for (const [key, entry] of Object.entries(speciesMoves)) {
    const sp = species[key];
    if (!sp) continue;
    const ids = entry.moves.map((s) => (typeof s === "string" ? s : s.id));
    for (const id of ids) if (!moves[id]) bad.push(`종 ${key}: 기술 ${id} 가 moves.json 에 없음`);
    if (new Set(ids).size !== ids.length) bad.push(`종 ${key}: 겹친 기술 ${ids.join("·")}`);
    if (entry.special) {
      if (!(entry.special in SPECIAL_SLOTS)) bad.push(`종 ${key}: special ${entry.special}`);
      else if (ids.length !== SPECIAL_SLOTS[entry.special]) bad.push(`종 ${key}: ${entry.special} 칸 ${ids.length}개`);
      continue;
    }
    if (ids.length !== 2) {
      bad.push(`종 ${key}: 기술 ${ids.length}개`);
      continue;
    }
    const slotTypes = entry.moves.map((s) => (typeof s === "string" ? moves[s]?.type : (s.type ?? moves[s.id]?.type)) ?? "");
    const off = slotTypes.filter((t) => !sp.types.includes(t)).length;
    if (off > 1) bad.push(`종 ${key}(${sp.types.join("/")}): 종 타입과 다른 칸이 ${off}개 — ${slotTypes.join("·")}`);
    if (sp.types.length === 2 && off === 0 && slotTypes[0] === slotTypes[1]) bad.push(`종 ${key}(${sp.types.join("/")}): 두 칸이 같은 타입 ${slotTypes[0]}`);
    if (sp.types.length === 1 && off === 0 && slotTypes.some((t) => t !== sp.types[0])) bad.push(`종 ${key}: 칸 타입 ${slotTypes.join("·")}`);
    for (const s of entry.moves) {
      const id = typeof s === "string" ? s : s.id;
      const cls = typeof s === "string" ? moves[id]?.class : (s.class ?? moves[id]?.class);
      const power = typeof s === "string" ? moves[id]?.power : (s.power ?? moves[id]?.power);
      if (cls === "status" || !(power && power > 0)) bad.push(`종 ${key}: ${id} 칸이 공격기가 아님`);
    }
  }

  // 7 특성
  for (const [id, a] of Object.entries(abilities)) {
    if (!a.ko) bad.push(`특성 ${id}: 한국어 이름 없음`);
    if (!["now", "later", "none"].includes(a.when)) bad.push(`특성 ${id}: when ${a.when}`);
  }
  for (const [key, id] of Object.entries(speciesAbilities)) if (!abilities[id]) bad.push(`종 ${key}: 특성 ${id} 가 abilities.json 에 없음`);
  return bad;
}

function main(): void {
  const bad = moveDataFindings();
  const count = (file: string): number => Object.keys(readTable<unknown>(file)).length;
  process.stdout.write(`기술 ${count("moves.json")} · 종 기술 ${count("species-moves.json")} · 특성 ${count("abilities.json")} · 종 특성 ${count("species-abilities.json")}\n`);
  if (bad.length) {
    for (const line of bad) process.stdout.write(`  ${line}\n`);
    process.stdout.write(`어긋남 ${bad.length}\n`);
    process.exit(1);
  }
  process.stdout.write("통과\n");
}

if (require.main === module) main();
