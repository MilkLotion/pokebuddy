// 포켓몬 화면 이름표(lib/names.json)를 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-names.js   (npm run data:build 가 네 빌드를 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV 세 장 (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon_species_names.csv   종 번호 → 언어별 이름 (한국어 3 · 영어 9)
//   pokemon_forms.csv           폼 식별자(rotom-wash) → 폼 번호
//   pokemon_form_names.csv      폼 번호 → 언어별 폼 이름 (워시로토무 · Wash Rotom)
// 우리 도감표(lib/dex.json, build-dex 가 만든다)의 슬러그를 전부 잇는다. 폼 슬러그는 폼 이름표를, 나머지는 종 이름표를 쓴다.
// 폼 이름표는 언어마다 "폼 이름"과 "포켓몬 이름" 두 칸인데 어느 칸이 온전한 이름인지 폼마다 다르다
// (히트로토무 는 폼 이름 칸, 알로라 라이츄 는 포켓몬 이름 칸) — 종 이름을 품은 칸을 고르고, 둘 다 아니면 "종 이름 + 폼 이름" 으로 잇는다.
// 그래도 어긋나는 것은 OVERRIDES 에 손으로 적는다.
// 리전폼은 data/regional.json 의 ko·en 을 가장 먼저 쓴다 — 화면 이름은 `알로라 라이츄` 형식이다 (2026-09-30 사용자 결정)
import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../../shared/types";
import { LIB_DIR, csv, readDex, runBuild } from "./pokeapi-csv";
import { regionalOf } from "../../dex/regional";

const LANG: Record<Lang, string> = { ko: "3", en: "9" };
const LANGS = Object.keys(LANG) as Lang[];
const OUT = path.join(LIB_DIR, "names.json");

type NameEntry = Record<Lang, string>;
type FormName = { form: string; pokemon: string };

// 자동으로 못 맞춘 것 — 슬러그 → { ko, en }
// 특수 폼(data/regional.json)이 있는 종의 기본형 — 공식 도감(포켓몬코리아)이 기본형에도 모습 이름을 붙이는 종은 괄호에 그 이름을 적는다
// (2026-10-03 사용자 결정 "다 적고, 괄호로 그 모습을 적자."). 공식 도감에 모습 이름이 없는 기본형(디아루가·플라엣테·마기아나·다투곰·피츄)은 종 이름 그대로다
const OVERRIDES: Record<string, NameEntry> = {
  giratina: { ko: "기라티나(어나더폼)", en: "Giratina (Altered Forme)" },
  basculin: { ko: "배쓰나이(적색근의 모습)", en: "Basculin (Red-Striped Form)" },
  lycanroc: { ko: "루가루암(한낮의 모습)", en: "Lycanroc (Midday Form)" },
  toxtricity: { ko: "스트린더(하이한 모습)", en: "Toxtricity (Amped Form)" },
  urshifu: { ko: "우라오스(일격의 태세)", en: "Urshifu (Single Strike Style)" },
};

export async function build(): Promise<void> {
  const dex = readDex();
  const [speciesRows, formRows, formNameRows] = await Promise.all([
    csv("pokemon_species_names.csv", ["pokemon_species_id", "local_language_id", "name"]),
    csv("pokemon_forms.csv", ["id", "identifier", "is_default", "form_identifier"]),
    csv("pokemon_form_names.csv", ["pokemon_form_id", "local_language_id", "form_name", "pokemon_name"]),
  ]);

  // 종 번호 → { ko, en }
  const species: Record<number, Partial<NameEntry>> = {};
  for (const r of speciesRows) {
    const id = Number(r.pokemon_species_id);
    for (const lang of LANGS) if (r.local_language_id === LANG[lang] && r.name) (species[id] ??= {})[lang] = r.name;
  }
  // 폼 식별자 → 폼 번호 (기본 폼은 종 번호와 같은 번호라 폼 이름표를 쓸 필요가 없다)
  const formId: Record<string, number> = {};
  for (const r of formRows) if (r.is_default !== "1" || r.form_identifier) formId[r.identifier] = Number(r.id);
  // 폼 번호 → 언어별 { form, pokemon }
  const formNames: Record<number, Partial<Record<Lang, FormName>>> = {};
  for (const r of formNameRows) {
    const id = Number(r.pokemon_form_id);
    for (const lang of LANGS) {
      if (r.local_language_id !== LANG[lang]) continue;
      (formNames[id] ??= {})[lang] = { form: r.form_name || "", pokemon: r.pokemon_name || "" };
    }
  }

  // 폼 이름 고르기 — 종 이름을 품은 온전한 이름이 있으면 그것(히트로토무 · 알로라 라이츄 · Wash Rotom).
  // 포켓몬 이름 칸이 종 이름과 똑같으면(아르세우스 폼들의 한국어) 폼 이름을 뒤에 붙여 구분한다 — "아르세우스 불꽃"
  const pick = (lang: Lang, sp: Partial<NameEntry> | undefined, fn: Partial<Record<Lang, FormName>> | undefined): string => {
    const base = sp?.[lang] || "";
    const f = fn?.[lang];
    if (!f) return base;
    if (f.form && base && f.form.includes(base)) return f.form;
    if (f.pokemon && base && f.pokemon !== base && f.pokemon.includes(base)) return f.pokemon;
    if (f.pokemon && !base) return f.pokemon;
    return [base, f.form].filter(Boolean).join(" ").trim() || f.pokemon || base;
  };

  const out: Record<string, NameEntry> = {};
  const missing: string[] = [];
  for (const slug of Object.keys(dex).sort()) {
    const key = slug.replace(/-3d$/, "");
    if (out[key]) continue;
    const sp = species[dex[slug] ?? -1];
    const fid = key.includes("-") ? formId[key] : undefined;
    const fn = fid ? formNames[fid] : undefined;
    const form = regionalOf(key);
    const entry = (form ? { ko: form.ko, en: form.en } : undefined) ?? OVERRIDES[key] ?? { ko: pick("ko", sp, fn), en: pick("en", sp, fn) };
    if (!entry.ko || !entry.en) missing.push(key);
    if (entry.ko || entry.en) out[key] = entry;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`);
  process.stdout.write(`이름표: ${OUT} — ${Object.keys(out).length}종\n`);
  if (missing.length) process.stdout.write(`한쪽 언어가 빈 것 ${missing.length}: ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? " …" : ""}\n`);
  const formSlugs = Object.keys(out).filter((k) => k.includes("-"));
  process.stdout.write(`폼 슬러그 ${formSlugs.length} 예: ${formSlugs.slice(0, 12).map((k) => `${k}=${out[k]?.ko}/${out[k]?.en}`).join(" · ")}\n`);
}

if (require.main === module) runBuild(build);
