// 메가 모습 켜기·끄기와 풀기 — 프리셋에 든 개체면 켠다. 적용하지 않은 프리셋도 되고, 한 프리셋에 여러 마리도 된다
// (2026-10-22 사용자 "적용중인 프리셋에 있는 메가진화로 모습바꾸는거 제한그런거 해제". 규칙은 src/dex/mega.ts 머리말, docs/specs/game.md "메가진화")
// 모습 표와 메가스톤 조건은 도감(src/dex/mega.ts)이 가진다. 여기는 개체가 어느 프리셋에 있는지를 본다
import type { DexOptions } from "../dex/data";
import { megaChoices, megaOf } from "../dex/mega.js";
import { allPresets } from "./presets.js";
import { presetPetIds } from "./locate.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

// 개체가 프리셋에 들었는가. 박스 개체면 false
const inSomePreset = (save: SaveV3, petId: string): boolean =>
  allPresets(save).some(({ slots }) => slots.some((s) => s.state === "pokemon" && s.petId === petId));

export type MegaFailure = ReasonOf<"no-pet" | "no-stone" | "bad-form" | "not-in-party" | "already">;

export type MegaResult = Outcome<MegaFailure> & {
  petId?: string;
  on?: string | null; // 바뀐 뒤의 모습. null 이면 기본 모습
};

// 메가 모습을 켜거나 끈다 — form 이 null 이면 기본 모습으로 돌아간다
export function setMega(save: SaveV3, petId: string, form: unknown, opts?: DexOptions): MegaResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (form == null) {
    if (!pet.mega?.on) return { ok: false, reason: "already" };
    delete pet.mega.on;
    return { ok: true, petId, on: null };
  }
  if (pet.mega?.stone !== true) return { ok: false, reason: "no-stone" };
  if (typeof form !== "string" || !megaChoices(pet, opts).includes(form)) return { ok: false, reason: "bad-form" };
  if (pet.mega.on === form) return { ok: false, reason: "already" };
  // 박스 개체는 켜지 못한다 — 박스로 가면 풀리기 때문이다(settleMega)
  if (!inSomePreset(save, petId)) return { ok: false, reason: "not-in-party" };
  pet.mega.on = form;
  delete pet.battleLook; // 전투 중 모습과 함께 켜지 않는다 (src/dex/battle-look.ts)
  return { ok: true, petId, on: form };
}

// 규칙에 맞지 않는 메가 모습을 푼다 — 거래 실행기가 명령마다 한 번 부른다
//   프리셋에 들지 않은 개체(박스), 종이 바뀌어 모습의 기본 종이 지금 종과 다른 개체, 메가스톤이 없는 개체
export function settleMega(save: SaveV3, opts?: DexOptions): string[] {
  const inPreset = presetPetIds(save);
  const reverted: string[] = [];
  for (const pet of save.pets) {
    const on = pet.mega?.on;
    if (!on) continue;
    if (inPreset.has(pet.id) && pet.mega?.stone === true && megaOf(on, opts)?.base === pet.species) continue;
    delete pet.mega!.on;
    reverted.push(pet.id);
  }
  return reverted;
}
