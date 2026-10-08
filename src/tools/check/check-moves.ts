// 기술·특성 데이터 검사 — npm run build 뒤 node dist/tools/check/check-moves.js
//
// data/moves.json · species-moves.json · abilities.json · species-abilities.json · move-text.ko.json · type-chart.json
// 과 species.defaults.json 의 종족값(stats) 짜임새를 본다.
// 계약은 docs/specs/moves.md. 데이터는 손으로 고치므로, 고친 뒤 이 검사로 규칙 위반을 잡는다
//
// 보는 것:
//   1. data/species.defaults.json 의 모든 종에 종 기술·종 특성이 있고, 남는 종이 없다
//   2. special 이 없는 종은 기술 2개다. 기술 id 는 moves.json 에 있고 한 종 안에서 겹치지 않는다
//   3. 칸 타입 — 단일 타입은 두 칸 모두 그 타입, 두 타입은 타입마다 한 칸. 종 타입과 다른 칸(전용기)은 하나까지. 웨더볼·대지의파동은 종 특성의 날씨·필드 타입으로 본다
//   4. 칸은 모두 공격기다. 변화기 전용기는 보류(docs/specs/moves.md "보류 기능"). 예외는 special 종(반사·킬가르도)
//   5. special 은 transform·reflect·sketch·wall·stance 중 하나이고 그에 맞는 칸 수다
//   6. moves.json 의 기술은 한국어·영어 이름, 타입, 분류가 있다. 공격기는 위력과 쿨타임이 있다. 능력 변화(effects.stats)는 who·stat·change(±1~3)·chance(1~100). 쿨타임은 공식 값(기대 위력 ÷ 15초, 최소 2초, 선공기 ×0.8), 급소(effects.crit)는 high·always. 상태 이상(effects.status)은 kind(하나 또는 목록)·chance(1~100), 풀죽음(effects.flinch)은 1~100
//   7. 종 특성은 abilities.json 에 있고, 특성은 한국어 이름과 when(now·later·none)이 있다
//   8. 모든 종에 종족값 6개(stats)가 있다. 합은 bst, 여섯째는 baseSpeed 와 같다
//   9. 기술 설명(move-text.ko.json)의 키는 moves.json 에 있고, 설명은 빈 문자열이 아니며 줄바꿈이 없다
//  10. 타입 상성표(type-chart.json)는 18 × 18 이고 배율은 0·0.5·1·2 뿐이다
//  11. 메가 배틀 값(mega-battle.json)의 키는 mega.json 의 모습과 같다. 종족값 6개, 특성은 abilities.json 에 있다
//  12. 후보(candidates)는 4개까지, 공격기, 기본 2개·서로와 겹치지 않고, 종 타입과 다른 후보는 하나까지. 특수 종에는 없다
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
  effects?: { stats?: StatEffect[]; crit?: string; status?: { kind: string | string[]; chance: number }; flinch?: number };
}

// 공격기의 능력 변화 — 맞힌 뒤 chance% 로 건다 (docs/specs/moves.md "능력 변화")
interface StatEffect {
  who: string;
  stat: string;
  change: number;
  chance: number;
}
const STAT_WHO = new Set(["self", "target"]);
// 공격기의 상태 이상 — 맞힌 뒤 chance% 로 건다. kind 가 목록이면 그중 하나 (docs/specs/moves.md "상태 이상")
const STATUS_KINDS = new Set(["burn", "paralysis", "poison", "toxic", "freeze", "sleep", "confusion"]);
// 찍찍베기(1~10회, 한 타마다 90% 로 이어짐)의 기대 타수
const EXP_HITS_10 = Array.from({ length: 10 }, (_, k) => 0.9 ** (k + 1)).reduce((a, b) => a + b, 0);
const ceil1 = (x: number): number => Math.ceil(x * 10 - 1e-9) / 10;
const STAT_KEYS = new Set(["atk", "def", "spa", "spd", "spe"]);

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
  candidates?: string[]; // 마지막 진화체의 후보 — 기본 2개와 합쳐 6개 중 2개를 고른다
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
  bst: number;
  baseSpeed?: number;
  stats?: number[];
}

const TYPES = new Set(["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"]);

// 특수 종의 칸 수 — reflect 는 카운터·미러코트, stance 는 킹실드·섀도볼
const SPECIAL_SLOTS: Readonly<Record<Special, number>> = { transform: 0, reflect: 2, sketch: 0, wall: 0, stance: 2 };

