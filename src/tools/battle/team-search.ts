// 팀 탐색기 — 중심 포켓몬(메가 포함)을 정하면 출전 제한 안에서 강한 6마리 조합을 모의 대전으로 찾는다. 개발 도구이며 앱·서버에 들어가지 않는다 (docs/specs/adventure.md "모의 대전기")
//
//   npm run build && node dist/tools/battle/team-search.js --anchor rayquaza-mega[,wo-chien …] [--quick] [--records <기록.json>] [--workers N] [--seed 1] [--no-tier-fix] [--out <결과.json>]
//   계정 기준: --save <관리자 저장 내보내기.json> [--anchor …] [--as-is] — 보유 종과 진화 뒤 형태(--as-is 면 지금 형태만), 열린 메가로 후보를 좁힌다. --anchor 를 안 주면 중심 없이 찾는다
//
// 단계: ① 후보 하나씩 재기 → ② 레쿠쟈 없는 강팀(상대 장) 만들기 → ③ 중심 팀 올라 타기 → ④ 최선 응수로 상대 장 키우기 → ⑤ 자리·기술 다듬기 → ⑥ 새 시드·새 강팀으로 검증
// 기록 파일: { rows: [{ sides: [[{species, form, moves, moveSwap}…], […]] }] } — 서버 기록을 받아 둔 JSON. 없으면 무작위 파티와 만든 강팀만 상대한다
// 규칙: 초전설 1·준전설 2·메가 1, 같은 종 중복 없음, 전투 중에만 나오는 모습(지우개굴닌자 등) 제외
//   레이스포스·글래스트리는 현재 출전 제한 칸이 비어 있다. 기본은 준전설 칸으로 본다. --no-tier-fix 면 지금 규칙 그대로 잰다
// 같은 시드면 같은 결과다. 규칙·데이터가 바뀌면 결과도 바뀐다(출력 첫 줄의 데이터 지문 참고)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter, type FighterSource } from "../../battle/fighter";
import { tierOf } from "../../battle/tier";
import { DEFAULT_DATA_DIR, isMetaKey } from "../../dex/data";
import { nextOf } from "../../dex/evo";
import { megaOf, megaSlugs } from "../../dex/mega";
import { profileOf } from "../../dex/species";
import { abilityTable, formBattleTable, moveTable, speciesMoveTable, speciesTable } from "../../dex/tables";

type Src = FighterSource;
type Team = Src[];
type Tier = "legendary" | "sub" | null;

interface EvalOpts {
  reps: number; // 기록 파티 하나당 판 수
  nrand: number; // 무작위 상대 수
  real: boolean; // 기록 파티를 상대하는가
  extra?: Team[]; // 더할 상대 장(만든 강팀)
  extraReps?: number;
  seed: number;
}
interface EvalResult {
  w: number;
  n: number;
}
interface WorkerInit {
  records: Team[];
  tierFix: boolean;
}

// ── 두 스레드 공통 ──
const STEED_FIX: Readonly<Record<string, Tier>> = { spectrier: "sub", glastrier: "sub" };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const speciesMoves = speciesMoveTable();
const battleOnly = new Set(
  Object.entries(formBattleTable())
    .filter(([k]) => !isMetaKey(k))
    .map(([, v]) => v.form),
);
// 얻을 수 있는 종 — 병풍·전투 전용 모습 제외
const eligible = Object.keys(speciesTable()).filter((s) => !isMetaKey(s) && speciesMoves[s] && speciesMoves[s]!.special !== "wall" && !battleOnly.has(s));
const bstOf = (slug: string): number => profileOf(slug).bst ?? 0;

function makeTierFn(tierFix: boolean): (slug: string) => Tier {
  return (slug) => (tierFix && STEED_FIX[slug]) || tierOf(slug);
}

const fighterCache = new Map<string, EngineFighter | null>();
function fighterOf(src: Src): EngineFighter | null {
  const key = JSON.stringify(src);
  let f = fighterCache.get(key);
  if (f === undefined) {
    f = buildFighter({ level: 100, ...src });
    fighterCache.set(key, f);
  }
  return f;
}

