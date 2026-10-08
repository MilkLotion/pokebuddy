// 서버 배틀 함수(battle-offer·battle-start)가 쓸 엔진·전투 개체 코드와 전투 데이터를 만든다 — npm run build 뒤 실행
//   src/battle/engine.ts        → supabase/functions/_shared/battle/engine.ts (그대로 — import 가 없는 파일)
//   src/battle/fighter-core.ts  → supabase/functions/_shared/battle/fighter-core.ts ("./engine.js" → "./engine.ts")
//   data/*.json(종·기술·메가·모습·상성) → supabase/functions/_shared/battle/battle-data.json { hash, data }
// hash 는 엔진·코어·데이터의 지문이다. 판 기록(battles.data_hash)에 남겨 패치 전후를 나눈다
// 규칙이나 데이터가 바뀌면 다시 돌리고 결과를 함께 커밋한다. selftest-battle 이 복사본이 지금과 같은지 본다
//   node dist/tools/data/build-battle.js          만들기 (npm run battle:build)
//   node dist/tools/data/build-battle.js --check  다르면 종료 코드 1 (만들지 않는다)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { battleData } from "../../battle/fighter";
import { writeTextIfChanged } from "./write-text";

const root = path.join(__dirname, "..", "..", "..");
export const BATTLE_OUT = path.join(root, "supabase", "functions", "_shared", "battle");
const lf = (t: string): string => t.replace(/\r\n/g, "\n");

// 만들 파일 — 이름 → 내용
export function buildBattleFiles(): Record<string, string> {
  const engine = lf(fs.readFileSync(path.join(root, "src", "battle", "engine.ts"), "utf8"));
  const core = lf(fs.readFileSync(path.join(root, "src", "battle", "fighter-core.ts"), "utf8")).replace(/from "\.\/engine\.js"/g, 'from "./engine.ts"');
  const header = (src: string): string => `// 생성 파일 — ${src} 복사본. 고치지 말고 npm run battle:build 를 돌린다\n`;
  const engineOut = header("src/battle/engine.ts") + engine;
  const coreOut = header("src/battle/fighter-core.ts") + core;
  const data = battleData();
  const body = JSON.stringify(data);
  const hash = crypto.createHash("sha256").update(engineOut).update(coreOut).update(body).digest("hex").slice(0, 16);
  return {
    "engine.ts": engineOut,
    "fighter-core.ts": coreOut,
    "battle-data.json": `{"hash":"${hash}","data":${body}}\n`,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const files = buildBattleFiles();
  let differ = 0;
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(BATTLE_OUT, name);
    const now = fs.existsSync(file) ? lf(fs.readFileSync(file, "utf8")) : null;
    if (now === text) continue;
    differ++;
    if (check) process.stdout.write(`다름: ${path.relative(root, file)}\n`);
    else {
      fs.mkdirSync(BATTLE_OUT, { recursive: true });
      writeTextIfChanged(file, text);
    }
  }
  const hash = (JSON.parse(files["battle-data.json"]!) as { hash: string }).hash;
  if (check && differ) process.exit(1);
  process.stdout.write(`${check ? "확인" : "만듦"}: ${path.relative(root, BATTLE_OUT)} · 지문 ${hash}${differ && !check ? ` · ${differ}개 바뀜` : ""}\n`);
}

if (require.main === module) main();
