// 화면 문구 열쇠 검사 — src 가 t("…") 로 부르는 열쇠가 언어 파일(data/i18n/ko.json·en.json) 양쪽에 있는가
//
//   node dist/tools/check/check-i18n-keys.js    없는 열쇠가 있으면 종료 코드 1 (기준 목록 없음 — 하나라도 없으면 실패)
//
// 까닭: 실패 알림처럼 드물게 지나는 경로의 열쇠는 A/B 화면 비교가 지나지 않아 빠져도 못 잡는다 (2026-10-03 app.ts 의 rt.game.reason.* 가 빠졌다)
// 보는 것:
//   번역 함수는 src/view/i18n.ts 의 t 하나다. 렌더러는 문구를 화면 값(snapshot)으로 받아 따로 번역 함수가 없다
//   t 를 view/i18n·view/text 에서 가져오는(또는 정의하는) 파일만 본다 — 지역 변수 t 를 세지 않게 (main/text 는 M8-1 에서 지웠다)
//   첫 인자 안의 글자 그대로 열쇠(삼항 안 포함)는 두 언어 파일에 다 있어야 한다
//   템플릿 `앞.${…}` 은 그 앞부분으로 시작하는 열쇠가 두 언어 파일에 하나 이상 있어야 한다
//   변수로 넘기는 열쇠(t(title))는 풀지 못한다 — 수만 알린다
// (도구 레인, 오케스트레이터 요청)
import fs from "node:fs";
import path from "node:path";
import { ROOT, sourceFiles } from "./baseline";

const LANGS = ["ko", "en"] as const;
// t 를 가져올 수 있는 모듈 — 원본과 다시 내보내기
const SOURCES = /["'](?:\.\.?\/)+view\/(?:i18n|text)(?:\.js)?["']|["']\.\/(?:i18n|text)(?:\.js)?["']/;

export interface I18nKeyReport {
  missing: string[]; // "ko 없음: <열쇠> @ <파일>:<줄>"
  literal: number; // 확인한 글자 그대로 열쇠
  prefix: number; // 확인한 템플릿 앞부분
  unresolved: string[]; // 풀지 못한 호출 "<파일>:<줄>"
  files: number; // 본 파일 수
}

// 파일이 i18n 의 t 를 쓰는가 — 이름 있는 import 에 t 가 있거나 t 를 정의하는 원본
function usesI18nT(file: string, text: string): boolean {
  if (file === "src/view/i18n.ts") return true;
  for (const m of text.matchAll(/^import\s+\{([^}]*)\}\s+from\s+([^;\n]+)/gm)) {
    if (SOURCES.test(m[2]!) && /(^|[,\s])t(\s*[,}]|\s*$)/.test(m[1]!)) return true;
  }
  return false;
}

// t( 뒤 첫 인자의 글자 — 괄호·따옴표·템플릿 안을 건너뛰며 깊이 0 의 쉼표나 닫는 괄호까지
function firstArg(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return text.slice(from, i);
      depth--;
    } else if (c === "," && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

export function checkI18nKeys(root: string = ROOT): I18nKeyReport {
  const tables = Object.fromEntries(
    LANGS.map((lang) => [lang, Object.keys(JSON.parse(fs.readFileSync(path.join(root, "data", "i18n", `${lang}.json`), "utf8")) as Record<string, string>)]),
  ) as Record<(typeof LANGS)[number], string[]>;
  const sets = Object.fromEntries(LANGS.map((lang) => [lang, new Set(tables[lang])])) as Record<(typeof LANGS)[number], Set<string>>;
  const report: I18nKeyReport = { missing: [], literal: 0, prefix: 0, unresolved: [], files: 0 };
  for (const file of sourceFiles(root)) {
    if (file.startsWith("src/tools/check/")) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (!usesI18nT(file, text)) continue;
    report.files++;
    // t( — 앞 글자가 이름·점이 아닌 곳만(foo.t( · get( 를 세지 않게). 정의 줄 "function t(" 는 건너뛴다
    for (const m of text.matchAll(/(?<![A-Za-z0-9_$.])t\(/g)) {
      const before = text.slice(Math.max(0, m.index - 9), m.index);
      if (/function\s+$/.test(before)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const where = `${file}:${line}`;
      const arg = firstArg(text, m.index + 2);
      const literals = [...arg.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)].map((x) => x[1] ?? x[2]!).filter((s) => /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/.test(s));
      const templates = [...arg.matchAll(/`([^`]*)`/g)].map((x) => x[1]!);
      if (!literals.length && !templates.length) {
        report.unresolved.push(where);
        continue;
      }
      for (const key of literals) {
        report.literal++;
        for (const lang of LANGS) if (!sets[lang].has(key)) report.missing.push(`${lang} 없음: ${key} @ ${where}`);
      }
      for (const tpl of templates) {
        const head = tpl.split("${")[0]!;
        if (!tpl.includes("${")) {
          report.literal++;
          for (const lang of LANGS) if (!sets[lang].has(head)) report.missing.push(`${lang} 없음: ${head} @ ${where}`);
          continue;
        }
        report.prefix++;
        for (const lang of LANGS) if (!tables[lang].some((k) => k.startsWith(head))) report.missing.push(`${lang} 없음: ${head}… (이 앞부분으로 시작하는 열쇠가 없다) @ ${where}`);
      }
    }
  }
  return report;
}

if (require.main === module) {
  const r = checkI18nKeys();
  const summary = `열쇠 ${r.literal}개·템플릿 앞부분 ${r.prefix}개 확인, 파일 ${r.files}개, 풀지 못한 호출(변수 열쇠) ${r.unresolved.length}곳`;
  if (r.missing.length) {
    process.stdout.write(`check-i18n-keys: 없는 열쇠 ${r.missing.length}건 (${summary})\n${r.missing.map((m) => `  ${m}`).join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`check-i18n-keys: 통과 (${summary})\n`);
}