// ── 작업 스레드 ──
function workerMain(init: WorkerInit): void {
  const chart = battleTypeChart();
  const tier = makeTierFn(init.tierFix);
  const poolRand = eligible.filter((s) => bstOf(s) >= 400 && !tier(s));
  const rand = mulberry32(31337);
  const randField: Team[] = Array.from({ length: 200 }, () => Array.from({ length: 6 }, () => ({ species: poolRand[Math.floor(rand() * poolRand.length)]! })));
  const build = (team: Team): (EngineFighter | null)[] => team.map((s) => (s ? fighterOf(s) : null));
  const win = (a: (EngineFighter | null)[], b: (EngineFighter | null)[], seed: number): number => {
    const r = runBattle({ seed, sides: [a, b], typeChart: chart });
    return r.winner === 0 ? 1 : r.winner === null ? 0.5 : 0;
  };
  const evalTeam = (team: Team, o: EvalOpts): EvalResult => {
    const A = build(team);
    let w = 0;
    let n = 0;
    if (o.real) {
      init.records.forEach((p, k) => {
        const B = build(p);
        for (let r = 0; r < o.reps; r++) {
          w += win(A, B, o.seed + k * 13 + r);
          n++;
        }
      });
    }
    for (let k = 0; k < o.nrand; k++) {
      w += win(A, build(randField[k]!), o.seed + 50_000 + k);
      n++;
    }
    (o.extra ?? []).forEach((p, k) => {
      const B = build(p);
      for (let r = 0; r < (o.extraReps ?? 2); r++) {
        w += win(A, B, o.seed + 90_000 + k * 11 + r);
        n++;
      }
    });
    return { w, n };
  };
  parentPort!.on("message", (m: { id: number; team: Team; opts: EvalOpts }) => {
    parentPort!.postMessage({ id: m.id, ...evalTeam(m.team, m.opts) });
  });
}

// ── 메인 스레드 ──
class Pool {
  private workers: Worker[];
  private idle: Worker[];
  private queue: { id: number; team: Team; opts: EvalOpts }[] = [];
  private pending = new Map<number, (r: EvalResult) => void>();
  private seq = 0;

