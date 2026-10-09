// 전투 중 모습이 바뀌는 종의 다른 모습 종족값(data/form-battle.json)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-form-battle.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon.csv        포켓몬 식별자 → 포켓몬 번호
//   pokemon_stats.csv  포켓몬 번호 → 종족값 (stat_id 1~6 = HP·공격·방어·특수공격·특수방어·스피드)
//   pokemon_types.csv  포켓몬 번호 → 타입 번호(slot 순서), types.csv 타입 번호 → 식별자
//
// 결과: { "<종 슬러그>": { "form": "<PokeAPI 모습 식별자>", "stats": [hp, atk, def, spa, spd, spe], "types": ["<타입>", …] } }
//   - 종 표(species.defaults.json)의 값은 기본 모습이다. 이 파일은 전투에서 바뀌는 다른 모습 하나다
//   - 규칙은 docs/specs/moves.md "모습이 바뀌는 종" — 언제 바뀌는지는 엔진(src/battle/engine.ts)이 정한다
import path from "node:path";
import { DATA_DIR, csv, must, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "form-battle.json");
// 다른 모습이 자기 기술 2개(species-moves.json 의 그 모습 칸)를 쓰는 종 — 표에 ownMoves: true 로 적는다
const OWN_MOVES: ReadonlySet<string> = new Set(["meloetta"]);

// 종 슬러그 → 다른 모습의 PokeAPI 식별자
const FORMS: Readonly<Record<string, string>> = {
  aegislash: "aegislash-blade", // 실드폼 → 블레이드폼
  wishiwashi: "wishiwashi-school", // 단독의 모습 → 무리의 모습
  minior: "minior-red", // 유성의 모습 → 코어의 모습 (색은 능력치가 같다)
  palafin: "palafin-hero", // 나이브폼 → 마이티폼
  terapagos: "terapagos-terastal", // 노말폼 → 테라스탈폼
  "darmanitan-galar-standard": "darmanitan-galar-zen", // 가라르 불비달마 → 달마모드 (얼음·불꽃)
  "greninja-battle-bond": "greninja-ash", // 유대변화 개굴닌자 → 지우개굴닌자 — 상대를 쓰러뜨리면 (2026-10-09, 지우의모자로 유대변화)
  zygarde: "zygarde-complete", // 지가르데 50% → 퍼펙트폼 — 스웜체인지, HP 50% 이하 (2026-10-09)
  darmanitan: "darmanitan-zen", // 하나 불비달마 → 달마모드 (불꽃·에스퍼) — 특성 달마모드는 species-abilities.json (2026-10-09 사용자 "줘야지")
  meloetta: "meloetta-pirouette", // 보이스폼 → 스텝폼 — 엔진은 루미나코러스(relic-song)를 쓸 때마다 오간다 (2026-10-09)
};

export async function build(): Promise<void> {
  const [pokemonRows, statRows, typeRows, typeNames] = await Promise.all([
    csv("pokemon.csv", ["id", "identifier"]),
    csv("pokemon_stats.csv", ["pokemon_id", "stat_id", "base_stat"]),
    csv("pokemon_types.csv", ["pokemon_id", "type_id", "slot"]),
    csv("types.csv", ["id", "identifier"]),
  ]);
  const typeName = new Map(typeNames.map((r) => [r.id, r.identifier]));
  const idOf = new Map(pokemonRows.map((r) => [r.identifier, r.id]));
  const sixOf = new Map<string, number[]>();
  for (const r of statRows) {
    const i = Number(r.stat_id) - 1;
    if (i < 0 || i > 5) continue;
    const six = sixOf.get(r.pokemon_id) ?? [0, 0, 0, 0, 0, 0];
    six[i] = Number(r.base_stat);
    sixOf.set(r.pokemon_id, six);
  }

  const out: Record<string, { form: string; stats: number[]; types: string[]; ownMoves?: true }> = {};
  for (const [species, form] of Object.entries(FORMS)) {
    const no = must(idOf.get(form), `포켓몬 식별자 ${form}`);
    const stats = sixOf.get(no);
    if (!stats || stats.some((v) => !v)) throw new Error(`종족값이 없다: ${form} ${no}`);
    const types = typeRows
      .filter((r) => r.pokemon_id === no)
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map((r) => must(typeName.get(r.type_id), `타입 번호 ${r.type_id}`));
    if (!types.length) throw new Error(`타입이 없다: ${form} ${no}`);
    out[species] = { form, stats, types, ...(OWN_MOVES.has(species) ? { ownMoves: true as const } : {}) };
  }

  writeLineJson(OUT, out);
  process.stdout.write(`모습 배틀 값: ${OUT} — ${Object.keys(out).length}종\n`);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`  ${k} ${v.form} ${JSON.stringify(v.stats)} ${v.types.join("/")}\n`);
}

if (require.main === module) runBuild(build);
