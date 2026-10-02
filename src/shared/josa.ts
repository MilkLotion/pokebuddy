// 한국어 조사 — 앞 낱말의 받침에 맞는 쪽을 고른다
// 숫자로 끝나면 한국어로 읽은 소리 기준 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 은 받침 있음)
// 라틴 글자로 끝나면 영어 글자 이름으로 읽는다 — L(엘)·R(알)은 ㄹ 받침, M(엠)·N(엔)은 받침 있음, 나머지는 받침 없음 ("경험사탕M을")
// 닫는 괄호로 끝나면 괄호 안의 끝 글자로 본다 — "루가루암(한밤중)으로", "배쓰나이(백색근)이" (특수 폼의 이름, 2026-10-03)
// 한글·숫자·라틴 글자가 아닌 글자로 끝나면 받침 없음으로 본다
// 렌더러(src/renderer/manage.ts)는 빌드 범위가 달라 같은 규칙을 따로 둔다 — 고칠 때 함께 고친다

export type JosaPair = "은/는" | "이/가" | "을/를" | "으로/로" | "과/와";

const DIGIT_BATCHIM = new Set(["0", "1", "3", "6", "7", "8"]);
const DIGIT_RIEUL = new Set(["1", "7", "8"]);
const LATIN_RIEUL = new Set(["l", "r"]);
const LATIN_OTHER = new Set(["m", "n"]);

// 끝 글자의 받침 — none: 없음, rieul: ㄹ, other: ㄹ 밖의 받침
function batchim(word: string): "none" | "rieul" | "other" {
  const last = word.trim().replace(/[)\]]+$/, "").slice(-1);
  if (!last) return "none";
  if (/[0-9]/.test(last)) {
    if (!DIGIT_BATCHIM.has(last)) return "none";
    return DIGIT_RIEUL.has(last) ? "rieul" : "other";
  }
  if (/[a-z]/i.test(last)) {
    const c = last.toLowerCase();
    return LATIN_RIEUL.has(c) ? "rieul" : LATIN_OTHER.has(c) ? "other" : "none";
  }
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "none";
  const jong = code % 28;
  if (jong === 0) return "none";
  return jong === 8 ? "rieul" : "other";
}

// 조사만 돌려준다 — `${name}${josa(name, "을/를")}`
export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const b = batchim(word);
  if (pair === "으로/로") return b === "other" ? withBatchim : without;
  return b === "none" ? without : withBatchim;
}
