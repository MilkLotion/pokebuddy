// 효과 A/B 모의 대전 — 같은 파티·같은 시드로 특성·상태 이상을 켜고 끈 승률 차를 잰다. 개발 도구이며 앱·서버에 들어가지 않는다
//
//   npm run build && node dist/tools/battle/effect-ab.js [--n 2000] [--from 0] [--seed 1] [--pool general|all] [--raw out.json]
//   node dist/tools/battle/effect-ab.js --merge a.json b.json ...   # 나눠 돌린 원자료를 합쳐 보고서를 낸다
//
// 판마다 같은 파티·같은 판 시드로 세 번 돌린다
//   A: 그대로 · B: 모든 개체 ability null · C: 모든 기술의 effects.status·flinch 를 지운 것
// 등장 하나의 점수는 승 1 · 무 0.5 · 패 0. d = 점수(A) − 점수(B 또는 C)
// 특성 효과 = 그 특성을 가진 종 등장의 d 평균. 상태 효과 = 그 상태를 거는 기술이 있는 종 등장의 d 평균
// 95% 구간 = ±1.96 × sd / √n (판 안 상관은 보지 않는다). 엔진·데이터는 바꾸지 않고 개체 복사본만 바꾼다
// 요청: battle-261008 · ability-261008 세션 (2026-10-09). 결과: worklog/records/battle-server/evidence/effect-ab-*.txt
import fs from "node:fs";
import { runBattle, type EngineFighter, type EngineMove, type StatusKind } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { tierOf } from "../../battle/tier";
import { isMetaKey } from "../../dex/data";
import { abilityTable, speciesMoveTable, speciesTable } from "../../dex/tables";
import { profileOf } from "../../dex/species";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 종 하나의 누적 — n 등장, a·b·c 점수 합, 차의 합·제곱합
interface Acc { n: number; a: number; b: number; c: number; dab: number; dab2: number; dac: number; dac2: number }
interface Raw { pool: string; seed: number; battles: number; species: Record<string, Acc>; len: [number, number, number]; timeout: [number, number, number] }

const zero = (): Acc => ({ n: 0, a: 0, b: 0, c: 0, dab: 0, dab2: 0, dac: 0, dac2: 0 });
const add = (x: Acc, y: Acc): void => {
  for (const k of Object.keys(x) as (keyof Acc)[]) x[k] += y[k];
};

const STATUS_KO: Readonly<Partial<Record<StatusKind, string>>> = { burn: "화상", paralysis: "마비", poison: "독", toxic: "맹독", freeze: "얼음", sleep: "잠듦", confusion: "혼란", flinch: "풀죽음" };

// 개체가 기술로 거는 상태 — effects.status 의 kind(목록이면 전부)와 flinch
function statusKinds(f: EngineFighter): Map<StatusKind, number> {
  const out = new Map<StatusKind, number>(); // 상태 → 가장 높은 확률
  for (const m of f.moves) {
    const st = m.effects.status;
    if (st) for (const k of Array.isArray(st.kind) ? st.kind : [st.kind as StatusKind]) out.set(k, Math.max(out.get(k) ?? 0, st.chance));
    if (m.effects.flinch) out.set("flinch", Math.max(out.get("flinch") ?? 0, m.effects.flinch));
  }
  return out;
}

function buildPool(poolName: string): EngineFighter[] {
  const moves = speciesMoveTable();
  const pool: EngineFighter[] = [];
  for (const slug of Object.keys(speciesTable())) {
    if (isMetaKey(slug) || !moves[slug]) continue;
    if ((profileOf(slug).bst ?? 0) < 400) continue;
    if (poolName === "general" && tierOf(slug)) continue;
    const f = buildFighter({ species: slug, level: 100 });
    if (f) pool.push(f);
  }
  return pool;
}

