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
//
// 공유 계열이 아닌 모습 바꾸기 종(로토무 — docs/specs/game.md "로토무의 모습 바꾸기")도 같은 바꾸기를 쓴다.
//   고를 종   data/regional.json shift 의 묶음 전부(로토무와 다섯 모습)
//   해금      묶음의 기본 종에 작업 시간 조건(src/dex/rules.ts SHIFT_RULES)이 있으면 계정의 에이전트 작업 시간이 그 이상이어야 바꾼다.
//             해금 전에도 목록은 준다 — 메뉴는 `모습 바꾸기` 줄을 흐리게 둔다(isFormLocked)
import type { DexOptions } from "./data";
import { nextOf, prevOf } from "./evo.js";
import { shiftGroupOf } from "./regional.js";
import { singleSpecies } from "./obtain.js";
import { recordDex } from "./record.js";
import { SHIFT_RULES } from "./rules.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type FormFailure = ReasonOf<"no-pet" | "not-shared" | "bad-form" | "form-locked" | "already">;

export type FormResult = Outcome<FormFailure> & {
  petId?: string;
  from?: string;
  to?: string;
};

// 공유 계열인가 — 진화 전 첫 종으로 본다
export function isShared(pet: PetV3, opts?: DexOptions): boolean {
  const root = pet.evolved[0] ?? pet.species;
  return singleSpecies(opts).has(root);
}

// 고를 수 있는 종 — 공유 계열이면 거쳐 온 종과 지금 종(저장에 없으면 만든다), 공유 계열이 아니면 모습 바꾸기 묶음(로토무). 둘 다 아니면 빈 목록
export function formsOf(pet: PetV3, opts?: DexOptions): string[] {
  if (!isShared(pet, opts)) return shiftGroupOf(pet.species, opts);
  const list = pet.forms?.length ? pet.forms : [...pet.evolved, pet.species];
  const own = [...new Set([...list, pet.species])];
  return [...new Set([...own, ...own.flatMap((slug) => shiftGroupOf(slug, opts))])];
}

// 이 종의 모습 바꾸기에 드는 에이전트 작업 시간 — 묶음의 기본 종에 조건이 없으면 null
export function shiftWorkMs(slug: string, opts?: DexOptions): number | null {
  const base = shiftGroupOf(slug, opts)[0];
  return base ? (SHIFT_RULES.workMs[base] ?? null) : null;
}

// 모습 바꾸기가 아직 잠겼는가 — 작업 시간 조건이 있는 묶음(로토무)만. 공유 계열은 잠그지 않는다
export function isFormLocked(save: Pick<SaveV3, "totals">, pet: PetV3, opts?: DexOptions): boolean {
  if (isShared(pet, opts)) return false;
  const need = shiftWorkMs(pet.species, opts);
  return need != null && (save.totals?.workMs ?? 0) < need;
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
  for (const slug of siblings) recordDex(save, slug, pet.shiny);
  return siblings;
}

// 지금 종을 바꾼다 — forms 안의 종만
export function setForm(save: SaveV3, petId: string, species: unknown, opts?: DexOptions): FormResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  const forms = formsOf(pet, opts);
  if (!forms.length) return { ok: false, reason: "not-shared" };
  if (typeof species !== "string" || !forms.includes(species)) return { ok: false, reason: "bad-form" };
  if (isFormLocked(save, pet, opts)) return { ok: false, reason: "form-locked" };
  if (species === pet.species) return { ok: false, reason: "already" };
  const from = pet.species;
  pet.forms = forms;
  pet.species = species;
  // 처음 바꾼 모습은 도감에 얻음으로 남긴다 — 진화 없이 드는 모습(기라티나(오리진폼)·로토무의 다섯 모습)은 여기서 처음 기록된다
  recordDex(save, species, pet.shiny);
  return { ok: true, petId, from, to: species };
}

// 단일 포켓몬 종인가 — 진화 계열 기준이다. 그 종이나 진화 전 종 가운데 하나가 단일 포켓몬(src/dex/obtain.ts singleSpecies)이면 단일 포켓몬이다
// (코스모그 → 코스모움·솔가레오, 타입:널 → 실버디). 우편 선물·업적 보상·업적 진행·교환·판매가 이 판정 하나를 쓴다
// (2026-10-04 사용자 결정 "진화 계열 기준", 94 항목 9-3-7). 여러 번 물을 때는 singles 를 한 번 만들어 넘긴다
export function isSingleSpecies(slug: string, opts?: DexOptions, singles: ReadonlySet<string> = singleSpecies(opts)): boolean {
  let at: string | null = slug;
  for (let guard = 0; at && guard < 10; guard += 1) {
    if (singles.has(at)) return true;
    at = prevOf(at, opts);
  }
  return false;
}

// 단일 포켓몬인가 — 거쳐 온 종이나 지금 종이 단일 포켓몬 계열이면 단일 포켓몬이다. 공유 sid 계열도 단일 포켓몬 판정을 따른다 (사용자 결정 2026-09-26: 교환 불가)
export function isSinglePet(pet: Pick<PetV3, "species" | "evolved">, opts?: DexOptions): boolean {
  const singles = singleSpecies(opts);
  if ([...pet.evolved, pet.species].some((s) => isSingleSpecies(s, opts, singles))) return true;
  return isShared({ ...(pet as PetV3), evolved: pet.evolved }, opts);
}
