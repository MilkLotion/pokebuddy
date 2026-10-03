// 자체 검사 실행기 — 목록(./list.ts)을 차례로 돌린다. npm run selftest 가 부른다
//
//   node dist/tools/selftest/run.js                 전부. 첫 실패에서 멈춘다
//   node dist/tools/selftest/run.js shop bag        이름을 준 것만 (npm run selftest -- shop bag)
//   node dist/tools/selftest/run.js --keep-going    실패해도 끝까지 돌고 실패한 이름을 모아 찍는다
//   node dist/tools/selftest/run.js --reverse       거꾸로 돌린다 — 검사끼리 순서에 기대는지 볼 때
//   node dist/tools/selftest/run.js --list          목록만 찍는다
//
// 검사는 프로세스 하나씩 따로 돈다. 동시에 돌리지 않는다 — 고정 포트와 로컬 Supabase 를 쓰는 검사가 있다
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SELFTESTS, type SelftestEntry } from "./list";

const ROOT = path.join(__dirname, "..", "..", "..");
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export interface SelftestRun {
  name: string;
  status: number | null;
  ms: number;
}

// 목록에 빠진 검사 파일 — src/tools 아래의 selftest-*.ts 가운데 목록의 어느 실행 파일과도 이름이 맞지 않는 것
export function unlistedSelftests(root: string = ROOT): string[] {
  const listed = new Set(SELFTESTS.map((e) => path.basename(e.file).replace(/\.(c?js)$/, "")));
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
      else if (/^selftest-.+\.ts$/.test(ent.name) && !listed.has(ent.name.replace(/\.ts$/, ""))) found.push(path.relative(root, path.join(dir, ent.name)).replace(/\\/g, "/"));
    }
  };
  const src = path.join(root, "src", "tools");
  if (fs.existsSync(src)) walk(src); // 설치본에는 src/tools 가 없다 — 그때는 보지 않는다
  return found.sort();
}

export function runSelftests(opts: { only?: string[]; keepGoing?: boolean; reverse?: boolean } = {}): SelftestRun[] {
  const only = opts.only ?? [];
  const unknown = only.filter((n) => !SELFTESTS.some((e) => e.name === n));
  if (unknown.length) throw new Error(`목록에 없는 검사: ${unknown.join(", ")} — node dist/tools/selftest/run.js --list`);
  const picked: readonly SelftestEntry[] = only.length ? SELFTESTS.filter((e) => only.includes(e.name)) : SELFTESTS;
  const list = opts.reverse ? [...picked].reverse() : picked;
  const runs: SelftestRun[] = [];
  for (const entry of list) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(ROOT, entry.file)], { cwd: ROOT, stdio: "inherit" });
    const run = { name: entry.name, status: r.status, ms: Date.now() - t0 };
    runs.push(run);
    if (run.status !== 0 && !opts.keepGoing) break;
  }
  return runs;
}

function main(argv: string[]): void {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const names = argv.filter((a) => !a.startsWith("--"));
  if (flags.has("--list")) {
    for (const e of SELFTESTS) say(`${e.name}${e.needs ? `  (${e.needs})` : ""}  ${e.file}`);
    return;
  }
  const missing = unlistedSelftests();
  if (missing.length) {
    process.stderr.write(`목록(src/tools/selftest/list.ts)에 없는 자체 검사 파일: ${missing.join(", ")}\n`);
    process.exit(1);
  }
  const runs = runSelftests({ only: names, keepGoing: flags.has("--keep-going"), reverse: flags.has("--reverse") });
  const failed = runs.filter((r) => r.status !== 0);
  if (failed.length) {
    process.stderr.write(`자체 검사 실패: ${failed.map((r) => `${r.name}(종료 코드 ${r.status ?? "없음"})`).join(", ")}\n`);
    process.exit(1);
  }
  say(`자체 검사 통과: ${runs.length}개, ${Math.round(runs.reduce((a, r) => a + r.ms, 0) / 1000)}초`);
}

if (require.main === module) main(process.argv.slice(2));
