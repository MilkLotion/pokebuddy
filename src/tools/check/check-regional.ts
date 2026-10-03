// 리전폼 표(data/regional.json)를 PokeAPI·PMD SpriteCollab 과 대 본다 — 개발용, 네트워크 필요. 배포 패키지에는 들어가지 않는다.
//
//   npm run build && node dist/tools/check/check-regional.js          표·그림 번호·간선만 (CSV 와 tracker.json)
//   npm run build && node dist/tools/check/check-regional.js --net    초상 두 장과 PMD 묶음(sprites.zip)까지 받아 본다 — 느리다
//
// 확인 (worklog-mac/records/region-map/design.md B.4)
//   1. forms 의 pokemonId 가 pokemon.csv 의 그 슬러그 행이고 종 번호가 기본 종과 같은가
//   2. pmd 경로가 tracker.json 의 지방 이름 하위 폴더인가, sprite_complete 가 몇인가. pmd 가 없는 폼은 tracker 에 폴더가 있는지 알린다
//      특수 폼(special)은 폴더 이름이 지방이 아니라 폼 이름이다(Eternal · Bloodmoon) — 슬러그의 폼 이름과 견준다
//   3. (--net) 초상 보통·이로치 주소가 200 인가, PMD 묶음이 비어 있지 않은가(1KB 이상)
//   4. edges 의 need 가 PokeAPI 에서 다시 계산한 값과 같은가. 지도 간선은 data/evo.json 의 같은 출발 기본형 간선 need 와 비교한다
// 결과는 출력만 한다. 표를 고치지 않는다. 어긋남이 있으면 종료 코드 1
import fs from "node:fs";
import path from "node:path";
import type { EvoNeed } from "../../shared/types";
import { regionalTable } from "../../dex/regional";
import { AFFINITY_MAX, BLANK_CD, BOND_CORD, affinityOf, type EvoTable } from "../data/build-evo";
import { DATA_DIR, csv, runBuild } from "../data/pokeapi-csv";

const TRACKER = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/tracker.json";
const PORTRAIT = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const PMD_ZIP = (d: string): string => `https://spriteserver.pmdcollab.org/assets/${d}/sprites.zip`;

