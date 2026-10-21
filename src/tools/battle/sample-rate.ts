// 샘플 파티 난이도 측정 — 샘플마다 기준 풀 파티와 N판을 싸워 승률을 잰다. 개발 도구이며 앱·서버에 들어가지 않는다
// 규칙은 docs/specs/adventure.md "샘플 파티"
//
//   npm run build && node dist/tools/battle/sample-rate.js [--n 200] [--seed 1] [--out <결과.json>]
//
// 기준 풀: 초전설·준전설 칸을 뺀 종 중 종족값 합 400 이상(모의 대전기 general 풀과 같다). 파티는 풀에서 서로 다른 6마리
// 판마다 샘플이 건 쪽(0)과 받은 쪽(1)을 번갈아 맡는다 — 쪽에 따른 치우침을 지운다. 무승부는 0.5승
// 리그: 샘플끼리 짝마다 --league 판(기본 10). 기준 승률이 100% 근처로 몰리는 상 난이도 안의 순서를 본다
// 수용: 기준·리그 승률 모두 상 최솟값 > 중 중앙값, 중 최솟값 > 하 중앙값. 어기면 종료 코드 1
import fs from "node:fs";
import { runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { battleSamples, SAMPLE_LEVELS, type SampleLevel } from "../../battle/samples";
import { tierOf } from "../../battle/tier";
import { isMetaKey } from "../../dex/data";
import { profileOf } from "../../dex/species";
import { speciesMoveTable, speciesTable } from "../../dex/tables";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const N = Number(arg("n", "200"));
const SEED = Number(arg("seed", "1"));
const OUT = arg("out", "");

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
  if ((profileOf(slug).bst ?? 0) < 400 || tierOf(slug)) continue;
  const f = buildFighter({ species: slug });
  if (f) pool.push(f);
}

const chart = battleTypeChart();
const rand = mulberry32(SEED);
// 기준 파티 N개 — 모든 샘플이 같은 상대들과 싸운다
const refs: EngineFighter[][] = Array.from({ length: N }, () => {
  const team = new Set<EngineFighter>();
  while (team.size < 6) team.add(pool[Math.floor(rand() * pool.length)]!);
  return [...team];
});

interface Row {
  id: string;
  level: SampleLevel;
  name: string;
  rate: number; // 기준 풀 승률 0~1
  league: number; // 리그 승률 0~1 — 나머지 샘플 상대
  timeouts: number;
}
const rows: Row[] = [];
for (const s of battleSamples()) {
  const team = s.slots.map((c) => buildFighter(c));
  let win = 0;
  let timeouts = 0;
  refs.forEach((ref, i) => {
    const mine = i % 2 === 0 ? 0 : 1;
    const sides = mine === 0 ? ([team, ref] as const) : ([ref, team] as const);
    const r = runBattle({ seed: SEED * 100_003 + i, sides: [...sides], typeChart: chart });
    if (r.timeout) timeouts++;
    win += r.winner === null ? 0.5 : r.winner === mine ? 1 : 0;
  });
  rows.push({ id: s.id, level: s.level, name: s.name, rate: win / N, league: 0, timeouts });
}

// 리그 — 샘플끼리 짝마다 LEAGUE 판(쪽을 번갈아). 기준 풀 승률이 100% 근처로 몰리는 상 난이도 안의 순서를 본다
const LEAGUE = Number(arg("league", "10"));
const teams = battleSamples().map((s) => s.slots.map((c) => buildFighter(c)));
const league = rows.map(() => 0);
for (let a = 0; a < teams.length; a++)
  for (let b = a + 1; b < teams.length; b++)
    for (let k = 0; k < LEAGUE; k++) {
      const flip = k % 2 === 1;
      const r = runBattle({ seed: SEED * 7_919 + a * 1_000 + b * 10 + k, sides: flip ? [teams[b]!, teams[a]!] : [teams[a]!, teams[b]!], typeChart: chart });
      const aSide = flip ? 1 : 0;
      const aWin = r.winner === null ? 0.5 : r.winner === aSide ? 1 : 0;
      league[a]! += aWin;
      league[b]! += 1 - aWin;
    }
const leagueRate = (i: number): number => league[i]! / ((teams.length - 1) * LEAGUE);

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
};
rows.forEach((r, i) => (r.league = leagueRate(i)));
type Stat = Record<SampleLevel, { min: number; median: number; max: number }>;
const statOf = (key: "rate" | "league"): Stat => {
  const out = {} as Stat;
  for (const level of SAMPLE_LEVELS) {
    const xs = rows.filter((r) => r.level === level).map((r) => r[key]);
    out[level] = { min: Math.min(...xs), median: median(xs), max: Math.max(...xs) };
  }
  return out;
};
const stat = { rate: statOf("rate"), league: statOf("league") };

process.stdout.write(`기준 풀 ${pool.length}종 · 샘플마다 ${N}판 · 리그 짝마다 ${LEAGUE}판 · 시드 ${SEED}\n\n`);
process.stdout.write(`${"id".padEnd(10)} ${"기준".padStart(6)} ${"리그".padStart(6)}  90초\n`);
for (const r of [...rows].sort((a, b) => b.league - a.league)) process.stdout.write(`${r.id.padEnd(10)} ${pct(r.rate).padStart(6)} ${pct(r.league).padStart(6)}  ${String(r.timeouts).padStart(3)}  ${r.name}\n`);
process.stdout.write("\n");
const misses: string[] = [];
for (const key of ["rate", "league"] as const) {
  const s = stat[key];
  const label = key === "rate" ? "기준" : "리그";
  for (const level of SAMPLE_LEVELS) process.stdout.write(`${label} ${level.padEnd(6)} 최소 ${pct(s[level].min)} · 중앙 ${pct(s[level].median)} · 최대 ${pct(s[level].max)}\n`);
  for (const r of rows) {
    if (r.level === "hard" && r[key] <= s.normal.median) misses.push(`${label}: ${r.id} 이 중 중앙값 이하`);
    if (r.level === "normal" && r[key] <= s.easy.median) misses.push(`${label}: ${r.id} 이 하 중앙값 이하`);
  }
}
process.stdout.write(misses.length ? `\n수용 실패 ${misses.length}건\n${misses.map((m) => `- ${m}`).join("\n")}\n` : "\n수용 통과\n");
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ n: N, seed: SEED, pool: pool.length, stat, rows }, null, 2) + "\n");
if (misses.length) process.exitCode = 1;
