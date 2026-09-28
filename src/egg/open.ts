// 알 열기 — 규칙은 docs/specs/game.md "알". 준비가 끝난 알을 사용자가 직접 열 때 부른다.
//
// 하는 일은 넷이다. 결과 판정, 개체 생성, 배치, 도감 기록.
// 랜덤알은 낮은 확률로 포켓몬 대신 단일 포켓몬 알을 준다(data/eggs.json 의 bonus). 그 알은 연 알의 자리에 들어간다.
// 단일 포켓몬 알은 이미 얻은 종을 빼고 뽑는다.
// 배치는 빈 파티 칸에 꺼낸 상태로 넣는다. 칸이 없으면 박스로 보낸다.
// 무작위는 받아서 쓴다 — 자체 검사가 결과를 정할 수 있어야 한다.
import { putPet } from "../box/slots.js";
import { randomNature } from "../dex/natures.js";
import type { DexOptions } from "../dex/data";
import { newPet, nextPetId, recordDex } from "../party/create.js";
import { canGiveEgg, eggBonus, isSingleEgg } from "../shop/catalog.js";
import { newEgg } from "../shop/buy.js";
import type { SaveV3 } from "../shared/save-v3";
import { decide, type Rand } from "./hatch.js";

export type OpenFailure = "no-egg" | "not-ready" | "no-candidate";

export interface OpenResult {
  ok: boolean;
  reason?: OpenFailure;
  petId?: string;
  species?: string;
  shiny?: boolean;
  slotIndex?: number; // 파티에 들어갔으면 칸 번호
  toBox?: boolean; // 파티가 가득 차 박스로 갔다
  egg?: { id: string; kind: string }; // 포켓몬 대신 나온 알 — 이때 개체 필드는 비어 있다
}

// 포켓몬 대신 나올 알 — 없으면 null. 확률 목록이 없는 알은 무작위를 쓰지 않는다.
// 뽑힌 알을 더 줄 수 없으면(남은 종이 없다) 평소처럼 포켓몬이 나온다
function bonusEgg(save: SaveV3, kind: string, rand: Rand, opts?: DexOptions): string | null {
  const table = eggBonus(kind, opts);
  if (!table.length) return null;
  const roll = rand();
  let acc = 0;
  for (const [next, p] of table) {
    acc += p;
    if (roll < acc) return canGiveEgg(save, next, opts) ? next : null;
  }
  return null;
}

export function open(save: SaveV3, eggId: string, now: number, rand: Rand, opts?: DexOptions): OpenResult {
  const i = save.eggs.findIndex((e) => e.id === eggId);
  if (i < 0) return { ok: false, reason: "no-egg" };
  const egg = save.eggs[i];
  if (!egg) return { ok: false, reason: "no-egg" };
  if (!egg.ready) return { ok: false, reason: "not-ready" };

  const bonus = bonusEgg(save, egg.kind, rand, opts);
  if (bonus) {
    const next = newEgg(save, bonus, now, opts); // 연 알이 아직 있어 새 식별자가 겹치지 않는다
    save.eggs.splice(i, 1, next);
    return { ok: true, egg: { id: next.id, kind: bonus } };
  }

  const single = isSingleEgg(egg.kind, opts);
  const candidates = single ? egg.candidates.filter((s) => !save.dex.obtained.includes(s)) : egg.candidates;
  const result = decide(candidates, rand, opts);
  if (!result) return { ok: false, reason: "no-candidate" };

  const id = nextPetId(save);
  save.pets.push(newPet({ id, species: result.species, shiny: result.shiny, nature: randomNature(rand, opts).id, now }));

  // 배치 — 빈 파티 칸에 꺼낸 상태로. 없으면 박스로
  const slotIndex = save.party.slots.findIndex((s) => s.state === "empty");
  let toBox = false;
  if (slotIndex >= 0) {
    save.party.slots[slotIndex] = { state: "pokemon", petId: id, hidden: false };
  } else {
    putPet(save.boxes, id);
    toBox = true;
  }

  // 도감 — 얻음 기록. 해금 기록이 없으면 함께 남긴다
  recordDex(save, result.species, result.shiny);

  save.eggs.splice(i, 1);
  return {
    ok: true,
    petId: id,
    species: result.species,
    shiny: result.shiny,
    slotIndex: slotIndex >= 0 ? slotIndex : undefined,
    toBox,
  };
}
