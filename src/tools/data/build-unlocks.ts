// 해금 규칙 초기값(data/unlocks.json)을 만든다 — 개발용, 네트워크 필요(아기 포켓몬 표 한 장). data/evo.json 을 먼저 만들어 둔다 (build-evo).
//
//   npm run build && node dist/tools/data/build-unlocks.js   (npm run data:build 가 네 빌드를 차례로 돈다)
//
// 출처: data/evo.json(진화 사슬) + data/unlocks.json 의 starter 항목(스타터 29종) + PokeAPI pokemon_species.csv 의 is_baby
//   스타터 목록의 출처는 표 자신이다 — 표가 스타터를 소유하고(design.md "도감 · 해금", src/dex/unlocks.ts starters),
//   이 빌드는 진화 규칙만 새로 만들고 손으로 적은 것을 얹는다. 표에 starter 가 하나도 없으면 멈춘다 (표가 지워졌거나 깨진 것)
//
// 규칙 (design.md "도감 · 해금")
//   1. 스타터 29종                                     { "starter": true } — 스타터는 이것만. 진화 대상인 종을 스타터로 두면 진화 규칙을 붙이지 않는다
//      (조건은 전부 만족이어야 해서 붙이면 스타터가 진화 전 종에 묶인다). 2026-09-27 피카츄 대신 피츄를 스타터로 — 피카츄는 피츄 진화로 해금
//   2. evo.json 의 진화 대상마다                       { "evolve": { "from", "affinity", "when"? } }
//      affinity 는 부모의 단계로 — 첫 진화 500, 둘째 진화 1500 (셋째 이상도 1500)
//      단계는 뿌리부터의 거리인데 **아기 포켓몬(is_baby)은 세지 않는다** — 피츄→피카츄→라이츄에서 피카츄는 0단계, 라이츄는 500
//   3. 손으로 적은 것 MANUAL — 같은 슬러그의 생성 규칙을 **대체**한다 (합치면 AND 가 되기 때문). 지금은 없다
//      2026-09-29 사용자 결정으로 모두 뺐다 — 잠만보(상점 800)는 먹고자 진화, 럭키(연속 14일)는 핑복 진화로 되돌렸다.
//      메타몽(파티 3마리)·라프라스(작업 100시간)는 업적 보상으로 옮겼다 (data/achievements.json)
//   4. 진화 전 첫 단계 종(evolves_from 없음) 가운데 위에서 규칙을 받지 않은 종   { "base": true } — 처음부터 해금 (2026-09-25 사용자 결정)
//      전설·환상(is_legendary · is_mythical)과 울트라비스트(ULTRA_BEASTS)는 넣지 않는다 — 입수 경로를 따로 정한다.
//      울트라비스트는 PokeAPI 에 표시가 없어 목록으로 둔다. 알에서 얻을 수 없는 종이다 (docs/specs/game.md "알")
//      종 목록 알(data/eggs.json pool)의 종도 넣지 않는다 — 화석은 태고의돌, 패러독스는 랜덤패러독스알에서 나와야 해금 (2026-09-27 사용자 결정)
//      업적 보상 종(data/achievements.json 의 reward.pokemon)도 넣지 않는다 — 업적으로만 얻는다. 규칙이 없으니 랜덤알·상점에서도 빠진다 (2026-09-29)
//      리전폼 가운데 진화 전 종(data/regional.json 의 get "base" — 알로라 식스테일 · 켄타로스 품종)도 같은 규칙으로 넣는다.
//      기본 종이 전설·환상이면(가라르 프리져·썬더·파이어) 넣지 않는다 — 전설 규칙대로 단일 포켓몬 알에서 나온다 (2026-09-30 사용자 결정)
//   그 밖의 종은 넣지 않는다 (아직 해금 길 없음)
//   진화 규칙은 리전폼 간선에서도 만든다. 기본형과 리전폼이 같은 종으로 가면(나옹·가라르 나옹 → 페르시온) 기본형 규칙을 쓴다
// 순서: 스타터 → 진화 대상(슬러그순) → 손으로 적은 것(스타터·진화 대상이 아닌 것만 뒤에)
import fs from "node:fs";
import path from "node:path";
import { starters, unlockRules } from "../../dex/unlocks";
import { fixedEggs } from "../../shop/catalog";
import { rewardSpecies } from "../../achievement/core";
import type { UnlockRule } from "../../shared/types";
import type { EvoTable } from "./build-evo";
import { DATA_DIR, csv, must, runBuild, writeLineJson } from "./pokeapi-csv";
import { isRegional, regionalTable } from "../../dex/regional";

const EVO = path.join(DATA_DIR, "evo.json");
const OUT = path.join(DATA_DIR, "unlocks.json");

export const RULES = {
  affinityByStage: [500, 1500], // 부모 단계 0 → 500, 1 → 1500. 그 뒤는 마지막 값
};

// 손으로 적은 규칙 — 생성 규칙을 대체
export const MANUAL: Readonly<Record<string, UnlockRule>> = {};

// 울트라비스트 — 진화 전 첫 단계만. 베베놈의 진화형 아고용은 진화 규칙이 남지만 베베놈을 얻을 길이 없어 함께 막힌다
export const ULTRA_BEASTS: readonly string[] = ["nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela", "kartana", "guzzlord", "poipole", "stakataka", "blacephalon"];

type EvolveRule = NonNullable<UnlockRule["evolve"]>;

