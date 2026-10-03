// 해금 판정 — data/unlocks.json 의 규칙 하나를 세상(저장 + 시각)에 대 본다 (design.md "도감 · 해금")
//
// 조건 종류마다 함수 하나. 규칙에 적힌 조건은 전부 만족해야 한다. 판정은 순수 — 저장을 바꾸지 않는다
//   starter  표시다 — 항상 참 (첫 실행 선택 화면에 나온다)
//   base     진화 전 첫 단계 종 — 항상 참. 처음부터 해금해 랜덤알에서 나온다 (2026-09-25 사용자 결정)
//   evolve   `from` 종을 가진 마리 중 친밀도가 임계 이상인 마리가 있다. `when` 은 지금 시간대
//   bond     `of` 종을 가진 마리의 친밀도 ≥ affinity
//   time     지금 게임 시간대 = day | night
//   event    오늘(로컬) = "MM-DD"
// 시간대는 게임 시간 — 30분마다 낮과 밤이 바뀐다. 진화와 같은 기준이다 (src/shared/clock.ts gameDayPart)
// 상점 가격 조건(shop)은 2026-09-29 뺐다 — 종 가격은 상점이 수집 난이도로 정한다 (src/shop/catalog.ts speciesPrice)
// 파티(party)·작업 시간(work)·연속 교감(streak) 조건도 2026-09-29 뺐다 — 메타몽·라프라스는 업적 보상(src/achievement/core.ts),
// 럭키는 핑복 진화로 얻는다 (사용자 결정)

import { gameDayPart, localDate } from "../shared/clock";
import { UNLOCK_RULES } from "./rules";
import type { SaveV3 } from "../shared/save-v3";
import type { DayPart, UnlockRule } from "../shared/species";
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "./data";

export type UnlockRules = Record<string, UnlockRule>;

// 아래 판정기(check · evaluate · evolvers)가 보는 세상 — 시각과 파티의 종·친밀도, 해금 목록. 저장 v2 의 모양(src/save/v2/types.ts World)이 이 모양을 채운다
export interface UnlockPet {
  species: string;
  affinity: number;
}
export interface UnlockWorld<P extends UnlockPet = UnlockPet> {
  now: number; // ms
  save: { party: P[]; unlocked: string[] };
}

export const dayPartOf = (now: number): DayPart => gameDayPart(now);

// 그 종을 가진 마리들 — 슬러그는 정규화해 비교
const petsOf = <P extends UnlockPet>(species: string, party: P[]): P[] => {
  const key = normalizeSlug(species);
  return party.filter((p) => normalizeSlug(p.species) === key);
};

// ── 조건별 판정 ────────────────────────────────────────────────────────────────
export const checkStarter = (_flag: true, _world: UnlockWorld): boolean => true;
export const checkBase = (_flag: true, _world: UnlockWorld): boolean => true;

export function checkEvolve(cond: NonNullable<UnlockRule["evolve"]>, world: UnlockWorld): boolean {
  if (cond.when && dayPartOf(world.now) !== cond.when) return false;
  return petsOf(cond.from, world.save.party).some((p) => p.affinity >= cond.affinity);
}

export const checkBond = (cond: NonNullable<UnlockRule["bond"]>, world: UnlockWorld): boolean =>
  petsOf(cond.of, world.save.party).some((p) => p.affinity >= cond.affinity);

export const checkTime = (part: DayPart, world: UnlockWorld): boolean => dayPartOf(world.now) === part;

export const checkEvent = (cond: NonNullable<UnlockRule["event"]>, world: UnlockWorld): boolean => localDate(world.now).slice(5) === cond.date;

// ── 규칙 하나 ──────────────────────────────────────────────────────────────────
// 적힌 조건 전부 만족. 아는 조건이 하나도 없는 규칙(빈 객체)은 거짓 — 해금 길이 없는 것으로 본다
export function check(rule: UnlockRule, world: UnlockWorld): boolean {
  let seen = 0;
  const need = (ok: boolean): boolean => {
    seen += 1;
    return ok;
  };
  if (rule.starter !== undefined && !need(checkStarter(rule.starter, world))) return false;
  if (rule.base !== undefined && !need(checkBase(rule.base, world))) return false;
  if (rule.evolve !== undefined && !need(checkEvolve(rule.evolve, world))) return false;
  if (rule.bond !== undefined && !need(checkBond(rule.bond, world))) return false;
  if (rule.time !== undefined && !need(checkTime(rule.time, world))) return false;
  if (rule.event !== undefined && !need(checkEvent(rule.event, world))) return false;
  return seen > 0;
}

// 새로 해금될 슬러그 — 규칙을 만족하고 아직 save.unlocked 에 없는 것. 규칙 표의 순서대로
export function evaluate(rules: UnlockRules, world: UnlockWorld): string[] {
  const done = new Set(world.save.unlocked.map(normalizeSlug));
  const out: string[] = [];
  for (const [slug, rule] of Object.entries(rules)) {
    if (isMetaKey(slug) || done.has(normalizeSlug(slug))) continue;
    if (check(rule, world)) out.push(slug);
  }
  return out;
}

// 첫 실행 선택 화면에 나오는 종
export const starters = (rules: UnlockRules): string[] =>
  Object.entries(rules)
    .filter(([slug, rule]) => !isMetaKey(slug) && rule.starter === true)
    .map(([slug]) => slug);

// 그 규칙으로 지금 진화할 마리들 — evolve 조건이 참일 때 커맨드 처리기가 종을 바꿀 대상
export function evolvers<P extends UnlockPet>(rule: UnlockRule, world: UnlockWorld<P>): P[] {
  const cond = rule.evolve;
  if (!cond || !check(rule, world)) return [];
  return petsOf(cond.from, world.save.party).filter((p) => p.affinity >= cond.affinity);
}

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
  const part = dayPartOf(now);
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
