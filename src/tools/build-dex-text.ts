// 도감 설명(data/dex-text.json — 종별 분류와 설명문)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/build-dex-text.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon_species_names.csv         종 번호 → 언어별 분류(genus — "쥐포켓몬" · "Mouse Pokémon")
//   pokemon_species_flavor_text.csv   종 번호 · 버전 → 언어별 설명문. 언어마다 가장 최근 버전의 문장을 쓴다
//   pokemon.csv                       기본 모습(is_default)의 키(데시미터)·몸무게(헥토그램) — 도감 기기 창 (docs/work/play-bugs/record.md)
//
// 결과: { "<도감 번호>": { "genus": { "ko", "en" }, "flavor": { "ko"?, "en"? }, "height"?, "weight"? } }
//   - 한국어 설명문은 898번까지만 있다(2026-09-25 확인). 없으면 ko 칸을 두지 않는다 — 화면이 영어로 대신한다
//   - 설명문의 줄바꿈·쪽바꿈 문자는 빈칸 하나로 바꾼다
import path from "node:path";
import { DATA_DIR, csv, readDex, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "dex-text.json");
const LANG = { ko: "3", en: "9" } as const;
type Lang = keyof typeof LANG;

interface DexText {
  genus: Partial<Record<Lang, string>>;
  flavor: Partial<Record<Lang, string>>;
  height?: number; // 데시미터 — 11 이면 1.1m
  weight?: number; // 헥토그램 — 190 이면 19.0kg
}

const clean = (text: string): string => text.replace(/[\s\u000c­]+/g, " ").trim();

export async function build(): Promise<void> {
  const [nameRows, flavorRows, bodyRows] = await Promise.all([
    csv("pokemon_species_names.csv", ["pokemon_species_id", "local_language_id", "genus"]),
    csv("pokemon_species_flavor_text.csv", ["species_id", "version_id", "language_id", "flavor_text"]),
    csv("pokemon.csv", ["species_id", "height", "weight", "is_default"]),
  ]);
  const wanted = new Set(Object.values(readDex()));
  const out: Record<string, DexText> = {};
  const entry = (id: string): DexText => (out[id] ??= { genus: {}, flavor: {} });

  for (const r of nameRows) {
    if (!wanted.has(Number(r.pokemon_species_id)) || !r.genus) continue;
    for (const lang of Object.keys(LANG) as Lang[]) if (r.local_language_id === LANG[lang]) entry(r.pokemon_species_id).genus[lang] = r.genus;
  }
  // 언어마다 가장 큰 버전 번호(가장 최근 게임)의 문장
  const latest = new Map<string, number>();
  for (const r of flavorRows) {
    if (!wanted.has(Number(r.species_id)) || !r.flavor_text) continue;
    for (const lang of Object.keys(LANG) as Lang[]) {
      if (r.language_id !== LANG[lang]) continue;
      const key = `${r.species_id}:${lang}`;
      const version = Number(r.version_id);
      if ((latest.get(key) ?? -1) >= version) continue;
      latest.set(key, version);
      entry(r.species_id).flavor[lang] = clean(r.flavor_text);
    }
  }

  for (const r of bodyRows) {
    if (r.is_default !== "1" || !wanted.has(Number(r.species_id))) continue;
    const e = entry(r.species_id);
    if (r.height) e.height = Number(r.height);
    if (r.weight) e.weight = Number(r.weight);
  }

  const sorted = Object.fromEntries(Object.keys(out).sort((a, b) => Number(a) - Number(b)).map((k) => [k, out[k]]));
  writeLineJson(OUT, sorted);
  const all = Object.values(out);
  const count = (f: (t: DexText) => unknown): number => all.filter(f).length;
  process.stdout.write(`도감 설명: ${OUT} — ${all.length}종\n`);
  process.stdout.write(`분류 한국어 ${count((t) => t.genus.ko)} · 영어 ${count((t) => t.genus.en)} / 설명 한국어 ${count((t) => t.flavor.ko)} · 영어 ${count((t) => t.flavor.en)}\n`);
  process.stdout.write(`키 ${count((t) => t.height)} · 몸무게 ${count((t) => t.weight)}
`);
  process.stdout.write(`  25 ${JSON.stringify(out["25"])}\n`);
}

if (require.main === module) runBuild(build);
