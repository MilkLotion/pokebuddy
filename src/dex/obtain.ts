// 종을 얻는 길 — 알의 후보, 단일 포켓몬, 랜덤알 후보, 업적 보상 종. 규칙은 docs/specs/game.md "알", "랜덤알"
// 상점(src/shop/catalog.ts)과 업적(src/achievement/evaluate.ts)에 흩어져 있던 것을 도감 쪽으로 모았다. 저장을 읽지 않는다
import { isMetaKey, type DexOptions } from "./data.js";
import { prevOf } from "./evo.js";
import { hatchBaseOf, regionalTable, shiftGroupOf } from "./regional.js";
import { achievementTable, eggTable } from "./tables.js";
import { unlockRules } from "./unlocks.js";

// 알에서 나올 수 있는 종. `unlocked` 이면 해금한 종에서 뽑는다는 뜻이라 여기서는 null
export function eggPool(kind: string, opts?: DexOptions): string[] | null {
  const raw = isMetaKey(kind) ? undefined : eggTable(opts)[kind]?.pool;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : null;
}

// 종 목록을 가진 알 전부 — [알 종류, 종 목록]. 태고의돌과 단일 포켓몬 알이다
export function fixedEggs(opts?: DexOptions): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const kind of Object.keys(eggTable(opts))) {
    const pool = eggPool(kind, opts);
    if (pool) out.push([kind, pool]);
  }
  return out;
}

// ── 단일 포켓몬 알 (data/eggs.json 의 single) ──────────────────────────────────
// 종별로 저장마다 한 번만 얻는다. 이미 얻은 종은 후보에서 뺀다 (src/egg/pool.ts)
export const isSingleEgg = (kind: string, opts?: DexOptions): boolean => !isMetaKey(kind) && eggTable(opts)[kind]?.single === true;

// 업적 보상으로 주는 종 전부 — 해금 규칙 생성기가 이 종들을 기본형에서 뺀다 (src/tools/data/build-unlocks.ts)
export function rewardSpecies(opts?: DexOptions): string[] {
  const out: string[] = [];
  for (const [id, def] of Object.entries(achievementTable(opts))) {
    // 손으로 쓰는 데이터라 값의 모양도 본다
    const reward: unknown = isMetaKey(id) ? null : def.reward;
    if (reward != null && typeof reward === "object" && typeof (reward as { pokemon?: unknown }).pokemon === "string") out.push((reward as { pokemon: string }).pokemon);
  }
  return out;
}

// 단일 포켓몬 전부 — 단일 포켓몬 알의 종, 우편으로만 받는 특수 폼(data/regional.json 의 get "gift" — 마기아나(500년 전의 색) · 피츄(삐쭉귀)),
// 업적 보상으로 주는 종(data/achievements.json 의 reward.pokemon — 2026-10-03 사용자 결정 "업적에서 구하는 포켓몬들도 단일종으로")
// 2026-10-03 사용자 결정 "알이나 다른데서 못구하고 이벤트같은거로 우편으로 보낼 예정이긴해. 대신 단일종 그거여야해."
export function singleSpecies(opts?: DexOptions): Set<string> {
  const out = new Set<string>();
  for (const [kind, pool] of fixedEggs(opts)) if (isSingleEgg(kind, opts)) for (const slug of pool) out.add(slug);
  for (const [slug, form] of Object.entries(regionalTable(opts).forms)) if (!isMetaKey(slug) && form.get === "gift") out.add(slug);
  for (const slug of rewardSpecies(opts)) out.add(slug);
  // 단일 포켓몬이 모습 바꾸기로 오가는 모습(기라티나(오리진폼))도 같은 개체라 단일 포켓몬이다
  for (const slug of [...out]) for (const form of shiftGroupOf(slug, opts)) out.add(form);
  return out;
}

// 랜덤알에서 나올 수 있는 종인가 — 해금 여부는 부르는 쪽이 본다 (docs/specs/game.md "랜덤알", "부화 준비와 결과")
//   해금 규칙이 없는 종        뺀다. 전설·환상·울트라비스트는 규칙이 없다 — 입수 경로를 따로 정한다.
//                              업적 보상 종(메타몽·라프라스)도 규칙이 없다 — 업적으로만 얻는다 (2026-09-29)
//                              옛 규칙으로 이미 해금된 저장도 여기서 걸러진다
//   진화 전용 종               뺀다. 해금 규칙이 진화(evolve)인 종이다(리자드·라이츄). 첫 선택 후보(starter)는 남는다
//   진화 전 종이 있는 종       뺀다. 해금 규칙이 진화가 아니어도 진화형이면 뺀다. 첫 선택 후보는 남는다.
//                              알은 늘 진화 전 종이다 (2026-09-28 사용자 결정 "알은 항상 진화 전 종")
//   고정 후보 알의 종          뺀다. 화석은 태고의돌(해금 뒤에는 상점에서도), 단일 포켓몬은 그 알로만 얻는다
export function inRandomEgg(slug: string, opts?: DexOptions): boolean {
  const rule = unlockRules(opts)[slug];
  if (!rule) return false;
  if (rule.evolve && !rule.starter) return false;
  if (prevOf(slug, opts) && !rule.starter) return false;
  return !fixedEggs(opts).some(([, pool]) => pool.includes(slug));
}

// 이 종이 나오는 알 — 종 목록 알(태고의돌)을 먼저 보고, 없으면 해금한 종에서 뽑는 알(랜덤알)이다.
// 단일 포켓몬 알은 빼고 본다. 어느 알에도 없으면 null (업적 보상 종 등)
// 알에서 대신 나오는 모습(배쓰나이(백색근의 모습))은 그 기본 종의 알이다
export function eggOfSpecies(raw: string, opts?: DexOptions): string | null {
  if (isMetaKey(raw)) return null;
  const slug = hatchBaseOf(raw, opts) ?? raw;
  const fixed = fixedEggs(opts).find(([kind, pool]) => !isSingleEgg(kind, opts) && pool.includes(slug));
  if (fixed) return fixed[0];
  if (!inRandomEgg(slug, opts)) return null;
  const eggs = eggTable(opts);
  return Object.keys(eggs).find((kind) => !isMetaKey(kind) && eggs[kind]?.pool === "unlocked") ?? null;
}
