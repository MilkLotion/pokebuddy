// 전투 중 모습 보이기 — 원작에서 전투 중에만 바뀌는 모습을 일상 파티(바탕화면·관리 창)에서 겉모습으로 고른다
// (2026-10-22 사용자 "전투중일때의 모습다른것들 파티에서 모습바꾸기 되는거지, 모험탭(탐험/배틀)에선 안돼야지.
//  지우개굴닌자라치면 파티에선 지우개굴닌자모습으로 있을수 있는데, 모험에서는 개굴닌자로만 쓸수있는거지. 배틀에서 유대진화해야 지우개굴닌자가 되고")
//
//   저장      PetV3.battleLook 에 모습 슬러그를 적는다. species 는 그대로다 — 진화·도감·교환·판매·서버 검증·배틀은 이 칸을 모른다
//   보이기    이름·타입·그림만 이 모습을 따른다(shownSpecies). 메가 모습이 켜져 있으면 메가가 먼저다
//   메가      한 개체에 메가 모습과 전투 중 모습을 함께 켜지 않는다. 하나를 켜면 다른 하나를 끈다
//   모험      배틀 파티·탐험은 species(기본 모습)로 나가고, 원래처럼 전투 중에 바뀐다 (src/battle/party.ts battleSpeciesOf, src/battle/fighter-core.ts partyOf)
//   고를 모습 전투 표(data/form-battle.json)·전투 중 모습 표(data/regional.json forms 의 get "battle")·엔진이 바꾸는 모습(체리꼬) 가운데 종이 있는 모습.
//             모습 바꾸기 묶음(data/regional.json shift)에 이미 든 모습(테라파고스 테라스탈폼)은 뺀다
// 순수 함수이며 저장을 쓰지 않는다. 저장은 거래 실행기가 한다
import type { DexOptions } from "./data";
import { formsOf } from "./forms.js";
import { battleFormsOf, shiftGroupOf } from "./regional.js";
import { hasProfile } from "./species.js";
import { formBattleTable } from "./tables.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";

// 엔진이 날씨로 바꾸는 모습 — 전투 표에 없다 (src/battle/engine.ts 의 플라워기프트)
const ENGINE_LOOKS: Readonly<Record<string, readonly string[]>> = { cherrim: ["cherrim-sunshine"] };

// 그 종이 고를 전투 중 모습 — 표 순서. 없으면 빈 목록
export function battleLookChoices(species: string, opts?: DexOptions): string[] {
  const row = formBattleTable(opts)[species];
  const list = [...(row?.form ? [row.form] : []), ...battleFormsOf(species, opts), ...(ENGINE_LOOKS[species] ?? [])];
  const group = shiftGroupOf(species, opts);
  return [...new Set(list)].filter((slug) => slug !== species && hasProfile(slug, opts) && !group.includes(slug));
}

// 포켓몬 메뉴 모습 말풍선의 줄 — 모습 바꾸기 묶음(formsOf) 다음에 전투 중 모습. 전투 중 모습이 없으면 formsOf 그대로다.
// 한 방향 묶음의 끝(개굴닌자(유대변화))은 formsOf 가 비므로 지금 종을 앞에 둔다 — 기본 모습으로 돌아가는 줄
export function menuFormsOf(pet: PetV3, opts?: DexOptions): string[] {
  const looks = battleLookChoices(pet.species, opts);
  const base = formsOf(pet, opts);
  return looks.length ? [...new Set([...(base.length ? base : [pet.species]), ...looks])] : base;
}

// 전투 중 모습을 켜거나 끈다 — look 이 null 이면 기본 모습. 메가 모습을 끈다. 바뀌었으면 true
export function setBattleLook(pet: PetV3, look: string | null, opts?: DexOptions): boolean {
  if (look === null) {
    if (!pet.battleLook) return false;
    delete pet.battleLook;
    return true;
  }
  if (!battleLookChoices(pet.species, opts).includes(look) || pet.battleLook === look) return false;
  pet.battleLook = look;
  if (pet.mega?.on) delete pet.mega.on;
  return true;
}

// 종에 맞지 않는 전투 중 모습을 지운다 — 진화 등으로 종이 바뀐 개체. 거래 실행기가 명령마다 부른다
export function settleBattleLook(save: SaveV3, opts?: DexOptions): void {
  for (const pet of save.pets) {
    if (pet.battleLook && (pet.mega?.on || !battleLookChoices(pet.species, opts).includes(pet.battleLook))) delete pet.battleLook;
  }
}
