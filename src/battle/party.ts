// 배틀 파티 — 칸 넣기·빼기, 프리셋 가져오기, 기술 순서, 메가 켜기, 출전 불가 판정. 규칙은 docs/specs/adventure.md "배틀 파티", "출전 제한"
// 개체를 옮기지 않는다. 칸에는 개체 식별자만 둔다. 개체의 자리(프리셋 칸·박스 칸)는 그대로다
import type { DexOptions } from "../dex/data.js";
import { megaChoices } from "../dex/mega.js";
import { slotsOfPreset } from "../party/presets.js";
import type { Outcome } from "../shared/command.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { BattleV3, SaveV3 } from "../shared/save-v3";
import { BATTLE_RULES, type BattleTier } from "./rules.js";
import { tierOf } from "./tier.js";

export type BattleFailure = ReasonOf<"no-pet" | "bad-slot" | "already" | "no-preset" | "not-in-party" | "no-stone" | "bad-form" | "bad-args">;

type Battle = Pick<SaveV3, "battle">;

// 빈 6칸
export const emptyBattle = (): BattleV3 => ({ slots: Array.from({ length: BATTLE_RULES.slots }, () => null) });

// 칸 — 저장에 없으면 빈 6칸으로 읽는다. 읽기만 하는 쪽이 쓴다
export const battleSlots = (save: Battle): (string | null)[] => save.battle?.slots ?? emptyBattle().slots;

// 고칠 칸 — 없으면 만들어 붙인다
function slotsFor(save: Battle): (string | null)[] {
  if (!save.battle) save.battle = emptyBattle();
  return save.battle.slots;
}

const isSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < BATTLE_RULES.slots;

// 배틀 파티에 든 개체인가
export const isInBattle = (save: Battle, petId: string): boolean => battleSlots(save).includes(petId);

// 칸에서 빠진 개체의 메가 상태를 지운다 — 칸을 바꾼 뒤마다 부른다
function pruneMega(save: Battle): void {
  const mega = save.battle?.mega;
  if (!mega) return;
  const ids = new Set(battleSlots(save));
  for (const id of Object.keys(mega)) if (!ids.has(id)) delete mega[id];
  if (!Object.keys(mega).length) delete save.battle!.mega;
}

// 칸에 개체를 넣는다. 그 칸의 개체는 빠진다. 다른 칸에 든 개체는 넣지 못한다
export function setBattleSlot(save: Pick<SaveV3, "battle" | "pets">, slot: number, petId: string): Outcome<BattleFailure> {
  if (!isSlot(slot)) return { ok: false, reason: "bad-slot" };
  if (!save.pets.some((p) => p.id === petId)) return { ok: false, reason: "no-pet" };
  const slots = slotsFor(save);
  if (slots.includes(petId)) return { ok: false, reason: "already" };
  slots[slot] = petId;
  pruneMega(save);
  return { ok: true };
}

// 칸을 비운다
export function clearBattleSlot(save: Battle, slot: number): Outcome<BattleFailure> {
  if (!isSlot(slot)) return { ok: false, reason: "bad-slot" };
  const slots = slotsFor(save);
  if (slots[slot] == null) return { ok: false, reason: "already" };
  slots[slot] = null;
  pruneMega(save);
  return { ok: true };
}

// 파티 프리셋 하나를 가져온다 — 프리셋의 칸 순서대로 6칸을 덮어쓴다. 빈 칸·잠긴 칸은 빈 칸이 된다.
// 출전 제한을 넘는 개체도 그대로 넣는다 (출전 불가로 보인다)
export function importPreset(save: Pick<SaveV3, "battle" | "party">, preset: number): Outcome<BattleFailure> {
  const from = slotsOfPreset(save, preset);
  if (!from) return { ok: false, reason: "no-preset" };
  const slots = slotsFor(save);
  for (let i = 0; i < BATTLE_RULES.slots; i += 1) {
    const s = from[i];
    slots[i] = s?.state === "pokemon" && s.petId ? s.petId : null;
  }
  pruneMega(save);
  return { ok: true };
}

// 개체의 기술 위아래 순서를 바꾼다 — 개체에 저장한다 (어디서 보든 같은 순서)
export function swapMoves(save: Pick<SaveV3, "pets">, petId: string): Outcome<BattleFailure> & { swapped?: boolean } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (pet.moveSwap) delete pet.moveSwap;
  else pet.moveSwap = true;
  return { ok: true, swapped: pet.moveSwap === true };
}

