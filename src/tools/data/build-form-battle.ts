// 전투 중 모습이 바뀌는 종의 다른 모습 종족값(data/form-battle.json)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-form-battle.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon.csv        포켓몬 식별자 → 포켓몬 번호
//   pokemon_stats.csv  포켓몬 번호 → 종족값 (stat_id 1~6 = HP·공격·방어·특수공격·특수방어·스피드)
//
// 결과: { "<종 슬러그>": { "form": "<PokeAPI 모습 식별자>", "stats": [hp, atk, def, spa, spd, spe] } }
//   - 종 표(species.defaults.json)의 값은 기본 모습이다. 이 파일은 전투에서 바뀌는 다른 모습 하나다
//   - 규칙은 docs/specs/moves.md "모습이 바뀌는 종" — 언제 바뀌는지는 엔진(src/battle/engine.ts)이 정한다
import path from "node:path";
import { DATA_DIR, csv, must, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "form-battle.json");

// 종 슬러그 → 다른 모습의 PokeAPI 식별자
const FORMS: Readonly<Record<string, string>> = {
  aegislash: "aegislash-blade", // 실드폼 → 블레이드폼
  wishiwashi: "wishiwashi-school", // 단독의 모습 → 무리의 모습
  minior: "minior-red", // 유성의 모습 → 코어의 모습 (색은 능력치가 같다)
  palafin: "palafin-hero", // 나이브폼 → 마이티폼
  terapagos: "terapagos-terastal", // 노말폼 → 테라스탈폼
};

export async function build(): Promise<void> {
  const [pokemonRows, statRows] = await Promise.all([
    csv("pokemon.csv", ["id", "identifier"]),
    csv("pokemon_stats.csv", ["pokemon_id", "stat_id", "base_stat"]),
  ]);
  const idOf = new Map(pokemonRows.map((r) => [r.identifier, r.id]));
  const sixOf = new Map<string, number[]>();
  for (const r of statRows) {
    const i = Number(r.stat_id) - 1;
    if (i < 0 || i > 5) continue;
    const six = sixOf.get(r.pokemon_id) ?? [0, 0, 0, 0, 0, 0];
    six[i] = Number(r.base_stat);
    sixOf.set(r.pokemon_id, six);
  }

  const out: Record<string, { form: string; stats: number[] }> = {};
  for (const [species, form] of Object.entries(FORMS)) {
    const no = must(idOf.get(form), `포켓몬 식별자 ${form}`);
    const stats = sixOf.get(no);
    if (!stats || stats.some((v) => !v)) throw new Error(`종족값이 없다: ${form} ${no}`);
    out[species] = { form, stats };
  }

  writeLineJson(OUT, out);
  process.stdout.write(`모습 배틀 값: ${OUT} — ${Object.keys(out).length}종\n`);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`  ${k} ${v.form} ${JSON.stringify(v.stats)}\n`);
}

if (require.main === module) runBuild(build);
