// 메가·원시회귀 모습의 배틀 값(data/mega-battle.json — 모습 슬러그 → 종족값 6개와 특성)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-mega-battle.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon_stats.csv       포켓몬 번호 → 종족값 (stat_id 1~6 = HP·공격·방어·특수공격·특수방어·스피드)
//   pokemon_abilities.csv   포켓몬 번호 → 특성 번호 (메가 모습은 특성이 하나)
//   abilities.csv           특성 번호 → 식별자 (data/abilities.json 의 키와 같다)
//
// 결과: { "<모습 슬러그>": { "stats": [hp, atk, def, spa, spd, spe], "ability": "<특성 id>", "baseAbility"?: true } }
//   - 모습 목록과 포켓몬 번호는 data/mega.json 의 forms 다. 그 파일은 손으로 고치므로 여기서 쓰지 않는다
//   - 메가 모습은 종이 아니다(src/dex/mega.ts). 메가 개체는 배틀·탐험에서 이 값으로 싸운다 (2026-10-08 사용자 결정)
//   - PokeAPI 에 특성이 없는 모습(레전드 Z-A 메가)은 기본 종(base)의 data/species-abilities.json 특성을 쓰고 baseAbility 를 적는다
//     (2026-10-08 사용자 결정 "제안대로"). PokeAPI 에 생기면 그쪽을 쓴다
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, csv, must, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "mega-battle.json");
const MEGA = path.join(DATA_DIR, "mega.json");
const SPECIES_ABILITIES = path.join(DATA_DIR, "species-abilities.json");

interface MegaBattle {
  stats: number[];
  ability: string;
  baseAbility?: true;
}

export async function build(): Promise<void> {
  const [statRows, abilityRows, abilityNames] = await Promise.all([
    csv("pokemon_stats.csv", ["pokemon_id", "stat_id", "base_stat"]),
    csv("pokemon_abilities.csv", ["pokemon_id", "ability_id", "slot"]),
    csv("abilities.csv", ["id", "identifier"]),
  ]);
  const forms = (JSON.parse(fs.readFileSync(MEGA, "utf8")) as { forms: Record<string, { base: string; pokemonId: number }> }).forms;
  const baseAbility = JSON.parse(fs.readFileSync(SPECIES_ABILITIES, "utf8")) as Record<string, string>;
  const abilityName = new Map(abilityNames.map((r) => [r.id, r.identifier]));

  // 포켓몬 번호 → 여섯 값 (stat_id 1~6 이 배열 자리 0~5)
  const sixOf = new Map<string, number[]>();
  for (const r of statRows) {
    const i = Number(r.stat_id) - 1;
    if (i < 0 || i > 5) continue;
    const six = sixOf.get(r.pokemon_id) ?? [0, 0, 0, 0, 0, 0];
    six[i] = Number(r.base_stat);
    sixOf.set(r.pokemon_id, six);
  }
  // 포켓몬 번호 → 슬롯이 가장 앞인 특성
  const firstAbility = new Map<string, { slot: number; id: string }>();
  for (const r of abilityRows) {
    const slot = Number(r.slot);
    if ((firstAbility.get(r.pokemon_id)?.slot ?? Infinity) <= slot) continue;
    firstAbility.set(r.pokemon_id, { slot, id: must(abilityName.get(r.ability_id), `특성 번호 ${r.ability_id}`) });
  }

  const out: Record<string, MegaBattle> = {};
  const fallback: string[] = [];
  for (const [slug, f] of Object.entries(forms)) {
    const no = String(f.pokemonId);
    const stats = sixOf.get(no);
    if (!stats || stats.some((v) => !v)) throw new Error(`종족값이 없다: ${slug} ${no}`);
    const hit = firstAbility.get(no);
    if (hit) out[slug] = { stats, ability: hit.id };
    else {
      out[slug] = { stats, ability: must(baseAbility[f.base], `기본 종 특성 ${f.base}`), baseAbility: true };
      fallback.push(slug);
    }
  }

  writeLineJson(OUT, out);
  process.stdout.write(`메가 배틀 값: ${OUT} — ${Object.keys(out).length}모습\n`);
  process.stdout.write(`기본 종 특성을 쓴 모습 ${fallback.length}${fallback.length ? `: ${fallback.join(", ")}` : ""}\n`);
  for (const k of ["charizard-mega-x", "charizard-mega-y"]) if (out[k]) process.stdout.write(`  ${k} ${JSON.stringify(out[k])}\n`);
}

if (require.main === module) runBuild(build);
