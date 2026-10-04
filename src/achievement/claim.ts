// 업적 보상 수령 — 업적당 한 번. 보상 종류는 src/achievement/defs.ts 머리말
import { type DexOptions } from "../dex/data.js";
import { hasObtained } from "../dex/record.js";
import { isSingleSpecies } from "../dex/forms.js";
import type { SaveV3 } from "../shared/save-v3";
import { openSlot } from "../party/slots.js";
import { countParty, slotsOfPreset } from "../party/presets.js";
import { addNewPet } from "../party/create.js";
import { addItem } from "../bag/items.js";
import { checkGiveEgg, newEgg } from "../egg/pool.js";
import type { Rand } from "../shared/rand.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import { defOf, rewardEgg, rewardItem, rewardPoints, rewardPokemon } from "./defs.js";
import type { Outcome } from "../shared/command.js";

export type ClaimFailure = ReasonOf<"no-achievement" | "not-achieved" | "already-claimed" | "no-locked-slot" | "box-full" | "daycare-full" | "egg-none">;

export type ClaimResult = Outcome<ClaimFailure> & {
  id?: string;
  slotIndex?: number; // 파티 칸 보상이면 연 칸, 포켓몬 보상이면 넣은 파티 칸
  petId?: string; // 포켓몬 보상으로 만든 개체
  toBox?: boolean; // 포켓몬 보상이 박스로 갔다
  points?: number; // 포인트 보상으로 받은 양
  eggId?: string; // 알 보상으로 넣은 알
  item?: { id: string; count: number }; // 도구 보상
  skipped?: boolean; // 단일 포켓몬을 이미 얻어 개체를 주지 않았다
};
// 보상 수령 — 업적당 한 번
//   파티 칸   칸 +1 — 첫 잠긴 칸을 연다
//   포켓몬    새 개체를 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 둘 곳이 없으면 받지 못한다(box-full) — 미수령으로 남는다
//   포인트    잔액에 더한다
//   알        돌보미집에 넣는다. 빈 칸이 없으면 daycare-full, 단일 포켓몬 알의 남은 종이 없으면 egg-none — 미수령으로 남는다
//   도구      가방에 더한다
export function claimAchievement(save: SaveV3, id: string, now: number, opts: DexOptions | undefined, rand: Rand): ClaimResult {
  const def = defOf(id, opts);
  if (!def) return { ok: false, reason: "no-achievement" };
  const row = save.achievements[id];
  if (!row || row.achievedAt == null) return { ok: false, reason: "not-achieved" };
  if (row.claimedAt != null) return { ok: false, reason: "already-claimed" };
  const done = (): void => {
    save.achievements[id] = { achievedAt: row.achievedAt, claimedAt: now };
  };

  const species = rewardPokemon(def);
  if (species) {
    // 단일 포켓몬은 저장마다 한 번만 얻는다 — 옛 규칙의 알이나 우편으로 먼저 얻었으면 개체를 주지 않는다
    if (isSingleSpecies(species, opts) && hasObtained(save, species)) {
      done();
      return { ok: true, id, skipped: true };
    }
    const added = addNewPet(save, { species, shiny: false, now, rand, place: "party-first", opts });
    if (!added) return { ok: false, reason: "box-full" };
    done();
    return { ok: true, id, petId: added.pet.id, ...(added.slotIndex !== undefined ? { slotIndex: added.slotIndex } : {}), toBox: added.toBox };
  }

  const points = rewardPoints(def);
  if (points != null) {
    save.points.balance += points;
    done();
    return { ok: true, id, points };
  }

  const eggKind = rewardEgg(def);
  if (eggKind) {
    const can = checkGiveEgg(save, eggKind, opts);
    if (!can.ok) return { ok: false, reason: can.reason === "sold-out" ? "egg-none" : can.reason };
    const egg = newEgg(save, eggKind, now, opts);
    save.eggs.push(egg);
    done();
    return { ok: true, id, eggId: egg.id };
  }

  const item = rewardItem(def);
  if (item) {
    addItem(save, item.id, item.count); // 사지 않고 받는 것은 가방 상한으로 막지 않는다
    done();
    return { ok: true, id, item };
  }

  // 업적으로 여는 칸은 첫 프리셋에만 있다 — 다른 프리셋을 적용한 중에도 첫 프리셋의 칸을 연다 (2026-10-02 사용자 결정)
  const i = openSlot(slotsOfPreset(save, 0) ?? save.party.slots, "achievement");
  if (i < 0) return { ok: false, reason: "no-locked-slot" };
  countParty(save);
  done();
  return { ok: true, id, slotIndex: i };
}
