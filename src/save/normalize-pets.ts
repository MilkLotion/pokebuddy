// 저장 v3 의 개체·파티·박스 정규화 — 저장 전체는 ./normalize.ts 가 읽고 여기를 부른다
// 개체 하나는 한 자리(파티 칸 또는 박스 칸)에만 있다. 자리가 없는 개체는 박스로 보낸다(addStraysToBox)
import type { BoxV3, BuffKind, BuffV3, MegaV3, PartySlotV3, PartyV3, PetV3, SlotState } from "../shared/save-v3";
import type { PetDaily } from "../shared/save-v3";
import type { NatureId } from "../shared/species";
import { BOX_RULES } from "../box/rules.js";
import { FALLBACK_NATURE } from "../dex/natures.js";
import { PARTY_RULES, PET_RULES } from "../party/rules.js";
import { snapSize } from "../party/size.js";
import { compactSlots, presetSlots } from "../party/slots.js";
import { defaultBoxName, newBox, pushBox } from "../box/boxes.js";
import { screenRefOf } from "../shared/raw.js";
import { countParty } from "../party/presets.js";
import { MAX_LEVEL } from "../dex/growth.js";
import { fixedGender, isGender, legacyGender } from "../dex/gender.js";
import { boolOr as bool, clampNum as clamp, intOr as int, isNatureValue, isRawObject, nonNeg, numOr as num, strOr as str, stringList as strings } from "./raw-values.js";

const BUFF_KINDS: readonly BuffKind[] = ["premium-food", "long-play", "short-play"];
const SLOT_STATES: readonly SlotState[] = ["pokemon", "empty", "locked"];

export const emptyDaily = (date: string): PetDaily => ({ date, gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 });

// 새 저장의 파티 — 첫 프리셋을 적용한 채 프리셋 start 개로 시작한다
export function emptyParty(): PartyV3 {
  const party: PartyV3 = {
    slots: presetSlots(0),
    active: 0,
    presets: Array.from({ length: PARTY_RULES.presets.start }, (_, i) => (i === 0 ? null : presetSlots(i))),
    presetNames: Array.from({ length: PARTY_RULES.presets.start }, () => ""),
  };
  countParty({ party });
  return party;
}

// ── 정규화 ─────────────────────────────────────────────────────────────────────

function normalizeDaily(raw: unknown, date: string): PetDaily {
  const r = isRawObject(raw) ? raw : {};
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
    if (!isRawObject(b)) continue;
    const kind = str(b.kind);
    if (!(BUFF_KINDS as readonly string[]).includes(kind)) continue;
    const remainMs = nonNeg(b.remainMs);
    if (remainMs <= 0) continue;
    out.push({ kind: kind as BuffKind, remainMs });
  }
  // 신남이 있으면 들뜸은 두지 않는다 — 들뜸은 신남으로 바뀌는 아랫단계다
  return out.some((b) => b.kind === "long-play") ? out.filter((b) => b.kind !== "short-play") : out;
}

// 메가진화 칸 — 모양이 아니면 null. 규칙에 맞는지는 보지 않는다 (src/dex/mega.ts settleMega 가 푼다)
function megaOf(raw: unknown): MegaV3 | null {
  if (!isRawObject(raw)) return null;
  return {
    bondMs: nonNeg(raw.bondMs),
    care: nonNeg(raw.care),
    ...(raw.stone === true ? { stone: true as const } : {}),
    ...(typeof raw.on === "string" && raw.on ? { on: raw.on } : {}),
  };
}

