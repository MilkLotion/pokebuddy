// 저장 v2 → v3 한 번 변환 — 규칙은 docs/specs/modules.md "V2 → V3 변환 규칙"
//
// 절차는 원본 백업 → 변환 → 검사 → 성공 시 교체다. 검사에 실패하면 원본을 유지하고 변환 결과를 버린다.
// 여기서는 변환과 검사만 한다. 파일을 옮기는 것은 부르는 쪽(src/save/save-file.ts)이 한다.
// 보존 대상: 개체 식별자, 친밀도, 성격, 포인트, 파티 순서, 표시 상태, 도감 기록, 구매 권리.
// v2 에는 레벨과 경험치가 없다. 새 값으로 시작한다.
import { MINT_ID, currentItemId, isOldMint } from "../../bag/mint.js";
import { localDate } from "../../shared/clock.js";
import type { PartySlotV3, PetV3, SaveV3 } from "../../shared/save-v3";
import type { Pet, SaveV2 } from "./types";
import { BAG_RULES } from "../../bag/rules.js";
import { PARTY_RULES, PET_RULES } from "../../party/rules.js";
import { CARE_RULES } from "../../state/rules.js";
import { legacyGender } from "../../dex/gender.js";
import { emptySave } from "../normalize.js";
import { addStraysToBox } from "../normalize-pets.js";
import { emptySlots } from "../../party/slots.js";
import { fillBoxes } from "../../box/boxes.js";

export interface MigrateResult {
  save: SaveV3 | null; // 검사를 통과한 결과. 실패하면 null
  checks: CheckResult[];
  failed: string[]; // 어긋난 검사 이름
}

export interface CheckResult {
  name: string;
  ok: boolean;
  before: number | string;
  after: number | string;
}

const SHINY_RIGHT = "shiny:"; // v2 inventory 의 이로치 권리 기록. 도구가 아니라서 legacy 로 보존한다

// v2 도구 이름 → v3 도구 이름. 이름이 다르면 가방에 남아도 쓸 수 없다.
// `berry` 는 프리미엄먹이의 옛 이름이다 (data/items.json 의 premium-food)
const ITEM_RENAME: Record<string, string> = { berry: "premium-food" };

// v2 의 마리 → v3 의 개체. 배고픔을 만복도로 뒤집고 쿨타임은 남은 시간으로 바꾼다
export function convertPet(pet: Pet, now: number, date: string): PetV3 {
  const left = (at: number | null, span: number): number => (at == null ? 0 : Math.max(0, span - (now - at)));
  const fedAt = typeof pet.fedAt === "number" ? pet.fedAt : null;
  const playedAt = typeof pet.playedAt === "number" ? pet.playedAt : null;
  const remain = left(fedAt, BAG_RULES.feedCooldownMs);
  return {
    id: pet.id,
    species: pet.species,
    shiny: pet.shiny === true,
    nature: pet.nature,
    gender: legacyGender(pet), // v2 에는 성별이 없다 — 반반 (2026-09-30 사용자 결정)
    size: pet.size,
    level: PET_RULES.level,
    exp: PET_RULES.exp,
    affinity: Math.min(100, Math.max(0, Math.round(pet.affinity))),
    affinityProgressMs: 0,
    fullness: Math.min(100, Math.max(0, 100 - Math.round(pet.hunger))),
    fullnessProgressMs: 0,
    mood: Math.min(100, Math.max(0, Math.round(pet.mood))),
    moodProgressMs: 0,
    feedCooldownMs: Math.round(remain),
    playCooldownMs: Math.round(left(playedAt, CARE_RULES.playCooldownMs)),
    playWindowMs: 0,
    playStreak: 0,
    buffs: [],
    home: { dx: pet.home.dx, dy: pet.home.dy },
    since: pet.since,
    stage: pet.stage,
    evolved: [...pet.evolved],
    // v2 의 daily.work 는 친밀도 단위다. v3 은 가중 ms 로 센다 (src/state/time.ts). 단위가 달라 옮기지 않는다
    daily: { ...pet.daily, date, work: 0 },
  };
}

