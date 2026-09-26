// 저장 v3 의 빈 상태와 정규화 — 모양은 src/shared/save-v3.ts, 계약은 docs/specs/modules.md "저장 구조"
//
// 정규화는 너그럽다. 빠진 필드는 기본값으로 채우고 범위를 벗어난 값은 자른다.
// 뼈대(v · pets · party.slots)가 아니면 null 을 돌려준다. 부르는 쪽이 파손으로 다룬다.
// 여기서 시계를 부르지 않는다. 지금 시각이 필요하면 받는다.
import { localDate } from "../shared/clock.js";
import type {
  AchievementV3, BoxV3, BuffKind, BuffV3, DexV3, EggV3, PartySlotV3, PetV3,
  PointsV3, SaveV3, SettingsV3, SlotState, TradePendingV3, TutorialState, TutorialV3, TxRecordV3,
} from "../shared/save-v3";
import type { LogEntry, NatureId, PetDaily, Totals } from "../shared/types";
import { SAVE_RULES, SAVE_V3_RULES, isNatureId, snapSize } from "./rules.js";

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => v != null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const int = (v: unknown, d = 0): number => Math.round(num(v, d));
const nonNeg = (v: unknown, d = 0): number => Math.max(0, int(v, d));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const unique = <T>(list: T[]): T[] => [...new Set(list)];

const BUFF_KINDS: readonly BuffKind[] = ["premium-food", "long-play"];
const SLOT_STATES: readonly SlotState[] = ["pokemon", "empty", "locked"];
const TUTORIAL_STATES: readonly TutorialState[] = ["none", "active", "skipped", "done"];

const emptyDaily = (date: string): PetDaily => ({ date, gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 });

const emptyTotals = (): Totals => ({ workMs: 0, presenceMs: 0, tokens: 0, turns: 0, days: 0, fed: 0, played: 0 });

// 첫 선택을 마치기 전의 빈 저장 — 파티는 두 칸이 열려 있고 나머지는 잠겨 있다
export function empty(now: number): SaveV3 {
  const date = localDate(now);
  return {
    v: 3,
    savedAt: now,
    lastTickAt: now,
    pets: [],
    starterPetId: null,
    party: { slots: emptySlots() },
    boxes: [newBox("b1", SAVE_V3_RULES.box.firstName)],
    eggs: [],
    eggSeq: 0,
    bag: {},
    points: { balance: 0, progressMs: 0 },
    dex: { unlocked: [], obtained: [], shinyObtained: [], discovered: {}, rulesRev: SAVE_V3_RULES.unlockRev },
    achievements: {},
    tutorials: {},
    settings: emptySettings(),
    daily: { date, streak: 0, interacted: false },
    totals: emptyTotals(),
    agents: {},
    tx: [],
    legacy: {},
    log: [],
  };
}

export function emptySlots(): PartySlotV3[] {
  const { total, openAtStart, shopUnlock } = SAVE_V3_RULES.party;
  return Array.from({ length: total }, (_, i) => {
    if (i < openAtStart) return { state: "empty" as SlotState };
    const bought = i - openAtStart < shopUnlock;
    return { state: "locked" as SlotState, unlockBy: bought ? ("shop" as const) : ("achievement" as const) };
  });
}

export const newBox = (id: string, name: string): BoxV3 => ({ id, name, slots: Array.from({ length: SAVE_V3_RULES.box.size }, () => null) });

// 소리 크기 기본값 — src/state/settings.ts SOUND_RULES.defaultVolume 과 같다 (저장 모듈이 상태 모듈을 부르지 않게 값만 둔다)
const SOUND_DEFAULT_VOLUME = 30;

const emptySettings = (): SettingsV3 => ({
  language: "ko",
  startOnLogin: true, // 계약 기본값 켜짐 (docs/specs/s5.md "설정과 연결"). 이미 값이 있는 저장은 그 값을 따른다
  sound: true,
  volume: SOUND_DEFAULT_VOLUME,
  sleepAfterMin: 5,
  playArea: { mode: "full", rect: null },
  display: {},
});

// ── 정규화 ─────────────────────────────────────────────────────────────────────

function normalizeDaily(raw: unknown, date: string): PetDaily {
  const r = isObj(raw) ? raw : {};
  const d = str(r.date, date);
  if (d !== date) return emptyDaily(date);
  return {
    date: d,
    gained: nonNeg(r.gained),
    feeds: nonNeg(r.feeds),
    plays: nonNeg(r.plays),
    pokes: nonNeg(r.pokes),
    presence: nonNeg(r.presence),
    work: nonNeg(r.work),
    turns: nonNeg(r.turns),
  };
}

