// 화면 문구·이름의 typed facade — lib/i18n.js · lib/names.js(JS 로 남아 있다 — CLI·설치본이 함께 쓴다).
// 메뉴·트레이는 슬러그가 아니라 "피카츄" 를 보인다. 성격 이름은 data/natures.json 의 name (한국어·영어) — 언어 파일에 따로 두지 않는다
import { nature as natureOf } from "../dex/natures";
import { megaOf } from "../dex/mega";
import type { Lang, NatureId } from "../shared/types";

interface I18nModule {
  t(key: string, vars?: Record<string, unknown>): string;
  langOf(config?: { lang?: unknown }, env?: NodeJS.ProcessEnv): Lang;
  setLang(next: string): Lang;
  getLang(): Lang;
  moodWord(mood: number): string;
  untilWord(nextAt: number, now?: number): string;
  DEFAULT_LANG: Lang;
  LANGS: string[];
}
interface NamesModule {
  petName(slug: string, lang?: Lang): string;
  hasName(slug: string): boolean;
}

const i18n = require("../../lib/i18n.js") as I18nModule;
const names = require("../../lib/names.js") as NamesModule;

// 문구 — {이름} 자리에 vars 를 채운다. 없는 키는 한국어 → 키 이름 순으로 떨어져 화면이 비지 않는다
export const t = (key: string, vars?: Record<string, unknown>): string => i18n.t(key, vars);
export const langOf = (config?: { lang?: unknown }, env?: NodeJS.ProcessEnv): Lang => i18n.langOf(config, env);
export const setLang = (next: string): Lang => i18n.setLang(next);
export const getLang = (): Lang => i18n.getLang();
export const moodWord = (mood: number): string => i18n.moodWord(mood);
export const untilWord = (nextAt: number, now?: number): string => i18n.untilWord(nextAt, now);

// 종의 화면 이름 — 표에 없는 이름은 슬러그 그대로. 메가 모습은 data/mega.json 의 이름이다 (src/dex/mega.ts)
export const petName = (slug: string, lang: Lang = getLang()): string => {
  const mega = megaOf(slug);
  return mega ? (lang === "en" ? mega.en : mega.ko) : names.petName(slug, lang);
};

// 성격의 화면 이름 — 모르는 id 는 그대로 보여 무엇이 빠졌는지 드러나게
export const natureName = (id: NatureId | string, lang: Lang = getLang()): string => natureOf(id)?.name[lang] ?? String(id);

// 마리의 화면 이름 — 별명이 있으면 별명, 없으면 종 이름
export const petLabel = (pet: { nick: string | null; species: string }, lang: Lang = getLang()): string =>
  pet.nick ?? petName(pet.species, lang);

// 타입의 화면 이름 — 18종 고정이라 표를 여기 둔다. 모르는 값은 그대로 보여 무엇이 빠졌는지 드러나게
const TYPE_KO: Readonly<Record<string, string>> = {
  normal: "노말", fire: "불꽃", water: "물", electric: "전기", grass: "풀", ice: "얼음",
  fighting: "격투", poison: "독", ground: "땅", flying: "비행", psychic: "에스퍼", bug: "벌레",
  rock: "바위", ghost: "고스트", dragon: "드래곤", dark: "악", steel: "강철", fairy: "페어리",
};

export const typeName = (id: string, lang: Lang = getLang()): string => (lang === "ko" ? TYPE_KO[id] ?? id : id);