export function migrateSaveV2(v2: SaveV2, now: number): MigrateResult {
  const date = localDate(now);
  const out = emptySave(now);

  // 개체와 파티 칸 — v2 는 배열 순서가 곧 칸 순서다
  out.pets = v2.party.map((p) => convertPet(p, now, date));
  // v2 에는 첫 개체 표시가 없다. 파티의 첫 마리를 첫 개체로 본다
  out.starterPetId = out.pets[0]?.id ?? null;
  const slots: PartySlotV3[] = emptySlots();
  const open = Math.min(slots.length, Math.max(PARTY_RULES.openAtStart, Math.round(v2.slots)));
  for (let i = 0; i < slots.length; i++) {
    if (i >= open) continue;
    const pet = v2.party[i];
    // shown 은 화면에 보이나를 뜻한다. v3 의 hidden 은 그 반대다
    slots[i] = pet ? { state: "pokemon", petId: pet.id, hidden: pet.shown !== true } : { state: "empty" };
  }
  out.party.slots = slots;

  const placed = new Set<string>();
  for (const s of slots) if (s.state === "pokemon" && s.petId) placed.add(s.petId);
  addStraysToBox(out.pets, placed, out.boxes);
  fillBoxes(out.boxes);

  // 가방 — 이로치 권리는 도구가 아니므로 legacy 로 옮긴다. 옛 민트를 합친 개수는 가방 상한에서 자른다 (src/save/v3.ts normalizeBag 과 같다)
  let mergedMint = false;
  for (const [k, v] of Object.entries(v2.inventory)) {
    if (k.startsWith(SHINY_RIGHT)) {
      out.legacy[k] = v;
      continue;
    }
    if (typeof v !== "number" || v <= 0) continue;
    if (isOldMint(k)) mergedMint = true;
    const id = currentItemId(ITEM_RENAME[k] ?? k); // 옛 민트는 민트 한 종류로 (src/bag/mint.ts)
    out.bag[id] = (out.bag[id] ?? 0) + Math.round(v);
  }
  if (mergedMint && (out.bag[MINT_ID] ?? 0) > BAG_RULES.max) out.bag[MINT_ID] = BAG_RULES.max;

  out.points.balance = Math.max(0, Math.round(v2.points));
  const acc = v2.acc as Record<string, unknown>;
  const progress = typeof acc?.progressMs === "number" ? acc.progressMs : 0;
  out.points.progressMs = Math.max(0, Math.round(progress));

  out.dex.unlocked = [...new Set(v2.unlocked)];
  out.dex.rulesRev = 0; // 옛 규칙으로 해금한 종이라 첫 해금 판정 때 한 번 정리한다 (src/dex/unlocks.ts pruneUnlocks)
  out.dex.obtained = [...new Set(out.pets.map((p) => p.species))];
  out.dex.shinyObtained = [...new Set(out.pets.filter((p) => p.shiny).map((p) => p.species))];

  out.daily = { ...v2.daily };
  out.totals = { ...v2.totals };
  out.agents = { ...v2.agents };
  out.log = [...v2.log];

  // 새 화면에서 쓰지 않는 값은 지우지 않고 보존한다
  for (const p of v2.party) {
    if (p.nick != null) out.legacy[`nick:${p.id}`] = p.nick;
    if (p.look != null) out.legacy[`look:${p.id}`] = p.look;
  }

  const checks = checkMigration(v2, out);
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { save: failed.length ? null : out, checks, failed };
}

// 변환 전후로 같아야 하는 값 — 하나라도 어긋나면 원본을 유지한다
export function checkMigration(v2: SaveV2, v3: SaveV3): CheckResult[] {
  const idsBefore = v2.party.map((p) => p.id).sort().join(",");
  const idsAfter = v3.pets.map((p) => p.id).sort().join(",");
  const affinityBefore = v2.party.reduce((a, p) => a + Math.min(100, Math.max(0, Math.round(p.affinity))), 0);
  const affinityAfter = v3.pets.reduce((a, p) => a + p.affinity, 0);
  const inBoxes = v3.boxes.reduce((a, b) => a + b.slots.filter(Boolean).length, 0);
  const inParty = v3.party.slots.filter((s) => s.state === "pokemon").length;
  return [
    { name: "개체 수", ok: v2.party.length === v3.pets.length, before: v2.party.length, after: v3.pets.length },
    { name: "개체 식별자", ok: idsBefore === idsAfter, before: idsBefore, after: idsAfter },
    { name: "친밀도 합계", ok: affinityBefore === affinityAfter, before: affinityBefore, after: affinityAfter },
    { name: "포인트", ok: Math.max(0, Math.round(v2.points)) === v3.points.balance, before: v2.points, after: v3.points.balance },
    { name: "해금 종 수", ok: new Set(v2.unlocked).size === v3.dex.unlocked.length, before: new Set(v2.unlocked).size, after: v3.dex.unlocked.length },
    { name: "배치 누락", ok: inParty + inBoxes === v3.pets.length, before: v3.pets.length, after: inParty + inBoxes },
  ];
}

