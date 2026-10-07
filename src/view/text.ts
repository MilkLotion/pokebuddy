// 화면 문구·이름의 입구 — 문구 표는 ./i18n.ts, 종 이름 표는 ./name-table.ts.
// (예전 src/main/text.ts. 화면 값(src/view)이 쓰는데 view 는 main 을 가져다 쓰지 못해 도구 레인 T7a 에서 옮겼다)
// 메뉴·트레이는 슬러그가 아니라 "피카츄" 를 보인다. 성격 이름은 data/natures.json 의 name (한국어·영어) — 언어 파일에 따로 두지 않는다
import { natureOf } from "../dex/natures";
import { megaOf } from "../dex/mega";
import { regionalOf } from "../dex/regional";
import type { Lang, NatureId } from "../shared/species";
import type { DexOptions } from "../dex/data";
import { isMetaKey } from "../dex/data";
import { evoItemTable, itemTable } from "../dex/tables";
import { currentLang, t } from "./i18n";
import { tableName } from "./name-table";

// 문구 — {이름} 자리에 vars 를 채운다. 없는 키는 한국어 → 키 이름 순으로 떨어져 화면이 비지 않는다
export { t, langOf, setLang, currentLang, boredText } from "./i18n";

// 종의 화면 이름 — 표에 없는 이름은 슬러그 그대로. 메가 모습은 data/mega.json 의 이름이다 (src/dex/mega.ts)
export const petName = (slug: string, lang: Lang = currentLang()): string => {
  const mega = megaOf(slug);
  return mega ? (lang === "en" ? mega.en : mega.ko) : tableName(slug, lang);
};

// 종 이름을 이름과 모습으로 나눈다 — 파티 상세 기기 창의 두 줄 (docs/specs/game.md "파티 상세 기기 창", 2026-10-07 사용자 결정)
// 지방 모습은 기본 종 이름 / `<지방>의 모습`. 뒤에 더 붙은 말(켄타로스 컴뱃종)은 ` · ` 로 잇는다. 괄호 모습은 괄호 앞 / 괄호 안.
// 그 밖(히트로토무·메가 모습)은 이름 그대로이고 모습이 없다
export function petNameParts(slug: string, lang: Lang = currentLang()): { name: string; form?: string } {
  const full = petName(slug, lang);
  const regional = regionalOf(slug);
  if (regional && !regional.special) {
    const base = petName(regional.base, lang);
    const at = full.indexOf(base);
    if (at > 0) {
      const region = full.slice(0, at).trim();
      const rest = full.slice(at + base.length).trim().replace(/^\((.*)\)$/, "$1");
      const form = lang === "en" ? `${region} Form` : `${region}의 모습`;
      return { name: base, form: rest ? `${form} · ${rest}` : form };
    }
  }
  const paren = /^(.+?)\s*\((.+)\)$/.exec(full);
  return paren ? { name: paren[1]!, form: paren[2]! } : { name: full };
}

// 성격의 화면 이름 — 모르는 id 는 그대로 보여 무엇이 빠졌는지 드러나게
export const natureName = (id: NatureId | string, lang: Lang = currentLang()): string => natureOf(id)?.name[lang] ?? String(id);

// 마리의 화면 이름 — 종 이름이다. 별명은 보이지 않는다 (docs/specs/game.md "별명 입력과 모습 선택을 제공하지 않는다")
// 도구·진화용 도구의 화면 이름 — 표에 없으면 식별자 그대로 둔다(가방이 모르는 식별자를 만나도 화면이 비지 않게).
// 설정 언어를 따른다 — 가방·상점·진화 조건·배너·편지가 같다 (2026-10-04 사용자 결정, 94 항목 3-2. docs/design.md 화면 언어)
export function itemName(id: string, opts?: DexOptions, lang: Lang = currentLang()): string {
  if (isMetaKey(id)) return id;
  const row = itemTable(opts)[id] ?? evoItemTable(opts)[id];
  return (lang === "en" ? row?.en : undefined) ?? row?.ko ?? id;
}

// 업적의 화면 이름 — 설정 언어를 따른다. 영어 이름이 없으면 한국어 (94 항목 3-2)
export const achievementName = (def: { ko: string; en?: string }, lang: Lang = currentLang()): string => (lang === "en" ? def.en : undefined) ?? def.ko;

// 진화 조건의 성별 낱말 — 도감 진화 문구·상점 트리 화살표가 같이 쓴다. 글자는 언어 파일의 gender.* (94 항목 3-2)
export const genderText = (gender: "male" | "female"): string => t(`gender.${gender}`);

export const petLabel = (pet: { species: string }, lang: Lang = currentLang()): string => petName(pet.species, lang);

// 타입의 화면 이름 — 18종 고정이라 표를 여기 둔다. 모르는 값은 그대로 보여 무엇이 빠졌는지 드러나게
const TYPE_KO: Readonly<Record<string, string>> = {
  normal: "노말", fire: "불꽃", water: "물", electric: "전기", grass: "풀", ice: "얼음",
  fighting: "격투", poison: "독", ground: "땅", flying: "비행", psychic: "에스퍼", bug: "벌레",
  rock: "바위", ghost: "고스트", dragon: "드래곤", dark: "악", steel: "강철", fairy: "페어리",
};

export const typeName = (id: string, lang: Lang = currentLang()): string => (lang === "ko" ? TYPE_KO[id] ?? id : id);
