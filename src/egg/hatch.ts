// 부화 결과 판정 — 규칙은 docs/specs/game.md "알", 수치는 docs/specs/balance.md
//
// 결정 순서
//   1. 알에 저장한 후보 범위에서 수집 난이도 가중치로 뽑는다. 1등급이 흔하고 5등급이 귀하다
//   2. 이로치는 따로 같은 확률로 뽑는다
// 알 행동 조건(쓰다듬기·노래로 결과를 바꾸는 규칙)은 2026-09-28 삭제했다 (worklog/records/game-runtime/record.md "알에서 진화형이 나옴")
// 무작위는 받아서 쓴다 — 자체 검사가 결과를 정할 수 있어야 한다.
import type { DexOptions } from "../dex/data.js";
import { rankOf } from "../dex/species.js";
import { pickByWeight, type Rand } from "../shared/rand.js";
import { hatchVariants } from "../dex/regional.js";
import { EGG_RULES } from "./rules.js";



export interface HatchResult {
  species: string;
  shiny: boolean;
}

// 난이도 가중치로 하나 뽑는다. 후보가 없으면 null
export function pickWeighted(candidates: string[], rand: Rand, opts?: DexOptions): string | null {
  if (!candidates.length) return null;
  const weight = (slug: string): number => EGG_RULES.rankWeight[rankOf(slug, opts)] ?? 1;
  // 가중치 합이 0 이하면 난수를 쓰지 않고 첫 후보 — 공용 추첨은 null 을 준다
  return pickByWeight(candidates, weight, rand) ?? candidates[0] ?? null;
}

// 알에서 나온 종의 모습 — 표(data/regional.json 의 hatch)에 있는 종만 한 번 더 뽑는다. 없으면 무작위를 쓰지 않고 그대로다.
// 배쓰나이는 적색근 45 · 청색근 45 · 백색근 10 (2026-10-03 사용자 결정). 알 열기만 부른다 — 줍기는 기본형이다
export function rollVariant(species: string, rand: Rand, opts?: DexOptions): string {
  return pickByWeight(hatchVariants(species, opts), ([, w]) => w, rand)?.[0] ?? species;
}

// 알 하나의 결과. 후보가 하나도 없으면 null
export function decide(candidates: string[], rand: Rand, opts?: DexOptions): HatchResult | null {
  const species = pickWeighted(candidates, rand, opts);
  if (!species) return null;
  return { species, shiny: rand() < 1 / EGG_RULES.shinyOneIn };
}
