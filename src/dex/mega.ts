// 메가진화·원시회귀 — data/mega.json (모습 표). 규칙은 docs/specs/game.md "메가진화", 수치는 docs/specs/balance.md "메가진화"
//
// 메가 모습은 종을 바꾸지 않는다. 개체의 species 는 그대로 두고 mega.on 에 모습 슬러그를 적는다.
// 진화·도감 집계·교환·판매·서버 검증의 species 규칙은 이 기능을 모른다. 그림·이름·타입 표시만 모습을 따른다
//   조건      친밀도 100 · Lv.60 이상 · 친밀도 100 뒤 파티에서 보낸 시간 · 친밀도 100 뒤 밥 주기와 놀아주기 횟수 (MEGA_RULES)
//   메가스톤  조건을 모두 채우면 그 개체가 지닌다(mega.stone). 가방에 들어가지 않는다. 한 번 생기면 없어지지 않는다
//   도감      메가스톤이 생긴 종을 dex.megaOpened 에 적는다. 개체를 팔거나 교환해도 남는다
//   켜기      적용한 프리셋의 칸에 든 개체만. 한 프리셋에 메가 모습은 한 마리다 — 새로 켜면 먼저 켠 개체가 기본 모습으로 돌아간다
//   예외      원시회귀(그란돈·가이오가)와 메가레쿠쟈는 한 마리 제한에서 빠진다(표의 free). 다른 개체를 풀지 않고, 다른 개체 때문에 풀리지도 않는다.
//             원작에서 원시회귀는 메가진화 횟수에 들지 않는다. 레쿠쟈는 메가스톤 없이 메가진화해 도구 칸이 비는 이점이 있는데 이 게임에는 도구가 없어 같은 이점으로 바꿨다 (2026-10-02 사용자 결정)
//   풀림      개체가 프리셋을 떠나면(박스) 기본 모습으로 돌아간다. 종이 바뀌어 모습이 맞지 않아도 돌아간다
// 표가 없으면 빈 표로 본다 — 시험용 dataDir 에 이 파일이 없어도 깨지지 않게
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기와 시간 적용이 한다
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";
import { MEGA_RULES } from "../save/rules.js";
import { allPresets } from "../party/presets.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";

export type MegaKind = "mega" | "primal";

export interface MegaForm {
  base: string; // 메가진화하는 종
  kind: MegaKind;
  free?: true; // 한 프리셋 한 마리 제한에서 빠진다 — 원시회귀와 메가레쿠쟈
  pokemonId: number; // PokeAPI pokemon.csv id — 초상 그림 번호
  pmd?: string; // PMD SpriteCollab 폼 경로(`0006/0001`)
  overworld?: string; // pokeemerald-expansion 의 graphics/pokemon 아래 폴더(`charizard/mega_y`)
  ko: string;
  en: string;
  types: string[];
}

interface MegaTable {
  forms: Record<string, MegaForm>;
}

const EMPTY: MegaTable = { forms: {} };
const tables = new Map<string, MegaTable>();

// 표 전체 — 파일이 없거나 깨졌으면 빈 표
export function megaTable(opts?: DexOptions): MegaTable {
  const key = opts?.dataDir ?? "";
  const hit = tables.get(key);
  if (hit) return hit;
  let table = EMPTY;
  try {
    table = { forms: loadJson<Partial<MegaTable>>("mega.json", opts).forms ?? {} };
  } catch {
    table = EMPTY;
  }
  tables.set(key, table);
  return table;
}

// 모습 정보 — 메가 모습이 아니면 null
export function megaOf(slug: string, opts?: DexOptions): MegaForm | null {
  const key = normalizeSlug(slug);
  if (isMetaKey(key)) return null;
  return megaTable(opts).forms[key] ?? null;
}

// 모습 슬러그 전부 — 표 순서
export const megaSlugs = (opts?: DexOptions): string[] => Object.keys(megaTable(opts).forms).filter((k) => !isMetaKey(k));

// 그 종의 메가 모습 — 표 순서. 없으면 빈 목록 (리자몽·뮤츠는 둘)
export const megaFormsOf = (species: string, opts?: DexOptions): string[] => megaSlugs(opts).filter((slug) => megaTable(opts).forms[slug]?.base === species);

// 한 마리 제한에서 빠지는 모습인가
export const megaFree = (slug: string | undefined, opts?: DexOptions): boolean => slug !== undefined && megaOf(slug, opts)?.free === true;

// 화면에 보이는 종 — 메가 모습이면 그 슬러그, 아니면 종
export const shownSpecies = (pet: Pick<PetV3, "species" | "mega">): string => pet.mega?.on ?? pet.species;

// 조건 하나하나 — 화면에는 보이지 않는다. 자체 확인과 지급 판정이 쓴다
export interface MegaProgress {
  affinity: boolean;
  level: boolean;
  bond: boolean;
  care: boolean;
}

export function megaProgress(pet: PetV3): MegaProgress {
  return {
    affinity: pet.affinity >= MEGA_RULES.affinity,
    level: pet.level >= MEGA_RULES.level,
    bond: (pet.mega?.bondMs ?? 0) >= MEGA_RULES.bondMs,
    care: (pet.mega?.care ?? 0) >= MEGA_RULES.care,
  };
}

// 시간과 횟수를 세는 개체인가 — 메가 모습이 있는 종이고 친밀도 100 이며 아직 메가스톤이 없다
const counting = (pet: PetV3, opts?: DexOptions): boolean =>
  pet.affinity >= MEGA_RULES.affinity && pet.mega?.stone !== true && megaFormsOf(pet.species, opts).length > 0;