  constructor(n: number, init: WorkerInit) {
    this.workers = Array.from({ length: n }, () => new Worker(__filename, { workerData: init }));
    this.idle = [...this.workers];
    for (const w of this.workers) {
      w.on("message", (r: { id: number } & EvalResult) => {
        const done = this.pending.get(r.id);
        this.pending.delete(r.id);
        this.idle.push(w);
        done?.(r);
        this.pump();
      });
    }
  }
  private pump(): void {
    while (this.idle.length && this.queue.length) this.idle.pop()!.postMessage(this.queue.shift()!);
  }
  eval(team: Team, opts: EvalOpts): Promise<EvalResult> {
    return new Promise((resolve) => {
      const id = this.seq++;
      this.pending.set(id, resolve);
      this.queue.push({ id, team, opts });
      this.pump();
    });
  }
  async rates(teams: Team[], opts: EvalOpts): Promise<number[]> {
    const rs = await Promise.all(teams.map((t) => this.eval(t, opts)));
    return rs.map((r) => (r.n ? r.w / r.n : 0));
  }
  async rate(team: Team, opts: EvalOpts): Promise<number> {
    return (await this.rates([team], opts))[0]!;
  }
  close(): void {
    for (const w of this.workers) void w.terminate();
  }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const say = (s: string): void => void process.stdout.write(s + "\n");
const pct = (x: number): string => (x * 100).toFixed(1);

const names = JSON.parse(fs.readFileSync(path.join(DEFAULT_DATA_DIR, "names.json"), "utf8")) as Record<string, { ko: string }>;
const labelOf = (s: Src): string => (s.form ? (megaOf(s.form)?.ko ?? s.form) : (names[s.species]?.ko ?? s.species));
const teamLabel = (t: Team): string => t.map(labelOf).join(" · ");

async function main(): Promise<void> {
  const quick = flag("quick");
  const tierFix = !flag("no-tier-fix");
  const seed = Number(arg("seed", "1"));
  const workers = Number(arg("workers", String(Math.max(1, os.cpus().length - 1))));
  const cfg = quick
    ? { shortN: 50, screenReps: 1, metas: 3, starts: 2, rounds: 0, holdouts: 3, valReps: 8, valRand: 60, passes: 3, brStarts: 1 }
    : { shortN: 140, screenReps: 3, metas: 8, starts: 4, rounds: 2, holdouts: 8, valReps: 25, valRand: 200, passes: 5, brStarts: 2 };

  const tier = makeTierFn(tierFix);
  // 계정 저장 — 보유 종(진화 뒤 형태까지)과 열린 메가로 후보를 좁힌다. 중심을 안 주면 중심 없이 찾는다
  const savePath = arg("save", "");
  const asIs = flag("as-is");
  let allowed: Set<string> | null = null;
  let megaOpen: Set<string> | null = null;
  let ownParty: Team = [];
  if (savePath) {
    const raw = JSON.parse(fs.readFileSync(savePath, "utf8")) as { save?: unknown };
    const save = (raw.save ?? raw) as { pets: { id: string; species: string }[]; dex?: { megaOpened?: string[] }; battle?: { slots?: (string | null)[]; mega?: Record<string, string> } };
    allowed = new Set<string>();
    const visit = (slug: string): void => {
      if (allowed!.has(slug)) return;
      allowed!.add(slug);
      if (!asIs) for (const step of nextOf(slug)) visit(step.to);
    };
    for (const p of save.pets) visit(p.species);
    megaOpen = new Set(save.dex?.megaOpened ?? []);
    const byId = new Map(save.pets.map((p) => [p.id, p.species]));
    ownParty = (save.battle?.slots ?? []).flatMap((id) => {
      const sp = id ? byId.get(id) : undefined;
      return sp ? [{ species: sp, ...(save.battle?.mega?.[id!] ? { form: save.battle.mega[id!]! } : {}) }] : [];
    });
  }
  // 중심은 쉼표로 여럿 줄 수 있다(예: wo-chien,rayquaza-mega) — 모두 팀에 넣고 고정한다
  const anchorKeys = arg("anchor", savePath ? "" : "rayquaza-mega").split(",").map((k) => k.trim()).filter(Boolean);
  const anchors: Src[] = anchorKeys.map((key) => {
    const m = megaOf(key);
    const a: Src = m ? { species: m.base, form: key } : { species: key };
    if (!speciesTable()[a.species]) throw new Error(`알 수 없는 중심 포켓몬: ${key}`);
    if (battleOnly.has(a.species)) throw new Error(`전투 중에만 나오는 모습이라 중심으로 쓸 수 없다: ${key}`);
    return a;
  });
  const anchorSp = new Set(anchors.map((a) => a.species));
  const inPool = (slug: string): boolean => !allowed || allowed.has(slug);

  // 기록 파티(고유)
  const records: Team[] = [];
  const recordsPath = arg("records", "");
  if (recordsPath) {
    const dump = JSON.parse(fs.readFileSync(recordsPath, "utf8")) as { rows: { sides: (Src | null)[][] }[] };
    const seen = new Set<string>();
    for (const row of dump.rows)
      for (const side of row.sides) {
        const team = side.filter((s): s is Src => !!s).map((s) => ({ species: s.species, form: s.form ?? null, ...(s.moves ? { moves: s.moves } : {}), moveSwap: s.moveSwap === true, ...(s.level ? { level: s.level } : {}) }));
        const key = JSON.stringify(team);
        if (team.length && !seen.has(key)) {
          seen.add(key);
          records.push(team);
        }
      }
  }

  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([speciesMoveTable(), moveTable(), abilityTable()])).digest("hex").slice(0, 12);
  say(`팀 탐색 — 중심 ${anchors.length ? anchors.map(labelOf).join(" + ") : "없음"}${allowed ? ` · 계정 풀 ${allowed.size}종${asIs ? "(지금 형태)" : "(진화 뒤 포함)"}` : ""} · 기록 파티 ${records.length}개 · 코어 ${workers} · ${quick ? "빠른 모드" : "전체 모드"} · 시드 ${seed} · 레이스포스·글래스트리 ${tierFix ? "준전설 칸으로 봄" : "현재 규칙 그대로"} · 데이터 지문 ${fingerprint}`);

  const pool = new Pool(workers, { records, tierFix });
  const rand = mulberry32(seed * 7919);
  const t0 = Date.now();
  const phase = (s: string): void => say(`[${Math.round((Date.now() - t0) / 1000)}초] ${s}`);