function simulate(): Raw {
  const N = Number(arg("n", "2000"));
  const FROM = Number(arg("from", "0"));
  const SEED = Number(arg("seed", "1"));
  const POOL = arg("pool", "general");
  const pool = buildPool(POOL);
  const noAbility = new Map(pool.map((f) => [f, { ...f, ability: null }]));
  const stripMove = (m: EngineMove): EngineMove => {
    const { status: _s, flinch: _f, ...rest } = m.effects;
    return { ...m, effects: rest };
  };
  const noStatus = new Map(pool.map((f) => [f, { ...f, moves: f.moves.map(stripMove) }]));
  const chart = battleTypeChart();
  const raw: Raw = { pool: POOL, seed: SEED, battles: 0, species: {}, len: [0, 0, 0], timeout: [0, 0, 0] };
  const score = (w: 0 | 1 | null, s: 0 | 1): number => (w === null ? 0.5 : w === s ? 1 : 0);

  for (let i = FROM; i < FROM + N; i++) {
    const rand = mulberry32(SEED * 1_000_003 + i); // 판 번호로 파티를 뽑는다 — 나눠 돌려도 같은 판
    const pick = (): EngineFighter[] => Array.from({ length: 6 }, () => pool[Math.floor(rand() * pool.length)]!);
    const sides = [pick(), pick()] as const;
    const seed = SEED * 100_003 + i;
    const rs = [
      runBattle({ seed, sides, typeChart: chart }),
      runBattle({ seed, sides: [sides[0].map((f) => noAbility.get(f)!), sides[1].map((f) => noAbility.get(f)!)], typeChart: chart }),
      runBattle({ seed, sides: [sides[0].map((f) => noStatus.get(f)!), sides[1].map((f) => noStatus.get(f)!)], typeChart: chart }),
    ];
    raw.battles++;
    rs.forEach((r, v) => {
      raw.len[v] = raw.len[v]! + r.endMs;
      if (r.timeout) raw.timeout[v] = raw.timeout[v]! + 1;
    });
    sides.forEach((team, s) =>
      team.forEach((f) => {
        const [a, b, c] = rs.map((r) => score(r.winner as 0 | 1 | null, s as 0 | 1)) as [number, number, number];
        const row = (raw.species[f.species] ??= zero());
        row.n++;
        row.a += a;
        row.b += b;
        row.c += c;
        row.dab += a - b;
        row.dab2 += (a - b) ** 2;
        row.dac += a - c;
        row.dac2 += (a - c) ** 2;
      }),
    );
  }
  return raw;
}

// 차의 평균과 95% 구간 반폭(%p)
function stat(n: number, sum: number, sum2: number): { mean: number; ci: number } {
  const mean = sum / Math.max(1, n);
  const v = n > 1 ? (sum2 - n * mean * mean) / (n - 1) : 0;
  return { mean: mean * 100, ci: (1.96 * Math.sqrt(Math.max(0, v) / Math.max(1, n))) * 100 };
}
const fmt = (x: { mean: number; ci: number }): string => `${x.mean >= 0 ? "+" : ""}${x.mean.toFixed(1)} ±${x.ci.toFixed(1)}`;

