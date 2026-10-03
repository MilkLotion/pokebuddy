// 옛 저장(v1·v2) 읽기 — 파일 내용을 v2 모양으로 맞춘다. v3 으로 옮기는 것은 ./migrate.ts 다
// 스키마 검증은 너그럽다 — 빠진 필드는 기본값으로 채우고, 뼈대(v·party, 종 없는 마리)가 아니면 파손으로 본다
// v1(한 마리 활성 + party 객체) 은 읽을 때 v2 로 이전한다 — 사용자의 진행을 잃지 않게
// 시각은 전부 ms. 여기서 시계를 직접 부르지 않는다 — emptySaveV2(now) 처럼 받는다
// 값 읽기 도우미는 v3 정규화와 다르다 — v2 의 nonNeg 는 반올림하지 않는다
import { localDate } from "../../shared/clock.js";
import type { AgentStats, LogEntry, PetDaily, Totals } from "../../shared/save-v3.js";
import type { NatureId } from "../../shared/species.js";
import { isAgentName } from "../../shared/names/agents.js";
import { SAVE_RULES } from "../rules.js";
import { isNatureValue } from "../raw-values.js";
import { SAVE_V2_RULES } from "./rules.js";
import type { Pet, SaveV2 } from "./types.js";

// 새 마리를 만들 때 필요한 것 — 나머지는 규칙표 기본값
export interface PetInit {
  id: string;
  species: string;
  now: number;
  nature?: NatureId;
  shiny?: boolean;
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => v != null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nonNeg = (v: unknown, d = 0): number => Math.max(0, num(v, d));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const unique = <T>(list: T[]): T[] => [...new Set(list)];

// ── 기본값 ─────────────────────────────────────────────────────────────────────

// 마리별 하루 기록 — date 가 "" 이면 상태 모듈의 첫 tick 에서 오늘로 넘긴다
export function freshPetDaily(date = ""): PetDaily {
  return { date, gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 };
}

export function emptyTotals(): Totals {
  return { workMs: 0, presenceMs: 0, tokens: 0, turns: 0, days: 0, fed: 0, played: 0 };
}

// 새 마리 — look 은 두지 않는다 (없으면 species 와 같다). 성격은 부르는 쪽이 무작위로 붙이고, 없으면 중립
export function emptyPet({ id, species, now, nature, shiny = false }: PetInit): Pet {
  const { pet } = SAVE_V2_RULES;
  return {
    id,
    species,
    shiny,
    nature: nature ?? pet.nature,
    nick: null,
    size: pet.size,
    shown: true,
    home: { ...pet.home },
    hunger: pet.hunger,
    mood: pet.mood,
    affinity: 0,
    stage: 0,
    since: now,
    fedAt: null,
    playedAt: null,
    daily: freshPetDaily(localDate(now)),
    evolved: [],
  };
}

// 빈 저장 — 스타터를 고르기 전. 슬롯 1, 파티 없음
export function emptySaveV2(now: number): SaveV2 {
  return {
    v: SAVE_V2_RULES.version,
    points: 0,
    slots: SAVE_V2_RULES.slots.min,
    party: [],
    daily: { date: localDate(now), streak: 1, interacted: false },
    totals: emptyTotals(),
    agents: {},
    unlocked: [],
    inventory: {},
    acc: {},
    log: [],
  };
}

// ── 정규화 ─────────────────────────────────────────────────────────────────────

function normalizePetDaily(raw: unknown): PetDaily {
  const d = isObj(raw) ? raw : {};
  const out = freshPetDaily(typeof d.date === "string" ? d.date : "");
  for (const k of ["gained", "feeds", "plays", "pokes", "presence", "work", "turns"] as const) out[k] = nonNeg(d[k]);
  return out;
}

function normalizeHome(raw: unknown): Pet["home"] {
  const { home } = SAVE_V2_RULES.pet;
  if (!isObj(raw)) return { ...home };
  return { dx: num(raw.dx, home.dx), dy: num(raw.dy, home.dy) };
}

// 펫 하나 — 빠진 필드는 기본값. species 가 없으면 못 쓰는 펫. v1 의 마리(id·hunger·size 없음)도 이 길로 온다
function normalizePet(raw: unknown, id: string): Pet | null {
  if (!isObj(raw) || typeof raw.species !== "string" || !raw.species) return null;
  const base = emptyPet({ id, species: raw.species, now: num(raw.since, 0) });
  const { min, max } = SAVE_V2_RULES.range;
  const pet: Pet = {
    ...base,
    shiny: raw.shiny === true,
    nature: isNatureValue(raw.nature) ? raw.nature : base.nature,
    nick: typeof raw.nick === "string" ? raw.nick : null,
    size: num(raw.size) > 0 ? num(raw.size) : base.size,
    shown: typeof raw.shown === "boolean" ? raw.shown : true,
    home: normalizeHome(raw.home),
    hunger: clamp(num(raw.hunger, base.hunger), min, max),
    mood: clamp(num(raw.mood, base.mood), min, max),
    affinity: nonNeg(raw.affinity),
    stage: Math.floor(nonNeg(raw.stage)),
    fedAt: numOrNull(raw.fedAt),
    playedAt: numOrNull(raw.playedAt),
    daily: normalizePetDaily(raw.daily),
    evolved: strings(raw.evolved),
  };
  if (typeof raw.look === "string" && raw.look) pet.look = raw.look;
  return pet;
}

// 비어 있는 가장 작은 p<n>
function nextPetId(used: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `p${n}`;
    if (!used.has(id)) return id;
  }
}