  const ok = (team: Team): boolean => {
    const sp = team.map((t) => t.species);
    if (new Set(sp).size !== sp.length) return false;
    let leg = 0;
    let sub = 0;
    let mg = 0;
    for (const t of team) {
      const ti = tier(t.species);
      if (ti === "legendary") leg++;
      else if (ti === "sub") sub++;
      if (t.form) mg++;
    }
    return leg <= 1 && sub <= 2 && mg <= 1;
  };
  if (anchors.length && !ok(anchors)) throw new Error("중심끼리 출전 제한(초전설 1·준전설 2·메가 1·중복 없음)에 걸린다");

  // ① 후보 하나씩 재기 — [후보, 중심, 무작위 4] 를 기록·무작위 상대와
  const poolRand = eligible.filter((s) => bstOf(s) >= 400 && !tier(s));
  const randSp = (): Src => ({ species: poolRand[Math.floor(rand() * poolRand.length)]! });
  const candidates = eligible.filter((s) => bstOf(s) >= 380 && tier(s) !== "legendary" && !anchorSp.has(s) && inPool(s));
  phase(`① 후보 ${candidates.length}종 재는 중`);
  const screenTeams: Team[] = [];
  for (const c of candidates) for (let r = 0; r < cfg.screenReps; r++) screenTeams.push([{ species: c }, ...anchors, ...Array.from({ length: 5 - anchors.length }, randSp)]);
  const screenRates = await pool.rates(screenTeams, { reps: 1, nrand: 15, real: true, seed: 100 });
  const score = new Map<string, number>();
  candidates.forEach((c, i) => {
    let s = 0;
    for (let r = 0; r < cfg.screenReps; r++) s += screenRates[i * cfg.screenReps + r]!;
    score.set(c, s / cfg.screenReps);
  });
  const shortlist = [...candidates].sort((a, b) => score.get(b)! - score.get(a)!).slice(0, cfg.shortN);
  const speciesC: Team = shortlist.map((s) => ({ species: s }));
  // 일반 팀용 후보 — 짧은 목록 + 초전설(종족값 합 580 이상) + 메가
  const legends: Team = eligible.filter((s) => tier(s) === "legendary" && !anchorSp.has(s) && bstOf(s) >= 580 && inPool(s)).map((s) => ({ species: s }));
  const megas: Team = megaSlugs()
    .filter((k) => !anchorKeys.includes(k))
    .map((k) => ({ species: megaOf(k)!.base, form: k }))
    .filter((s) => eligible.includes(s.species) && !anchorSp.has(s.species) && inPool(s.species) && (!megaOpen || megaOpen.has(s.species)));
  const genericC: Team = [...speciesC, ...legends, ...megas];

  const climb = async (start: Team, cands: Team, opts: EvalOpts, locks: number[], margin: number): Promise<{ team: Team; score: number }> => {
    let team = start;
    let cur = await pool.rate(team, opts);
    for (let pass = 0; pass < cfg.passes; pass++) {
      let improved = false;
      for (let i = 0; i < 6; i++) {
        if (locks.includes(i)) continue;
        const trials: Team[] = [];
        for (const c of cands) {
          const t = team.map((x) => ({ ...x }));
          t[i] = { ...c };
          if (ok(t)) trials.push(t);
        }
        const rates = await pool.rates(trials, opts);
        let bi = -1;
        let bs = cur + margin;
        rates.forEach((v, k) => {
          if (v > bs) {
            bs = v;
            bi = k;
          }
        });
        if (bi >= 0) {
          team = trials[bi]!;
          cur = bs;
          improved = true;
        }
      }
      if (!improved) break;
    }
    return { team, score: cur };
  };
  const randomTeam = (cands: Team, withAnchor: boolean): Team => {
    for (;;) {
      const n = withAnchor ? anchors.length : 0;
      const t: Team = Array.from({ length: 6 - n }, () => ({ ...cands[Math.floor(rand() * cands.length)]! }));
      if (withAnchor) anchors.forEach((a, i) => t.splice(1 + i, 0, { ...a }));
      if (ok(t)) return t;
    }
  };
  const lockOf = (t: Team): number[] => anchors.map((a) => t.findIndex((x) => x.species === a.species));
  const mineC = anchors.length ? speciesC : genericC;

