// 훅 산출물 검사 — dist/hooks/pokebuddy-state.js 가 혼자 도는가
//
//   node dist/tools/check/check-hook-bundle.js   (npm run build 뒤)
//
// 훅은 ~/.claude/scripts/hooks/pokebuddy-state.cjs 로 복사되는 단일 파일이다 (cli/setup.js).
// Node 내장 말고 다른 것을 require 하면 복사본이 깨진다 — 프로젝트 모듈은 `import type` 으로만 가져와야 한다
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { ROOT } from "./baseline";

const HOOK = path.join("dist", "hooks", "pokebuddy-state.js");

export function findHookRequires(root: string = ROOT): { missing: boolean; bad: string[] } {
  const file = path.join(root, HOOK);
  if (!fs.existsSync(file)) return { missing: true, bad: [] };
  const text = fs.readFileSync(file, "utf8");
  const builtin = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
  const bad = [...text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!).filter((spec) => !builtin.has(spec));
  return { missing: false, bad: [...new Set(bad)].sort() };
}

if (require.main === module) {
  const res = findHookRequires();
  if (res.missing) {
    process.stderr.write(`check-hook-bundle: ${HOOK} 가 없다 — npm run build 먼저\n`);
    process.exit(1);
  }
  if (res.bad.length) {
    process.stderr.write(`check-hook-bundle: 훅이 Node 내장이 아닌 것을 require 한다 — ${res.bad.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write("check-hook-bundle: 통과 (Node 내장만 require 한다)\n");
}
