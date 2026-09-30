// 진화 사슬(data/evo.json)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/build-evo.js   (npm run data:build 가 네 빌드를 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   pokemon_species.csv     종 번호 · 식별자 · evolves_from_species_id
//   pokemon_evolution.csv   진화 조건 — 시간대와 트리거·도구·레벨·친밀도·장소·기술·성별
//   pokemon.csv             종의 기본 폼 식별자 (종 식별자가 도감에 없을 때 대신)
//   items.csv               도구 번호 → 식별자
//   pokemon_forms.csv       폼 번호 → 식별자 (진화 행의 evolved_pokemon_form_id 가 리전폼인지 가린다)
//
// 결과: { "<slug>": [{ "to": "<slug>", "when"?: "day" | "night", "need": {…}, "map"?: true }] }
//   - 종 단위. 폼 슬러그(rotom-wash)는 사슬에 넣지 않는다 — 기본 종만
//   - 리전폼(raichu-alola)은 PokeAPI 에서 뽑지 않고 data/regional.json 의 edges 를 덧붙인다. 같은 출발이면 기본형 간선 뒤에 붙는다.
//     지도 간선(map)의 원래 조건이 도구면 need 를 지도(region-map)로 바꿔 적는다 — 돌 없이 지도 하나로 진화한다 (2026-09-30 사용자 결정)
//     기본형 조건을 고를 때 결과가 리전폼인 행(evolved_pokemon_form_id)은 뺀다 — 가라르 야도킹 행이 기본 야도킹 조건에 섞이지 않게.
//     그래서 기본 야돈 → 야도킹은 교환(연결의끈)이다 (2026-09-30 사용자 결정)
//   - 슬러그는 lib/dex.json 에 있는 것만. 종 식별자(deoxys)가 도감에 있으면 그것, 없으면 기본 폼 식별자(deoxys-normal)
//   - when 은 그 종으로의 진화 조건 행들이 전부 같은 시간대일 때만 적는다 (루가루암처럼 폼마다 다르면 생략).
//     dusk · full-moon 같은 다른 값은 시간대 없음으로 본다
//   - gender 는 그 종으로의 진화 조건 행들이 전부 같은 성별일 때만 적는다 (염뉴트는 암컷, 엘레이드는 수컷).
//     냐오닉스처럼 두 성별 행이 다 있으면 생략한다 (2026-09-30 사용자 결정 "염뉴트의 경우 암컷만 진화가능")
//   - 부모가 도감에 없으면 그 간선은 버린다 (사슬이 끊긴 채 남지 않게 개수를 출력)
//
// need 의 우선순위 — 한 종에 원작 조건이 여럿이면 위에서부터 고른다 (docs/specs/game.md "진화 계약")
//   1 레벨      원작 값 그대로
//   2 친밀도    원작 친밀도 0~255 를 0~100 으로 환산해 5 단위로 반올림
//   3 도구      원작 도구를 그대로 쓴다 (진화의돌 10종 + 사과·주전자 같은 특수 도구)
//   4 교환      우리에 교환이 없다 → bond-cord(연결의끈)
//   5 기술      우리에 기술이 없다 → blank-cd(빈 기술머신). 기술과 특수가 겹치면 기술로 본다
//   6 장소      우리에 장소가 없다 → 그 장소를 대표하는 원작 돌 (LOCATION_STONE)
//   7 그 밖의 특수  배틀·걸음·수집 조건 → 친밀도 100
import path from "node:path";
import type { DayPart, EvoNeed, Gender } from "../shared/types";
import { DATA_DIR, csv, readDex, runBuild, writeLineJson } from "./pokeapi-csv";
import { REGION_MAP, isRegional, regionalTable } from "../dex/regional";

const OUT = path.join(DATA_DIR, "evo.json");

// 사용자 결정으로 정한 시간대 — PokeAPI 에는 게임 버전 조건이라 시간대가 없다.
// 코스모움은 게임 시간이 낮이면 솔가레오, 밤이면 루나아라가 된다 (docs/specs/game.md "진화 실행 시 게임 시간의 낮이면")
export const WHEN_BY_DECISION: Readonly<Record<string, DayPart>> = { solgaleo: "day", lunala: "night" };
const DAY_PARTS = new Set<string>(["day", "night"] satisfies DayPart[]);

// 우리에 없는 조건을 바꿀 때 쓰는 도구
export const BOND_CORD = "bond-cord";
export const BLANK_CD = "blank-cd";
export const AFFINITY_MAX = 100;

// 장소 진화 — 결과 종마다 그 장소를 대표하는 원작 돌. 표에 없는 종이 나오면 빌드가 멈춘다
export const LOCATION_STONE: Readonly<Record<string, string>> = {
  magnezone: "thunder-stone", // 특수 자기장 터
  probopass: "thunder-stone",
  vikavolt: "thunder-stone",
  leafeon: "leaf-stone", // 이끼바위
  glaceon: "ice-stone", // 얼음바위
  crabominable: "ice-stone", // 눈 덮인 산
  runerigus: "dusk-stone", // 폐허의 바위 아치
};

