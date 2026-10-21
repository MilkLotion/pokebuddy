// 전투 개체 만들기의 핵심 — 표(BattleData)와 개체 정보로 엔진이 받는 값(EngineFighter)을 만든다
// 앱(./fighter.ts)과 서버 함수(supabase/functions/_shared/battle)가 같은 코드를 쓴다 — 같은 개체면 같은 전투 개체가 나온다
// import 는 엔진 하나뿐이다. 서버로 복사할 때 엔진 경로의 .js 를 .ts 로 바꾼다(src/tools/data/build-battle.ts). 주석에 따옴표 경로를 쓰지 않는다 — 함수 서버가 주석 속 경로도 읽는다
// 규칙은 docs/specs/adventure.md "배틀 엔진", "실제 능력치"
import { ENGINE_RULES, type EngineFighter, type EngineMove } from "./engine.js";

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
  picks?: string[]; // 후보 기술 — 개체가 기본 2개 대신 고를 수 있는 기술 (data/species-moves.json candidates). 마지막 진화체만 있다
  tier?: "legendary" | "sub" | null; // 출전 제한의 칸
}
export interface BattleMegaRow {
  base: string;
  stats: number[];
  types: string[];
  ability: string;
  moves?: BattleSpeciesRow["moves"]; // 메가 모습의 기본 2개 (data/mega-moves.json). 없으면 기본 종의 기술을 쓴다. 옛 판 데이터에는 없다
  picks?: string[]; // 메가 모습의 후보 4개
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
  female?: Record<string, { stats: number[]; types: string[]; ability: string }>; // 성별로 능력치·특성이 다른 종의 암컷 (data/gender-battle.json). 옛 판 데이터에는 없다
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
  moves?: string[]; // 개체가 고른 기술 2개, 순서대로 — 메가 줄이 있는 메가 모습이면 PetV3.megaMoves[form], 아니면 PetV3.moves. 그 줄의 기본 2개 + 후보 안이 아니면 버리고 기본 2개를 쓴다. 옛 등록에는 없다
  level?: number; // 개체의 실제 레벨 — 약어리 어군 해금에 쓴다. 없으면 해금 전
  shiny?: boolean; // 그림만 — 이로치. 전투 값에는 쓰지 않는다 (배틀 창 그림, 2026-10-09)
  gender?: string; // 성별(male·female·unknown) — 성별 그림이 따로 있는 종의 그림, 성별 능력치가 있는 종(BattleData.female)의 능력치
}

// 칸의 그림 값 — 이로치·성별. 판 응답(looks)과 상대 고르기 칸이 쓴다. 옛 등록에는 없어 기본 그림이다
export const lookOfSource = (s: FighterSource | null): { shiny: boolean; gender?: string } | null => (s ? { shiny: s.shiny === true, ...(typeof s.gender === "string" ? { gender: s.gender } : {}) } : null);

// 날씨·필드·오라 룰렛 칸 수 — 일반 1, 메가(원시회귀 포함) +1, 전설급(초전설·준전설) +1. src/view/battle.ts 가 특성 설명에도 쓴다
export const rouletteTickets = (mega: boolean, legendary: boolean): number => 1 + (mega ? 1 : 0) + (legendary ? 1 : 0);

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

// 1번 칸에 고정한 기술 — 킬가르도(stance)의 킹실드. 2번 칸만 고른다 (docs/specs/moves.md "킬가르도", 2026-10-14)
export const fixedMoveOfRow = (row: BattleSpeciesRow | undefined): string | null => {
  const first = row?.special === "stance" ? row.moves[0] : undefined;
  return first == null ? null : typeof first === "string" ? first : first.id;
};

// 개체가 고른 기술 2개가 그 종에서 쓸 수 있는가 — 기본 2개 + 후보 안의 서로 다른 2개. 킬가르도 밖의 특수 종(병풍 등)은 고르지 않는다
export function validPicks(row: BattleSpeciesRow | undefined, chosen: readonly unknown[] | null | undefined): [string, string] | null {
  if (!row || (row.special && row.special !== "stance") || !Array.isArray(chosen) || chosen.length !== 2) return null;
  const [a, b] = chosen;
  if (typeof a !== "string" || typeof b !== "string" || a === b) return null;
  const fixed = fixedMoveOfRow(row);
  if (fixed && a !== fixed) return null;
  const ids = new Set([...row.moves.map((c) => (typeof c === "string" ? c : c.id)), ...(row.picks ?? [])]);
  return ids.has(a) && ids.has(b) ? [a, b] : null;
}

