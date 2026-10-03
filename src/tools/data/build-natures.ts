// 성격 이름(data/natures.json 의 name)을 공식 이름으로 맞춘다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-natures.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   natures.csv        성격 번호 → 식별자
//   nature_names.csv   성격 번호 → 언어별 이름 (한국어 3 · 영어 9)
//
// natures.json 은 게임 고유 값(axes — 움직임 성향)을 손으로 다듬는 표다. 그래서 파일을 새로 쓰지 않고
// 각 성격 줄의 이름 칸만 바꾼다 — 줄맞춤과 axes 는 그대로 남는다. 공식에 없는 성격이 있으면 멈춘다
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, csv, must, runBuild } from "./pokeapi-csv";

const FILE = path.join(DATA_DIR, "natures.json");
const LANG = { ko: "3", en: "9" } as const;

export async function build(): Promise<void> {
  const [natureRows, nameRows] = await Promise.all([
    csv("natures.csv", ["id", "identifier"]),
    csv("nature_names.csv", ["nature_id", "local_language_id", "name"]),
  ]);
  const idOf = new Map(natureRows.map((r) => [r.identifier, r.id]));
  const names = new Map<string, { ko?: string; en?: string }>();
  for (const r of nameRows) {
    const entry = names.get(r.nature_id) ?? {};
    if (r.local_language_id === LANG.ko) entry.ko = r.name;
    if (r.local_language_id === LANG.en) entry.en = r.name;
    names.set(r.nature_id, entry);
  }

  const text = fs.readFileSync(FILE, "utf8");
  const changed: string[] = [];
  const out = text.replace(/^(.*"id":\s*"([a-z]+)".*)$/gm, (line, _all: string, id: string) => {
    const hit = names.get(must(idOf.get(id), `공식에 없는 성격 ${id}`));
    const ko = must(hit?.ko, `${id} 의 한국어 이름`);
    const en = must(hit?.en, `${id} 의 영어 이름`);
    const next = line.replace(/"ko":\s*"[^"]*"/, `"ko": "${ko}"`).replace(/"en":\s*"[^"]*"/, `"en": "${en}"`);
    if (next !== line) changed.push(`${id} → ${ko} / ${en}`);
    return next;
  });
  fs.writeFileSync(FILE, out);
  process.stdout.write(`성격 이름: ${FILE} — 바꾼 성격 ${changed.length}${changed.length ? `\n  ${changed.join("\n  ")}` : ""}\n`);
}

if (require.main === module) runBuild(build);
