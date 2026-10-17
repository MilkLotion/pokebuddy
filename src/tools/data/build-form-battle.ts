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
// 성별로 능력치·특성이 다른 종의 암컷 배틀 값(data/gender-battle.json) — 종 표에 넣지 않는다(성별 그림은 종이 아니다, 2026-10-17 사용자 "6 성별 능력치")
const GENDER_OUT = path.join(DATA_DIR, "gender-battle.json");
// 종 슬러그 → 암컷의 PokeAPI 식별자와 특성. 특성은 손으로 고른다 — 냐오닉스 암컷은 원작의 숨은 특성 승기, 나머지는 종 특성 그대로(data/species-abilities.json)
const FEMALE: Readonly<Record<string, { form: string; ability: string }>> = {
  meowstic: { form: "meowstic-female", ability: "competitive" },
  indeedee: { form: "indeedee-female", ability: "psychic-surge" },
  basculegion: { form: "basculegion-female", ability: "adaptability" },
  oinkologne: { form: "oinkologne-female", ability: "lingering-aroma" },
};
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
  "zygarde-10": "zygarde-complete", // 지가르데 10% → 퍼펙트폼 — 50%와 같은 스웜체인지 (2026-10-17 모습 바꾸기로 10%폼을 더함)
  eiscue: "eiscue-noice", // 아이스페이스 → 나이스페이스 — 물리 기술에 얼음 얼굴이 깨지면 (2026-10-17 사용자 "5 전투 중 그림")
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

  // 포켓몬 식별자 → 종족값·타입
  const rowOf = (form: string): { stats: number[]; types: string[] } => {
    const no = must(idOf.get(form), `포켓몬 식별자 ${form}`);
    const stats = sixOf.get(no);
    if (!stats || stats.some((v) => !v)) throw new Error(`종족값이 없다: ${form} ${no}`);
    const types = typeRows
      .filter((r) => r.pokemon_id === no)
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map((r) => must(typeName.get(r.type_id), `타입 번호 ${r.type_id}`));
    if (!types.length) throw new Error(`타입이 없다: ${form} ${no}`);
    return { stats, types };
  };
  const out: Record<string, { form: string; stats: number[]; types: string[]; ownMoves?: true }> = {};
  for (const [species, form] of Object.entries(FORMS)) out[species] = { form, ...rowOf(form), ...(OWN_MOVES.has(species) ? { ownMoves: true as const } : {}) };
  const female: Record<string, { form: string; stats: number[]; types: string[]; ability: string }> = {};
  for (const [species, v] of Object.entries(FEMALE)) female[species] = { form: v.form, ...rowOf(v.form), ability: v.ability };
  writeLineJson(GENDER_OUT, female);
  process.stdout.write(`암컷 배틀 값: ${GENDER_OUT} — ${Object.keys(female).length}종
`);

  writeLineJson(OUT, out);
  process.stdout.write(`모습 배틀 값: ${OUT} — ${Object.keys(out).length}종\n`);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`  ${k} ${v.form} ${JSON.stringify(v.stats)} ${v.types.join("/")}\n`);
}

if (require.main === module) runBuild(build);