// 종의 기술 2개 — 칸이 객체면 기본값을 덮는다. 표에 없는 기술은 빠진다
// chosen 이 그 종에서 쓸 수 있으면 그 2개를 그 순서로 쓴다. 아니면 기본 2개이고, swap 이면 거꾸로다
// 기술 줄 — 메가 모습(form)에 자기 기술 줄이 있으면 그 줄, 아니면 종 줄 (docs/specs/moves.md "메가 모습의 기술", 2026-10-22)
export function battleMoveRow(data: BattleData, species: string, form?: string | null): BattleSpeciesRow | undefined {
  const sp = data.species[species];
  const mega = form ? data.mega[form] : undefined;
  return sp && mega?.moves ? { stats: sp.stats, types: sp.types, ability: sp.ability, moves: mega.moves, ...(mega.picks ? { picks: mega.picks } : {}), tier: sp.tier ?? null } : sp;
}

// form — 배틀에서 켠 메가 모습. 메가 줄의 기본 2개는 swap 을 따르지 않는다(swap 은 종 줄의 순서다)
export function movesOf(data: BattleData, species: string, swap: boolean, chosen?: readonly unknown[] | null, form?: string | null): EngineMove[] {
  const out: EngineMove[] = [];
  const sp = battleMoveRow(data, species, form);
  if (sp !== data.species[species]) swap = false;
  const cells = sp?.moves ?? [];
  const picked = validPicks(sp, chosen);
  const list = picked ? picked.map((id) => cells.find((c) => (typeof c === "string" ? c : c.id) === id) ?? id) : cells;
  for (const cell of list) {
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
  return swap && !picked && !fixedMoveOfRow(sp) ? out.reverse() : out; // 고정 기술이 있으면 순서를 바꾸지 않는다
}

// 개체 하나 → 전투 개체. 표에 종이나 종족값이 없으면 null
export function fighterFrom(data: BattleData, src: FighterSource, basis: StatBasis = BATTLE_BASIS): EngineFighter | null {
  const sp = data.species[src.species];
  if (!sp) return null;
  // 성별로 능력치·특성이 다른 종(대쓰여너·에써르·퍼퓨돈·냐오닉스)의 암컷 — 능력치·타입·특성만 바꾼다. 기술과 보이는 종은 그대로다 (2026-10-17 사용자 "6 성별 능력치")
  const female = src.gender === "female" && !src.form ? data.female?.[src.species] : undefined;
  const mega = src.form ? data.mega[src.form] : undefined;
  const shown = mega ? src.form! : src.species;
  const baseStats = mega ? mega.stats : (female?.stats ?? sp.stats);
  if (!Array.isArray(baseStats) || baseStats.length !== 6) return null;
  const real = (six: readonly number[]): number[] => six.map((b, i) => realStat(b, i, basis));
  const alt = mega ? undefined : data.forms[src.species];
  const moves = movesOf(data, src.species, src.moveSwap === true, src.moves, mega ? src.form : null);
  return {
    species: shown,
    types: mega ? mega.types : (female?.types ?? sp.types),
    level: basis.level,
    stats: real(baseStats),
    moves,
    ability: mega ? mega.ability : (female?.ability ?? sp.ability),
    special: sp.special && SPECIALS.has(sp.special) ? (sp.special as EngineFighter["special"]) : null,
    altForm: alt ? altFormOf(data, alt, real, src.moveSwap === true) : null,
    schoolingReady: (src.level ?? 0) >= SCHOOLING_LEVEL,
    tickets: rouletteTickets(!!mega, !!sp.tier),
  };
}

// 전투 중 바뀌는 다른 모습 — 자기 기술을 쓰는 모습(메로엣타)은 그 모습 칸의 기술을 함께 싣는다
function altFormOf(data: BattleData, alt: BattleFormRow, real: (six: readonly number[]) => number[], swap: boolean): NonNullable<EngineFighter["altForm"]> {
  const own = alt.ownMoves ? movesOf(data, alt.form, swap) : [];
  return {
    species: alt.form,
    stats: real(alt.stats),
    ...(alt.types ? { types: alt.types } : {}),
    ...(own.length ? { moves: own } : {}),
  };
}

// 출전 제한의 칸 — 메가 모습을 켜면 메가 칸도 센다
export const tierFrom = (data: BattleData, species: string): "legendary" | "sub" | null => data.species[species]?.tier ?? null;

// ── 저장 → 배틀 파티 ── 서버가 서버 저장에서 배틀 파티를 읽을 때 쓴다(손으로 만든 저장도 받으므로 모든 값을 의심한다)
// 출전 제한 마릿수 — src/battle/rules.ts BATTLE_RULES.limits 와 같다(selftest-battle 이 대조)
//   legendary 초전설, legend 초전설·준전설 합, mega 메가진화·원시회귀
//   (2026-10-22 사용자 "전설1,준전설2으로하거나 준전설3 으로 되게 해" — 초전설 1 + 준전설 2, 또는 준전설 3)
export const BATTLE_LIMITS = { legendary: 1, legend: 3, mega: 1 } as const;
export type LimitKind = keyof typeof BATTLE_LIMITS;

// 출전 불가 — 칸마다 넘은 제한 또는 null. 칸 순서대로 세고, 넘은 칸이 뒤인 개체가 출전 불가다.
// 출전 불가가 된 개체는 마릿수에 넣지 않는다 — 한 마리를 빼면 나머지는 그대로 나간다.
// 종의 칸(초전설·합)과 메가 칸을 따로 센다. 둘 다 넘으면 종의 칸을 알린다
// 앱(src/battle/party.ts blockedSlots)·서버(partyOf)·샘플 파티가 같이 쓴다
export function blockedOf(rows: readonly ({ tier: "legendary" | "sub" | null; mega: boolean } | null)[]): (LimitKind | null)[] {
  let legendary = 0;
  let legend = 0;
  let mega = 0;
  return rows.map((row) => {
    if (!row) return null;
    let over: LimitKind | null = null;
    if (row.tier) {
      if (row.tier === "legendary" && legendary + 1 > BATTLE_LIMITS.legendary) over = "legendary";
      else if (legend + 1 > BATTLE_LIMITS.legend) over = "legend";
      else {
        if (row.tier === "legendary") legendary += 1;
        legend += 1;
      }
    }
    if (row.mega) {
      if (mega + 1 > BATTLE_LIMITS.mega) over ??= "mega";
      else mega += 1;
    }
    return over;
  });
}
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
  const rows: ({ tier: "legendary" | "sub" | null; mega: boolean } | null)[] = [];
  let n = 0;
  const party = Array.from({ length: BATTLE_SLOTS }, (_, i): FighterSource | null => {
    const id = (save.battle as { slots: unknown[] }).slots[i];
    const pet = typeof id === "string" ? pets.get(id) : undefined;
    if (!pet || typeof pet.species !== "string" || !data.species[pet.species]) {
      rows.push(null);
      return null;
    }
    // 배틀 파티의 모습 — 칸에 들어올 때 적은 모습 바꾸기 종. 같은 묶음이 아니면 지금 종 (src/battle/party.ts battleSpeciesOf 와 같다)
    const keptRaw = forms[id as string];
    const group = shiftGroup(data, pet.species);
    const species = typeof keptRaw === "string" && group.includes(keptRaw) && data.species[keptRaw] ? keptRaw : pet.species;
    const formRaw = mega[id as string];
    const form = typeof formRaw === "string" && data.mega[formRaw]?.base === pet.species ? formRaw : null;
    n++;
    rows.push({ tier: tierFrom(data, species), mega: form !== null });
    // 고른 기술 — 메가 줄이 있는 메가 모습이면 그 모습의 고른 기술(megaMoves), 아니면 moves
    const row = battleMoveRow(data, species, form);
    const megaPicked = form && row !== data.species[species] && isRec(pet.megaMoves) ? pet.megaMoves[form] : null;
    const picked = validPicks(row, Array.isArray(megaPicked) ? megaPicked : row === data.species[species] && Array.isArray(pet.moves) ? pet.moves : null);
    return { species, form, moveSwap: pet.moveSwap === true, ...(picked ? { moves: picked } : {}), level: typeof pet.level === "number" ? pet.level : 1, shiny: pet.shiny === true, ...(typeof pet.gender === "string" ? { gender: pet.gender } : {}) };
  });
  return { party, count: n, blocked: blockedOf(rows).some((b) => b !== null) };
}
