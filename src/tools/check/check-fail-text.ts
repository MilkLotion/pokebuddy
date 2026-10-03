// 실패 문구 검사 — 실패 값(FailCode)마다 한국어·영어 글이 비지 않고 제 언어로 적혔는가
//
//   node dist/tools/check/check-fail-text.js   (npm run build 뒤)
//
// 표(src/shared/fail-text.ts FAIL_TEXT)가 모든 값을 갖는지는 Record<FailCode, …> 라 tsc 가 본다.
// 서버가 내는 코드가 FailCode 에 드는지는 check-server-codes 가 본다(SERVER_*_CODES → OnlineCode).
// tsc 가 못 보는 것만 여기서 본다:
// - 빈 글자(공백뿐인 글 포함)
// - 언어가 바뀐 글 — ko 에 한글이 없거나 en 에 한글이 있다(복사해 붙이다 칸을 바꾼 경우)
// 값 목록은 실행 때 배열(REASONS·SERVER_*_CODES·APP_ONLINE_CODES)에서 모은다 — FailCode 는 이 배열들의 합이다
import { failTextOf, type FailLang } from "../../shared/fail-text";
import * as onlineCodes from "../../shared/names/online-codes";
import { REASONS } from "../../shared/names/reasons";

const HANGUL = /[가-힣]/;

export function failCodes(): string[] {
  const codes = new Set<string>(REASONS);
  for (const [key, value] of Object.entries(onlineCodes)) {
    if ((/^SERVER_[A-Z]+_CODES$/.test(key) || key === "APP_ONLINE_CODES") && Array.isArray(value)) for (const v of value) codes.add(String(v));
  }
  return [...codes].sort();
}

export function findFailTextProblems(codes: string[] = failCodes()): string[] {
  const problems: string[] = [];
  for (const code of codes) {
    for (const lang of ["ko", "en"] as FailLang[]) {
      // 자리 command 는 글을 그대로 준다. 표에 없는 값이면 값 글자 자체가 돌아온다
      const { text } = failTextOf(code, "command", lang);
      if (!text.trim()) problems.push(`${code} ${lang}: 빈 글`);
      else if (text === code) problems.push(`${code} ${lang}: 표에 없다`);
      else if (lang === "ko" && !HANGUL.test(text)) problems.push(`${code} ko: 한글이 없다 — "${text}"`);
      else if (lang === "en" && HANGUL.test(text)) problems.push(`${code} en: 한글이 있다 — "${text}"`);
    }
  }
  return problems;
}

if (require.main === module) {
  const codes = failCodes();
  const problems = findFailTextProblems(codes);
  if (problems.length) {
    process.stderr.write(`check-fail-text: ${problems.length}건\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`check-fail-text: 통과 — 실패 값 ${codes.length}개, ko·en\n`);
}
