// 첫 선택 — 저장이 비었을 때 딱 한 번 (docs/specs/game.md "첫 포켓몬과 이후 획득")
//
// 고른 종으로 개체 하나를 만들어 첫 파티 칸에 꺼내 놓는다. 알에서 나온 개체와 달리 숨기지 않는다.
// 첫 개체는 따로 기억한다 — 업적 판정이 그것을 본다.
// 시작 포인트를 한 번 준다. 튜토리얼을 건너뛰어도 같다 (docs/specs/game.md "튜토리얼을 건너뛰어도 시작 포인트를 동일하게 한 번 지급한다").
// 2026-09-26 전에는 규칙표에만 있고 주지 않았다 — 새 게임이 0 포인트로 시작했다.
// 이미 개체가 있으면 아무것도 하지 않는다. 두 번 부르면 두 마리가 되기 때문이다.
import { rollGender } from "../dex/gender.js";
import { randomNature } from "../dex/natures.js";
import type { DexOptions } from "../dex/data";
import type { Rand } from "../egg/hatch";
import { newPet, nextPetId, recordDex } from "./create.js";
import type { SaveV3 } from "../shared/save-v3";
import { SHOP_V3_RULES } from "../save/rules.js";

export type StarterFailure = "already" | "no-slot";

export interface StarterResult {
  ok: boolean;
  reason?: StarterFailure;
  petId?: string;
  species?: string;
  slotIndex?: number;
}

export function begin(save: SaveV3, species: string, now: number, rand: Rand, opts?: DexOptions): StarterResult {
  if (save.pets.length) return { ok: false, reason: "already" };
  const slotIndex = save.party.slots.findIndex((s) => s.state === "empty");
  if (slotIndex < 0) return { ok: false, reason: "no-slot" };

  const id = nextPetId(save);
  save.pets.push(newPet({ id, species, shiny: false, nature: randomNature(rand, opts).id, gender: rollGender(species, rand, opts), now }));
  save.party.slots[slotIndex] = { state: "pokemon", petId: id, hidden: false };
  save.starterPetId = id;
  save.points.balance += SHOP_V3_RULES.startPoints;
  recordDex(save, species, false);
  return { ok: true, petId: id, species, slotIndex };
}
