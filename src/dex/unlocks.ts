// 해금 — data/unlocks.json 의 규칙을 저장과 시각에 대 보고 해금한다 (design.md "도감 · 해금")
//
// unlockByRules 가 규칙에 적힌 조건을 전부 본다(진화 규칙은 진화할 때 해금되므로 건너뛴다). 아는 조건이 하나도 없는 규칙은 해금하지 않는다
//   starter  표시다 — 항상 참 (첫 실행 선택 화면에 나온다)
//   base     진화 전 첫 단계 종 — 항상 참. 처음부터 해금해 랜덤알에서 나온다 (2026-09-25 사용자 결정)
//   evolve   `from` 종을 가진 마리 중 친밀도가 임계 이상인 마리가 있다. `when` 은 지금 시간대
//   bond     `of` 종을 가진 마리의 친밀도 ≥ affinity
//   time     지금 게임 시간대 = day | night
//   event    오늘(로컬) = "MM-DD"
// 시간대는 게임 시간 — 30분마다 낮과 밤이 바뀐다. 진화와 같은 기준이다 (src/shared/clock.ts gameDayPart)
// 상점 가격 조건(shop)은 2026-09-29 뺐다 — 종 가격은 상점이 수집 난이도로 정한다 (src/shop/catalog.ts speciesPrice)
// 파티(party)·작업 시간(work)·연속 교감(streak) 조건도 2026-09-29 뺐다 — 메타몽·라프라스는 업적 보상(src/achievement/evaluate.ts),
// 럭키는 핑복 진화로 얻는다 (사용자 결정)

import { gameDayPart, localDate } from "../shared/clock";
import { UNLOCK_RULES } from "./rules";
import type { SaveV3 } from "../shared/save-v3";
import type { UnlockRule } from "../shared/species";
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";

export type UnlockRules = Record<string, UnlockRule>;

// 첫 실행 선택 화면에 나오는 종
export const starterSlugs = (rules: UnlockRules): string[] =>
  Object.entries(rules)
    .filter(([slug, rule]) => !isMetaKey(slug) && rule.starter === true)
    .map(([slug]) => slug);

// data/unlocks.json 전부
export const unlockRules = (opts?: DexOptions): UnlockRules => loadJson<UnlockRules>("unlocks.json", opts);

// ── 해금 정리 (한 번) ──────────────────────────────────────────────────────────
// 옛 규칙이 처음부터 해금한 종 가운데 이제 알에서만 나오는 종을 되돌린다 (2026-09-27 사용자 결정 "획득하지 않은 것만 한 번 정리")
//   판 1  화석·패러독스가 기본형에서 빠졌다. 규칙이 없고 얻지 않은 종의 해금을 지운다. 얻은 종은 그대로 둔다
//   정리는 판(UNLOCK_RULES.rev)마다 한 번 — 새 저장은 지금 판으로 시작한다
export function pruneUnlocks(save: SaveV3, rules: UnlockRules): string[] {
  if (save.dex.rulesRev >= UNLOCK_RULES.rev) return [];
  const obtained = new Set(save.dex.obtained.map(normalizeSlug));
  const removed = save.dex.unlocked.filter((slug) => !rules[slug] && !obtained.has(normalizeSlug(slug)));
  save.dex.unlocked = save.dex.unlocked.filter((slug) => !removed.includes(slug));
  save.dex.rulesRev = UNLOCK_RULES.rev;
  return removed;
}

// ── v3 저장 해금 ───────────────────────────────────────────────────────────────
// 규칙을 만족한 종을 save.dex.unlocked 에 더한다. 새로 해금한 슬러그를 돌려준다
//   게임 틱(state/time.ts applyTime)과 모든 거래 뒤(tx/executor.ts)에 부른다 — 첫 선택 직후 다른 후보·기본형도 해금된다
//   evolve 규칙은 보지 않는다 — 실제로 진화할 때 해금한다
//   친밀도는 가진 마리 전부로 본다
export function unlockByRules(save: SaveV3, now: number, opts?: DexOptions): string[] {
  const rules = unlockRules(opts);
  pruneUnlocks(save, rules);
  const done = new Set(save.dex.unlocked.map(normalizeSlug));
  const part = gameDayPart(now);
  const out: string[] = [];
  for (const [slug, r] of Object.entries(rules)) {
    if (isMetaKey(slug) || r.evolve || done.has(normalizeSlug(slug))) continue;
    let seen = 0;
    const ok = (cond: boolean): boolean => ((seen += 1), cond);
    if (r.bond && !ok(save.pets.some((p) => normalizeSlug(p.species) === normalizeSlug(r.bond!.of) && p.affinity >= r.bond!.affinity))) continue;
    if (r.time && !ok(part === r.time)) continue;
    if (r.event && !ok(localDate(now).slice(5) === r.event.date)) continue;
    if (r.starter) ok(true);
    if (r.base) ok(true);
    if (seen === 0) continue;
    save.dex.unlocked.push(slug);
    out.push(slug);
  }
  return out;
}