// 아기 포켓몬 슬러그 집합과 기본형(진화 전 첫 단계, 전설·환상·울트라비스트 제외) 목록 (종 식별자 = 도감 슬러그)
async function fetchSpecies(): Promise<{ babies: Set<string>; bases: string[] }> {
  const rows = await csv("pokemon_species.csv", ["identifier", "is_baby", "evolves_from_species_id", "is_legendary", "is_mythical"]);
  const rare = new Set(rows.filter((r) => r.is_legendary === "1" || r.is_mythical === "1").map((r) => r.identifier));
  const regionalBases = Object.entries(regionalTable().forms)
    .filter(([, f]) => f.get === "base" && !rare.has(f.base))
    .map(([slug]) => slug);
  return {
    babies: new Set(rows.filter((r) => r.is_baby === "1").map((r) => r.identifier)),
    bases: [
      ...rows.filter((r) => !r.evolves_from_species_id && r.is_legendary !== "1" && r.is_mythical !== "1" && !ULTRA_BEASTS.includes(r.identifier)).map((r) => r.identifier),
      ...regionalBases,
    ],
  };
}

// 부모 → 자식 목록에서 각 슬러그의 단계 — 아기가 아닌 조상의 수
function stageFn(evo: EvoTable, babies: Set<string>): (slug: string) => number {
  const parentOf = new Map<string, string>();
  for (const [from, steps] of Object.entries(evo)) {
    for (const s of steps) {
      const kept = parentOf.get(s.to);
      if (kept === undefined || (isRegional(kept) && !isRegional(from))) parentOf.set(s.to, from); // 부모는 기본형이 먼저 (src/dex/evo.ts 와 같은 규칙)
    }
  }
  return (slug) => {
    let n = 0;
    let cur = slug;
    let guard = 0;
    let parent = parentOf.get(cur);
    while (parent !== undefined && guard < 10) {
      cur = parent;
      if (!babies.has(cur)) n += 1;
      guard += 1;
      parent = parentOf.get(cur);
    }
    return n;
  };
}

export function build(evo: EvoTable, babies: Set<string>, starterSlugs: string[], bases: string[] = []): { out: Record<string, UnlockRule>; skipped: number; replaced: number } {
  const stageOf = stageFn(evo, babies);
  const out: Record<string, UnlockRule> = {};

  for (const slug of starterSlugs) out[slug] = { starter: true };

  const evolves: [string, EvolveRule][] = [];
  for (const [from, steps] of Object.entries(evo)) {
    const idx = Math.min(stageOf(from), RULES.affinityByStage.length - 1);
    const affinity = must(RULES.affinityByStage[idx], `단계 ${idx} 의 affinity`);
    for (const s of steps) {
      const rule: EvolveRule = { from, affinity };
      if (s.when) rule.when = s.when;
      evolves.push([s.to, rule]);
    }
  }
  // 같은 결과면 기본형 출발이 먼저 — 먼저 온 규칙을 쓴다
  const regionalLast = (r: EvolveRule): number => (isRegional(r.from) ? 1 : 0);
  evolves.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : regionalLast(a[1]) - regionalLast(b[1])));
  let skipped = 0;
  for (const [to, rule] of evolves) {
    if (out[to]) {
      skipped += 1;
      continue;
    }
    out[to] = { evolve: rule };
  }
  let replaced = 0;
  for (const [slug, rule] of Object.entries(MANUAL)) {
    if (out[slug]) replaced += 1;
    out[slug] = rule;
  }
  const fixed = new Set(fixedEggs({ dataDir: DATA_DIR }).flatMap(([, pool]) => pool));
  const rewards = new Set(rewardSpecies({ dataDir: DATA_DIR }));
  for (const slug of bases) if (!out[slug] && !fixed.has(slug) && !rewards.has(slug)) out[slug] = { base: true };
  return { out, skipped, replaced };
}

async function main(): Promise<void> {
  const evo = JSON.parse(fs.readFileSync(EVO, "utf8")) as EvoTable;
  // 스타터는 지금 표에서 — 쓰기 전에 읽는다 (같은 파일을 덮어쓴다)
  const starterSlugs = starters(unlockRules({ dataDir: DATA_DIR }));
  if (!starterSlugs.length) throw new Error(`${OUT} 에 starter 항목이 없다 — 스타터 목록의 출처라 비어 있으면 만들 수 없다`);
  const { babies, bases } = await fetchSpecies();
  const { out, skipped, replaced } = build(evo, babies, starterSlugs, bases);
  writeLineJson(OUT, out);
  const counts = { starter: 0, evolve: 0, base: 0, manual: Object.keys(MANUAL).length };
  for (const r of Object.values(out)) {
    if (r.starter) counts.starter += 1;
    if (r.evolve) counts.evolve += 1;
    if (r.base) counts.base += 1;
  }
  process.stdout.write(`해금 규칙: ${OUT} — ${Object.keys(out).length}종 (스타터 ${counts.starter} · 진화 ${counts.evolve} · 기본형 ${counts.base} · 손으로 ${counts.manual} · 대체 ${replaced} · 스타터라 건너뜀 ${skipped})\n`);
  process.stdout.write(`아기 포켓몬 ${babies.size}종은 단계에 세지 않음\n`);
  for (const k of ["raichu", "pikachu", "charizard", "umbreon", "snorlax", "chansey", "ditto", "lapras"]) if (out[k]) process.stdout.write(`  ${k} ${JSON.stringify(out[k])}\n`);
}

if (require.main === module) runBuild(main);