// v2 party 배열 — id 가 없거나 겹치면 새로 붙인다. 마리 하나라도 종이 없으면 null (파손)
function normalizeParty(list: unknown[]): Pet[] | null {
  const used = new Set<string>();
  const ids: (string | null)[] = list.map((p) => {
    const id = isObj(p) && typeof p.id === "string" && p.id && !used.has(p.id) ? p.id : null;
    if (id) used.add(id);
    return id;
  });
  const party: Pet[] = [];
  for (let i = 0; i < list.length; i++) {
    let id = ids[i] ?? null;
    if (!id) {
      id = nextPetId(used);
      used.add(id);
    }
    const pet = normalizePet(list[i], id);
    if (!pet) return null;
    party.push(pet);
  }
  return party;
}

function normalizeDaily(raw: unknown): SaveV2["daily"] {
  const d = isObj(raw) ? raw : {};
  return {
    date: typeof d.date === "string" ? d.date : "",
    streak: Math.max(1, Math.floor(num(d.streak, 1))),
    interacted: d.interacted === true,
  };
}

function normalizeTotals(raw: unknown): Totals {
  const t = isObj(raw) ? raw : {};
  const out = emptyTotals();
  for (const k of Object.keys(out) as (keyof Totals)[]) out[k] = nonNeg(t[k]);
  return out;
}

// 아는 CLI 이름만 남긴다
function normalizeAgents(raw: unknown): SaveV2["agents"] {
  const out: SaveV2["agents"] = {};
  if (!isObj(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    if (!isAgentName(name) || !isObj(v)) continue;
    const stats: AgentStats = { connected: v.connected === true };
    if (typeof v.date === "string") stats.date = v.date;
    if (typeof v.tokensToday === "number") stats.tokensToday = nonNeg(v.tokensToday);
    if (typeof v.tokensTotal === "number") stats.tokensTotal = nonNeg(v.tokensTotal);
    out[name] = stats;
  }
  return out;
}

// 항목 → 개수. 숫자가 아닌 값은 버린다
function normalizeInventory(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, v);
  return out;
}

// 기록 — at·kind 가 있는 것만, 최근 keep 건
function normalizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is LogEntry => isObj(e) && typeof e.at === "number" && typeof e.kind === "string")
    .slice(-SAVE_RULES.logKeep);
}

// v1 → v2 이전 (1판 game/economy.js newState 의 모양)
//   party 객체 { "eevee#1": {...} } → 배열, id 는 p1… 순서대로
//   active 였던 마리만 shown — 1판에서 화면에 있던 마리가 그대로 나온다 (슬롯 1 과 맞다). 나머지는 안 보임
//   daily 는 v1 이 파티 전체 하나였다 — 활성 마리가 오늘 기록을 이어받고(하루 상한이 이전으로 풀리지 않게) 나머지는 빈 기록
//   streak 은 그대로, acc(누적기)는 버린다 — 10분이 채 안 된 조각은 잃어도 된다
//   unlocked 는 파티의 종과 거쳐 온 종 — 가진 것은 해금된 것
function migrateV1(raw: Raw): SaveV2 | null {
  if (!isObj(raw.party)) return null;
  const entries = Object.entries(raw.party);
  const active = typeof raw.active === "string" && raw.party[raw.active] ? raw.active : (entries[0]?.[0] ?? null);
  const d = isObj(raw.daily) ? raw.daily : {};
  const date = typeof d.date === "string" ? d.date : "";
  const party: Pet[] = [];
  entries.forEach(([key, p], i) => {
    const pet = normalizePet(p, `p${i + 1}`);
    if (!pet) return;
    const isActive = key === active;
    pet.shown = isActive;
    pet.daily = isActive ? normalizePetDaily({ ...d, date }) : freshPetDaily(date);
    party.push(pet);
  });
  if (party.length !== entries.length) return null;
  const interacted = nonNeg(d.feeds) + nonNeg(d.plays) + nonNeg(d.pokes) > 0;
  return {
    v: SAVE_V2_RULES.version,
    points: nonNeg(raw.points),
    slots: clamp(party.length, SAVE_V2_RULES.slots.min, SAVE_V2_RULES.slots.max), // 1판 마리가 더 많으면 마리 수만큼 칸 (design.md 저장 v2)
    party,
    daily: { date, streak: Math.max(1, Math.floor(num(d.streak, 1))), interacted },
    totals: emptyTotals(),
    agents: {},
    unlocked: unique(party.flatMap((p) => [p.species, ...p.evolved])),
    inventory: normalizeInventory(raw.inventory),
    acc: {},
    log: normalizeLog(raw.log),
  };
}

// 파일 내용 → state. 뼈대가 아니면 null (파손). v 가 1 이면 이전, 2 면 채우기, 그 밖은 파손
export function normalizeSaveV2(raw: unknown): SaveV2 | null {
  if (!isObj(raw)) return null;
  if (raw.v === 1) return migrateV1(raw);
  if (raw.v !== SAVE_V2_RULES.version || !Array.isArray(raw.party)) return null;
  const party = normalizeParty(raw.party);
  if (!party) return null;
  return {
    v: SAVE_V2_RULES.version,
    points: nonNeg(raw.points),
    slots: clamp(Math.floor(num(raw.slots, SAVE_V2_RULES.slots.min)), SAVE_V2_RULES.slots.min, SAVE_V2_RULES.slots.max),
    party,
    daily: normalizeDaily(raw.daily),
    totals: normalizeTotals(raw.totals),
    agents: normalizeAgents(raw.agents),
    unlocked: unique(strings(raw.unlocked)),
    inventory: normalizeInventory(raw.inventory),
    acc: isObj(raw.acc) ? { ...raw.acc } : {},
    log: normalizeLog(raw.log),
  };
}
