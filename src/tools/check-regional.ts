// 리전폼 표(data/regional.json)를 PokeAPI·PMD SpriteCollab 과 대 본다 — 개발용, 네트워크 필요. 배포 패키지에는 들어가지 않는다.
//
//   npm run build && node dist/tools/check-regional.js          표·그림 번호·간선만 (CSV 와 tracker.json)
//   npm run build && node dist/tools/check-regional.js --net    초상 두 장과 PMD 묶음(sprites.zip)까지 받아 본다 — 느리다
//
// 확인 (worklog-mac/records/region-map/design.md B.4)
//   1. forms 의 pokemonId 가 pokemon.csv 의 그 슬러그 행이고 종 번호가 기본 종과 같은가
//   2. pmd 경로가 tracker.json 의 지방 이름 하위 폴더인가, sprite_complete 가 몇인가. pmd 가 없는 폼은 tracker 에 폴더가 있는지 알린다
//   3. (--net) 초상 보통·이로치 주소가 200 인가, PMD 묶음이 비어 있지 않은가(1KB 이상)
//   4. edges 의 need 가 PokeAPI 에서 다시 계산한 값과 같은가. 지도 간선은 data/evo.json 의 같은 출발 기본형 간선 need 와 비교한다
// 결과는 출력만 한다. 표를 고치지 않는다. 어긋남이 있으면 종료 코드 1
import fs from "node:fs";
import path from "node:path";
import type { EvoNeed } from "../shared/types";
import { regionalTable } from "../dex/regional";
import { AFFINITY_MAX, BLANK_CD, BOND_CORD, affinityOf, type EvoTable } from "./build-evo";
import { DATA_DIR, csv, runBuild } from "./pokeapi-csv";

const TRACKER = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/tracker.json";
const PORTRAIT = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const PMD_ZIP = (d: string): string => `https://spriteserver.pmdcollab.org/assets/${d}/sprites.zip`;

