// 생성기의 글 파일 쓰기 — 줄 끝만 다르고 내용이 같으면 쓰지 않는다
//
// 생성기는 LF 로 만든다. core.autocrlf 트리에서는 받은 파일이 CRLF 라, 내용이 같아도 다시 쓰면 git 이 "바뀜"으로 본다
// (2026-10-04 도메인 레인이 verify-data.json·save-rules.ts 복사본에서 두 번 겪음)
import fs from "node:fs";

const lf = (t: string): string => t.replace(/\r\n/g, "\n");

// 반환: 실제로 썼는가
export function writeTextIfChanged(file: string, text: string): boolean {
  let old: string | null = null;
  try {
    old = fs.readFileSync(file, "utf8");
  } catch {
    // 없는 파일 — 새로 쓴다
  }
  if (old != null && lf(old) === lf(text)) return false;
  fs.writeFileSync(file, text);
  return true;
}
