// 정적 검사의 공용 부분 — 소스 목록, 기준 목록 견주기, 결과 찍기
//
// 기준 목록 방식: 리팩토링 전부터 있던 어긋남은 기준 목록(src/tools/check/baseline/<이름>.txt)에 적어 두고,
// 거기 없는 새 어긋남만 실패로 본다. 단계가 끝날 때마다 `--update-baseline` 으로 줄어든 목록을 다시 적는다.
// 목록이 비면 그 검사는 예외 없이 지켜지는 것이다 (worklog 의 code-structure 설계 50번 3.9절)
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.join(__dirname, "..", "..", "..");

export interface CheckResult {
  ok: boolean;
  findings: string[]; // 지금 어긋난 것 전부 (기준 목록에 있는 것 포함)
  fresh: string[]; // 수가 늘어난 종류에서, 기준 목록에 없는 것 — 실패의 까닭
  gone: string[]; // 기준 목록에는 있는데 이제 없는 것 — 목록을 줄일 수 있다
}

// src 아래의 .ts (선언 파일 제외). 경로는 뿌리 기준, 슬래시
export function sourceFiles(root: string = ROOT, under = "src"): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  const start = path.join(root, under);
  if (fs.existsSync(start)) walk(start);
  return out.sort();
}

const baselineFile = (name: string, root: string): string => path.join(root, "src", "tools", "check", "baseline", `${name}.txt`);

export function readBaseline(name: string, root: string = ROOT): string[] {
  try {
    return fs
      .readFileSync(baselineFile(name, root), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function writeBaseline(name: string, findings: readonly string[], root: string = ROOT): void {
  const file = baselineFile(name, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = `# ${name} 검사의 기준 목록 — 리팩토링 전부터 있던 어긋남. 줄어들기만 해야 한다 (node dist/tools/check/check-${name}.js --update-baseline)\n`;
  fs.writeFileSync(file, head + [...findings].sort().join("\n") + (findings.length ? "\n" : ""));
}

// 어긋남 한 줄의 종류 — "layer: …" 의 layer
const kindOf = (line: string): string => line.slice(0, line.indexOf(":"));
const countByKind = (lines: Iterable<string>): Map<string, number> => {
  const out = new Map<string, number>();
  for (const l of lines) out.set(kindOf(l), (out.get(kindOf(l)) ?? 0) + 1);
  return out;
};

// 실패는 종류별 수가 기준 목록보다 늘었을 때다. 줄의 글자로 견주지 않는 까닭 — 파일을 옮기면 같은 어긋남의 경로가 바뀐다.
// 옮긴 단계는 수가 늘지 않은 것을 보고 `--update-baseline` 으로 목록을 다시 적는다
export function compare(name: string, findings: readonly string[], root: string = ROOT): CheckResult {
  const base = new Set(readBaseline(name, root));
  const now = new Set(findings);
  const fresh = [...now].filter((f) => !base.has(f)).sort();
  const gone = [...base].filter((f) => !now.has(f)).sort();
  const was = countByKind(base);
  const grown = [...countByKind(now)].filter(([kind, n]) => n > (was.get(kind) ?? 0)).map(([kind]) => kind);
  return { ok: grown.length === 0, findings: [...now].sort(), fresh: fresh.filter((f) => grown.includes(kindOf(f))), gone };
}

// 검사 하나의 명령줄 입구 — 종료 코드 0 또는 1
export function runCheck(name: string, find: (root: string) => string[]): void {
  const findings = find(ROOT);
  if (process.argv.includes("--update-baseline")) {
    writeBaseline(name, findings);
    process.stdout.write(`check-${name}: 기준 목록을 다시 적었다 (${findings.length}건)\n`);
    return;
  }
  const res = compare(name, findings);
  if (!res.ok) {
    process.stderr.write(`check-${name}: 새 어긋남 ${res.fresh.length}건\n${res.fresh.map((f) => `  ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`check-${name}: 통과 (기준 목록 ${res.findings.length}건${res.gone.length ? `, 줄일 수 있는 것 ${res.gone.length}건` : ""})\n`);
}
