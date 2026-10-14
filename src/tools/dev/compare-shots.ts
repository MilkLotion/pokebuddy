// 두 그림 폴더를 픽셀로 견준다 — CSS·공통 부품을 고치기 전후 화면이 같은지 본다 (worklog/records/perf-refactor 10단계)
//
//   node dist/tools/dev/compare-shots.js <전 폴더> <후 폴더> [--diff <폴더>]
//
// 같은 이름의 PNG 끼리 크기와 픽셀을 견준다. 다른 픽셀이 있는 그림, 한쪽에만 있는 그림을 적는다.
// --diff 를 주면 다른 픽셀을 빨갛게 칠한 그림을 남긴다. 모두 같으면 종료 코드 0, 하나라도 다르면 1
import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng } from "../../platform/png";

const [before, after] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--diff");
const diffAt = process.argv.indexOf("--diff");
const diffDir = diffAt >= 0 ? process.argv[diffAt + 1] : null;
if (!before || !after) throw new Error("두 폴더를 준다 — node dist/tools/dev/compare-shots.js <전> <후>");
if (diffDir) fs.mkdirSync(diffDir, { recursive: true });

const pngs = (d: string): string[] => fs.readdirSync(d).filter((n) => n.endsWith(".png")).sort();
const a = pngs(before);
const b = new Set(pngs(after));
const lines: string[] = [];
let same = 0;
for (const name of a) {
  if (!b.has(name)) {
    lines.push(`없음(후): ${name}`);
    continue;
  }
  b.delete(name);
  const x = decodePng(fs.readFileSync(path.join(before, name)));
  const y = decodePng(fs.readFileSync(path.join(after, name)));
  if (!x || !y) {
    lines.push(`읽지 못함: ${name}`);
    continue;
  }
  if (x.w !== y.w || x.h !== y.h) {
    lines.push(`크기 다름: ${name} ${x.w}×${x.h} → ${y.w}×${y.h}`);
    continue;
  }
  let diff = 0;
  const mark = diffDir ? Buffer.from(y.px) : null;
  for (let i = 0; i < x.px.length; i += 4) {
    if (x.px[i] !== y.px[i] || x.px[i + 1] !== y.px[i + 1] || x.px[i + 2] !== y.px[i + 2] || x.px[i + 3] !== y.px[i + 3]) {
      diff++;
      if (mark) {
        mark[i] = 255;
        mark[i + 1] = 0;
        mark[i + 2] = 0;
        mark[i + 3] = 255;
      }
    }
  }
  if (diff === 0) {
    same++;
    continue;
  }
  lines.push(`픽셀 다름: ${name} ${diff}개`);
  if (mark && diffDir) fs.writeFileSync(path.join(diffDir, name), encodePng({ w: y.w, h: y.h, px: mark }));
}
for (const name of b) lines.push(`없음(전): ${name}`);
for (const l of lines) process.stdout.write(`${l}\n`);
process.stdout.write(`compare-shots: 같음 ${same}개, 다름 ${lines.length}개\n`);
process.exit(lines.length ? 1 : 0);
