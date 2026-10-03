// 저장 v3 의 빈 상태와 정규화 — 모양은 src/shared/save-v3.ts. 개체·파티·박스는 ./normalize-pets.ts, 계약은 docs/specs/modules.md "저장 구조"
//
// 정규화는 너그럽다. 빠진 필드는 기본값으로 채우고 범위를 벗어난 값은 자른다.
// 뼈대(v · pets · party.slots)가 아니면 null 을 돌려준다. 부르는 쪽이 파손으로 다룬다.
// 여기서 시계를 부르지 않는다. 지금 시각이 필요하면 받는다.
import { localDate } from "../shared/clock.js";
import type {
  AchievementV3, CountsV3, DexV3, EggV3, FindKind, FindRecordV3, FindV3, PetV3,
  PointsV3, SaveV3, SettingsV3, TradePendingV3, TutorialState, TutorialV3, TxRecordV3,
} from "../shared/save-v3";
import type { LogEntry, Totals } from "../shared/save-v3";
import { ACHIEVEMENT_RULES } from "../achievement/rules.js";
import { BAG_RULES } from "../bag/rules.js";
import { BOX_RULES } from "../box/rules.js";
import { UNLOCK_RULES } from "../dex/rules.js";
import { fillBoxes, newBox } from "../box/boxes.js";
import { maxEggNo } from "../egg/pool.js";
import { screenRefOf } from "../shared/raw.js";
import { SAVE_RULES, SAVE_V3_RULES } from "./rules.js";
import { MINT_ID, currentItemId, isOldMint, refundRetiredMint } from "../bag/mint.js";
import { normalizeMail } from "../mail/letters.js";
import { FIND_RULES } from "../find/rules.js";
import { SOUND_RULES } from "../state/rules.js";
import { maxPetNo } from "../party/create.js";
import { addStraysToBox, emptyParty, normalizeBoxes, normalizeParty, normalizePet } from "./normalize-pets.js";
import { boolOr as bool, clampNum as clamp, intOr as int, isObj, nonNeg, strOr as str, stringList as strings, uniqueList as unique, type Raw } from "./raw-values.js";

// 놀이공간 방식 — 옛 "full"(주 화면)과 모르는 값은 "screen"(고른 화면 없음 = 주 화면)이다 (2026-09-28 여러 화면)
const playModeOf = (v: unknown): SettingsV3["playArea"]["mode"] => (v === "region" || v === "all" ? v : "screen");
const TUTORIAL_STATES: readonly TutorialState[] = ["none", "active", "skipped", "done"];

const emptyTotals = (): Totals => ({ workMs: 0, presenceMs: 0, tokens: 0, turns: 0, days: 0, fed: 0, played: 0 });

// 첫 선택을 마치기 전의 빈 저장 — 파티는 두 칸이 열려 있고 나머지는 잠겨 있다
export function emptySave(now: number): SaveV3 {
  const date = localDate(now);
  return {
    v: 3,
    savedAt: now,
    lastTickAt: now,
    pets: [],
    starterPetId: null,
    party: emptyParty(),
    boxes: fillBoxes([newBox("b1", BOX_RULES.firstName)]),
    petSeq: 0,
    eggs: [],
    eggSeq: 0,
    bag: {},
    points: { balance: 0, progressMs: 0 },
    dex: { unlocked: [], obtained: [], shinyObtained: [], discovered: {}, rulesRev: UNLOCK_RULES.rev },
    achievements: {},
    tutorials: {},
    settings: emptySettings(),
    daily: { date, streak: 0, interacted: false },
    totals: emptyTotals(),
    agents: {},
    tx: [],
    legacy: {},
    log: [],
    counts: { hatched: 0, evolved: 0, traded: 0, day: "", streak: 0 },
    achRev: ACHIEVEMENT_RULES.rev,
  };
}

const emptySettings = (): SettingsV3 => ({
  language: "ko",
  startOnLogin: true, // 계약 기본값 켜짐 (docs/specs/game.md "설정과 연결"). 이미 값이 있는 저장은 그 값을 따른다
  sound: true,
  volume: SOUND_RULES.defaultVolume,
  sleepAfterMin: 5,
  playArea: { mode: "screen", rect: null, screen: null }, // 새 저장은 주 화면 (2026-09-28 사용자 결정)
  display: {},
});

// ── 정규화 ─────────────────────────────────────────────────────────────────────

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
// 합친 민트는 가방 상한(BAG_RULES.max)으로 자른다. 다른 도구의 개수는 건드리지 않는다
export function normalizeBag(raw: unknown): Record<string, number> {
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
  if (merged && (out[MINT_ID] ?? 0) > BAG_RULES.max) out[MINT_ID] = BAG_RULES.max;
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
    ...(Array.isArray(r.megaOpened) ? { megaOpened: unique(strings(r.megaOpened)) } : {}), // 2026-10-02 에 더했다
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
    out[k] = { achievedAt: achievedAt ?? claimedAt, claimedAt, ...(v.quiet === true ? { quiet: true as const } : {}) };
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
export function normalizeSave(raw: unknown, now: number): SaveV3 | null {
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
  addStraysToBox(pets, placed, boxes);
  fillBoxes(boxes); // 옛 저장(박스 1개부터)도 읽을 때 기본 개수로 맞춘다

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
    counts: normalizeCounts(raw.counts, pets, eggs, nonNeg(raw.eggSeq)),
    achRev: nonNeg(raw.achRev),
  };
}

// 업적이 세는 누적 값 — 없으면 옛 저장이다. 저장에 남은 흔적에서 시작 값을 정한다 (src/achievement/core.ts)
//   부화   만든 알 수(eggSeq) − 기다리는 알 수. 알에서 다른 알이 나온 경우도 한 번으로 센다
//   진화   가진 개체의 stage 합. 교환으로 받은 개체의 진화도 든다
//   교환   0
function normalizeCounts(raw: unknown, pets: readonly PetV3[], eggs: EggV3[], eggSeq: number): CountsV3 {
  if (!isObj(raw)) {
    return {
      hatched: Math.max(0, Math.max(eggSeq, maxEggNo(eggs)) - eggs.length),
      evolved: pets.reduce((n, p) => n + p.stage, 0),
      traded: 0,
      day: "",
      streak: 0,
    };
  }
  return { hatched: nonNeg(raw.hatched), evolved: nonNeg(raw.evolved), traded: nonNeg(raw.traded), day: str(raw.day), streak: nonNeg(raw.streak) };
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