// tracker.json 의 지방 이름 — 켄타로스 품종은 Paldea · Paldea_Blaze · Paldea_Aqua
const TRACKER_REGION: Readonly<Record<string, string>> = { alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" };

// 특수 폼의 폼 이름 — 슬러그에서 기본 종을 뗀다 (floette-eternal → eternal)
const specialName = (slug: string, base: string): string => (slug.startsWith(`${base}-`) ? slug.slice(base.length + 1) : slug);
// tracker 폴더 이름과 견줄 때는 글자와 숫자만 본다 — Lowkey 와 low-key, Rapid_Strike 와 rapid-strike, Spiky 와 spiky-eared
const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameMatches = (node: string | undefined, want: string, special: boolean): boolean => {
  if (node === undefined) return false;
  if (!special) return node.startsWith(want);
  const [a, b] = [plain(node), plain(want)];
  return a.length > 0 && (a.startsWith(b) || b.startsWith(a));
};

// 사용자 결정으로 원작과 다르게 둔 간선 — 원작 조건과 견주지 않는다
//   치고마 → 우라오스(연격의 태세): 원작은 물의 족자다. 족자는 악의 족자 하나만 쓴다 (2026-10-03 사용자 결정 "족자는 하나만 하자")
const NEED_BY_DECISION: ReadonlySet<string> = new Set(["kubfu→urshifu-rapid-strike"]);

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
    csv("pokemon_forms.csv", ["id", "identifier", "pokemon_id"]),
    csv("pokemon_evolution.csv", ["evolved_species_id", "evolution_trigger_id", "trigger_item_id", "minimum_level", "minimum_happiness", "known_move_id", "known_move_type_id", "evolved_pokemon_form_id"]),
    csv("items.csv", ["id", "identifier"]),
  ]);
  const trackerRes = await fetch(TRACKER);
  if (!trackerRes.ok) throw new Error(`tracker.json 내려받기 실패: ${trackerRes.status}`);
  const tracker = (await trackerRes.json()) as Record<string, TrackerNode>;

  const problems: string[] = [];
  const pokemonByName = new Map(pokemonRows.map((r) => [r.identifier, r]));
  const pokemonById = new Map(pokemonRows.map((r) => [r.id, r]));
  // 포켓몬 번호가 따로 없는 폼(pichu-spiky-eared)은 폼 표에서 그 폼이 속한 포켓몬 행을 찾는다
  const pokemonOfForm = new Map(formRows.map((r) => [r.identifier, pokemonById.get(r.pokemon_id)]));
  const speciesByName = new Map(speciesRows.map((r) => [r.identifier, r.id]));
  // 기본 종의 종 번호 — 포켓몬 식별자가 종 이름과 다르면(darmanitan-standard) 종 표로 찾는다
  const speciesOf = (slug: string): string | undefined => pokemonByName.get(slug)?.species_id ?? speciesByName.get(slug);

  // 1 · 2 · 3 — 폼 한 줄씩
  process.stdout.write("슬러그 | 번호 | 포켓몬 id | PMD | tracker | 초상 | PMD 묶음\n");
  for (const [slug, f] of Object.entries(table.forms)) {
    const row = pokemonByName.get(slug) ?? pokemonOfForm.get(slug);
    const idOk = row !== undefined && Number(row.id) === f.pokemonId;
    const dexOk = row !== undefined && row.species_id === speciesOf(f.base);
    if (!idOk) problems.push(`${slug}: pokemonId ${f.pokemonId} ≠ pokemon.csv ${row?.id ?? "없음"}`);
    if (!dexOk) problems.push(`${slug}: 종 번호 ${row?.species_id ?? "없음"} ≠ 기본 종 ${f.base} ${speciesOf(f.base) ?? "없음"}`);

    const dex = String(row?.species_id ?? "").padStart(4, "0");
    const groups = tracker[dex]?.subgroups ?? {};
    const want = f.special ? specialName(slug, f.base) : (TRACKER_REGION[f.region] ?? "");
    let trackerNote: string;
    if (f.pmd) {
      const [d, sub] = f.pmd.split("/");
      const node = d === dex && sub ? groups[sub] : undefined;
      const nameOk = nameMatches(node?.name, want, f.special === true);
      trackerNote = node ? `${node.name} · 완성 ${node.sprite_complete ?? 0}` : "폴더 없음";
      if (!nameOk) problems.push(`${slug}: pmd ${f.pmd} 가 tracker 의 ${want} 폴더가 아니다 (${trackerNote})`);
      if (node && !node.sprite_complete) problems.push(`${slug}: pmd ${f.pmd} 의 sprite_complete 가 0 — 기본형 그림으로 대신한다`);
    } else {
      const found = Object.entries(groups).filter(([, g]) => nameMatches(g.name, want, f.special === true));
      trackerNote = found.length ? `pmd 없음 · tracker ${found.map(([k, g]) => `${k}:${g.name}:${g.sprite_complete ?? 0}`).join(",")}` : "pmd 없음";
    }

    let portraitNote = "-";
    let zipNote = "-";
    if (net) {
      const file = f.portrait ?? String(f.pokemonId);
      const [normal, shiny] = await Promise.all([status(`${PORTRAIT}/${file}.png`), status(`${PORTRAIT}/shiny/${file}.png`)]);
      portraitNote = `${normal.code}/${shiny.code}`;
      if (normal.code !== 200 || shiny.code !== 200) problems.push(`${slug}: 초상 ${portraitNote}`);
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
        // 기본형 간선이 없는 종(대쓰여너 — 배쓰나이(백색근의 모습)만 진화한다)은 결과 종의 PokeAPI 행으로 다시 계산한다
        if (other === undefined) {
          const sp = speciesByName.get(s.to);
          other = needOfRows(evoRows.filter((r) => r.evolved_species_id === sp));
          source = "PokeAPI 종 행";
        }
      }
      const decided = NEED_BY_DECISION.has(`${from}→${s.to}`);
      if (decided) source += " · 사용자 결정으로 다르게 둠";
      const same = decided || JSON.stringify(other ?? null) === JSON.stringify(s.need ?? null);
      if (!same) problems.push(`${from}→${s.to}: 표 ${needText(s.need)} · ${source} ${needText(other ?? undefined)}`);
      process.stdout.write(`${from}→${s.to}${s.map ? " (지도)" : ""} | ${needText(s.need)} | ${needText(other ?? undefined)} | ${source}${same ? "" : " ← 다름"}\n`);
    }
  }

  process.stdout.write(`\n폼 ${Object.keys(table.forms).length} · 간선 ${Object.values(table.edges).flat().length} · 어긋남 ${problems.length}\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  if (problems.length) process.exitCode = 1;
}

if (require.main === module) runBuild(check);
