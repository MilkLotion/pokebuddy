// 공유 sid 진화 계열 — 규칙은 docs/specs/game.md "후속 진화 예외"와 "공유 sid"
//
// 단일 포켓몬의 진화 계열(코스모그·타입:널·치고마·멜탄·베베놈)은 개체 하나가 진행 상태를 공유한다.
// 개체 식별자는 진화해도 그대로이므로 개체 하나가 곧 sid 하나다. 새 개체를 만들지 않는다.
//   대상      진화 전 첫 종이 단일 포켓몬(단일 포켓몬 알의 종과 우편으로만 받는 특수 폼 — src/shop/catalog.ts singleSpecies)인 개체
//   고를 종   PetV3.forms — 거쳐 온 종과 지금 종. 갈래 진화(코스모움)는 결과 종을 모두 받는다.
//             모습 바꾸기로 오가는 모습(data/regional.json 의 shift — 기라티나와 기라티나(오리진폼))은 진화 없이 처음부터 든다
//   바꾸기    forms 안의 종으로 species 만 바꾼다. 파티·박스 칸, 레벨·친밀도·만복도 등은 그대로다.
//             스탯은 바꾼 종을 따른다(종에서 읽으므로 따로 할 일이 없다)
// 한 개체이므로 같은 sid 가 두 파티 칸을 차지하지 않고, 박스 사용 수도 1마리다.
import type { DexOptions } from "./data";
import { nextOf } from "./evo.js";
import { shiftGroupOf } from "./regional.js";
import { singleSpecies } from "./obtain.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";

export type FormFailure = ReasonOf<"no-pet" | "not-shared" | "bad-form" | "already">;

export interface FormResult {
  ok: boolean;
  reason?: FormFailure;
  petId?: string;
  from?: string;
  to?: string;
}

// 공유 계열인가 — 진화 전 첫 종으로 본다
export function isShared(pet: PetV3, opts?: DexOptions): boolean {
  const root = pet.evolved[0] ?? pet.species;
  return singleSpecies(opts).has(root);
}

// 고를 수 있는 종 — 공유 계열이 아니면 빈 목록. 저장에 없으면 거쳐 온 종과 지금 종으로 만든다
export function formsOf(pet: PetV3, opts?: DexOptions): string[] {
  if (!isShared(pet, opts)) return [];
  const list = pet.forms?.length ? pet.forms : [...pet.evolved, pet.species];
  const own = [...new Set([...list, pet.species])];
  return [...new Set([...own, ...own.flatMap((slug) => shiftGroupOf(slug, opts))])];
}

// 진화한 직후에 부른다 — 이전 종을 남기고, 갈래 진화면 다른 결과 종도 함께 준다(도감 획득 기록 포함).
// 공유 계열이 아니면 아무것도 하지 않는다. 함께 받은 종을 돌려준다
export function afterEvolve(save: SaveV3, pet: PetV3, from: string, opts?: DexOptions): string[] {
  if (!isShared(pet, opts)) return [];
  const before = pet.forms?.length ? pet.forms : [...pet.evolved.slice(0, -1), from];
  const siblings = nextOf(from, opts)
    .map((s) => s.to)
    .filter((to) => to !== pet.species);
  pet.forms = [...new Set([...before, from, pet.species, ...siblings])];
  for (const slug of siblings) {
    if (!save.dex.unlocked.includes(slug)) save.dex.unlocked.push(slug);
    if (!save.dex.obtained.includes(slug)) save.dex.obtained.push(slug);
    if (pet.shiny && !save.dex.shinyObtained.includes(slug)) save.dex.shinyObtained.push(slug);
  }
  return siblings;
}

// 지금 종을 바꾼다 — forms 안의 종만
export function setForm(save: SaveV3, petId: string, species: unknown, opts?: DexOptions): FormResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  const forms = formsOf(pet, opts);
  if (!forms.length) return { ok: false, reason: "not-shared" };
  if (typeof species !== "string" || !forms.includes(species)) return { ok: false, reason: "bad-form" };
  if (species === pet.species) return { ok: false, reason: "already" };
  const from = pet.species;
  pet.forms = forms;
  pet.species = species;
  // 처음 바꾼 모습은 도감에 얻음으로 남긴다 — 진화 없이 드는 모습(기라티나(오리진폼))은 여기서 처음 기록된다
  if (!save.dex.unlocked.includes(species)) save.dex.unlocked.push(species);
  if (!save.dex.obtained.includes(species)) save.dex.obtained.push(species);
  if (pet.shiny && !save.dex.shinyObtained.includes(species)) save.dex.shinyObtained.push(species);
  return { ok: true, petId, from, to: species };
}
