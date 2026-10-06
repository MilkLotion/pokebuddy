// 버드렉스의 말 — 유대의고삐로 블리자포스·레이스포스를 부르고, 백마·흑마 모습은 그 말이 있어야 된다 (2026-10-07 사용자 결정, worklog/records/bugs-1007/1-2.md)
//
// 표는 data/regional.json riders 다 — 모습 → 그 모습에 있어야 하는 말(src/dex/regional.ts riderOf·allRiders)
//   부르기    가방 기기 창에서 유대의고삐(RIDER_ITEM)를 쓴다 — 명령 bag.use 의 pick 이 고른 말이다(src/tx/handlers/items.ts useHandler)
//             저장에 버드렉스 계열 개체가 있고, 아직 얻지 않은 말이고, 고삐가 있고, 박스에 빈 칸이 있어야 한다. 말은 박스로 간다
//   모습      백마 탄 모습·흑마 탄 모습은 그 말 개체가 저장에 있어야 바뀐다. 말은 쓰지 않는다(src/dex/forms.ts setForm)
// 두 말은 단일 포켓몬이라 팔거나 교환할 수 없다 — 한 번 생기면 저장에서 사라지지 않는다
import { boxRoom } from "../box/slots.js";
import type { DexOptions } from "../dex/data";
import { hasObtained } from "../dex/record.js";
import { allRiders, ridersOf } from "../dex/regional.js";
import { RIDER_ITEM } from "../dex/rules.js";
import type { Outcome } from "../shared/command.js";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Rand } from "../shared/rand.js";
import type { SaveV3 } from "../shared/save-v3";
import { addNewPet } from "./create.js";

export type CallFailure = ReasonOf<"not-rider-owner" | "already" | "bad-choice" | "none-left" | "box-full">;

export type CallResult = Outcome<CallFailure> & { petId?: string; species?: string; left?: number };

// 지금 부를 수 있는지와 말의 상태 — 가방 기기 창이 쓴다. 막는 까닭은 명령과 같은 순서다
//   not-rider-owner  버드렉스 계열 개체가 없다 · already  두 말을 다 가졌다 · box-full  박스에 빈 칸이 없다
export function riderCall(save: SaveV3, opts?: DexOptions): { horses: { species: string; owned: boolean }[]; block: Extract<CallFailure, "not-rider-owner" | "already" | "box-full"> | null } {
  const horses = allRiders(opts).map((species) => ({ species, owned: hasObtained(save, species) }));
  const owner = save.pets.some((p) => ridersOf(p.species, opts).length > 0);
  const block = !owner ? "not-rider-owner" : horses.every((h) => h.owned) ? "already" : boxRoom(save.boxes) < 1 ? "box-full" : null;
  return { horses, block };
}

// 말을 부른다 — 유대의고삐 1개를 쓰고 고른 말을 박스에 넣는다. 거절하면 저장을 바꾸지 않는다
export function callRider(save: SaveV3, species: unknown, now: number, rand: Rand, opts?: DexOptions): CallResult {
  const { horses, block } = riderCall(save, opts);
  if (block === "not-rider-owner") return { ok: false, reason: block };
  const choice = horses.find((h) => h.species === species);
  if (!choice) return { ok: false, reason: "bad-choice" };
  if (choice.owned) return { ok: false, reason: "already" };
  if ((save.bag[RIDER_ITEM] ?? 0) < 1) return { ok: false, reason: "none-left" };
  if (block === "box-full") return { ok: false, reason: block };
  const added = addNewPet(save, { species: choice.species, shiny: false, now, rand, place: "box-only", opts });
  if (!added) return { ok: false, reason: "box-full" };
  const left = (save.bag[RIDER_ITEM] ?? 0) - 1;
  if (left > 0) save.bag[RIDER_ITEM] = left;
  else delete save.bag[RIDER_ITEM];
  return { ok: true, petId: added.pet.id, species: choice.species, left };
}