// 날씨·필드를 부르는 특성 → 바뀌는 타입. 웨더볼은 날씨, 대지의파동은 필드를 따른다
const ENV_TYPE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "weather-ball": { drought: "fire", "orichalcum-pulse": "fire", "desolate-land": "fire", drizzle: "water", "primordial-sea": "water", "sand-stream": "rock", "sand-spit": "rock", "snow-warning": "ice" },
  "terrain-pulse": { "electric-surge": "electric", "hadron-engine": "electric", "grassy-surge": "grass", "seed-sower": "grass", "psychic-surge": "psychic", "misty-surge": "fairy" },
};

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
  const moveText = readTable<string>("move-text.ko.json");
  const typeChart = readTable<Record<string, number>>("type-chart.json");
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
    if (m.effects?.crit !== undefined && !["high", "always"].includes(m.effects.crit)) bad.push(`기술 ${id}: 급소 ${m.effects.crit}`);
    // 쿨타임 = 기대 위력 ÷ 15초, 최소 2초, 0.1초 올림. 선공기 ×0.8 (docs/specs/moves.md "쿨타임")
    if (m.class !== "status" && m.power && !specialOnly.has(id)) {
      const exp = m.power * (!m.hits ? 1 : m.hits[0] === m.hits[1] ? m.hits[0] : m.hits[1] === 10 ? EXP_HITS_10 : 3.1);
      let want = Math.max(2, ceil1(exp / 15));
      if ((m.priority ?? 0) > 0) want = ceil1(want * 0.8);
      if (m.cooldown !== want) bad.push(`기술 ${id}: 쿨타임 ${m.cooldown} — 공식 ${want}`);
    }
    const st = m.effects?.status;
    if (st !== undefined) {
      const kinds = Array.isArray(st.kind) ? st.kind : [st.kind];
      if (!kinds.length || !kinds.every((k) => STATUS_KINDS.has(k)) || !(st.chance >= 1 && st.chance <= 100)) bad.push(`기술 ${id}: 상태 이상 ${JSON.stringify(st)}`);
    }
    const fl = m.effects?.flinch;
    if (fl !== undefined && !(Number.isInteger(fl) && fl >= 1 && fl <= 100)) bad.push(`기술 ${id}: 풀죽음 ${fl}`);
    for (const e of m.effects?.stats ?? []) {
      const ok = STAT_WHO.has(e.who) && STAT_KEYS.has(e.stat) && Number.isInteger(e.change) && e.change !== 0 && Math.abs(e.change) <= 3 && e.chance >= 1 && e.chance <= 100;
      if (!ok) bad.push(`기술 ${id}: 능력 변화 ${JSON.stringify(e)}`);
    }
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
    if (entry.special && entry.candidates?.length) bad.push(`종 ${key}: 특수 종에 후보`);
    if (entry.special) {
      if (!(entry.special in SPECIAL_SLOTS)) bad.push(`종 ${key}: special ${entry.special}`);
      else if (ids.length !== SPECIAL_SLOTS[entry.special]) bad.push(`종 ${key}: ${entry.special} 칸 ${ids.length}개`);
      continue;
    }
    if (ids.length !== 2) {
      bad.push(`종 ${key}: 기술 ${ids.length}개`);
      continue;
    }
    // 웨더볼·대지의파동은 종 특성이 부르는 날씨·필드의 타입으로 본다 (docs/specs/moves.md "날씨와 필드")
    const slotTypes = entry.moves.map((s) => {
      const id = typeof s === "string" ? s : s.id;
      const envType = ENV_TYPE[id]?.[speciesAbilities[key] ?? ""];
      if (envType) return envType;
      return (typeof s === "string" ? moves[s]?.type : (s.type ?? moves[s.id]?.type)) ?? "";
    });
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
    // 12 후보 — 4개까지, 공격기, 기본 2개·서로와 겹치지 않음, 종 타입과 다른 후보는 하나까지
    const cand = entry.candidates ?? [];
    if (cand.length > 4) bad.push(`종 ${key}: 후보 ${cand.length}개`);
    if (new Set([...ids, ...cand]).size !== ids.length + cand.length) bad.push(`종 ${key}: 후보가 겹침 ${cand.join("·")}`);
    for (const id of cand) {
      const m = moves[id];
      if (!m) bad.push(`종 ${key}: 후보 ${id} 가 moves.json 에 없음`);
      else if (m.class === "status" || !(m.power && m.power > 0)) bad.push(`종 ${key}: 후보 ${id} 가 공격기가 아님`);
    }
    const candOff = cand.filter((id) => !sp.types.includes(ENV_TYPE[id]?.[speciesAbilities[key] ?? ""] ?? moves[id]?.type ?? "")).length;
    if (candOff > 1) bad.push(`종 ${key}: 종 타입과 다른 후보 ${candOff}개`);
  }

  // 7 특성
  for (const [id, a] of Object.entries(abilities)) {
    if (!a.ko) bad.push(`특성 ${id}: 한국어 이름 없음`);
    if (!["now", "later", "none"].includes(a.when)) bad.push(`특성 ${id}: when ${a.when}`);
  }
  for (const [key, id] of Object.entries(speciesAbilities)) if (!abilities[id]) bad.push(`종 ${key}: 특성 ${id} 가 abilities.json 에 없음`);

  // 8 종족값
  for (const [key, sp] of Object.entries(species)) {
    const st = sp.stats;
    if (!st || st.length !== 6 || st.some((v) => !(Number.isInteger(v) && v > 0))) {
      bad.push(`종 ${key}: 종족값 ${JSON.stringify(st)}`);
      continue;
    }
    if (st.reduce((a, b) => a + b, 0) !== sp.bst) bad.push(`종 ${key}: 종족값 합 ${st.join("+")} ≠ bst ${sp.bst}`);
    if (st[5] !== sp.baseSpeed) bad.push(`종 ${key}: 스피드 ${st[5]} ≠ baseSpeed ${sp.baseSpeed}`);
  }

  // 9 기술 설명 — 설명이 없는 기술은 키가 없다 (원작 한국어 문장이 없는 기술)
  for (const [id, text] of Object.entries(moveText)) {
    if (!moves[id]) bad.push(`기술 설명 ${id}: moves.json 에 없는 기술`);
    if (typeof text !== "string" || !text.trim()) bad.push(`기술 설명 ${id}: 빈 설명`);
    else if (/[\n\r\f]/.test(text)) bad.push(`기술 설명 ${id}: 줄바꿈이 남음`);
  }

  // 10 타입 상성
  for (const atk of TYPES) {
    const row = typeChart[atk];
    if (!row) {
      bad.push(`상성 ${atk}: 공격 타입 줄 없음`);
      continue;
    }
    for (const def of TYPES) if (![0, 0.5, 1, 2].includes(row[def] as number)) bad.push(`상성 ${atk} → ${def}: ${row[def]}`);
    for (const def of Object.keys(row)) if (!TYPES.has(def)) bad.push(`상성 ${atk} → ${def}: 18타입 밖`);
  }
  for (const atk of Object.keys(typeChart)) if (!TYPES.has(atk)) bad.push(`상성 ${atk}: 18타입 밖`);

  // 11 메가 배틀 값 — 메가 모습은 종이 아니라 종 표에 없다 (src/dex/mega.ts)
  const megaForms = readTable<Record<string, unknown>>("mega.json").forms ?? {};
  const megaBattle = readTable<{ stats?: number[]; ability?: string }>("mega-battle.json");
  for (const slug of Object.keys(megaForms)) if (!megaBattle[slug]) bad.push(`메가 ${slug}: 배틀 값 없음`);
  for (const [slug, m] of Object.entries(megaBattle)) {
    if (!megaForms[slug]) bad.push(`메가 배틀 값 ${slug}: mega.json 에 없는 모습`);
    if (!m.stats || m.stats.length !== 6 || m.stats.some((v) => !(Number.isInteger(v) && v > 0))) bad.push(`메가 ${slug}: 종족값 ${JSON.stringify(m.stats)}`);
    if (!m.ability || !abilities[m.ability]) bad.push(`메가 ${slug}: 특성 ${m.ability} 가 abilities.json 에 없음`);
  }
  return bad;
}

function main(): void {
  const bad = moveDataFindings();
  const count = (file: string): number => Object.keys(readTable<unknown>(file)).length;
  process.stdout.write(`기술 ${count("moves.json")} · 종 기술 ${count("species-moves.json")} · 특성 ${count("abilities.json")} · 종 특성 ${count("species-abilities.json")} · 기술 설명 ${count("move-text.ko.json")} · 상성 ${count("type-chart.json")}타입 · 메가 배틀 값 ${count("mega-battle.json")}\n`);
  if (bad.length) {
    for (const line of bad) process.stdout.write(`  ${line}\n`);
    process.stdout.write(`어긋남 ${bad.length}\n`);
    process.exit(1);
  }
  process.stdout.write("통과\n");
}

if (require.main === module) main();
