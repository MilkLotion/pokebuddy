// 화면 문구 — 메뉴·트레이·설정창이 쓰는 말을 언어 파일(data/i18n/<언어>.json)에서 키로 가져온다.
//
// 기본은 한국어(ko). 언어는 환경변수 POKEBUDDY_LANG → 설정 파일 lang → ko 순서로 정한다.
// 없는 키는 한국어 → 키 이름 순으로 떨어져 화면이 비지 않는다 (새 키를 영어에 아직 안 적어도 깨지지 않게).
// 코어(src/save · src/tx)는 문구가 아니라 코드(reason·nextAt)를 돌려주고, 문구는 여기서만 만든다 — 언어를 하나 더 얹을 때 코어를 건드리지 않게.
// CLI 의 안내문은 아직 한국어 그대로다 — 터미널 쪽은 다음 단계에서 같은 표로 옮긴다
// (예전 lib/i18n.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다. 언어 파일은 T7b-2 에서 lib/i18n/ 에서 data/i18n/ 로 옮겼다.
//  메인·화면 값이 부르는 입구는 ./text.ts 다)
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Lang } from "../shared/species";

// dist/view → 프로젝트/data/i18n
const I18N_DIR = path.join(__dirname, "..", "..", "data", "i18n");
const readTable = (lang: Lang): Record<string, string> => JSON.parse(readFileSync(path.join(I18N_DIR, `${lang}.json`), "utf8")) as Record<string, string>;

const TABLES: Record<Lang, Record<string, string>> = {
  ko: readTable("ko"),
  en: readTable("en"),
};
const DEFAULT_LANG: Lang = "ko";

let lang: Lang = DEFAULT_LANG;

const isLang = (v: string): v is Lang => Object.prototype.hasOwnProperty.call(TABLES, v);

// 쓸 언어 — 모르는 값이면 기본 언어
export function langOf(config: { lang?: unknown } = {}, env: NodeJS.ProcessEnv = process.env): Lang {
  const want = String(env.POKEBUDDY_LANG || config.lang || DEFAULT_LANG).toLowerCase().slice(0, 2);
  return isLang(want) ? want : DEFAULT_LANG;
}

export function setLang(next: string): Lang {
  lang = isLang(next) ? next : DEFAULT_LANG;
  return lang;
}

export const currentLang = (): Lang => lang;

// 문구 — {이름} 자리에 vars 를 채운다. 없는 변수는 그대로 남겨 무엇이 빠졌는지 보이게
export function t(key: string, vars: Record<string, unknown> = {}): string {
  const table = TABLES[lang] || TABLES[DEFAULT_LANG];
  const text = table[key] ?? TABLES[DEFAULT_LANG][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (vars[name] == null ? whole : String(vars[name])));
}

// 기분 0~100 → 다섯 단계 말 (최고·좋음·보통·시들·우울)
export function moodText(mood: number): string {
  const m = Number(mood);
  const level = !Number.isFinite(m) ? 3 : m >= 80 ? 5 : m >= 60 ? 4 : m >= 40 ? 3 : m >= 20 ? 2 : 1;
  return t(`mood.${level}`);
}
