// 출전 제한의 칸 — 종이 초전설 칸인지 준전설 칸인지 정한다 (docs/specs/adventure.md "출전 제한")
//   초전설 칸   data/eggs.json legendary 의 종과 아르세우스
//   준전설 칸   mythical·sub-legendary·ultra-beast·paradox 의 종 — 초전설을 뺀 전설급 전체
// 진화 가족은 같은 칸이다(코스모그 → 솔가레오, 타입:널 → 실버디). 알 후보에는 뿌리 종만 있으므로 사슬의 뿌리로 본다
// 모습(기라티나(오리진폼)·자시안(검왕) 등)은 같은 도감 번호로 본다
import type { DexOptions } from "../dex/data.js";
import { rootOf } from "../dex/evo.js";
import { eggPool } from "../dex/obtain.js";
import { profileOf } from "../dex/species.js";
import type { BattleTier } from "./rules.js";

const TIER_EGGS: Readonly<Record<string, BattleTier>> = {
  legendary: "legendary",
  mythical: "sub",
  "sub-legendary": "sub",
  "ultra-beast": "sub",
  paradox: "sub",
};
// 알 후보에 없는 초전설 — 업적 보상으로만 얻는다 (data/achievements.json)
const EXTRA: Readonly<Record<string, BattleTier>> = { arceus: "legendary" };

let cache: { opts: DexOptions | undefined; byDex: Map<number, BattleTier> } | null = null;

function tierByDex(opts?: DexOptions): Map<number, BattleTier> {
  if (cache && cache.opts === opts) return cache.byDex;
  const byDex = new Map<number, BattleTier>();
  const put = (slug: string, tier: BattleTier) => {
    const dex = profileOf(slug, opts).dex;
    // 초전설이 준전설보다 앞선다 — 같은 번호가 두 칸에 걸치지 않게
    if (dex > 0 && byDex.get(dex) !== "legendary") byDex.set(dex, tier);
  };
  for (const [kind, tier] of Object.entries(TIER_EGGS)) for (const slug of eggPool(kind, opts) ?? []) put(slug, tier);
  for (const [slug, tier] of Object.entries(EXTRA)) put(slug, tier);
  cache = { opts, byDex };
  return byDex;
}

// 종의 칸 — 칸이 없는 종은 null
export function tierOf(slug: string, opts?: DexOptions): BattleTier | null {
  const byDex = tierByDex(opts);
  for (const s of [slug, rootOf(slug, opts)]) {
    const tier = byDex.get(profileOf(s, opts).dex);
    if (tier) return tier;
  }
  return null;
}