// 원작 친밀도 0~255 → 우리 친밀도 0~100, 5 단위
export const affinityOf = (happiness: number): number =>
  Math.min(AFFINITY_MAX, Math.max(5, Math.round((happiness / 255) * AFFINITY_MAX / 5) * 5));

// 간선 하나 — src/dex/evo.ts EvoStep 과 같은 모양 (빌드가 만들고 dex 가 읽는다)
export interface EvoEdge {
  to: string;
  when?: DayPart;
  gender?: Exclude<Gender, "none">;
  need: EvoNeed;
  map?: true; // 지도(region-map)도 필요하다 — data/regional.json 에서만 온다
}

export type EvoTable = Record<string, EvoEdge[]>;

export async function build(): Promise<void> {
  const dex = readDex();
  const [speciesRows, evoRows, pokemonRows, itemRows] = await Promise.all([
    csv("pokemon_species.csv", ["id", "identifier", "evolves_from_species_id"]),
    csv("pokemon_evolution.csv", [
      "evolved_species_id",
      "evolution_trigger_id",
      "time_of_day",
      "trigger_item_id",
      "minimum_level",
      "minimum_happiness",
      "location_id",
      "known_move_id",
      "known_move_type_id",
      "gender_id",
      "evolved_pokemon_form_id",
    ]),
    csv("pokemon.csv", ["species_id", "identifier", "is_default"]),
    csv("items.csv", ["id", "identifier"]),
  ]);
  const formRows = await csv("pokemon_forms.csv", ["id", "identifier"]);
  const formName = new Map(formRows.map((r) => [r.id, r.identifier]));
  // 결과가 리전폼인 행 — 기본형 조건에서 뺀다
  const toRegional = (r: { evolved_pokemon_form_id: string }): boolean => {
    const name = r.evolved_pokemon_form_id ? formName.get(r.evolved_pokemon_form_id) : undefined;
    return name !== undefined && isRegional(name);
  };
  const baseRows = evoRows.filter((r) => !toRegional(r));
  type SpeciesRow = (typeof speciesRows)[number];

  const defaultOfSpecies = new Map<string, string>();
  for (const r of pokemonRows) if (r.is_default === "1") defaultOfSpecies.set(r.species_id, r.identifier);

  // 종 번호 → 도감 슬러그 (없으면 null)
  const slugOf = (sp: SpeciesRow): string | null => {
    if (dex[sp.identifier] != null) return sp.identifier;
    const def = defaultOfSpecies.get(sp.id);
    if (def && dex[def] != null) return def;
    return null;
  };

  // 진화 대상 종 번호 → 시간대 (행마다 모아 하나로 합칠 수 있을 때만)
  const whenOf = new Map<string, string[]>();
  for (const r of baseRows) {
    const list = whenOf.get(r.evolved_species_id) ?? [];
    list.push(DAY_PARTS.has(r.time_of_day) ? r.time_of_day : "");
    whenOf.set(r.evolved_species_id, list);
  }
  const pickWhen = (speciesId: string): DayPart | undefined => {
    const uniq = [...new Set(whenOf.get(speciesId) ?? [])];
    const only = uniq[0];
    return uniq.length === 1 && only && DAY_PARTS.has(only) ? (only as DayPart) : undefined;
  };

  // 진화 대상 종 번호 → 성별 조건 (행들이 전부 같은 성별일 때만). PokeAPI genders.csv — 1 female · 2 male
  const GENDER_ID: Readonly<Record<string, Exclude<Gender, "none">>> = { "1": "female", "2": "male" };
  const pickGender = (speciesId: string): Exclude<Gender, "none"> | undefined => {
    const uniq = [...new Set((rowsOf.get(speciesId) ?? []).map((r) => r.gender_id))];
    const only = uniq[0];
    return uniq.length === 1 && only ? GENDER_ID[only] : undefined;
  };

  // 진화 대상 종 번호 → 조건 하나. 여러 행(버전마다 다름)을 우선순위로 합친다
  const itemName = new Map(itemRows.map((r) => [r.id, r.identifier]));
  const TRADE = "2";
  const USE_MOVE = "14";
  const rowsOf = new Map<string, (typeof evoRows)[number][]>();
  for (const r of baseRows) {
    const list = rowsOf.get(r.evolved_species_id) ?? [];
    list.push(r);
    rowsOf.set(r.evolved_species_id, list);
  }
  const needOf = (speciesId: string, slug: string): EvoNeed => {
    const rows = rowsOf.get(speciesId) ?? [];
    // 우리에게 있는 조건이 원작에 있으면 그것부터 — 야돈처럼 레벨과 지역 도구가 함께 있는 종을 원작 쪽으로 둔다
    const level = rows.map((r) => Number(r.minimum_level)).find((v) => v > 0);
    if (level) return { kind: "level", level };
    const happiness = rows.map((r) => Number(r.minimum_happiness)).find((v) => v > 0);
    if (happiness) return { kind: "affinity", value: affinityOf(happiness) };
    const item = rows.map((r) => itemName.get(r.trigger_item_id)).find((v): v is string => Boolean(v));
    if (item) return { kind: "item", item };
    if (rows.some((r) => r.evolution_trigger_id === TRADE)) return { kind: "item", item: BOND_CORD };
    if (rows.some((r) => r.known_move_id || r.known_move_type_id || r.evolution_trigger_id === USE_MOVE)) return { kind: "item", item: BLANK_CD };
    // 장소는 트리거를 가리지 않고 본다 — 데스판처럼 피해 조건에 장소가 붙은 것도 그 장소의 돌로 간다
    if (rows.some((r) => r.location_id)) {
      const stone = LOCATION_STONE[slug];
      if (!stone) throw new Error(`장소 진화의 돌이 표에 없다: ${slug}`);
      return { kind: "item", item: stone };
    }
    return { kind: "affinity", value: AFFINITY_MAX };
  };

  const byId = new Map(speciesRows.map((r) => [r.id, r]));
  const out: EvoTable = {};
  let edges = 0;
  const dropped: string[] = [];
  for (const sp of speciesRows.sort((a, b) => Number(a.id) - Number(b.id))) {
    if (!sp.evolves_from_species_id) continue;
    const parent = byId.get(sp.evolves_from_species_id);
    const from = parent ? slugOf(parent) : null;
    const to = slugOf(sp);
    if (!from || !to) {
      dropped.push(`${parent?.identifier ?? "?"}→${sp.identifier}`);
      continue;
    }
    const step: EvoEdge = { to, need: needOf(sp.id, to) };
    const when = WHEN_BY_DECISION[to] ?? pickWhen(sp.id);
    if (when) step.when = when;
    const gender = pickGender(sp.id);
    if (gender) step.gender = gender;
    (out[from] ??= []).push(step);
    edges += 1;
  }

  // 리전폼 간선 — 손으로 관리하는 표를 그대로 붙인다. 슬러그가 도감표에 없으면 멈춘다
  let regionalEdges = 0;
  let mapEdges = 0;
  for (const [from, steps] of Object.entries(regionalTable().edges)) {
    if (from.startsWith("_")) continue;
    for (const s of steps) {
      if (dex[from] == null || dex[s.to] == null) throw new Error(`리전폼 간선의 슬러그가 도감표에 없다: ${from}→${s.to}`);
      if (!s.need) throw new Error(`리전폼 간선에 need 가 없다: ${from}→${s.to}`);
      if ((out[from] ?? []).some((e) => e.to === s.to)) throw new Error(`리전폼 간선이 기본형 간선과 겹친다: ${from}→${s.to}`);
      // 지도 간선의 원래 조건이 도구(돌 등)면 지도가 그 도구를 대신한다 — 표는 원작 조건을 두고, 여기서 need 를 지도로 바꾼다
      //   (2026-09-30 사용자 결정 "천둥의돌이면 라이츄, 지도면 알로라라이츄로 진화하게 하자. 아이템1개만쓰는게 나을거같네")
      //   레벨·친밀도 간선은 원래 조건을 그대로 두고 map 표시로 지도를 더 요구한다
      const need: EvoNeed = s.map && s.need.kind === "item" ? { kind: "item", item: REGION_MAP } : s.need;
      const step: EvoEdge = { to: s.to, need };
      if (s.when) step.when = s.when;
      if (s.gender) step.gender = s.gender;
      if (s.map) step.map = true;
      (out[from] ??= []).push(step);
      edges += 1;
      regionalEdges += 1;
      if (s.map) mapEdges += 1;
    }
  }

  const sorted: EvoTable = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k] ?? []]));
  writeLineJson(OUT, sorted);
  process.stdout.write(`진화 사슬: ${OUT} — 부모 ${Object.keys(sorted).length}종 · 간선 ${edges} (리전폼 ${regionalEdges} · 지도 ${mapEdges})\n`);
  process.stdout.write(`도감에 없어 버린 간선 ${dropped.length}${dropped.length ? `: ${dropped.slice(0, 20).join(", ")}${dropped.length > 20 ? " …" : ""}` : ""}\n`);
  const timed = Object.values(sorted).flat().filter((s) => s.when);
  const gendered = Object.values(sorted).flat().filter((s) => s.gender);
  process.stdout.write(`성별 있는 간선 ${gendered.length}: ${gendered.map((s) => `${s.to}(${s.gender})`).join(" · ")}
`);
  process.stdout.write(`시간대 있는 간선 ${timed.length}: ${timed.map((s) => `${s.to}(${s.when})`).join(" · ")}\n`);
  const all = Object.values(sorted).flat();
  const byKind = new Map<string, number>();
  const byItem = new Map<string, number>();
  for (const s of all) {
    byKind.set(s.need.kind, (byKind.get(s.need.kind) ?? 0) + 1);
    if (s.need.kind === "item") byItem.set(s.need.item, (byItem.get(s.need.item) ?? 0) + 1);
  }
  process.stdout.write(`조건 종류: ${[...byKind].map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);
  process.stdout.write(`진화용 도구 ${byItem.size}종: ${[...byItem].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);
  if (sorted.eevee) process.stdout.write(`  eevee → ${sorted.eevee.map((s) => s.to).join(" ")}\n`);
}

if (require.main === module) runBuild(build);