// 개체 하나 — 종이 없으면 null (뼈대 아님)
export function normalizePet(raw: unknown, date: string): PetV3 | null {
  if (!isRawObject(raw)) return null;
  const id = str(raw.id);
  const species = str(raw.species);
  if (!id || !species) return null;
  const nature: NatureId = isNatureValue(raw.nature) ? raw.nature : FALLBACK_NATURE;
  const home = isRawObject(raw.home) ? raw.home : {};
  const since = nonNeg(raw.since);
  return {
    id,
    species,
    shiny: bool(raw.shiny),
    nature,
    // 성별 — 한 성별 종(무성·수컷만·암컷만)이면 그 성별로 맞춘다. 두 성별 종은 저장된 수컷·암컷을 두고, 없거나 맞지 않으면 옛 저장처럼 반반으로 정한다.
    // 교환 받기(src/trade/exchange.ts)와 같은 규칙이다 (src/dex/gender.ts 2026-09-30 사용자 결정, 94-same-feature-diffs.md 9-3-9)
    gender: fixedGender(species) ?? (isGender(raw.gender) && raw.gender !== "none" ? raw.gender : legacyGender({ id, species, since })),
    size: snapSize(num(raw.size, PET_RULES.size)), // 단계 배율로 맞춘다 — 옛 4~6 은 가장 큰 단계로 (src/party/size.ts SIZE_STEPS)
    level: clamp(int(raw.level, PET_RULES.level), 1, MAX_LEVEL),
    exp: nonNeg(raw.exp, PET_RULES.exp),
    affinity: clamp(int(raw.affinity, PET_RULES.affinity), 0, PET_RULES.statMax),
    affinityProgressMs: nonNeg(raw.affinityProgressMs),
    fullness: clamp(int(raw.fullness, PET_RULES.fullness), 0, PET_RULES.statMax),
    fullnessProgressMs: nonNeg(raw.fullnessProgressMs),
    mood: clamp(int(raw.mood, PET_RULES.mood), 0, PET_RULES.statMax),
    moodProgressMs: nonNeg(raw.moodProgressMs), // 2026-09-25 에 더했다. 옛 저장에는 없어 0 이다
    feedCooldownMs: nonNeg(raw.feedCooldownMs),
    playCooldownMs: nonNeg(raw.playCooldownMs),
    playWindowMs: nonNeg(raw.playWindowMs),
    playStreak: nonNeg(raw.playStreak),
    buffs: normalizeBuffs(raw.buffs),
    home: { dx: int(home.dx, PET_RULES.home.dx), dy: int(home.dy, PET_RULES.home.dy) },
    ...(screenRefOf(raw.screen) ? { screen: screenRefOf(raw.screen)! } : {}), // 2026-09-28 에 더했다. 모든 화면 방식에서 끌어다 놓은 개체만 가진다
    since,
    stage: nonNeg(raw.stage),
    evolved: strings(raw.evolved),
    ...(Array.isArray(raw.forms) ? { forms: strings(raw.forms) } : {}), // 2026-09-26 에 더했다. 공유 sid 계열만 가진다
    ...(megaOf(raw.mega) ? { mega: megaOf(raw.mega)! } : {}), // 2026-10-02 에 더했다. 메가진화 진행과 모습
    daily: normalizeDaily(raw.daily, date),
  };
}

// 프리셋 하나의 칸. `placed` 는 이미 자리가 있는 개체다 — 놓은 개체를 여기에 더한다
function normalizeSlots(raw: unknown, petIds: Set<string>, placed: Set<string>, preset: number): PartySlotV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = presetSlots(preset);
  for (let i = 0; i < out.length; i++) {
    const r = list[i];
    if (!isRawObject(r)) continue;
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
// 가진 수를 넘는 번호의 칸은 버린다 — 그 개체는 자리 없는 개체로 박스에 간다 (addStraysToBox)
export function normalizeParty(raw: unknown, petIds: Set<string>, placed: Set<string>): PartyV3 {
  const r = isRawObject(raw) ? raw : {};
  const { start, max } = PARTY_RULES.presets;
  const { nameMax } = BOX_RULES;
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

export function normalizeBoxes(raw: unknown, petIds: Set<string>, placed: Set<string>): BoxV3[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BoxV3[] = [];
  for (const b of list) {
    if (!isRawObject(b)) continue;
    const id = str(b.id);
    if (!id) continue;
    // 이름 — 기본 이름은 저장하지 않고("") 화면이 자리 번호로 보인다(src/box/boxes.ts boxName, 파티 프리셋과 같은 규칙).
    // 옛 저장이 채워 둔 "박스 N" 은 그 자리의 기본 이름과 같을 때만 비운다. 자리와 다른 "박스 N" 은 사용자가 지은 이름으로 보고 둔다
    // (94-same-feature-diffs.md 9-5-5)
    const name = str(b.name);
    const box = newBox(id, name === defaultBoxName(out.length) ? "" : name);
    const slots = Array.isArray(b.slots) ? b.slots : [];
    for (let i = 0; i < box.slots.length; i++) {
      const petId = str(slots[i]);
      if (!petId || !petIds.has(petId) || placed.has(petId)) continue;
      box.slots[i] = petId;
      placed.add(petId);
    }
    out.push(box);
  }
  return out.length ? out : [newBox("b1", "")];
}

// 파티에도 박스에도 없는 개체를 박스의 빈 칸에 넣는다. 자리가 없으면 박스를 새로 만든다.
// 읽기의 복구 경로다 — 개체를 잃지 않으려고 여기서만 박스 상한을 보지 않는다
export function addStraysToBox(pets: PetV3[], placed: Set<string>, boxes: BoxV3[]): void {
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
      pushBox(boxes).slots[0] = pet.id;
    }
    placed.add(pet.id);
  }
}
