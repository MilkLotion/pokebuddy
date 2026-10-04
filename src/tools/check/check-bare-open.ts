// 맨 open( 검사 — 설정창의 나눈 파일(src/renderer/manage/*.ts, manage.ts 제외)이 open(…) 을 앞 없이 부르는가
//
//   node dist/tools/check/check-bare-open.js   (npm run build 뒤)
//
// 까닭: manage.ts 의 open 을 다른 파일로 옮기면 그 파일에서는 전역 window.open 으로 잡힌다. 형이 우연히 맞아 오류 없이 빌드된다
// (2026-10-04 렌더러 P10r 에서 찾음). 대화상자를 여는 것은 ./dialog.js 의 openAnyDialog·openDialog 다.
// check-deps(가져오기 방향)와 따로 둔다 — 이것은 가져오지 않은 이름이 전역으로 잡히는 문제다.
// 보는 것: 주석·글자를 지운 줄에서 `(^|[^\w.$])open\(`. 그 파일이 open 을 스스로 선언했으면 보지 않는다. window.open(…) 은 점이 앞이라 걸리지 않는다
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./baseline";

const DIR = path.join("src", "renderer", "manage");
const ENTRY = "manage.ts";

// 주석과 글자(따옴표 셋)를 같은 길이의 빈칸으로 바꾼다 — 줄 번호를 지킨다. 템플릿 안의 ${…} 는 글자로 친다(이 검사에는 충분하다)
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, " "));
}

export function findBareOpen(root: string = ROOT): string[] {
  const dir = path.join(root, DIR);
  const found: string[] = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts") || name === ENTRY) continue;
    const code = codeOnly(fs.readFileSync(path.join(dir, name), "utf8"));
    if (/(^|[^\w.$])(function\s+open\s*\(|(const|let)\s+open\s*=)/m.test(code)) continue;
    code.split(/\r?\n/).forEach((line, i) => {
      if (/(^|[^\w.$])open\(/.test(line)) found.push(`${DIR.split(path.sep).join("/")}/${name}:${i + 1}`);
    });
  }
  return found;
}

if (require.main === module) {
  const found = findBareOpen();
  if (found.length) {
    process.stderr.write(`check-bare-open: 맨 open( ${found.length}곳 — 전역 window.open 으로 잡힌다. ./dialog.js 의 openAnyDialog 로 바꾼다\n${found.map((f) => `  ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("check-bare-open: 통과\n");
}
