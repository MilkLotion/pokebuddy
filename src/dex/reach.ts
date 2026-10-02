// 해금 사슬 도달 검사 — 모든 종이 실제로 얻어질 수 있는지 규칙을 따라가며 넓힌다 (worklog/records/s5-design-system-v2/feedback.md SR-06)
//
// 얻는 길(획득)과 해금을 나눠 본다. 시작은 첫 선택 후보 전부다(누구를 골라도 다른 후보는 해금돼 있다).
//   랜덤알       해금한 종 가운데 랜덤알에서 나올 수 있는 종을 얻는다 (src/shop/catalog.ts inRandomEgg)
//   종 목록 알   목록의 종을 얻는다 — 태고의돌(화석)과 단일 포켓몬 알 (data/eggs.json)
//   진화 규칙    `from` 종을 얻었으면 대상 종을 해금하고, 진화로 얻는다. 도구 진화의 도구는 상점에 있다 (SHOP_RULES.evoItemPrice)
//   진화 사슬    진화는 해금과 무관하게 된다(src/dex/evolve.ts). 앞 단계 종을 얻었으면 진화형도 얻는다 — 핑복 → 럭키
//   기본형·교감·시간대·날짜 규칙  조건을 채우면 해금된다 — 해금된 뒤 랜덤알로 얻는다(진화 전용이 아니면)
//   업적 보상    업적 보상 종(메타몽·라프라스)을 얻는다. 규칙표에는 없다 (data/achievements.json, 2026-09-29)
// 결과는 순수하다. 저장을 바꾸지 않는다
import type { DexOptions } from "./data";
import { unlockRules } from "./unlocks.js";
import { prevOf } from "./evo.js";
import { fixedEggs, inRandomEgg, rewardSpecies } from "./obtain.js";

export interface Reach {
  obtainable: Set<string>; // 얻을 수 있는 종
  unlocked: Set<string>; // 해금될 수 있는 종
  withRule: string[]; // 해금 규칙이 있는 종
  unreachable: string[]; // 규칙이 있는데 얻을 수 없는 종 — 끊긴 사슬
  brokenFrom: string[]; // 진화 규칙의 `from` 이 규칙표·알 어디에도 없는 종
}

export function reach(opts?: DexOptions): Reach {
  const rules = unlockRules(opts);
  const fixedPool = fixedEggs(opts).flatMap(([, pool]) => pool);
  const entries = Object.entries(rules).filter(([slug]) => !slug.startsWith("_"));

  const unlocked = new Set<string>(entries.filter(([, r]) => r.starter).map(([s]) => s));
  const obtainable = new Set<string>();
  const add = (set: Set<string>, slug: string): boolean => (set.has(slug) ? false : (set.add(slug), true));

  let grew = true;
  while (grew) {
    grew = false;
    for (const s of unlocked) if (inRandomEgg(s, opts)) grew = add(obtainable, s) || grew; // 랜덤알
    for (const s of fixedPool) grew = add(obtainable, s) || grew;
    for (const s of rewardSpecies(opts)) grew = add(obtainable, s) || grew; // 업적 보상
    for (const [slug, r] of entries) {
      if (r.evolve) {
        if (obtainable.has(r.evolve.from)) {
          grew = add(unlocked, slug) || grew;
          grew = add(obtainable, slug) || grew;
        }
      } else if (r.base || r.bond || r.time || r.event) {
        grew = add(unlocked, slug) || grew;
      }
      const prev = prevOf(slug, opts);
      if (prev && obtainable.has(prev)) grew = add(obtainable, slug) || grew;
    }
  }

  const known = new Set<string>([...entries.map(([s]) => s), ...fixedPool, ...rewardSpecies(opts)]);
  const withRule = entries.map(([s]) => s);
  return {
    obtainable,
    unlocked,
    withRule,
    unreachable: withRule.filter((s) => !obtainable.has(s)),
    brokenFrom: entries.filter(([, r]) => r.evolve && !known.has(r.evolve.from)).map(([s]) => s),
  };
}
