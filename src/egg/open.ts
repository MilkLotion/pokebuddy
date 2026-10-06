// 알 열기 — 규칙은 docs/specs/game.md "알". 준비가 끝난 알을 사용자가 직접 열 때 부른다.
//
// 하는 일은 넷이다. 결과 판정, 개체 생성, 배치, 도감 기록.
// 랜덤알은 낮은 확률로 포켓몬 대신 다른 알(단일 포켓몬 알·태고의돌)을 준다(data/eggs.json 의 bonus). 그 알은 연 알의 자리에 들어간다.
// 뽑힌 단일 포켓몬 알을 줄 수 없으면(종을 다 모았거나 남은 종이 돌보미집의 같은 알로 다 찼다) 포켓몬 대신 포인트를 준다 (2026-10-07 사용자 결정).
// 단일 포켓몬 알은 이미 얻은 종을 빼고 뽑는다.
// 모습이 여럿인 종은 종을 뽑은 뒤 모습을 한 번 더 뽑는다(data/regional.json 의 hatch — 배쓰나이의 적색근·청색근·백색근).
// 배치는 빈 파티 칸에 꺼낸 상태로 넣는다. 칸이 없으면 박스로 보낸다.
// 파티 빈 칸도 박스 빈 칸도 없으면 열지 않는다 — 알은 그대로 남는다 (2026-10-02 사용자 결정 "박스에서 둘곳이 없으면 알에서 부화안되게").
// 무작위는 받아서 쓴다 — 자체 검사가 결과를 정할 수 있어야 한다.
import type { DexOptions } from "../dex/data";
import { hasObtained } from "../dex/record.js";
import { isSingleEgg } from "../dex/obtain.js";
import { addNewPet, checkNewPetRoom } from "../party/create.js";
import { allCaughtPoints, canGiveEgg, eggBonus, newEgg } from "./pool.js";
import type { SaveV3 } from "../shared/save-v3";
import { pickHatch, rollVariant } from "./hatch.js";
import type { Rand } from "../shared/rand.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type OpenFailure = ReasonOf<"no-egg" | "not-ready" | "no-candidate" | "box-full">;

export type OpenResult = Outcome<OpenFailure> & {
  petId?: string;
  species?: string;
  shiny?: boolean;
  slotIndex?: number; // 파티에 들어갔으면 칸 번호
  toBox?: boolean; // 파티가 가득 차 박스로 갔다
  egg?: { id: string; kind: string }; // 포켓몬 대신 나온 알 — 이때 개체 필드는 비어 있다
  allCaught?: { kind: string; points: number }; // 다 모은 알 대신 받은 포인트 — 이때 개체 필드는 비어 있다
};

// 포켓몬 대신 나올 알 — 없으면 null. 확률 목록이 없는 알은 무작위를 쓰지 않는다.
// 뽑힌 알을 더 줄 수 없으면(남은 종이 없다) give 가 false 다. 확률은 남은 종과 상관없이 늘 같다 (data/eggs.json 의 bonus)
function bonusEgg(save: SaveV3, kind: string, rand: Rand, opts?: DexOptions): { kind: string; give: boolean } | null {
  const table = eggBonus(kind, opts);
  if (!table.length) return null;
  const roll = rand();
  let acc = 0;
  for (const [next, p] of table) {
    acc += p;
    if (roll < acc) return { kind: next, give: canGiveEgg(save, next, opts) };
  }
  return null;
}

export function openEgg(save: SaveV3, eggId: string, now: number, rand: Rand, opts?: DexOptions): OpenResult {
  const i = save.eggs.findIndex((e) => e.id === eggId);
  if (i < 0) return { ok: false, reason: "no-egg" };
  const egg = save.eggs[i];
  if (!egg) return { ok: false, reason: "no-egg" };
  if (!egg.ready) return { ok: false, reason: "not-ready" };
  // 둘 곳 — 무작위를 쓰기 전에 본다. 다른 알이 나올 차례여도 같다(둘 곳이 생긴 뒤 열어도 결과가 같게)
  if (!checkNewPetRoom(save, "party-first").ok) return { ok: false, reason: "box-full" }; // 새 개체를 두는 곳과 같은 검사 (94 항목 9-5-5)

  const bonus = bonusEgg(save, egg.kind, rand, opts);
  if (bonus?.give) {
    const next = newEgg(save, bonus.kind, now, opts); // 연 알이 아직 있어 새 식별자가 겹치지 않는다
    save.eggs.splice(i, 1, next);
    return { ok: true, egg: { id: next.id, kind: bonus.kind } };
  }
  // 다 모은 알 — 포켓몬 대신 포인트. 무작위를 더 쓰지 않는다(서버 재계산 src/verify/save-rules.ts rollEgg 와 같은 순서)
  if (bonus) {
    const points = allCaughtPoints(bonus.kind, opts);
    save.points.balance += points;
    save.eggs.splice(i, 1);
    return { ok: true, allCaught: { kind: bonus.kind, points } };
  }

  const single = isSingleEgg(egg.kind, opts);
  const candidates = single ? egg.candidates.filter((s) => !hasObtained(save, s)) : egg.candidates;
  const picked = pickHatch(candidates, rand, opts);
  if (!picked) return { ok: false, reason: "no-candidate" };
  // 모습이 여럿인 종(배쓰나이)은 종·이로치 다음에 모습을 뽑는다 — 서버 재계산(src/verify/save-rules.ts rollEgg)과 같은 순서
  const result = { species: rollVariant(picked.species, rand, opts), shiny: picked.shiny };

  // 개체 만들기·도감 기록·배치 — 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 둘 곳은 위에서 봤다
  const added = addNewPet(save, { species: result.species, shiny: result.shiny, now, rand, place: "party-first", opts });
  if (!added) return { ok: false, reason: "box-full" };
  const id = added.pet.id;
  const slotIndex = added.slotIndex ?? -1;
  const toBox = added.toBox;
  save.counts.hatched += 1; // 부화 업적이 센다. 알에서 다른 알이 나온 것은 세지 않는다

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
