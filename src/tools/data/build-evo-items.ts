// 진화용 도구 목록(data/evo-items.json)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-evo-items.js   (npm run data:build 가 네 빌드를 차례로 돈다)
//   build-evo 가 만든 data/evo.json 을 읽으므로 그 뒤에 돈다.
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   items.csv        도구 번호 → 식별자
//   item_names.csv   도구 번호 → 한국어·영어 이름
//
// 결과: { "<item>": { "ko": "…", "en": "…", "gen": 1, "targets": ["<slug>", …] } }
//   - gen 은 원작 첫 등장 세대 — 상점·가방 진화 탭 정렬 기준. 우리 도구(OWN_ITEMS — 빈 기술머신·연결의끈·지도)는 없어 맨 위에 선다
//     (2026-10-05 사용자 결정 "원작에 없음 … 가장위로", "연결의끈도 제일 위로 … 빈기술머신-연결의끈-지도 순서")
//   - data/evo.json 의 `need.kind === "item"` 에 실제로 쓰인 도구만 담는다
//   - bond-cord(연결의끈)·blank-cd(빈 기술머신)는 우리 도구라 이름을 여기서 준다. 빈 기술머신은 2026-09-26 "빈 CD"에서,
//     연결의끈(원작 레전드 아르세우스의 Linking Cord)은 2026-09-27 "유대의끈"에서 바꿨다(사용자 결정). id 는 저장 호환을 위해 그대로다
//   - region-map(지도)은 원작에 없는 우리 도구다. `map: true` 간선(기본형 → 리전폼 진화)이 요구한다. targets 는 그 간선의 결과다
//     돌 간선은 need 자체가 지도라 돌의 targets 에 리전폼이 들어가지 않는다 (2026-09-30 사용자 결정 "아이템1개만쓰는게 나을거같네")
//     (2026-09-30 사용자 결정 "지도 라는 아이템 추가해서 리전폼 진화할 수 있게 추가하자")
//   - 상점의 진화 탭이 이 목록을 그대로 보여준다 (docs/specs/game.md "진화 계약")
import fs from "node:fs";
import path from "node:path";
import type { EvoNeed } from "../../shared/species";
import { BLANK_CD, BOND_CORD } from "./build-evo";
import { DATA_DIR, csv, runBuild, writeLineJson } from "./pokeapi-csv";
import { REGION_MAP } from "../../dex/regional";

const IN = path.join(DATA_DIR, "evo.json");
const OUT = path.join(DATA_DIR, "evo-items.json");
const LANG = { ko: "3", en: "9" } as const;

// 우리가 만든 도구 — 원작에 없으므로 이름을 직접 준다
export const OWN_ITEMS: Readonly<Record<string, { ko: string; en: string }>> = {
  [BOND_CORD]: { ko: "연결의끈", en: "Linking Cord" },
  [BLANK_CD]: { ko: "빈 기술머신", en: "Blank TM" },
  [REGION_MAP]: { ko: "지도", en: "Map" },
};

// 원작 첫 등장 세대 — PokeAPI item_game_indices 는 빠지거나 틀린 값이 있어(악의 족자 9·복합금속 없음) 손으로 둔다
// 새 진화 도구가 생기면 여기에 더한다. 없으면 빌드가 실패한다 (우리 도구 OWN_ITEMS 는 예외 — 세대를 두지 않는다)
export const ITEM_GEN: Readonly<Record<string, number>> = {
  "moon-stone": 1,
  "leaf-stone": 1,
  "water-stone": 1,
  "fire-stone": 1,
  "thunder-stone": 1,
  "sun-stone": 2,
  "dawn-stone": 4,
  "shiny-stone": 4,
  "dusk-stone": 4,
  "ice-stone": 7,
  "galarica-cuff": 8,
  "galarica-wreath": 8,
  "cracked-pot": 8,
  "sweet-apple": 8,
  "tart-apple": 8,
  "scroll-of-darkness": 8,
  "black-augurite": 8,
  "peat-block": 8,
  "auspicious-armor": 9,
  "malicious-armor": 9,
  "metal-alloy": 9,
  "syrupy-apple": 9,
  "unremarkable-teacup": 9,
};

interface EvoItem {
  ko: string;
  en: string;
  gen?: number;
  targets: string[];
}

type EvoTable = Record<string, { to: string; need?: EvoNeed; map?: true }[]>;

export async function build(): Promise<void> {
  const evo = JSON.parse(fs.readFileSync(IN, "utf8")) as EvoTable;
  const targets = new Map<string, string[]>();
  for (const [from, steps] of Object.entries(evo)) {
    if (from.startsWith("_")) continue;
    for (const s of steps) {
      if (s.map) targets.set(REGION_MAP, [...(targets.get(REGION_MAP) ?? []), s.to]);
      if (!s.need || s.need.kind !== "item") continue;
      if (s.map && s.need.item === REGION_MAP) continue; // 위에서 이미 담았다
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
    const gen = ITEM_GEN[item];
    if (gen === undefined && !(item in OWN_ITEMS)) throw new Error(`${item} 의 원작 세대(ITEM_GEN)가 없다`);
    out[item] = { ko: hit.ko ?? item, en: hit.en ?? item, ...(gen !== undefined ? { gen } : {}), targets: [...new Set(targets.get(item) ?? [])].sort() }; // 같은 결과가 두 출발에서 오면(어둠의돌 데스니칸) 한 번만
  }

  writeLineJson(OUT, out);
  process.stdout.write(`진화용 도구: ${OUT} — ${Object.keys(out).length}종\n`);
  process.stdout.write(`이름을 못 찾은 도구 ${missing.length}${missing.length ? `: ${missing.join(", ")}` : ""}\n`);
  for (const [k, v] of Object.entries(out)) process.stdout.write(`  ${k} ${v.ko} — ${v.targets.length}종\n`);
}

if (require.main === module) runBuild(build);