  // ② 상대 장 — 중심 없이 만든 강팀
  phase(`② 상대 강팀 ${cfg.metas}개 만드는 중`);
  const field: Team[] = [];
  for (let m = 0; m < cfg.metas; m++) {
    const r = await climb(randomTeam(genericC, false), genericC, { reps: 1, nrand: 20, real: true, extra: field.slice(-8), extraReps: 3, seed: 60_000 + m * 17 }, [], 0.01);
    field.push(r.team);
  }

  // ③ 중심 팀 올라 타기
  phase(`③ 중심 팀 ${cfg.starts}개 올라 타는 중`);
  const anchorOpts = (s: number): EvalOpts => ({ reps: 2, nrand: 30, real: true, extra: field, extraReps: 4, seed: s });
  let mine: Team[] = [];
  for (let s = 0; s < cfg.starts; s++) mine.push((await climb(randomTeam(mineC, anchors.length > 0), mineC, anchorOpts(80_000), anchors.map((_, i) => 1 + i), 0.006)).team);

  // ④ 최선 응수로 상대 장 키우기
  for (let r = 0; r < cfg.rounds; r++) {
    phase(`④ 최선 응수 라운드 ${r + 1}/${cfg.rounds}`);
    const bestNow = mine[0]!;
    const counter = await climb(field[field.length - 1]!.map((x) => ({ ...x })), genericC, { reps: 1, nrand: 10, real: false, extra: [bestNow, bestNow, ...field.slice(-3)], extraReps: 6, seed: 40_000 + r * 555 }, [], 0.01);
    field.push(counter.team);
    const next: Team[] = [];
    for (const t of mine) next.push((await climb(t, mineC, anchorOpts(80_000 + r), lockOf(t), 0.006)).team);
    mine = next;
  }