// 친밀도 100 뒤 파티에서 보낸 시간 — 시간 적용이 파티 칸 개체마다 부른다. 버프 배율은 곱하지 않는다
export function tickMega(pet: PetV3, elapsedMs: number, opts?: DexOptions): void {
  if (elapsedMs <= 0 || !counting(pet, opts)) return;
  const mega = (pet.mega ??= { bondMs: 0, care: 0 });
  mega.bondMs = Math.min(MEGA_RULES.bondMs, mega.bondMs + elapsedMs);
}

// 친밀도 100 뒤 밥 주기·놀아주기 한 번 — 돌봄 명령이 성공한 뒤 부른다
export function countCare(pet: PetV3, opts?: DexOptions): void {
  if (!counting(pet, opts)) return;
  const mega = (pet.mega ??= { bondMs: 0, care: 0 });
  mega.care = Math.min(MEGA_RULES.care, mega.care + 1);
}

// 조건을 모두 채운 개체에 메가스톤을 준다. 새로 받은 개체의 식별자를 돌려준다. 종을 도감 기록에 적는다
export function grantStones(save: SaveV3, opts?: DexOptions): string[] {
  const granted: string[] = [];
  for (const pet of save.pets) {
    if (pet.mega?.stone === true || !megaFormsOf(pet.species, opts).length) continue;
    const p = megaProgress(pet);
    if (!p.affinity || !p.level || !p.bond || !p.care) continue;
    pet.mega = { bondMs: pet.mega?.bondMs ?? 0, care: pet.mega?.care ?? 0, stone: true };
    const opened = (save.dex.megaOpened ??= []);
    if (!opened.includes(pet.species)) opened.push(pet.species);
    granted.push(pet.id);
  }
  return granted;
}

// 개체가 고를 수 있는 메가 모습 — 메가스톤이 없으면 빈 목록
export const megaChoices = (pet: PetV3, opts?: DexOptions): string[] => (pet.mega?.stone === true ? megaFormsOf(pet.species, opts) : []);

// 개체가 든 프리셋의 칸들. 박스 개체면 null
function presetSlotsOf(save: SaveV3, petId: string): { preset: number; petIds: string[] } | null {
  for (const { preset, slots } of allPresets(save)) {
    const ids = slots.filter((s) => s.state === "pokemon" && s.petId).map((s) => s.petId as string);
    if (ids.includes(petId)) return { preset, petIds: ids };
  }
  return null;
}

export type MegaFailure = "no-pet" | "no-stone" | "bad-form" | "not-in-party" | "already";

export interface MegaResult {
  ok: boolean;
  reason?: MegaFailure;
  petId?: string;
  on?: string | null; // 바뀐 뒤의 모습. null 이면 기본 모습
  reverted?: string[]; // 같은 프리셋에서 기본 모습으로 돌아간 개체
}

// 메가 모습을 켜거나 끈다 — form 이 null 이면 기본 모습으로 돌아간다
export function setMega(save: SaveV3, petId: string, form: unknown, opts?: DexOptions): MegaResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };
  if (form == null) {
    if (!pet.mega?.on) return { ok: false, reason: "already" };
    delete pet.mega.on;
    return { ok: true, petId, on: null, reverted: [] };
  }
  if (pet.mega?.stone !== true) return { ok: false, reason: "no-stone" };
  if (typeof form !== "string" || !megaChoices(pet, opts).includes(form)) return { ok: false, reason: "bad-form" };
  if (pet.mega.on === form) return { ok: false, reason: "already" };
  const place = presetSlotsOf(save, petId);
  if (!place) return { ok: false, reason: "not-in-party" };
  const reverted: string[] = [];
  // 제한에서 빠지는 모습은 다른 개체를 풀지 않는다. 다른 개체의 제한 밖 모습도 풀지 않는다
  if (!megaFree(form, opts)) {
    for (const other of save.pets) {
      if (other.id === petId || !other.mega?.on || megaFree(other.mega.on, opts) || !place.petIds.includes(other.id)) continue;
      delete other.mega.on;
      reverted.push(other.id);
    }
  }
  pet.mega.on = form;
  return { ok: true, petId, on: form, reverted };
}

// 같은 프리셋에서 지금 메가 모습인 다른 개체 — 확인 창이 "원래 모습으로 돌아가요" 줄에 쓴다
export function megaRivals(save: SaveV3, petId: string, opts?: DexOptions): PetV3[] {
  const place = presetSlotsOf(save, petId);
  const pet = save.pets.find((p) => p.id === petId);
  // 이 개체의 모습이 제한 밖이면 아무도 풀리지 않는다. 한 종의 모습은 모두 같은 쪽이다
  if (!place || !pet || megaFree(megaFormsOf(pet.species, opts)[0], opts)) return [];
  return save.pets.filter((p) => p.id !== petId && p.mega?.on && !megaFree(p.mega.on, opts) && place.petIds.includes(p.id));
}

// 규칙에 맞지 않는 메가 모습을 푼다 — 거래 실행기가 명령마다 한 번 부른다
//   프리셋에 들지 않은 개체(박스), 종이 바뀌어 모습의 기본 종이 지금 종과 다른 개체, 메가스톤이 없는 개체
export function settleMega(save: SaveV3, opts?: DexOptions): string[] {
  const inPreset = new Set<string>();
  for (const { slots } of allPresets(save)) for (const s of slots) if (s.state === "pokemon" && s.petId) inPreset.add(s.petId);
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
