// 저장 v3 의 빈 상태와 정규화 — 모양은 src/shared/save-v3.ts, 계약은 docs/specs/modules.md "저장 구조"
//
// 정규화는 너그럽다. 빠진 필드는 기본값으로 채우고 범위를 벗어난 값은 자른다.
// 뼈대(v · pets · party.slots)가 아니면 null 을 돌려준다. 부르는 쪽이 파손으로 다룬다.
// 여기서 시계를 부르지 않는다. 지금 시각이 필요하면 받는다.
import { localDate } from "../shared/clock.js";
import type {
  AchievementV3, BoxV3, BuffKind, BuffV3, DexV3, EggV3, FindKind, FindRecordV3, FindV3, PartySlotV3, PartyV3, PetV3,
  PointsV3, SaveV3, ScreenRefV3, SettingsV3, SlotState, TradePendingV3, TutorialState, TutorialV3, TxRecordV3,
} from "../shared/save-v3";
import type { LogEntry, NatureId, PetDaily, Totals } from "../shared/types";
import { SAVE_RULES, SAVE_V3_RULES, SHOP_V3_RULES, isNatureId, snapSize } from "./rules.js";
import { MINT_ID, currentItemId, isOldMint, refundRetiredMint } from "../bag/mint.js";
import { compactSlots } from "../party/slots.js";
import { countParty } from "../party/presets.js";
import { normalizeMail } from "../mail/core.js";
import { FIND_RULES } from "../find/rules.js";
import { isGender, legacyGender } from "../dex/gender.js";
import { maxPetNo } from "../party/create.js";

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => v != null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const int = (v: unknown, d = 0): number => Math.round(num(v, d));
const nonNeg = (v: unknown, d = 0): number => Math.max(0, int(v, d));

