// 모의 대전기 — 배틀 엔진을 여러 판 돌려 집계한다. 개발 도구이며 앱·서버에 들어가지 않는다 (docs/specs/adventure.md "모의 대전기")
//
//   npm run build && node dist/tools/battle/sim-battle.js [--n 3000] [--seed 1] [--pool general|all] [--top 15]
//
// 풀: general = 초전설·준전설 칸을 뺀 종 중 종족값 합 400 이상 / all = 종족값 합 400 이상 전부
// 파티: 풀에서 6마리를 무작위로 고른다(겹칠 수 있다). 출전 제한·메가는 보지 않는다
// 집계: 판 길이 분포, 90초 도달 비율, 평타·기술 피해 몫, 마리당 기술 사용, 스피드 5분위 승률, 종별 승률 상하위
import { runBattle, type BattleEvent, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { tierOf } from "../../battle/tier";
import { isMetaKey } from "../../dex/data";
import { speciesMoveTable, speciesTable } from "../../dex/tables";
import { profileOf } from "../../dex/species";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const N = Number(arg("n", "3000"));
const SEED = Number(arg("seed", "1"));
const POOL = arg("pool", "general");
const TOP = Number(arg("top", "15"));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const moves = speciesMoveTable();
const pool: EngineFighter[] = [];
for (const slug of Object.keys(speciesTable())) {
  if (isMetaKey(slug) || !moves[slug]) continue;
  const bst = profileOf(slug).bst ?? 0;
  if (bst < 400) continue;
  if (POOL === "general" && tierOf(slug)) continue;
  const f = buildFighter({ species: slug, level: 100 });
  if (f) pool.push(f);
}

const chart = battleTypeChart();
const rand = mulberry32(SEED);
const pick = (): EngineFighter[] => Array.from({ length: 6 }, () => pool[Math.floor(rand() * pool.length)]!);

const bySpeed = [...pool].sort((a, b) => a.stats[5]! - b.stats[5]!);
const quintile = new Map(bySpeed.map((f, i) => [f, Math.min(4, Math.floor((i * 5) / bySpeed.length))]));
const q = [0, 0, 0, 0, 0].map(() => ({ win: 0, n: 0 }));
const species = new Map<string, { win: number; n: number }>();
const byRange = new Map<number, { win: number; n: number }>();
const lens: number[] = [];
let timeouts = 0, draws = 0, basic = 0, skill = 0, uses = 0, fighters = 0;

for (let i = 0; i < N; i++) {
  const sides = [pick(), pick()] as const;
  const r = runBattle({ seed: SEED * 100_003 + i, sides, typeChart: chart });
  lens.push(r.endMs);
  if (r.timeout) timeouts++;
  if (r.winner === null) draws++;
  for (const e of r.events as BattleEvent[]) {
    if (e.kind === "damage") e.source === "basic" ? (basic += e.amount) : (skill += e.amount);
    if (e.kind === "move") uses++;
  }
  sides.forEach((team, s) =>
    team.forEach((f) => {
      fighters++;
      const won = r.winner === s ? 1 : 0;
      const qq = q[quintile.get(f)!]!;
      qq.n++;
      qq.win += won;
      const row = species.get(f.species) ?? { win: 0, n: 0 };
      row.n++;
      row.win += won;
      species.set(f.species, row);
      const rr = byRange.get(f.range) ?? { win: 0, n: 0 };
      rr.n++;
      rr.win += won;
      byRange.set(f.range, rr);
    }),
  );
}

lens.sort((a, b) => a - b);
const at = (p: number): string => (lens[Math.floor(lens.length * p)]! / 1000).toFixed(1);
const pct = (a: number, b: number): string => `${((100 * a) / Math.max(1, b)).toFixed(0)}%`;
const out: string[] = [];
out.push(`풀 ${POOL} ${pool.length}종 · ${N}판 · 시드 ${SEED}`);
out.push(`판 길이 p10 ${at(0.1)} · p25 ${at(0.25)} · 중앙 ${at(0.5)} · p75 ${at(0.75)} · p90 ${at(0.9)}초`);
out.push(`90초 도달 ${pct(timeouts, N)} · 무승부 ${pct(draws, N)}`);
out.push(`평타 피해 몫 ${pct(basic, basic + skill)} · 마리당 기술 사용 ${(uses / fighters).toFixed(1)}번`);
out.push(`스피드 5분위 승률(느림→빠름) ${q.map((x) => pct(x.win, x.n)).join(" / ")} · 경계 ${[0.2, 0.4, 0.6, 0.8].map((x) => bySpeed[Math.floor(bySpeed.length * x)]!.stats[5]).join(", ")}`);
out.push(`사거리별 승률: ${[...byRange.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k === 1 ? "근접" : "원거리"} ${pct(v.win, v.n)} (${pool.filter((f) => f.range === k).length}종)`).join(" · ")}`);
const ranked = [...species.entries()].filter(([, v]) => v.n >= 30).map(([k, v]) => ({ k, rate: v.win / v.n, n: v.n })).sort((a, b) => b.rate - a.rate);
out.push(`종별 승률 상위: ${ranked.slice(0, TOP).map((x) => `${x.k} ${(x.rate * 100).toFixed(0)}%`).join(", ")}`);
out.push(`종별 승률 하위: ${ranked.slice(-TOP).map((x) => `${x.k} ${(x.rate * 100).toFixed(0)}%`).join(", ")}`);
process.stdout.write(out.join("\n") + "\n");
