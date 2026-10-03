// PMD 그림 저작자 목록(credits.txt) 풀이 — 그림 받기(src/main/art/pmd-load.ts)와 진단(pokebuddy status)이 같이 쓴다.
// 바깥에 기대지 않는 순수 함수라 shared 에 둔다 (도구 레인 T7b-3 — cli 가 main 을 가져다 쓰지 않게 pmd-load 에서 옮겼다)

// TSV: 날짜 \t 작성자 \t CUR \t 라이선스 \t 동작목록
export function parseCredits(text: string | null | undefined): { author: string; license: string }[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((f) => f.length >= 2 && f[1])
    .map((f) => ({ author: f[1]!.trim(), license: (f[3] || "").trim() || "Unspecified" }));
}