// 화면 하나를 가리키는 값 — id 와 사각형이 모두 유한한 수이고 크기가 있어야 한다. 아니면 null (설정·개체·명령이 같은 규칙을 쓴다)
export function screenRefOf(raw: unknown): ScreenRefV3 | null {
  if (!isObj(raw)) return null;
  const { id, x, y, w, h } = raw;
  if (![id, x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const ref = { id: Math.round(id as number), x: Math.round(x as number), y: Math.round(y as number), w: Math.round(w as number), h: Math.round(h as number) };
  return ref.w > 0 && ref.h > 0 ? ref : null;
}

// 놀이공간 방식 — 옛 "full"(주 화면)과 모르는 값은 "screen"(고른 화면 없음 = 주 화면)이다 (2026-09-28 여러 화면)
const playModeOf = (v: unknown): SettingsV3["playArea"]["mode"] => (v === "region" || v === "all" ? v : "screen");
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const unique = <T>(list: T[]): T[] => [...new Set(list)];

const BUFF_KINDS: readonly BuffKind[] = ["premium-food", "long-play", "short-play"];
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
    party: emptyParty(),
    boxes: growBoxes([newBox("b1", SAVE_V3_RULES.box.firstName)]),
    petSeq: 0,
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

// 프리셋 하나의 새 칸 — 첫 프리셋은 상점 2칸·업적 2칸이다. 나머지 프리셋은 잠긴 칸을 모두 상점에서 산다 (2026-10-02 사용자 결정)
export function presetSlots(index: number): PartySlotV3[] {
  if (index === 0) return emptySlots();
  const { total, openAtStart } = SAVE_V3_RULES.party;
  return Array.from({ length: total }, (_, i) =>
    i < openAtStart ? { state: "empty" as SlotState } : { state: "locked" as SlotState, unlockBy: "shop" as const });
}

// 새 저장의 파티 — 첫 프리셋을 적용한 채 프리셋 start 개로 시작한다
function emptyParty(): PartyV3 {
  const party: PartyV3 = {
    slots: presetSlots(0),
    active: 0,
    presets: Array.from({ length: SAVE_V3_RULES.party.presets.start }, (_, i) => (i === 0 ? null : presetSlots(i))),
    presetNames: Array.from({ length: SAVE_V3_RULES.party.presets.start }, () => ""),
  };
  countParty({ party });
  return party;
}

export const newBox = (id: string, name: string): BoxV3 => ({ id, name, slots: Array.from({ length: SAVE_V3_RULES.box.size }, () => null) });

// 박스 수를 규칙에 맞춘다 — start 개보다 적으면 채우고, 모든 박스에 한 마리 이상 있으면 step 개를 더한다.
// 그래서 빈 박스가 늘 하나 이상 있다. 줄이지는 않는다. 박스에 개체가 들어가는 조작 뒤에 부른다
export function growBoxes(boxes: BoxV3[]): BoxV3[] {
  const { start, step } = SAVE_V3_RULES.box;
  const add = (count: number): void => {
    for (let i = 0; i < count; i += 1) boxes.push(newBox(`b${boxes.length + 1}`, `박스 ${boxes.length + 1}`));
  };
  if (boxes.length < start) add(start - boxes.length);
  if (boxes.every((b) => b.slots.some((s) => s !== null))) add(step);
  return boxes;
}

// 소리 크기 기본값 — src/state/settings.ts SOUND_RULES.defaultVolume 과 같다 (저장 모듈이 상태 모듈을 부르지 않게 값만 둔다)
const SOUND_DEFAULT_VOLUME = 30;

const emptySettings = (): SettingsV3 => ({
  language: "ko",
  startOnLogin: true, // 계약 기본값 켜짐 (docs/specs/game.md "설정과 연결"). 이미 값이 있는 저장은 그 값을 따른다
  sound: true,
  volume: SOUND_DEFAULT_VOLUME,
  sleepAfterMin: 5,
  playArea: { mode: "screen", rect: null, screen: null }, // 새 저장은 주 화면 (2026-09-28 사용자 결정)
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
  // 신남이 있으면 들뜸은 두지 않는다 — 들뜸은 신남으로 바뀌는 아랫단계다
  return out.some((b) => b.kind === "long-play") ? out.filter((b) => b.kind !== "short-play") : out;
}

// 개체 하나 — 종이 없으면 null (뼈대 아님)
export function normalizePet(raw: unknown, date: string): PetV3 | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const species = str(raw.species);
  if (!id || !species) return null;
  const nature: NatureId = isNatureId(raw.nature) ? raw.nature : SAVE_RULES.pet.nature;
  const home = isObj(raw.home) ? raw.home : {};
  const since = nonNeg(raw.since);
  return {
    id,
    species,
    shiny: bool(raw.shiny),
    nature,
    gender: isGender(raw.gender) ? raw.gender : legacyGender({ id, species, since }), // 옛 저장은 반반 (2026-09-30 사용자 결정)
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
    ...(screenRefOf(raw.screen) ? { screen: screenRefOf(raw.screen)! } : {}), // 2026-09-28 에 더했다. 모든 화면 방식에서 끌어다 놓은 개체만 가진다
    since,
    stage: nonNeg(raw.stage),
    evolved: strings(raw.evolved),
    ...(Array.isArray(raw.forms) ? { forms: strings(raw.forms) } : {}), // 2026-09-26 에 더했다. 공유 sid 계열만 가진다
    daily: normalizeDaily(raw.daily, date),
  };
}

// 프리셋 하나의 칸. `placed` 는 이미 자리가 있는 개체다 — 놓은 개체를 여기에 더한다
function normalizeSlots(raw: unknown, petIds: Set<string>, placed: Set<string>, preset: number): PartySlotV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = presetSlots(preset);
  for (let i = 0; i < out.length; i++) {
    const r = list[i];
    if (!isObj(r)) continue;
    const state = str(r.state);
    if (!(SLOT_STATES as readonly string[]).includes(state)) continue;
    if (state === "pokemon") {
      const petId = str(r.petId);
      // 없는 개체를 가리키는 칸은 빈 칸으로 본다 — 사라진 개체를 화면이 그리지 못하게.
      // 다른 칸에 이미 놓인 개체도 빈 칸으로 본다 — 개체는 한 자리에만 있다
      if (petIds.has(petId) && !placed.has(petId)) {
        out[i] = { state: "pokemon", petId, hidden: bool(r.hidden) };
        placed.add(petId);
      } else {
        out[i] = { state: "empty" };
      }
      continue;
    }
    if (state === "empty") {
      out[i] = { state: "empty" };
      continue;
    }
    // 업적으로 여는 칸은 첫 프리셋에만 있다
    const by = preset === 0 && str(r.unlockBy) === "achievement" ? "achievement" : "shop";
    out[i] = { state: "locked", unlockBy: by };
  }
  return compactSlots(out); // 열린 칸은 앞에서부터 — 옛 저장의 1·2·5번 열림도 1·2·3번으로
}

// 파티와 프리셋 — 프리셋이 없는 옛 저장은 지금 파티를 첫 프리셋으로 보고 나머지를 빈 프리셋으로 채운다.
// 읽는 순서는 적용한 프리셋 → 나머지 프리셋 번호 순이다. 한 개체가 두 곳에 있으면 먼저 읽은 쪽이 남는다.
// 가진 수를 넘는 번호의 칸은 버린다 — 그 개체는 자리 없는 개체로 박스에 간다 (putStrays)
function normalizeParty(raw: unknown, petIds: Set<string>, placed: Set<string>): PartyV3 {
  const r = isObj(raw) ? raw : {};
  const { start, max, nameMax } = SAVE_V3_RULES.party.presets;
  const rawPresets = Array.isArray(r.presets) ? r.presets : [];
  const rawNames = Array.isArray(r.presetNames) ? r.presetNames : [];
  const count = clamp(nonNeg(r.presetCount, rawPresets.length), start, max);
  const active = clamp(nonNeg(r.active), 0, count - 1);
  const slots = normalizeSlots(r.slots, petIds, placed, active);
  const presets = Array.from({ length: count }, (_, i) => (i === active ? null : normalizeSlots(rawPresets[i], petIds, placed, i)));
  const presetNames = Array.from({ length: count }, (_, i) => [...str(rawNames[i]).trim()].slice(0, nameMax).join(""));
  const party: PartyV3 = { slots, active, presets, presetNames, presetCount: count };
  countParty({ party });
  return party;
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

// 가방 — 옛 민트 21종(<성격>-mint, 그 전의 mint-<성격>)은 민트 한 종류(mint)로 합친다 (2026-09-29 사용자 결정).
// 합친 민트는 가방 상한(SHOP_V3_RULES.bagMax)으로 자른다. 다른 도구의 개수는 건드리지 않는다
function normalizeBag(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  let merged = false;
  for (const [k, v] of Object.entries(raw)) {
    const n = nonNeg(v);
    if (n <= 0) continue;
    if (isOldMint(k)) merged = true;
    const id = currentItemId(k);
    out[id] = (out[id] ?? 0) + n;
  }
  if (merged && (out[MINT_ID] ?? 0) > SHOP_V3_RULES.bagMax) out[MINT_ID] = SHOP_V3_RULES.bagMax;
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
    sleepAfterMin: clamp(int(r.sleepAfterMin, base.sleepAfterMin), 0, 600), // 0 은 잠들지 않음 (docs/specs/game.md "설정과 연결")
    playArea: {
      mode: playModeOf(area.mode),
      rect: rect ? { x: int(rect.x), y: int(rect.y), w: nonNeg(rect.w), h: nonNeg(rect.h) } : null,
      screen: screenRefOf(area.screen),
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
  const placed = new Set<string>();
  const party = normalizeParty(raw.party, seen, placed);
  const boxes = normalizeBoxes(raw.boxes, seen, placed);
  putStrays(pets, placed, boxes);
  growBoxes(boxes); // 옛 저장(박스 1개부터)도 읽을 때 지금 규칙으로 맞춘다

  const d = isObj(raw.daily) ? raw.daily : {};
  const dailyDate = str(d.date, date);
  const eggs = normalizeEggs(raw.eggs);
  const bag = normalizeBag(raw.bag);
  const points = normalizePoints(raw.points);
  refundRetiredMint(bag, points); // 성격민트 은퇴 — 가진 민트를 지우고 개당 구매가를 포인트로 (src/bag/mint.ts)
  return {
    v: 3,
    savedAt: nonNeg(raw.savedAt, now),
    lastTickAt: nonNeg(raw.lastTickAt, now),
    pets,
    starterPetId: seen.has(str(raw.starterPetId)) ? str(raw.starterPetId) : null,
    party,
    boxes,
    eggs,
    petSeq: Math.max(nonNeg(raw.petSeq), maxPetNo(pets)), // 2026-10-02 에 더했다. 옛 저장은 지금 있는 개체의 가장 큰 번호에서 시작한다
    eggSeq: Math.max(nonNeg(raw.eggSeq), maxEggNo(eggs)), // 2026-09-26 에 더했다. 옛 저장은 지금 있는 알의 가장 큰 번호에서 시작한다
    bag,
    points,
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
    mail: normalizeMail(raw.mail),
    find: normalizeFind(raw.find),
  };
}

const FIND_KINDS: readonly FindKind[] = ["points", "item", "evo", "pokemon"];

// 줍기 — 모양이 깨진 기록은 버린다. 없으면 빈 값 (src/find/core.ts)
function normalizeFind(raw: unknown): FindV3 {
  const r = isObj(raw) ? raw : {};
  const log: FindRecordV3[] = [];
  for (const e of Array.isArray(r.log) ? r.log : []) {
    if (!isObj(e) || typeof e.id !== "string" || !e.id || typeof e.petId !== "string" || !FIND_KINDS.includes(e.kind as FindKind)) continue;
    if (log.some((x) => x.id === e.id)) continue;
    log.push({
      id: e.id,
      at: nonNeg(e.at),
      petId: e.petId,
      species: str(e.species),
      kind: e.kind as FindKind,
      ref: str(e.ref),
      amount: nonNeg(e.amount, 1),
      ...(typeof e.newPetId === "string" && e.newPetId ? { newPetId: e.newPetId } : {}),
    });
  }
  const maxNo = log.reduce((m, e) => Math.max(m, Number(/^f(\d+)$/.exec(e.id)?.[1] ?? 0)), 0);
  return { seq: Math.max(nonNeg(r.seq), maxNo), log: log.slice(-FIND_RULES.keep) }; // 옛 activeMs 는 버린다 — 판정이 무기억이다
}

// 친구 교환에 걸린 개체 — 개체가 없거나 모양이 깨졌으면 비운다 (worklog/records/trade/record.md "로컬 저장과 복구")
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
