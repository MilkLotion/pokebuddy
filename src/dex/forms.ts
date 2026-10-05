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
// 모습 바꾸기 묶음(data/regional.json shift)에 규칙(src/dex/rules.ts SHIFT_RULES)이 있는 종(로토무 — docs/specs/game.md "로토무의 모습 바꾸기")
//   해금      그 개체가 지금 파티에 있는 동안 받은 에이전트 작업 시간(PetV3.workMs)이 조건 이상이어야 바꾼다.
//             해금 전에도 목록은 준다 — 메뉴는 `모습 바꾸기` 줄을 흐리게 둔다(isFormLocked)
//   도구      기본 종이 아닌 모습으로 바꿀 때마다 도구(로토무카탈로그) 하나를 쓴다. 기본 종으로 돌아갈 때는 쓰지 않는다(formItemOf)
// 로토무는 업적 보상 종이라 공유 계열(isShared)로도 판정된다 — 해금·도구 규칙은 공유 계열 여부와 상관없이 본다
import type { DexOptions } from "./data";
import { nextOf, prevOf } from "./evo.js";
import { shiftGroupOf } from "./regional.js";
import { singleSpecies } from "./obtain.js";
import { recordDex } from "./record.js";
import { SHIFT_RULES } from "./rules.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";
import type { ReasonOf } from "../shared/names/reasons.js";
import type { Outcome } from "../shared/command.js";

export type FormFailure = ReasonOf<"no-pet" | "not-shared" | "bad-form" | "form-locked" | "already" | "no-item">;

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

// 이 종이 든 모습 바꾸기 묶음의 규칙과 기본 종 — 규칙이 없으면 null
export function shiftRuleOf(slug: string, opts?: DexOptions): { base: string; workMs: number; item: string } | null {
  const base = shiftGroupOf(slug, opts)[0];
  const rule = base ? SHIFT_RULES[base] : undefined;
  return base && rule ? { base, ...rule } : null;
}

// 이 종의 모습 바꾸기에 드는 개체 작업 시간 — 규칙이 없으면 null
export const shiftWorkMs = (slug: string, opts?: DexOptions): number | null => shiftRuleOf(slug, opts)?.workMs ?? null;

// 모습 바꾸기가 아직 잠겼는가 — 규칙이 있는 묶음(로토무)만. 그 개체의 작업 시간(PetV3.workMs)으로 본다
export function isFormLocked(pet: PetV3, opts?: DexOptions): boolean {
  const rule = shiftRuleOf(pet.species, opts);
  return rule != null && (pet.workMs ?? 0) < rule.workMs;
}

// 그 모습으로 바꿀 때 쓰는 도구 — 규칙이 있는 묶음에서 기본 종이 아닌 모습으로 갈 때만. 아니면 null
export function formItemOf(pet: PetV3, to: string, opts?: DexOptions): string | null {
  const rule = shiftRuleOf(pet.species, opts);
  return rule && to !== rule.base ? rule.item : null;
}

// 개체 작업 시간 — 시간 적용이 지금 파티 칸 개체마다 부른다. 규칙이 있는 묶음의 개체만 세고 조건 값에서 멈춘다
export function tickFormWork(pet: PetV3, workMs: number, opts?: DexOptions): void {
  if (workMs <= 0) return;
  const rule = shiftRuleOf(pet.species, opts);
  if (!rule || (pet.workMs ?? 0) >= rule.workMs) return;
  pet.workMs = Math.min(rule.workMs, (pet.workMs ?? 0) + workMs);
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
  if (isFormLocked(pet, opts)) return { ok: false, reason: "form-locked" };
  if (species === pet.species) return { ok: false, reason: "already" };
  const item = formItemOf(pet, species, opts);
  if (item && (save.bag[item] ?? 0) < 1) return { ok: false, reason: "no-item" };
  if (item) {
    save.bag[item] = (save.bag[item] ?? 0) - 1;
    if (save.bag[item] <= 0) delete save.bag[item];
  }
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
