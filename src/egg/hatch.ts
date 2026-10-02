// 부화 결과 판정 — 규칙은 docs/specs/game.md "알", 수치는 docs/specs/balance.md
//
// 결정 순서
//   1. 알에 저장한 후보 범위에서 수집 난이도 가중치로 뽑는다. 1등급이 흔하고 5등급이 귀하다
//   2. 이로치는 따로 같은 확률로 뽑는다
// 알 행동 조건(쓰다듬기·노래로 결과를 바꾸는 규칙)은 2026-09-28 삭제했다 (worklog/records/game-runtime/record.md "알에서 진화형이 나옴")
// 무작위는 받아서 쓴다 — 자체 검사가 결과를 정할 수 있어야 한다.
import type { DexOptions } from "../dex/data.js";
import { rankOf } from "../dex/species.js";
import { hatchVariants } from "../dex/regional.js";
import { EGG_RULES } from "./rules.js";

// [임시] 옛 이름 — src/tools 와 scripts/build-verify.cjs 가 새 자리(src/egg/rules.ts EGG_RULES)에서 읽으면 지운다
export const SHINY_ONE_IN = EGG_RULES.shinyOneIn;
export const RANK_WEIGHT = EGG_RULES.rankWeight;

export type Rand = () => number; // 0 이상 1 미만

export interface HatchResult {
  species: string;
  shiny: boolean;
}

// [임시] 옛 자리의 다시 내보내기 — src/tools 가 새 자리(src/dex/species.ts)에서 가져오면 지운다
export { rankOf };

// 난이도 가중치로 하나 뽑는다. 후보가 없으면 null
export function pickWeighted(candidates: string[], rand: Rand, opts?: DexOptions): string | null {
  if (!candidates.length) return null;
  const weights = candidates.map((slug) => EGG_RULES.rankWeight[rankOf(slug, opts)] ?? 1);
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return candidates[0] ?? null;
  let roll = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return candidates[i] ?? null;
  }
  return candidates[candidates.length - 1] ?? null;
}

// 알에서 나온 종의 모습 — 표(data/regional.json 의 hatch)에 있는 종만 한 번 더 뽑는다. 없으면 무작위를 쓰지 않고 그대로다.
// 배쓰나이는 적색근 45 · 청색근 45 · 백색근 10 (2026-10-03 사용자 결정). 알 열기만 부른다 — 줍기는 기본형이다
export function rollVariant(species: string, rand: Rand, opts?: DexOptions): string {
  const list = hatchVariants(species, opts);
  const total = list.reduce((a, [, w]) => a + w, 0);
  if (!list.length || total <= 0) return species;
  let roll = rand() * total;
  for (const [slug, w] of list) {
    roll -= w;
    if (roll < 0) return slug;
  }
  return list[list.length - 1]?.[0] ?? species;
}

// 알 하나의 결과. 후보가 하나도 없으면 null
export function decide(candidates: string[], rand: Rand, opts?: DexOptions): HatchResult | null {
  const species = pickWeighted(candidates, rand, opts);
  if (!species) return null;
  return { species, shiny: rand() < 1 / EGG_RULES.shinyOneIn };
}
