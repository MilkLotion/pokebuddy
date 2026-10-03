// 빌드 전에 dist/ 에서 짝 소스가 없어진 산출물을 지운다 — npm run build 가 tsc 앞에서 부른다
//
// tsc 는 소스를 옮기거나 지운 뒤에도 옛 산출물을 지우지 않는다. 그런 파일이 남으면
// scripts/build-exe.cjs 가 dist/ 를 통째로 설치본에 싣고, 낡은 모듈이 이름으로 불려 새 코드 대신 돈다.
// dist/ 를 통째로 지우지 않는 까닭: 같은 트리에서 빌드와 창 캡처가 겹칠 수 있다. 짝이 있는 파일은 tsc 가 제자리에 다시 쓰므로 남겨 둔다.
// 짝: dist/web/<p>.js → src/<p>.ts (렌더러 빌드), dist/<p>.js → src/<p>.ts (메인 빌드). .js.map·.d.ts 도 같은 짝을 본다.
// 새 의존성 없이 Node 내장만 쓴다
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const OUT = /\.(js|js\.map|d\.ts)$/;

// 산출물 하나의 짝 소스
function sourceOf(file) {
  const rel = path.relative(dist, file).replace(/\\/g, "/");
  const inner = rel.startsWith("web/") ? rel.slice(4) : rel;
  const base = inner.replace(OUT, "");
  return [path.join(root, "src", `${base}.ts`), path.join(root, "src", `${base}.d.ts`)];
}

let removed = 0;
let failed = 0;
// 폴더를 돌며 짝 없는 산출물을 지운다. 비면 폴더도 지운다. 폴더가 비었는지 돌려준다
function sweep(dir) {
  let left = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (sweep(full)) {
        try {
          fs.rmdirSync(full);
        } catch {
          left += 1;
        }
      } else left += 1;
    } else if (OUT.test(ent.name) && !sourceOf(full).some((s) => fs.existsSync(s))) {
      try {
        fs.rmSync(full, { force: true });
        removed += 1;
      } catch {
        failed += 1; // 떠 있는 프로세스가 잡고 있다(Windows) — 빌드는 이어 간다
        left += 1;
      }
    } else left += 1;
  }
  return left === 0;
}

// src/ 에 .ts 가 하나라도 있는가 — 없으면(npm 설치본은 TS 원본을 싣지 않는다) 모든 산출물이 "짝 없음"이 된다.
// cli/setup.js 가 훅 파일이 없을 때 build 를 부를 수 있어, 그때 dist/ 를 다 지우지 않게 아무것도 지우지 않는다 (교차 검토 93번)
function hasTs(dir) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return ents.some((ent) => (ent.isDirectory() ? hasTs(path.join(dir, ent.name)) : ent.name.endsWith(".ts")));
}

if (fs.existsSync(dist) && hasTs(path.join(root, "src"))) sweep(dist);
if (removed || failed) process.stdout.write(`dist/ 에서 짝 소스가 없는 산출물 ${removed}개를 지웠다${failed ? `, ${failed}개는 지우지 못했다` : ""}\n`);