  // ⑤ 자리·기술 다듬기
  phase(`⑤ 자리와 기술 다듬는 중`);
  const perms: number[][] = [];
  const idx = [0, 1, 2, 3, 4, 5];
  const permute = (k: number): void => {
    if (k === 6) {
      perms.push([...idx]);
      return;
    }
    for (let i = k; i < 6; i++) {
      [idx[k], idx[i]] = [idx[i]!, idx[k]!];
      permute(k + 1);
      [idx[k], idx[i]] = [idx[i]!, idx[k]!];
    }
  };
  permute(0);
  const tuneOpts: EvalOpts = { reps: 2, nrand: 20, real: true, extra: field, extraReps: 4, seed: 300_000 };
  const tuned: Team[] = [];
  for (const base of mine) {
    let team = base;
    let cur = await pool.rate(team, tuneOpts);
    const arranged = perms.map((pm) => pm.map((i) => base[i]!));
    const rates = await pool.rates(arranged, tuneOpts);
    const bi = rates.indexOf(Math.max(...rates));
    if (rates[bi]! > cur + 0.005) {
      team = arranged[bi]!;
      cur = rates[bi]!;
    }
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (let i = 0; i < 6; i++) {
        const row = speciesMoves[team[i]!.species];
        if (!row || row.special) continue;
        const ids = [...row.moves.map((m) => (typeof m === "string" ? m : m.id)), ...(row.candidates ?? [])];
        const trials: Team[] = [];
        for (const x of ids)
          for (const y of ids)
            if (x !== y) {
              const t = team.map((m) => ({ ...m }));
              t[i] = { ...t[i]!, moves: [x, y] };
              trials.push(t);
            }
        const r2 = await pool.rates(trials, tuneOpts);
        const k = r2.indexOf(Math.max(...r2));
        if (r2[k]! > cur + 0.006) {
          team = trials[k]!;
          cur = r2[k]!;
          improved = true;
        }
      }
      if (!improved) break;
    }
    tuned.push(team);
  }

  // ⑥ 검증 — 새 시드, 새로 만든 강팀(학습에 안 쓴 상대), 최선 응수
  phase(`⑥ 검증: 새 강팀 ${cfg.holdouts}개 만드는 중`);
  const holdout: Team[] = [];
  for (let h = 0; h < cfg.holdouts; h++) holdout.push((await climb(randomTeam(genericC, false), genericC, { reps: 2, nrand: 40, real: true, seed: 700_000 + h }, [], 0.01)).team);
  const measure = async (team: Team) => {
    const real = records.length ? await pool.eval(team, { reps: cfg.valReps, nrand: 0, real: true, seed: 5_550_000 }) : { w: 0, n: 0 };
    const rnd = await pool.eval(team, { reps: 0, nrand: cfg.valRand, real: false, seed: 5_560_000 });
    const meta = await pool.eval(team, { reps: 0, nrand: 0, real: false, extra: field, extraReps: cfg.valReps, seed: 5_570_000 });
    const hold = await pool.eval(team, { reps: 0, nrand: 0, real: false, extra: holdout, extraReps: cfg.valReps, seed: 5_580_000 });
    const rate = (r: EvalResult): number => (r.n ? r.w / r.n : 0);
    return { records: rate(real), random: rate(rnd), meta: rate(meta), holdout: rate(hold) };
  };
  const results = [];
  for (const team of tuned) {
    const m = await measure(team);
    let br = 0;
    let brTeam: Team = [];
    for (let b = 0; b < cfg.brStarts; b++) {
      const r = await climb(field[field.length - 1 - b]!.map((x) => ({ ...x })), genericC, { reps: 0, nrand: 0, real: false, extra: [team], extraReps: 10, seed: 123_000 }, [], 0.01);
      if (r.score > br) {
        br = r.score;
        brTeam = r.team;
      }
    }
    results.push({ team, ...m, bestResponse: br, bestResponseTeam: brTeam, rank: 0.3 * m.records + 0.3 * m.meta + 0.4 * m.holdout });
  }
  results.sort((a, b) => b.rank - a.rank);

  // 기록 속 같은 중심 파티(비교용)
  const baselines = anchors.length ? records.filter((t) => anchors.every((a) => t.some((s) => s.species === a.species && (s.form ?? null) === (a.form ?? null)))) : ownParty.length ? [ownParty] : [];
  const baseRows = [];
  for (const t of baselines.slice(0, 5)) baseRows.push({ team: t, ...(await measure(t)) });
  pool.close();

  // 출력
  const abilities = abilityTable();
  const movesT = moveTable();
  say(`\n=== 결과 (${Math.round((Date.now() - t0) / 1000)}초) — 승률 %, 기록=기록 파티 · 무작위 · 메타=상대 장 · 새 강팀=학습에 안 쓴 강팀 ===`);
  results.forEach((r, i) => {
    say(`\n${i === 0 ? "★ 추천" : `후보 ${i + 1}`}  기록 ${pct(r.records)} · 무작위 ${pct(r.random)} · 메타 ${pct(r.meta)} · 새 강팀 ${pct(r.holdout)} · 최선 응수가 이기는 비율 ${pct(r.bestResponse)}`);
    r.team.forEach((s, k) => {
      const f = fighterOf(s);
      if (!f) return;
      const tr = tier(s.species);
      say(`  ${k + 1}번 ${labelOf(s)}${tr === "legendary" ? "(초전설)" : tr === "sub" ? "(준전설)" : ""} [${f.types.join("/")}] ${abilities[f.ability ?? ""]?.ko ?? f.ability} · 사거리 ${f.range} · ${f.moves.map((m) => movesT[m.id]?.ko ?? m.id).join(" + ")}${s.moves ? " (고른 기술)" : ""}`);
    });
    if (r.bestResponseTeam.length) say(`  최선 응수: ${teamLabel(r.bestResponseTeam)}`);
  });
  if (baseRows.length) {
    say(anchors.length ? `\n기록 속 같은 중심 파티(비교)` : `\n지금 계정의 배틀 파티(비교)`);
    for (const b of baseRows) say(`  기록 ${pct(b.records)} · 메타 ${pct(b.meta)} · 새 강팀 ${pct(b.holdout)}  ${teamLabel(b.team)}`);
  }
  say(`\n읽는 법: 자동 전투라 결과가 0%·100% 로 갈린다. 어떤 팀에도 그 팀만 노린 응수 팀이 있다. 상대 장에 없던 강팀에 얼마나 이기는지(새 강팀)를 본다.`);
  const out = arg("out", "");
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ anchor: anchorKeys.join(","), seed, quick, tierFix, fingerprint, results, baselines: baseRows }, null, 2));
    say(`결과 파일: ${out}`);
  }
}

if (isMainThread) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else {
  workerMain(workerData as WorkerInit);
}
