// 진화용 도구 목록(data/evo-items.json)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/build-evo-items.js   (npm run data:build 가 네 빌드를 차례로 돈다)
//   build-evo 가 만든 data/evo.json 을 읽으므로 그 뒤에 돈다.
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   items.csv        도구 번호 → 식별자
//   item_names.csv   도구 번호 → 한국어·영어 이름
//
// 결과: { "<item>": { "ko": "…", "en": "…", "targets": ["<slug>", …] } }
//   - data/evo.json 의 `need.kind === "item"` 에 실제로 쓰인 도구만 담는다
//   - bond-cord(연결의끈)·blank-cd(빈 기술머신)는 우리 도구라 이름을 여기서 준다. 빈 기술머신은 2026-09-26 "빈 CD"에서,
//     연결의끈(원작 레전드 아르세우스의 Linking Cord)은 2026-09-27 "유대의끈"에서 바꿨다(사용자 결정). id 는 저장 호환을 위해 그대로다
//   - 상점의 진화 탭이 이 목록을 그대로 보여준다 (docs/specs/game.md "진화 계약")
import fs from "node:fs";
import path from "node:path";
import type { EvoNeed } from "../shared/types";
import { BLANK_CD, BOND_CORD } from "./build-evo";
import { DATA_DIR, csv, runBuild, writeLineJson } from "./pokeapi-csv";

const IN = path.join(DATA_DIR, "evo.json");
const OUT = path.join(DATA_DIR, "evo-items.json");
const LANG = { ko: "3", en: "9" } as const;

// 우리가 만든 도구 — 원작에 없으므로 이름을 직접 준다
export const OWN_ITEMS: Readonly<Record<string, { ko: string; en: string }>> = {
  [BOND_CORD]: { ko: "연결의끈", en: "Linking Cord" },
  [BLANK_CD]: { ko: "빈 기술머신", en: "Blank TM" },
};

interface EvoItem {
  ko: string;
  en: string;
  targets: string[];
}

type EvoTable = Record<string, { to: string; need?: EvoNeed }[]>;

export async function build(): Promise<void> {
  const evo = JSON.parse(fs.readFileSync(IN, "utf8")) as EvoTable;
  const targets = new Map<string, string[]>();
  for (const [from, steps] of Object.entries(evo)) {
    if (from.startsWith("_")) continue;
    for (const s of steps) {
      if (!s.need || s.need.kind !== "item") continue;
      const list = targets.get(s.need.item) ?? [];
      list.push(s.to);
      targets.set(s.need.item, list);
    }
  }

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

  const out: Record<string, EvoItem> = {};
  const missing: string[] = [];
  for (const item of [...targets.keys()].sort()) {
    const own = OWN_ITEMS[item];
    const hit = own ?? names.get(idOf.get(item) ?? "") ?? {};
    if (!hit.ko || !hit.en) missing.push(item);
    out[item] = { ko: hit.ko ?? item, en: hit.en ?? item, targets: (targets.get(item) ?? []).sort() };
  }

  writeLineJson(OUT, out);
  process.stdout.write(`진화용 도구: ${OUT} — ${Object.keys(out).length}종\n`);
  process.stdout.write(`이름을 못 찾은 도구 ${missing.length}${missing.length ? `: ${missing.join(", ")}` : ""}\n`);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`  ${k} ${v.ko} — ${v.targets.length}종\n`);
}

if (require.main === module) runBuild(build);
