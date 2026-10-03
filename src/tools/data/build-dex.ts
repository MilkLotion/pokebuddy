// 도감표(data/dex.json — 슬러그 → 전국도감 번호)를 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-dex.js   (npm run data:build 가 맨 먼저 돈다 — 다른 빌드가 이 표를 읽는다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon_species.csv   종 번호 → 종 식별자 (전국도감 전부)
//   pokemon.csv           포켓몬 식별자(폼 포함) → 종 번호
//   pokemon_forms.csv     폼 식별자(unown-b · burmy-sandy) → 포켓몬 번호
//
// 규칙
//   1. 모든 종 식별자를 넣는다 — 공식 도감에 새 종이 생기면 따라 늘어난다
//   2. 폼 슬러그는 지금 표가 고른 것을 남긴다(rotom-wash · arceus-fire …). 표가 폼 선택을 소유한다.
//      공식에서 찾을 수 없는 폼은 뺀다 — 번호는 늘 공식 값으로 다시 매긴다
//   3. 리전폼(data/regional.json forms)을 넣는다 — 번호는 pokemon.csv 의 종 번호. 공식에 없는 리전폼이 있으면 멈춘다
// 옛 표는 codex-pokepets 에서 뽑은 것이었다(1021번까지). 2026-09-25 에 PokeAPI 기준으로 바꿨다
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, csv, readDex, runBuild } from "./pokeapi-csv";
import { regionalSlugs } from "../../dex/regional";

const OUT = path.join(DATA_DIR, "dex.json");

export async function build(): Promise<void> {
  const [speciesRows, pokemonRows, formRows] = await Promise.all([
    csv("pokemon_species.csv", ["id", "identifier"]),
    csv("pokemon.csv", ["id", "identifier", "species_id"]),
    csv("pokemon_forms.csv", ["identifier", "pokemon_id"]),
  ]);
  const speciesOfPokemon = new Map(pokemonRows.map((r) => [r.id, Number(r.species_id)]));
  const official = new Map<string, number>();
  for (const r of pokemonRows) official.set(r.identifier, Number(r.species_id));
  for (const r of formRows) {
    const sp = speciesOfPokemon.get(r.pokemon_id);
    if (sp) official.set(r.identifier, sp);
  }

  const out: Record<string, number> = {};
  for (const r of speciesRows) out[r.identifier] = Number(r.id);
  const before = readDex();
  const dropped: string[] = [];
  let forms = 0;
  for (const slug of Object.keys(before)) {
    if (slug in out) continue;
    const sp = official.get(slug);
    if (sp == null) {
      dropped.push(slug);
      continue;
    }
    out[slug] = sp;
    forms++;
  }
  let regional = 0;
  for (const slug of regionalSlugs()) {
    const sp = official.get(slug);
    if (sp == null) throw new Error(`리전폼이 PokeAPI 에 없다: ${slug}`);
    if (!(slug in out)) forms++;
    out[slug] = sp;
    regional++;
  }

  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  fs.writeFileSync(OUT, `${JSON.stringify(sorted)}\n`);
  const added = Object.keys(out).filter((k) => !(k in before)).sort((a, b) => (out[a] ?? 0) - (out[b] ?? 0));
  const moved = Object.keys(before).filter((k) => k in out && out[k] !== before[k]);
  process.stdout.write(`도감표: ${OUT} — 종 ${speciesRows.length} · 폼 ${forms}(리전폼 ${regional}) · 합 ${Object.keys(out).length}\n`);
  process.stdout.write(`새로 넣은 슬러그 ${added.length}${added.length ? `: ${added.map((k) => `${k}(${out[k]})`).join(", ")}` : ""}\n`);
  process.stdout.write(`번호가 바뀐 슬러그 ${moved.length}${moved.length ? `: ${moved.join(", ")}` : ""}\n`);
  process.stdout.write(`공식에 없어 뺀 슬러그 ${dropped.length}${dropped.length ? `: ${dropped.join(", ")}` : ""}\n`);
}

if (require.main === module) runBuild(build);
