// 가방 도구 이름(data/items.json 의 ko·en)을 공식 이름으로 맞춘다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/build-items.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   items.csv        도구 번호 → 식별자
//   item_names.csv   도구 번호 → 언어별 이름 (한국어 3 · 영어 9)
//
// items.json 의 키가 공식 식별자와 같은 도구만 이름을 바꾼다(rare-candy · exp-candy-xs …).
// 공식에 없는 게임 고유 도구(기본먹이 · 프리미엄먹이 · 장난감 · 민트 · 약)는 손으로 적은 이름을 그대로 둔다.
// 민트(mint)는 성격별 21종을 합친 게임 고유 도구다 (2026-09-29 사용자 결정). 공식 식별자에 mint 가 없어 이름이 바뀌지 않는다
// 파일을 새로 쓰지 않고 각 도구 줄의 이름 칸만 바꾼다 — 가격·효과·설명은 그대로 남는다
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, csv, runBuild } from "./pokeapi-csv";

const FILE = path.join(DATA_DIR, "items.json");
const LANG = { ko: "3", en: "9" } as const;

export async function build(): Promise<void> {
  const [itemRows, nameRows] = await Promise.all([
    csv("items.csv", ["id", "identifier"]),
    csv("item_names.csv", ["item_id", "local_language_id", "name"]),
  ]);
  const idOf = new Map(itemRows.map((r) => [r.identifier, r.id]));
  const names = new Map<string, { ko?: string; en?: string }>();
  for (const r of nameRows) {
    const entry = names.get(r.item_id) ?? {};
    if (r.local_language_id === LANG.ko) entry.ko = r.name;
    if (r.local_language_id === LANG.en) entry.en = r.name;
    names.set(r.item_id, entry);
  }

  const text = fs.readFileSync(FILE, "utf8");
  const changed: string[] = [];
  const own: string[] = [];
  const out = text.replace(/^(\s*"([a-z0-9-]+)":\s*\{.*)$/gm, (line, _all: string, id: string) => {
    const official = idOf.get(id);
    if (!official) {
      own.push(id);
      return line;
    }
    const hit = names.get(official);
    let next = line;
    if (hit?.ko) next = next.replace(/"ko":\s*"[^"]*"/, `"ko": "${hit.ko}"`);
    if (hit?.en) next = next.replace(/"en":\s*"[^"]*"/, `"en": "${hit.en}"`);
    if (next !== line) changed.push(`${id} → ${hit?.ko} / ${hit?.en}`);
    return next;
  });
  fs.writeFileSync(FILE, out);
  process.stdout.write(`도구 이름: ${FILE} — 바꾼 도구 ${changed.length}${changed.length ? `\n  ${changed.join("\n  ")}` : ""}\n`);
  process.stdout.write(`공식에 없는 게임 고유 도구 ${own.length}: ${own.join(", ")}\n`);
}

if (require.main === module) runBuild(build);