function report(raw: Raw): string {
  const pool = buildPool(raw.pool);
  const abil = abilityTable() as Record<string, { ko?: string; group?: string; when?: string }>;
  const out: string[] = [];
  const B = raw.battles;
  out.push(`효과 A/B 모의 대전 — 풀 ${raw.pool} ${pool.length}종 · ${B}판 × 3(A 그대로 · B 특성 끔 · C 기술 상태 이상·풀죽음 끔) · 시드 ${raw.seed}`);
  out.push(`값 = 점수(A) − 점수(B 또는 C), %p. 점수는 승 1·무 0.5·패 0. ± 는 95% 구간(등장 단위, 판 안 상관 무시)`);
  out.push(`판 길이 평균 A ${(raw.len[0] / B / 1000).toFixed(1)}초 · B ${(raw.len[1] / B / 1000).toFixed(1)}초 · C ${(raw.len[2] / B / 1000).toFixed(1)}초`);
  out.push(`90초 도달 A ${raw.timeout[0]} · B ${raw.timeout[1]} · C ${raw.timeout[2]}판`);
  const flip = Object.values(raw.species).reduce((s, r) => s + r.dab2, 0) / Object.values(raw.species).reduce((s, r) => s + r.n, 0);
  const flipC = Object.values(raw.species).reduce((s, r) => s + r.dac2, 0) / Object.values(raw.species).reduce((s, r) => s + r.n, 0);
  out.push(`결과가 바뀐 비율(등장 기준 d² 평균) A↔B ${(flip * 100).toFixed(0)}% · A↔C ${(flipC * 100).toFixed(0)}%`);

  // ── 1. 특성 ──
  const byAbility = new Map<string, { acc: Acc; species: string[] }>();
  const byGroup = new Map<string, { acc: Acc; species: string[] }>();
  for (const f of pool) {
    const r = raw.species[f.species];
    if (!r) continue;
    const key = f.ability ?? "(없음)";
    const row = byAbility.get(key) ?? { acc: zero(), species: [] };
    add(row.acc, r);
    row.species.push(f.species);
    byAbility.set(key, row);
    const g = f.ability ? `${abil[f.ability]?.group ?? "?"}/${abil[f.ability]?.when ?? "?"}` : "(없음)";
    const gr = byGroup.get(g) ?? { acc: zero(), species: [] };
    add(gr.acc, r);
    gr.species.push(f.species);
    byGroup.set(g, gr);
  }
  const abName = (k: string): string => `${abil[k]?.ko ?? k}(${k})`;
  const abRows = [...byAbility.entries()].map(([k, v]) => ({ k, s: stat(v.acc.n, v.acc.dab, v.acc.dab2), n: v.acc.n, sp: v.species.length, when: abil[k]?.when ?? "-" }));
  abRows.sort((x, y) => y.s.mean - x.s.mean);
  const sig = (s: { mean: number; ci: number }): string => (Math.abs(s.mean) > s.ci ? " *" : "");
  out.push("");
  out.push(`## 1. 특성 효과 (A − B). * = 95% 구간이 0 을 넘지 않음`);
  out.push(`### 특성별 — 등장 400 이상 (${abRows.filter((x) => x.n >= 400).length}개)`);
  for (const x of abRows.filter((r) => r.n >= 400)) out.push(`${fmt(x.s)}${sig(x.s)}\t${abName(x.k)}\t${x.when}\t${x.sp}종 ${x.n}등장`);
  out.push(`### 묶음(group/when) — 모든 특성 포함`);
  const gRows = [...byGroup.entries()].map(([k, v]) => ({ k, s: stat(v.acc.n, v.acc.dab, v.acc.dab2), n: v.acc.n, sp: v.species.length })).sort((x, y) => y.s.mean - x.s.mean);
  for (const x of gRows) out.push(`${fmt(x.s)}${sig(x.s)}\t${x.k}\t${x.sp}종 ${x.n}등장`);
  out.push(`### 표본 적은 특성(등장 400 미만) — 참고만`);
  for (const x of abRows.filter((r) => r.n < 400)) out.push(`${fmt(x.s)}\t${abName(x.k)}\t${x.when}\t${x.sp}종 ${x.n}등장`);

  // ── 2. 상태 이상 ──
  out.push("");
  out.push(`## 2. 기술 상태 이상·풀죽음 효과 (A − C). 종의 기술이 그 상태를 걸면 그 종 등장을 넣는다(여러 상태면 여러 줄에 들어간다)`);
  const kinds = Object.keys(STATUS_KO) as StatusKind[];
  const none = zero();
  const noneSp: string[] = [];
  const byKind = new Map<StatusKind, { acc: Acc; species: { k: string; chance: number }[] }>();
  for (const f of pool) {
    const r = raw.species[f.species];
    if (!r) continue;
    const ks = statusKinds(f);
    if (!ks.size) {
      add(none, r);
      noneSp.push(f.species);
    }
    for (const [k, chance] of ks) {
      const row = byKind.get(k) ?? { acc: zero(), species: [] };
      add(row.acc, r);
      row.species.push({ k: f.species, chance });
      byKind.set(k, row);
    }
  }
  const kRows = kinds.filter((k) => byKind.has(k)).map((k) => ({ k, v: byKind.get(k)!, s: stat(byKind.get(k)!.acc.n, byKind.get(k)!.acc.dac, byKind.get(k)!.acc.dac2) })).sort((x, y) => y.s.mean - x.s.mean);
  for (const x of kRows) out.push(`${fmt(x.s)}${sig(x.s)}\t${STATUS_KO[x.k]}(${x.k})\t${x.v.species.length}종 ${x.v.acc.n}등장`);
  out.push(`${fmt(stat(none.n, none.dac, none.dac2))}\t(기술 상태 없음 — 대조군)\t${noneSp.length}종 ${none.n}등장`);
  out.push(`### 상태별 종 — 차 큰 순(등장 n, 기술 확률 최대)`);
  for (const x of kRows) {
    const list = x.v.species
      .map((sp) => ({ ...sp, s: stat(raw.species[sp.k]!.n, raw.species[sp.k]!.dac, raw.species[sp.k]!.dac2), n: raw.species[sp.k]!.n }))
      .sort((p, q) => q.s.mean - p.s.mean);
    out.push(`${STATUS_KO[x.k]}: ${list.map((p) => `${p.k} ${p.s.mean >= 0 ? "+" : ""}${p.s.mean.toFixed(0)}(${p.n}, ${p.chance}%)`).join(", ")}`);
  }

  // ── 3. 종별 상하위 (참고) ──
  const spRows = Object.entries(raw.species).map(([k, r]) => ({ k, ab: stat(r.n, r.dab, r.dab2), ac: stat(r.n, r.dac, r.dac2), n: r.n }));
  out.push("");
  out.push(`## 3. 종별 상하위 (참고, 종 단위 ± 는 대개 ${spRows.length ? spRows[0]!.ab.ci.toFixed(0) : "?"}%p 안팎)`);
  const top = (key: "ab" | "ac", lo: boolean): string =>
    [...spRows].sort((x, y) => (lo ? x[key].mean - y[key].mean : y[key].mean - x[key].mean)).slice(0, 15).map((x) => `${x.k} ${fmt(x[key])}`).join(", ");
  out.push(`특성 A−B 상위: ${top("ab", false)}`);
  out.push(`특성 A−B 하위: ${top("ab", true)}`);
  out.push(`상태 A−C 상위: ${top("ac", false)}`);
  out.push(`상태 A−C 하위: ${top("ac", true)}`);
  return out.join("\n") + "\n";
}

const mergeAt = process.argv.indexOf("--merge");
if (mergeAt >= 0) {
  const files = process.argv.slice(mergeAt + 1);
  const all: Raw = { pool: "", seed: 0, battles: 0, species: {}, len: [0, 0, 0], timeout: [0, 0, 0] };
  for (const file of files) {
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
    all.pool = r.pool;
    all.seed = r.seed;
    all.battles += r.battles;
    for (let v = 0; v < 3; v++) {
      all.len[v] = all.len[v]! + r.len[v]!;
      all.timeout[v] = all.timeout[v]! + r.timeout[v]!;
    }
    for (const [k, acc] of Object.entries(r.species)) add((all.species[k] ??= zero()), acc);
  }
  process.stdout.write(report(all));
} else {
  const raw = simulate();
  const rawPath = arg("raw", "");
  if (rawPath) fs.writeFileSync(rawPath, JSON.stringify(raw));
  else process.stdout.write(report(raw));
}
