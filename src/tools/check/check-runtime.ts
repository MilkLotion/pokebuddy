// 실행 규칙 검사 — 화면이 "바뀐 것이 없는데 다시 그리는" 꼴을 소스에서 찾는다 (실행 규칙 R2·R4, worklog/records/perf-refactor 0-4)
//
//   node dist/tools/check/check-runtime.js                     (npm run build 뒤)
//   node dist/tools/check/check-runtime.js --update-baseline   기준 목록을 지금 것으로 다시 적는다
//
// 보는 것
//   link-stamp      설정창의 기기 창 연결이 `stamp: () => ui.view` 로 비교한다. ui.view 는 1초마다 새 객체라 매초 다시 보낸다 (R2)
//   device-redraw   모델을 받는 기기 창(api.onShow 를 쓰는 파일)이 모양 비교(structureOf) 없이 그린다. 모델이 올 때마다 통째로 다시 만든다 (R4)
// 지금 있는 것은 기준 목록(src/tools/check/baseline/runtime.txt)에 있다. 종류별 수가 늘면 실패한다
import fs from "node:fs";
import path from "node:path";
import { ROOT, runCheck } from "./baseline";

const LINK_DIR = path.join("src", "renderer", "manage");
const DEVICE_DIR = path.join("src", "renderer", "device");
const FRAME = "device-frame.ts"; // 기기 창 틀 — 받기를 거는 공통 코드라 따로 보지 않는다

const slash = (p: string): string => p.split(path.sep).join("/");
const tsFiles = (root: string, dir: string): string[] => {
  const full = path.join(root, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts")).sort() : [];
};

export function findRuntime(root: string = ROOT): string[] {
  const found: string[] = [];
  for (const name of tsFiles(root, LINK_DIR)) {
    const lines = fs.readFileSync(path.join(root, LINK_DIR, name), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/stamp:\s*\(\)\s*=>\s*ui\.view\b/.test(line)) found.push(`link-stamp: ${slash(path.join(LINK_DIR, name))}:${i + 1}`);
    });
  }
  for (const name of tsFiles(root, DEVICE_DIR)) {
    if (name === FRAME) continue;
    const text = fs.readFileSync(path.join(root, DEVICE_DIR, name), "utf8");
    if (/\bonShow\b/.test(text) && !/\bstructureOf\b/.test(text)) found.push(`device-redraw: ${slash(path.join(DEVICE_DIR, name))}`);
  }
  return found;
}

if (require.main === module) runCheck("runtime", findRuntime);
