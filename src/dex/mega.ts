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
import { MEGA_RULES } from "./rules.js";
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

// 도감 칸의 꼬리표 — 메가 하나는 M, X·Y 가 있으면 MX·MY, 원시회귀는 P. 메가 모습이 아니면 null
// (#0006-MX, 2026-10-09 시안 99 `도감 메가 칸 시안` — 사용자 "그렇게 진행")
export function megaTagOf(slug: string, opts?: DexOptions): string | null {
  const form = megaOf(slug, opts);
  if (!form) return null;
  if (form.kind === "primal") return "P";
  const xy = /-mega-([xy])$/.exec(slug);
  return xy ? `M${(xy[1] ?? "").toUpperCase()}` : "M";
}

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

// 친밀도 100 뒤 놀아주기 한 번 — 놀아주기·장난감이 성공한 뒤 부른다. 밥 주기는 세지 않는다 (2026-10-11)
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
