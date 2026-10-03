// 이름 규칙 검사 — 내보낸 함수의 이름만 본다 (worklog 의 code-structure 설계 50번 3.1·3.2절)
//
//   node dist/tools/check/check-names.js                    새 어긋남이 있으면 종료 코드 1
//   node dist/tools/check/check-names.js --update-baseline  지금 어긋남을 기준 목록으로 적는다
//
// 보는 것:
//   one-word    내보내는 함수는 두 낱말 이상이다 (허용: t · josa · el)
//   duplicate   같은 이름을 두 파일이 내보내지 않는다
//   banned-head 쓰지 않는 머리 낱말 (make·init·get·lookup·resolve·put·render·paint·show)
//   word-tail   꼬리 …Word 는 …Text 로 쓴다
// save·update 는 도메인 명사(저장·앱 업데이트)와 섞여 기계로 가르지 못한다 — 보지 않는다.
// "같은 뜻에 낱말 하나"는 기계로 보지 못한다 — 검수에서 본다
import fs from "node:fs";
import path from "node:path";
import { ROOT, runCheck, sourceFiles } from "./baseline";

export const ALLOWED_ONE_WORD: readonly string[] = ["t", "josa", "el"];
export const BANNED_HEADS: readonly string[] = ["make", "init", "get", "lookup", "resolve", "put", "render", "paint", "show"];

const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase());

interface Exported {
  name: string;
  file: string;
}

// 내보낸 함수 — export function 과, 화살표 함수를 값으로 가진 export const
function exportedFunctions(root: string): Exported[] {
  const out: Exported[] = [];
  for (const file of sourceFiles(root)) {
    if (file.startsWith("src/tools/")) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) out.push({ name: m[1]!, file });
    for (const m of text.matchAll(/^export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:<[^>]*>)?\(/gm)) out.push({ name: m[1]!, file });
  }
  return out;
}

export function findNameViolations(root: string = ROOT): string[] {
  const list = exportedFunctions(root);
  const found: string[] = [];
  const byName = new Map<string, string[]>();
  for (const e of list) byName.set(e.name, [...(byName.get(e.name) ?? []), e.file]);
  for (const e of list) {
    const words = wordsOf(e.name);
    if (words.length === 1 && !ALLOWED_ONE_WORD.includes(e.name)) found.push(`one-word: ${e.name} @ ${e.file}`);
    if (words.length > 1 && BANNED_HEADS.includes(words[0]!)) found.push(`banned-head: ${e.name} @ ${e.file}`);
    if (/[a-z0-9]Word$/.test(e.name)) found.push(`word-tail: ${e.name} @ ${e.file}`);
  }
  for (const [name, files] of byName) if (files.length > 1) found.push(`duplicate: ${name} @ ${[...files].sort().join(", ")}`);
  return found.sort();
}

if (require.main === module) runCheck("names", findNameViolations);