// tracker.json 의 지방 이름 — 켄타로스 품종은 Paldea · Paldea_Blaze · Paldea_Aqua
const TRACKER_REGION: Readonly<Record<string, string>> = { alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" };

interface TrackerNode {
  name?: string;
  sprite_complete?: number;
  subgroups?: Record<string, TrackerNode>;
}

const needText = (n: EvoNeed | undefined): string =>
  !n ? "-" : n.kind === "level" ? `Lv.${n.level}` : n.kind === "affinity" ? `친밀도 ${n.value}` : `도구 ${n.item}`;

async function status(url: string): Promise<{ code: number; bytes: number }> {
  try {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    return { code: res.status, bytes: buf.length };
  } catch {
    return { code: 0, bytes: 0 };
  }
}

export async function check(): Promise<void> {
  const net = process.argv.includes("--net");
  const table = regionalTable();
  const [pokemonRows, speciesRows, formRows, evoRows, itemRows] = await Promise.all([
    csv("pokemon.csv", ["id", "identifier", "species_id"]),
    csv("pokemon_species.csv", ["id", "identifier"]),
    csv("pokemon_forms.csv", ["id", "identifier"]),
    csv("pokemon_evolution.csv", ["evolved_species_id", "evolution_trigger_id", "trigger_item_id", "minimum_level", "minimum_happiness", "known_move_id", "known_move_type_id", "evolved_pokemon_form_id"]),
    csv("items.csv", ["id", "identifier"]),
  ]);
  const trackerRes = await fetch(TRACKER);
  if (!trackerRes.ok) throw new Error(`tracker.json 내려받기 실패: ${trackerRes.status}`);
  const tracker = (await trackerRes.json()) as Record<string, TrackerNode>;

  const problems: string[] = [];
  const pokemonByName = new Map(pokemonRows.map((r) => [r.identifier, r]));
  const speciesByName = new Map(speciesRows.map((r) => [r.identifier, r.id]));
  // 기본 종의 종 번호 — 포켓몬 식별자가 종 이름과 다르면(darmanitan-standard) 종 표로 찾는다
  const speciesOf = (slug: string): string | undefined => pokemonByName.get(slug)?.species_id ?? speciesByName.get(slug);

  // 1 · 2 · 3 — 폼 한 줄씩
  process.stdout.write("슬러그 | 번호 | 포켓몬 id | PMD | tracker | 초상 | PMD 묶음\n");
  for (const [slug, f] of Object.entries(table.forms)) {
    const row = pokemonByName.get(slug);
    const idOk = row !== undefined && Number(row.id) === f.pokemonId;
    const dexOk = row !== undefined && row.species_id === speciesOf(f.base);
    if (!idOk) problems.push(`${slug}: pokemonId ${f.pokemonId} ≠ pokemon.csv ${row?.id ?? "없음"}`);
    if (!dexOk) problems.push(`${slug}: 종 번호 ${row?.species_id ?? "없음"} ≠ 기본 종 ${f.base} ${speciesOf(f.base) ?? "없음"}`);

    const dex = String(row?.species_id ?? "").padStart(4, "0");
    const groups = tracker[dex]?.subgroups ?? {};
    const want = TRACKER_REGION[f.region] ?? "";
    let trackerNote: string;
    if (f.pmd) {
      const [d, sub] = f.pmd.split("/");
      const node = d === dex && sub ? groups[sub] : undefined;
      const nameOk = node?.name !== undefined && node.name.startsWith(want);
      trackerNote = node ? `${node.name} · 완성 ${node.sprite_complete ?? 0}` : "폴더 없음";
      if (!nameOk) problems.push(`${slug}: pmd ${f.pmd} 가 tracker 의 ${want} 폴더가 아니다 (${trackerNote})`);
      if (node && !node.sprite_complete) problems.push(`${slug}: pmd ${f.pmd} 의 sprite_complete 가 0 — 기본형 그림으로 대신한다`);
    } else {
      const found = Object.entries(groups).filter(([, g]) => g.name?.startsWith(want));
      trackerNote = found.length ? `pmd 없음 · tracker ${found.map(([k, g]) => `${k}:${g.name}:${g.sprite_complete ?? 0}`).join(",")}` : "pmd 없음";
    }

    let portraitNote = "-";
    let zipNote = "-";
    if (net) {
      const [plain, shiny] = await Promise.all([status(`${PORTRAIT}/${f.pokemonId}.png`), status(`${PORTRAIT}/shiny/${f.pokemonId}.png`)]);
      portraitNote = `${plain.code}/${shiny.code}`;
      if (plain.code !== 200 || shiny.code !== 200) problems.push(`${slug}: 초상 ${portraitNote}`);
      if (f.pmd) {
        const [zip, zipShiny] = await Promise.all([status(PMD_ZIP(f.pmd)), status(PMD_ZIP(`${f.pmd}/0001`))]);
        zipNote = `${zip.code} ${zip.bytes}B / 이로치 ${zipShiny.code} ${zipShiny.bytes}B`;
        if (zip.code !== 200 || zip.bytes < 1024) problems.push(`${slug}: PMD 묶음이 비었다 (${zipNote}) — 기본형 그림으로 대신한다`);
      }
    }
    process.stdout.write(`${slug} | ${dex}-${f.no} | ${f.pokemonId} | ${f.pmd ?? "-"} | ${trackerNote} | ${portraitNote} | ${zipNote}\n`);
  }

  // 4 — 간선 need
  const itemName = new Map(itemRows.map((r) => [r.id, r.identifier]));
  const formName = new Map(formRows.map((r) => [r.id, r.identifier]));
  const evo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "evo.json"), "utf8")) as EvoTable;
  // build-evo needOf 와 같은 우선순위 (레벨 → 친밀도 → 도구 → 교환 → 기술 → 그 밖)
  const needOfRows = (rows: typeof evoRows): EvoNeed | null => {
    if (!rows.length) return null;
    const level = rows.map((r) => Number(r.minimum_level)).find((v) => v > 0);
    if (level) return { kind: "level", level };
    const happiness = rows.map((r) => Number(r.minimum_happiness)).find((v) => v > 0);
    if (happiness) return { kind: "affinity", value: affinityOf(happiness) };
    const item = rows.map((r) => itemName.get(r.trigger_item_id)).find((v): v is string => Boolean(v));
    if (item) return { kind: "item", item };
    if (rows.some((r) => r.evolution_trigger_id === "2")) return { kind: "item", item: BOND_CORD };
    if (rows.some((r) => r.known_move_id || r.known_move_type_id || r.evolution_trigger_id === "14")) return { kind: "item", item: BLANK_CD };
    return { kind: "affinity", value: AFFINITY_MAX };
  };
  process.stdout.write("\n간선 | 표 need | 비교 need | 출처\n");
  for (const [from, steps] of Object.entries(table.edges)) {
    for (const s of steps) {
      let other: EvoNeed | null | undefined;
      let source: string;
      if (s.map) {
        other = (evo[from] ?? []).find((e) => !e.map && table.forms[s.to]?.base === e.to)?.need;
        source = "기본형 간선";
      } else if (table.forms[s.to]) {
        other = needOfRows(evoRows.filter((r) => r.evolved_pokemon_form_id && formName.get(r.evolved_pokemon_form_id) === s.to));
        source = "PokeAPI 폼 행";
      } else {
        // 리전폼 → 지방 전용 진화 — 결과 종의 PokeAPI 행 (기본형 간선과 같은 값이어야 한다)
        other = (evo[table.forms[from]?.base ?? ""] ?? []).find((e) => e.to === s.to)?.need;
        source = "기본형 간선";
      }
      const same = JSON.stringify(other ?? null) === JSON.stringify(s.need ?? null);
      if (!same) problems.push(`${from}→${s.to}: 표 ${needText(s.need)} · ${source} ${needText(other ?? undefined)}`);
      process.stdout.write(`${from}→${s.to}${s.map ? " (지도)" : ""} | ${needText(s.need)} | ${needText(other ?? undefined)} | ${source}${same ? "" : " ← 다름"}\n`);
    }
  }

  process.stdout.write(`\n폼 ${Object.keys(table.forms).length} · 간선 ${Object.values(table.edges).flat().length} · 어긋남 ${problems.length}\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  if (problems.length) process.exitCode = 1;
}

if (require.main === module) runBuild(check);