function normalizeBuffs(raw: unknown): BuffV3[] {
  if (!Array.isArray(raw)) return [];
  const out: BuffV3[] = [];
  for (const b of raw) {
    if (!isObj(b)) continue;
    const kind = str(b.kind);
    if (!(BUFF_KINDS as readonly string[]).includes(kind)) continue;
    const remainMs = nonNeg(b.remainMs);
    if (remainMs <= 0) continue;
    out.push({ kind: kind as BuffKind, remainMs });
  }
  return out;
}

// 개체 하나 — 종이 없으면 null (뼈대 아님)
export function normalizePet(raw: unknown, date: string): PetV3 | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const species = str(raw.species);
  if (!id || !species) return null;
  const nature: NatureId = isNatureId(raw.nature) ? raw.nature : SAVE_RULES.pet.nature;
  const home = isObj(raw.home) ? raw.home : {};
  return {
    id,
    species,
    shiny: bool(raw.shiny),
    nature,
    size: snapSize(num(raw.size, SAVE_V3_RULES.pet.size)), // 단계 배율로 맞춘다 — 옛 4~6 은 가장 큰 단계로 (src/save/rules.ts SIZE_STEPS)
    level: clamp(int(raw.level, SAVE_V3_RULES.pet.level), 1, 100),
    exp: nonNeg(raw.exp, SAVE_V3_RULES.pet.exp),
    affinity: clamp(int(raw.affinity, SAVE_V3_RULES.pet.affinity), 0, 100),
    affinityProgressMs: nonNeg(raw.affinityProgressMs),
    fullness: clamp(int(raw.fullness, SAVE_V3_RULES.pet.fullness), 0, 100),
    fullnessProgressMs: nonNeg(raw.fullnessProgressMs),
    mood: clamp(int(raw.mood, SAVE_V3_RULES.pet.mood), 0, 100),
    moodProgressMs: nonNeg(raw.moodProgressMs), // 2026-09-25 에 더했다. 옛 저장에는 없어 0 이다
    feedCooldownMs: nonNeg(raw.feedCooldownMs),
    playCooldownMs: nonNeg(raw.playCooldownMs),
    playWindowMs: nonNeg(raw.playWindowMs),
    playStreak: nonNeg(raw.playStreak),
    buffs: normalizeBuffs(raw.buffs),
    home: { dx: int(home.dx, SAVE_RULES.pet.home.dx), dy: int(home.dy, SAVE_RULES.pet.home.dy) },
    since: nonNeg(raw.since),
    stage: nonNeg(raw.stage),
    evolved: strings(raw.evolved),
    ...(Array.isArray(raw.forms) ? { forms: strings(raw.forms) } : {}), // 2026-09-26 에 더했다. 공유 sid 계열만 가진다
    daily: normalizeDaily(raw.daily, date),
  };
}

function normalizeSlots(raw: unknown, petIds: Set<string>): PartySlotV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = emptySlots();
  for (let i = 0; i < out.length; i++) {
    const r = list[i];
    if (!isObj(r)) continue;
    const state = str(r.state);
    if (!(SLOT_STATES as readonly string[]).includes(state)) continue;
    if (state === "pokemon") {
      const petId = str(r.petId);
      // 없는 개체를 가리키는 칸은 빈 칸으로 본다 — 사라진 개체를 화면이 그리지 못하게
      out[i] = petIds.has(petId) ? { state: "pokemon", petId, hidden: bool(r.hidden) } : { state: "empty" };
      continue;
    }
    if (state === "empty") {
      out[i] = { state: "empty" };
      continue;
    }
    const by = str(r.unlockBy) === "achievement" ? "achievement" : "shop";
    out[i] = { state: "locked", unlockBy: by };
  }
  return out;
}

function normalizeBoxes(raw: unknown, petIds: Set<string>, placed: Set<string>): BoxV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BoxV3[] = [];
  for (const b of list) {
    if (!isObj(b)) continue;
    const id = str(b.id);
    if (!id) continue;
    const box = newBox(id, str(b.name, `박스 ${out.length + 1}`));
    const slots = Array.isArray(b.slots) ? b.slots : [];
    for (let i = 0; i < box.slots.length; i++) {
      const petId = str(slots[i]);
      if (!petId || !petIds.has(petId) || placed.has(petId)) continue;
      box.slots[i] = petId;
      placed.add(petId);
    }
    out.push(box);
  }
  return out.length ? out : [newBox("b1", SAVE_V3_RULES.box.firstName)];
}

