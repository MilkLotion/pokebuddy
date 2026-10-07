// 타입 상성표(data/type-chart.json)를 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-type-chart.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   types.csv           타입 번호 → 식별자
//   type_efficacy.csv   공격 타입 번호 · 방어 타입 번호 → 배율(damage_factor, 백분율)
//
// 결과: { "<공격 타입>": { "<방어 타입>": 배율 } } — 배율은 0 · 0.5 · 1 · 2. 18타입 × 18타입을 빠짐없이 둔다
//   - 원작 18타입만 쓴다. PokeAPI 의 stellar·unknown·shadow 는 뺀다
//   - 두 타입 방어는 두 배율을 곱한다(docs/specs/moves.md "피해") — 표에는 한 타입씩만 둔다
import path from "node:path";
import { DATA_DIR, csv, must, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "type-chart.json");

// 원작 18타입 — 표의 키 순서
export const TYPES = ["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"] as const;

export async function build(): Promise<void> {
  const [typeRows, effRows] = await Promise.all([
    csv("types.csv", ["id", "identifier"]),
    csv("type_efficacy.csv", ["damage_type_id", "target_type_id", "damage_factor"]),
  ]);
  const nameOf = new Map(typeRows.map((r) => [r.id, r.identifier]));
  const wanted = new Set<string>(TYPES);

  const found = new Map<string, number>();
  for (const r of effRows) {
    const atk = nameOf.get(r.damage_type_id);
    const def = nameOf.get(r.target_type_id);
    if (!atk || !def || !wanted.has(atk) || !wanted.has(def)) continue;
    found.set(`${atk}>${def}`, Number(r.damage_factor) / 100);
  }

  const out: Record<string, Record<string, number>> = {};
  for (const atk of TYPES) {
    out[atk] = {};
    for (const def of TYPES) {
      const v = must(found.get(`${atk}>${def}`), `상성 ${atk} → ${def}`);
      if (![0, 0.5, 1, 2].includes(v)) throw new Error(`상성 ${atk} → ${def} 배율이 ${v}`);
      out[atk][def] = v;
    }
  }

  writeLineJson(OUT, out);
  const count = new Map<number, number>();
  for (const row of Object.values(out)) for (const v of Object.values(row)) count.set(v, (count.get(v) ?? 0) + 1);
  process.stdout.write(`타입 상성: ${OUT} — ${TYPES.length} × ${TYPES.length}\n`);
  process.stdout.write(`배율: ${[...count].sort((a, b) => a[0] - b[0]).map(([k, v]) => `×${k} ${v}`).join(" · ")}\n`);
  process.stdout.write(`  fire ${JSON.stringify(out.fire)}\n`);
}

if (require.main === module) runBuild(build);
