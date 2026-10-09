// 전투 개체 만들기의 핵심 — 표(BattleData)와 개체 정보로 엔진이 받는 값(EngineFighter)을 만든다
// 앱(./fighter.ts)과 서버 함수(supabase/functions/_shared/battle)가 같은 코드를 쓴다 — 같은 개체면 같은 전투 개체가 나온다
// import 는 엔진 하나뿐이다. 서버로 복사할 때 엔진 경로의 .js 를 .ts 로 바꾼다(src/tools/data/build-battle.ts). 주석에 따옴표 경로를 쓰지 않는다 — 함수 서버가 주석 속 경로도 읽는다
// 규칙은 docs/specs/adventure.md "배틀 엔진", "실제 능력치"
import { ENGINE_RULES, rangeOfMoves, type EngineFighter, type EngineMove } from "./engine.js";

// ── 표 ──
export interface BattleMoveRow {
  type: string;
  class: "physical" | "special" | "status";
  power?: number;
  accuracy?: number | null;
  priority?: number;
  cooldown?: number;
  hits?: [number, number];
  traits?: string[];
  effects?: Record<string, unknown>;
}
export interface BattleSpeciesRow {
  stats: number[]; // 종족값 6개
  types: string[];
  ability: string | null;
  special?: string;
  moves: (string | ({ id: string } & Partial<BattleMoveRow>))[]; // 기본 기술 2개 — 칸이 객체면 기술 기본값을 덮는다
  tier?: "legendary" | "sub" | null; // 출전 제한의 칸
}
export interface BattleMegaRow {
  base: string;
  stats: number[];
  types: string[];
  ability: string;
}
export interface BattleFormRow {
  form: string;
  stats: number[];
  types?: string[];
  ownMoves?: true; // 그 모습이 자기 기술을 쓴다(메로엣타 스텝폼)
}
export interface BattleData {
  species: Record<string, BattleSpeciesRow>;
  moves: Record<string, BattleMoveRow>;
  mega: Record<string, BattleMegaRow>; // 메가·원시회귀 모습
  forms: Record<string, BattleFormRow>; // 전투 중 모습이 바뀌는 종의 다른 모습
  shift: Record<string, string[]>; // 모습 바꾸기 묶음 — 기본 종 → 다른 모습들(로토무 등). 배틀 파티가 적은 모습(battle.forms)을 검사한다
  typeChart: Record<string, Record<string, number>>;
}

export interface StatBasis {
  level: number;
  iv: number;
  ev: number;
}
// 배틀(PvP) — 모든 개체 50레벨, 개체값 31, 노력치 0 (docs/specs/adventure.md "실제 능력치")
export const BATTLE_BASIS: Readonly<StatBasis> = { level: 50, iv: 31, ev: 0 };

export interface FighterSource {
  species: string; // 기본 종
  form?: string | null; // 배틀에서 켠 메가 모습 슬러그
  moveSwap?: boolean;
  level?: number; // 개체의 실제 레벨 — 약어리 어군 해금에 쓴다. 없으면 해금 전
}

const SPECIALS = new Set(["wall", "reflect", "sketch", "transform", "stance"]);
const SCHOOLING_LEVEL = 60; // 약어리 어군 해금 레벨 (docs/specs/moves.md "모습이 바뀌는 종")

// 원작 능력치 공식 — HP 는 ⌊(2B+IV+⌊EV/4⌋)×L/100⌋+L+10, 그 밖은 ⌊…⌋+5. HP 종족값 1(껍질몬)은 늘 1
export function realStat(base: number, index: number, basis: StatBasis = BATTLE_BASIS): number {
  const core = Math.floor(((2 * base + basis.iv + Math.floor(basis.ev / 4)) * basis.level) / 100);
  if (index !== 0) return core + 5;
  if (base === 1) return 1;
  return core + basis.level + 10;
}

const ceilTick = (sec: number): number => Math.ceil((sec * 1000) / ENGINE_RULES.tickMs) * ENGINE_RULES.tickMs;

// 종의 기술 2개 — 칸이 객체면 기본값을 덮는다. 표에 없는 기술은 빠진다
export function movesOf(data: BattleData, species: string, swap: boolean): EngineMove[] {
  const out: EngineMove[] = [];
  for (const cell of data.species[species]?.moves ?? []) {
    const id = typeof cell === "string" ? cell : cell.id;
    const base = data.moves[id];
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
      effects: (row.effects ?? {}) as EngineMove["effects"],
    });
  }
  return swap ? out.reverse() : out;
}