function normalizeEggs(raw: unknown): EggV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EggV3[] = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    const id = str(e.id);
    if (!id) continue;
    const actions = isObj(e.actions) ? e.actions : {};
    const remainMs = nonNeg(e.remainMs);
    out.push({
      id,
      kind: str(e.kind, "random"),
      boughtAt: nonNeg(e.boughtAt),
      remainMs,
      ready: remainMs <= 0 ? true : bool(e.ready),
      candidates: strings(e.candidates),
      careCooldownMs: nonNeg(e.careCooldownMs),
      actions: { pat: nonNeg(actions.pat), song: nonNeg(actions.song) },
    });
  }
  return out;
}

// 옛 도구 id → 지금 id. 2026-09-25 에 민트 키를 공식 식별자로 바꿨다(mint-adamant → adamant-mint)
const itemIdOf = (id: string): string => id.replace(/^mint-([a-z]+)$/, "$1-mint");

function normalizeBag(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = nonNeg(v);
    if (n > 0) out[itemIdOf(k)] = (out[itemIdOf(k)] ?? 0) + n;
  }
  return out;
}

function normalizeDex(raw: unknown): DexV3 {
  const r = isObj(raw) ? raw : {};
  const discovered: Record<string, string> = {};
  if (isObj(r.discovered)) for (const [k, v] of Object.entries(r.discovered)) if (typeof v === "string") discovered[k] = v;
  return {
    unlocked: unique(strings(r.unlocked)),
    obtained: unique(strings(r.obtained)),
    shinyObtained: unique(strings(r.shinyObtained)),
    discovered,
    rulesRev: nonNeg(r.rulesRev),
  };
}

function normalizeAchievements(raw: unknown): Record<string, AchievementV3> {
  const out: Record<string, AchievementV3> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const achievedAt = typeof v.achievedAt === "number" ? v.achievedAt : null;
    const claimedAt = typeof v.claimedAt === "number" ? v.claimedAt : null;
    // 받은 적이 있으면 달성한 적도 있다 — 어긋난 기록은 달성으로 맞춘다
    out[k] = { achievedAt: achievedAt ?? claimedAt, claimedAt };
  }
  return out;
}

function normalizeTutorials(raw: unknown): Record<string, TutorialV3> {
  const out: Record<string, TutorialV3> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const state = str(v.state, "none");
    out[k] = {
      state: ((TUTORIAL_STATES as readonly string[]).includes(state) ? state : "none") as TutorialState,
      steps: nonNeg(v.steps),
      ...(typeof v.queuedAt === "number" && Number.isFinite(v.queuedAt) ? { queuedAt: v.queuedAt } : {}), // 2026-09-26 에 더했다
    };
  }
  return out;
}

function normalizeSettings(raw: unknown): SettingsV3 {
  const r = isObj(raw) ? raw : {};
  const base = emptySettings();
  const area = isObj(r.playArea) ? r.playArea : {};
  const rect = isObj(area.rect) ? area.rect : null;
  return {
    language: str(r.language, base.language),
    startOnLogin: bool(r.startOnLogin, base.startOnLogin),
    sound: bool(r.sound, base.sound),
    volume: clamp(int(r.volume, base.volume), 0, 100), // 옛 저장에는 없어 기본값이다
    sleepAfterMin: clamp(int(r.sleepAfterMin, base.sleepAfterMin), 0, 600), // 0 은 잠들지 않음 (docs/specs/s5.md "설정과 연결")
    playArea: {
      mode: str(area.mode) === "region" ? "region" : "full",
      rect: rect ? { x: int(rect.x), y: int(rect.y), w: nonNeg(rect.w), h: nonNeg(rect.h) } : null,
    },
    display: isObj(r.display) ? { ...r.display } : {},
  };
}

// 완료한 요청 — 최근 건수와 보관 기간 중 큰 쪽을 남긴다
export function normalizeTx(raw: unknown, now: number): TxRecordV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: TxRecordV3[] = [];
  for (const t of list) {
    if (!isObj(t)) continue;
    const id = str(t.id);
    if (!id) continue;
    out.push({ id, at: nonNeg(t.at), result: t.result });
  }
  out.sort((a, b) => a.at - b.at);
  const { keep, ttlMs } = SAVE_V3_RULES.tx;
  const fresh = out.filter((t) => now - t.at <= ttlMs);
  return fresh.length >= keep ? fresh : out.slice(-keep);
}

function normalizePoints(raw: unknown): PointsV3 {
  const r = isObj(raw) ? raw : {};
  return { balance: nonNeg(r.balance), progressMs: nonNeg(r.progressMs) };
}

function normalizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is LogEntry => isObj(e) && typeof e.at === "number" && typeof e.kind === "string")
    .slice(-SAVE_RULES.log.keep);
}