// 저장에서 사라진 개체를 칸에서 뺀다 — 교환으로 보낸 개체 등. 읽을 때(정규화)도 부른다
export function dropMissingBattlePets(save: Pick<SaveV3, "battle" | "pets">): void {
  if (!save.battle) return;
  const ids = new Set(save.pets.map((p) => p.id));
  save.battle.slots = save.battle.slots.map((id) => (id != null && ids.has(id) ? id : null));
  pruneMega(save);
}

// 배틀 파티에서 켠 메가 모습 — 없으면 null
export const battleMegaOf = (save: Battle, petId: string): string | null => save.battle?.mega?.[petId] ?? null;

// 메가 모습을 켜고 끈다 — form 이 null 이면 원래 모습. 메가스톤을 지닌 배틀 파티 개체만. 바탕화면 프리셋의 메가 모습과 따로다.
// 다른 개체를 끄지 않는다 — 메가 칸(1마리)을 넘으면 출전 불가로 보인다 (blockedSlots)
export function setBattleMega(save: Pick<SaveV3, "battle" | "pets">, petId: string, form: string | null, opts?: DexOptions): Outcome<BattleFailure> {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (!isInBattle(save, petId)) return { ok: false, reason: "not-in-party" };
  const choices = megaChoices(pet, opts);
  if (!choices.length) return { ok: false, reason: "no-stone" };
  if (form !== null && !choices.includes(form)) return { ok: false, reason: "bad-form" };
  if (battleMegaOf(save, petId) === form) return { ok: false, reason: "already" };
  const battle = save.battle!;
  if (form === null) delete battle.mega?.[petId];
  else battle.mega = { ...(battle.mega ?? {}), [petId]: form };
  pruneMega(save);
  return { ok: true };
}

// 출전 불가 — 칸마다 넘은 칸(초전설·준전설·메가) 또는 null. 한 칸의 마릿수를 넘으면 칸 순서가 뒤인 개체가 출전 불가다.
// 한 개체가 종의 칸과 메가 칸을 함께 센다(메가레쿠쟈·원시회귀). 둘 다 넘으면 종의 칸을 알린다
export function blockedSlots(save: Pick<SaveV3, "battle" | "pets">, opts?: DexOptions): (BattleTier | null)[] {
  const count: Record<BattleTier, number> = { legendary: 0, sub: 0, mega: 0 };
  return battleSlots(save).map((id) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    if (!pet) return null;
    const over: BattleTier[] = [];
    const tier = tierOf(pet.species, opts);
    if (tier && (count[tier] += 1) > BATTLE_RULES.limits[tier]) over.push(tier);
    if (battleMegaOf(save, pet.id) && (count.mega += 1) > BATTLE_RULES.limits.mega) over.push("mega");
    return over[0] ?? null;
  });
}

// 배틀을 시작할 수 있는가 — 출전 불가가 없고 한 마리 이상. 배틀은 아직 없다 (탐험·배틀 단추는 누르지 못한다)
export const canStartBattle = (save: Pick<SaveV3, "battle" | "pets">, opts?: DexOptions): boolean =>
  battleSlots(save).some((id) => id != null) && blockedSlots(save, opts).every((b) => b == null);

// ── 랜덤 배틀 보상 ── 서버가 정한 판의 포인트를 넣고 판 id 를 남긴다. 같은 판은 두 번 넣지 않는다(applied: false)
// 서버 저장 검증이 battle.applied 의 새 판 id 를 판 기록과 대조한다 (src/verify/save-rules.ts battle)
const BATTLE_REWARD_MAX = 500; // 그날 첫 판 — docs/specs/balance.md "배틀 보상"
const APPLIED_KEEP = 200;
export function applyBattleReward(save: Battle & Pick<SaveV3, "points">, battleId: string, reward: number): Outcome<BattleFailure> & { applied?: boolean } {
  if (!battleId || !Number.isInteger(reward) || reward < 0 || reward > BATTLE_REWARD_MAX) return { ok: false, reason: "bad-args" };
  const battle = (save.battle ??= emptyBattle());
  const applied = (battle.applied ??= []);
  if (applied.includes(battleId)) return { ok: true, applied: false };
  save.points.balance += reward;
  applied.push(battleId);
  if (applied.length > APPLIED_KEEP) applied.splice(0, applied.length - APPLIED_KEEP);
  return { ok: true, applied: true };
}