// 개체 하나 → 전투 개체. 표에 종이나 종족값이 없으면 null
export function fighterFrom(data: BattleData, src: FighterSource, basis: StatBasis = BATTLE_BASIS): EngineFighter | null {
  const sp = data.species[src.species];
  if (!sp) return null;
  const mega = src.form ? data.mega[src.form] : undefined;
  const shown = mega ? src.form! : src.species;
  const baseStats = mega ? mega.stats : sp.stats;
  if (!Array.isArray(baseStats) || baseStats.length !== 6) return null;
  const real = (six: readonly number[]): number[] => six.map((b, i) => realStat(b, i, basis));
  const alt = mega ? undefined : data.forms[src.species];
  const moves = movesOf(data, src.species, src.moveSwap === true);
  return {
    species: shown,
    types: mega ? mega.types : sp.types,
    level: basis.level,
    stats: real(baseStats),
    moves,
    ability: mega ? mega.ability : sp.ability,
    special: sp.special && SPECIALS.has(sp.special) ? (sp.special as EngineFighter["special"]) : null,
    range: rangeOfMoves(moves),
    altForm: alt ? altFormOf(data, alt, real, src.moveSwap === true) : null,
    schoolingReady: (src.level ?? 0) >= SCHOOLING_LEVEL,
  };
}

// 전투 중 바뀌는 다른 모습 — 자기 기술을 쓰는 모습(메로엣타)은 그 모습 칸의 기술과 사거리를 함께 싣는다
function altFormOf(data: BattleData, alt: BattleFormRow, real: (six: readonly number[]) => number[], swap: boolean): NonNullable<EngineFighter["altForm"]> {
  const own = alt.ownMoves ? movesOf(data, alt.form, swap) : [];
  return {
    species: alt.form,
    stats: real(alt.stats),
    ...(alt.types ? { types: alt.types } : {}),
    ...(own.length ? { moves: own, range: rangeOfMoves(own) } : {}),
  };
}

// 출전 제한의 칸 — 메가 모습을 켜면 메가 칸도 센다
export const tierFrom = (data: BattleData, species: string): "legendary" | "sub" | null => data.species[species]?.tier ?? null;

// ── 저장 → 배틀 파티 ── 서버가 서버 저장에서 배틀 파티를 읽을 때 쓴다(손으로 만든 저장도 받으므로 모든 값을 의심한다)
// 출전 제한 마릿수 — src/battle/rules.ts BATTLE_RULES.limits 와 같다(selftest-battle 이 대조)
export const BATTLE_LIMITS = { legendary: 1, sub: 2, mega: 1 } as const;
const BATTLE_SLOTS = 6;

export interface PartyRead {
  party: (FighterSource | null)[]; // 칸 6개
  count: number; // 든 개체 수
  blocked: boolean; // 출전 불가가 있는가 — 칸의 마릿수를 넘으면 칸 순서가 뒤인 개체가 출전 불가
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 모습 바꾸기 묶음 — 그 종이 든 묶음(기본 종 포함). 없으면 빈 목록 (src/dex/regional.ts shiftGroupOf 와 같다)
function shiftGroup(data: BattleData, slug: string): string[] {
  for (const [base, list] of Object.entries(data.shift ?? {})) if (base === slug || list.includes(slug)) return [base, ...list];
  return [];
}

export function partyOf(save: unknown, data: BattleData): PartyRead {
  const empty: PartyRead = { party: Array.from({ length: BATTLE_SLOTS }, () => null), count: 0, blocked: false };
  if (!isRec(save) || !isRec(save.battle) || !Array.isArray(save.battle.slots) || !Array.isArray(save.pets)) return empty;
  const pets = new Map<string, Record<string, unknown>>();
  for (const p of save.pets) if (isRec(p) && typeof p.id === "string") pets.set(p.id, p);
  const mega = isRec(save.battle.mega) ? save.battle.mega : {};
  const forms = isRec(save.battle.forms) ? save.battle.forms : {};
  const count = { legendary: 0, sub: 0, mega: 0 };
  let blocked = false;
  let n = 0;
  const party = Array.from({ length: BATTLE_SLOTS }, (_, i): FighterSource | null => {
    const id = (save.battle as { slots: unknown[] }).slots[i];
    const pet = typeof id === "string" ? pets.get(id) : undefined;
    if (!pet || typeof pet.species !== "string" || !data.species[pet.species]) return null;
    // 배틀 파티의 모습 — 칸에 들어올 때 적은 모습 바꾸기 종. 같은 묶음이 아니면 지금 종 (src/battle/party.ts battleSpeciesOf 와 같다)
    const keptRaw = forms[id as string];
    const group = shiftGroup(data, pet.species);
    const species = typeof keptRaw === "string" && group.includes(keptRaw) && data.species[keptRaw] ? keptRaw : pet.species;
    const formRaw = mega[id as string];
    const form = typeof formRaw === "string" && data.mega[formRaw]?.base === pet.species ? formRaw : null;
    n++;
    const tier = tierFrom(data, species);
    if (tier && (count[tier] += 1) > BATTLE_LIMITS[tier]) blocked = true;
    if (form && (count.mega += 1) > BATTLE_LIMITS.mega) blocked = true;
    return { species, form, moveSwap: pet.moveSwap === true, level: typeof pet.level === "number" ? pet.level : 1 };
  });
  return { party, count: n, blocked };
}