// 파일 내용 → SaveV3. 뼈대가 아니면 null. 칸에 없는 개체는 박스의 빈 칸으로 보낸다
export function normalize(raw: unknown, now: number): SaveV3 | null {
  if (!isObj(raw) || raw.v !== 3) return null;
  const date = localDate(now);
  const pets: PetV3[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw.pets) ? raw.pets : []) {
    const pet = normalizePet(p, date);
    if (!pet || seen.has(pet.id)) continue;
    seen.add(pet.id);
    pets.push(pet);
  }
  const party = isObj(raw.party) ? raw.party : {};
  const slots = normalizeSlots(party.slots, seen);
  const placed = new Set<string>();
  for (const s of slots) if (s.state === "pokemon" && s.petId) placed.add(s.petId);
  const boxes = normalizeBoxes(raw.boxes, seen, placed);
  putStrays(pets, placed, boxes);

  const d = isObj(raw.daily) ? raw.daily : {};
  const dailyDate = str(d.date, date);
  const eggs = normalizeEggs(raw.eggs);
  return {
    v: 3,
    savedAt: nonNeg(raw.savedAt, now),
    lastTickAt: nonNeg(raw.lastTickAt, now),
    pets,
    starterPetId: seen.has(str(raw.starterPetId)) ? str(raw.starterPetId) : null,
    party: { slots },
    boxes,
    eggs,
    eggSeq: Math.max(nonNeg(raw.eggSeq), maxEggNo(eggs)), // 2026-09-26 에 더했다. 옛 저장은 지금 있는 알의 가장 큰 번호에서 시작한다
    bag: normalizeBag(raw.bag),
    points: normalizePoints(raw.points),
    dex: normalizeDex(raw.dex),
    achievements: normalizeAchievements(raw.achievements),
    tutorials: normalizeTutorials(raw.tutorials),
    settings: normalizeSettings(raw.settings),
    daily: dailyDate === date
      ? { date: dailyDate, streak: nonNeg(d.streak), interacted: bool(d.interacted) }
      : { date, streak: nonNeg(d.streak), interacted: false },
    totals: { ...emptyTotals(), ...(isObj(raw.totals) ? normalizeTotals(raw.totals) : {}) },
    agents: isObj(raw.agents) ? { ...(raw.agents as SaveV3["agents"]) } : {},
    tx: normalizeTx(raw.tx, now),
    legacy: isObj(raw.legacy) ? { ...raw.legacy } : {},
    log: normalizeLog(raw.log),
    trade: normalizeTrade(raw.trade, seen),
  };
}

// 친구 교환에 걸린 개체 — 개체가 없거나 모양이 깨졌으면 비운다 (docs/work/trade/record.md "로컬 저장과 복구")
function normalizeTrade(raw: unknown, petIds: Set<string>): { pending: TradePendingV3 | null } {
  const p = isObj(raw) && isObj(raw.pending) ? raw.pending : null;
  if (!p || typeof p.channelId !== "string" || !p.channelId || typeof p.petId !== "string" || !petIds.has(p.petId)) return { pending: null };
  return { pending: { channelId: p.channelId, petId: p.petId, offerRev: nonNeg(p.offerRev), received: p.received ?? null } };
}

// 알 식별자 `e숫자` 의 가장 큰 번호
export function maxEggNo(eggs: { id: string }[]): number {
  let max = 0;
  for (const e of eggs) {
    const m = /^e(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function normalizeTotals(raw: Raw): Totals {
  return {
    workMs: nonNeg(raw.workMs),
    presenceMs: nonNeg(raw.presenceMs),
    tokens: nonNeg(raw.tokens),
    turns: nonNeg(raw.turns),
    days: nonNeg(raw.days),
    fed: nonNeg(raw.fed),
    played: nonNeg(raw.played),
  };
}

// 파티에도 박스에도 없는 개체를 박스의 빈 칸에 넣는다. 자리가 없으면 박스를 새로 만든다
export function putStrays(pets: PetV3[], placed: Set<string>, boxes: BoxV3[]): void {
  for (const pet of pets) {
    if (placed.has(pet.id)) continue;
    let done = false;
    for (const box of boxes) {
      const i = box.slots.indexOf(null);
      if (i < 0) continue;
      box.slots[i] = pet.id;
      done = true;
      break;
    }
    if (!done) {
      const box = newBox(`b${boxes.length + 1}`, `박스 ${boxes.length + 1}`);
      box.slots[0] = pet.id;
      boxes.push(box);
    }
    placed.add(pet.id);
  }
}
