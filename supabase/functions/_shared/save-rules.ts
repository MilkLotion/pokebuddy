// 생성 파일 — src/verify/save-rules.ts 복사본. 고치지 말고 scripts/build-verify.cjs 를 돌린다
// 서버 저장 검증 규칙 v1 — 직전 서버 저장과 새 저장을 비교해 정상 플레이로 불가능한 변화를 찾는다.
// 설계는 worklog/records/cloud-authority/record.md "P4 서버 검증", 수치 근거는 docs/specs/balance.md "서버 검증 상한"
//
// 이 파일은 import 가 없다 — scripts/build-verify.cjs 가 그대로 supabase/functions/_shared/save-rules.ts 로 복사한다(Deno).
// node 자체 검사(src/tools/selftest-verify.ts)도 이 파일을 그대로 부른다
// 저장 모양은 src/shared/save-v3.ts 를 따르되, 손으로 만든 JSON 도 받으므로 모든 값을 의심해서 읽는다
//
// 규칙 (상한에는 여유 비율 margin 을 곱한다 — D32 1.1. 틈에는 파일 쓰기·틱 지연 slackMs 를 더한다)
//   work        작업 시간 증가 ≤ 틈
//   points      포인트 증가 ≤ 시간 적립 + 줍기 + 우편 + 판매 + 민트 환불
//   spend       늘어난 도구·새 알의 값 ≤ 그사이 쓸 수 있었던 포인트
//   bag         팔지 않는 도구가 출처 없이 늘었다
//   mail        서버에서 받지 않은 편지를 넣었다
//   achievement 없는 업적을 받았다
//   level       레벨 1~100, 경험치 0~최대, 레벨 ≤ 경험치가 허락하는 레벨
//   exp         경험치 증가 합 ≤ 쓴 사탕 + 살 수 있었던 사탕
//   affinity    친밀도는 줄지 않고, 증가 ≤ 시간·돌봄 상한 + 장난감
//   new-pets    새 개체 수 ≤ 출처 수
//   pet-id      사라진 id 가 다시 나타나거나, 새 id 가 이전 최대 번호 이하
//   species     기존 개체의 종 변경은 진화 간선·forms 안에서만
//   identity    기존 개체의 성격·성별 변경
//   shiny       새 이로치는 알·줍기·교환·모습이 바뀌는 약에서만
//   eggs        알은 6개 이하

export interface VerifyItem {
  price: number | null;
  effect: string;
  amount: number;
}

// scripts/build-verify.cjs 가 data/ 와 규칙표에서 뽑는다
export interface VerifyData {
  items: Record<string, VerifyItem>;
  eggs: Record<string, number>; // 알 종류 → 값
  achievements: Record<string, "pokemon" | "party-slot">; // 업적 → 보상 종류
  evo: Record<string, string[]>; // 종(모습 슬러그 포함) → 한 단계 진화 종
  growth: Record<string, string>; // 종 → 성장 곡선 이름
  expTable: Record<string, number[]>; // 성장 곡선 → [레벨 1..100 의 누적 경험치] (src/dex/growth.ts expForLevel)
  maxExp: number; // 모든 성장 곡선의 100레벨 누적 경험치 중 최대
  rareCandyExp: number; // 이상한사탕 하나가 올릴 수 있는 경험치 최대(한 레벨 간격 최대)
  rules: {
    pointMs: number; // 가중 시간 이만큼에 1P
    maxPartySlots: number;
    maxEarnFactor: number; // 친밀도 배율(2) × 작업 배율(2)
    findPointsMax: number; // 줍기 한 번 최대 포인트
    mintRefund: number;
    sellRatio: number;
    speciesMinPrice: number; // 종 지정 구매 최저가
    affinityPerHour: number; // 시간 적립 최대(버프·작업 반영)
    carePerHour: number; // 밥·놀기 쿨타임 기준 최대
    careOnce: number; // 밥 한 번 + 놀기 한 번 — 짧은 틈에도 한 번씩은 할 수 있다
    toyAffinity: number;
    maxEggs: number;
    slackMs: number; // 파일 쓰기(15초)·틱(30초) 지연 — 짧은 틈에도 이만큼은 흐른 것으로 본다
  };
}

export interface VerifyContext {
  gapMs: number; // 서버 시각 기준 직전 저장 뒤 흐른 시간 — 부르는 쪽이 72시간(D25)으로 자른다
  margin: number; // D32 1.1
  letters: Record<string, unknown[]>; // 이 사용자가 서버에서 받은 편지 → 선물 (mail_claims). 새로 넣은 편지 id 를 여기서 찾는다
  trades: number; // 직전 저장 뒤 끝난 교환 수 (trade_channels)
  tradesBefore: string[]; // 직전 저장 전에 끝난 교환 채널 — 걸려 있던 교환(trade.pending)이 풀렸을 때 출처로 본다
}

export interface Violation {
  rule: string;
  value: number;
  limit: number;
  pet?: string;
}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => v != null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pos = (n: number): number => (n > 0 ? n : 0);
const HOUR = 3_600_000;
const isMint = (id: string): boolean => id === "mint" || id.endsWith("-mint"); // 성격민트 은퇴 — 저장을 읽을 때 개당 환불(src/bag/mint.ts)

// 누적 경험치로 읽는 레벨 — 표의 경험치 이하인 가장 큰 레벨
function levelFor(table: number[], exp: number): number {
  let level = 1;
  for (let i = 1; i < table.length; i++) {
    if ((table[i] ?? Infinity) > exp) break;
    level = i + 1;
  }
  return level;
}

interface Pet {
  id: string;
  since: number;
  species: string;
  shiny: boolean;
  nature: string;
  gender: string;
  level: number;
  exp: number;
  affinity: number;
  forms: string[];
}

const petOf = (v: unknown): Pet | null => {
  if (!isObj(v) || typeof v.id !== "string") return null;
  return {
    id: v.id,
    since: num(v.since),
    species: str(v.species),
    shiny: v.shiny === true,
    nature: str(v.nature),
    gender: str(v.gender),
    level: num(v.level),
    exp: num(v.exp),
    affinity: num(v.affinity),
    forms: list(v.forms).map(str),
  };
};

const petsOf = (save: Raw): Pet[] => list(save.pets).map(petOf).filter((p): p is Pet => p != null);
const bagOf = (save: Raw): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(save.bag)) for (const [k, v] of Object.entries(save.bag)) out[k] = num(v);
  return out;
};
const balanceOf = (save: Raw): number => (isObj(save.points) ? num(save.points.balance) : 0);
const workOf = (save: Raw): number => (isObj(save.totals) ? num(save.totals.workMs) : 0);
const findOf = (save: Raw): { seq: number; log: Raw[] } => {
  const f = isObj(save.find) ? save.find : {};
  return { seq: num(f.seq), log: list(f.log).filter(isObj) };
};
const eggsOf = (save: Raw): { id: string; kind: string }[] => list(save.eggs).filter(isObj).map((e) => ({ id: str(e.id), kind: str(e.kind) }));
const claimed = (save: Raw): Set<string> => {
  const out = new Set<string>();
  if (isObj(save.achievements)) for (const [k, v] of Object.entries(save.achievements)) if (isObj(v) && v.claimedAt != null) out.add(k);
  return out;
};
const appliedOf = (save: Raw): string[] => (isObj(save.mail) ? list(save.mail.applied).map(str) : []);
const pendingChannel = (save: Raw): string | null => {
  if (!isObj(save.trade) || !isObj(save.trade.pending)) return null;
  return str(save.trade.pending.channelId) || null;
};
const idNo = (id: string): number => {
  const m = /^p(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};
const maxOf = (values: number[]): number => {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
};

// 진화 간선으로 from 에서 to 에 닿는가 — 한 저장 사이에 여러 번 진화할 수 있다
function reachable(evo: Record<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const next of evo[cur] ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export function verifySave(prevRaw: unknown, nextRaw: unknown, ctx: VerifyContext, data: VerifyData): Violation[] {
  const out: Violation[] = [];
  if (!isObj(prevRaw) || !isObj(nextRaw)) return out; // 첫 저장은 first_trust 가 가른다
  const prev = prevRaw;
  const next = nextRaw;
  const r = data.rules;
  const m = ctx.margin;
  const hours = (pos(ctx.gapMs) + r.slackMs) / HOUR;
  const add = (rule: string, value: number, limit: number, pet?: string): void => {
    if (value > limit) out.push({ rule, value, limit: Math.floor(limit), ...(pet ? { pet } : {}) });
  };
  const priceOf = (id: string): number | null => data.items[id]?.price ?? null;
  const sellOf = (id: string): number => {
    const price = priceOf(id);
    return price ? Math.floor(price * r.sellRatio) : 0;
  };
  const maxSell = maxOf(Object.keys(data.items).map(sellOf));
  let minBuy = r.speciesMinPrice;
  for (const p of Object.values(data.eggs)) if (p > 0 && p < minBuy) minBuy = p;

  // 줍기 — 기록은 최근 것만 남으므로 모자란 몫은 최댓값으로 본다
  const pf = findOf(prev);
  const nf = findOf(next);
  const newFinds = pos(nf.seq - pf.seq);
  const seen = nf.log.filter((f) => Number(/^f(\d+)$/.exec(str(f.id))?.[1] ?? 0) > pf.seq);
  const unseen = pos(newFinds - seen.length);
  const findPoints = seen.reduce((s, f) => s + (str(f.kind) === "points" ? num(f.amount) : 0), 0) + unseen * r.findPointsMax;
  const found: Record<string, number> = {};
  for (const f of seen) if (str(f.kind) === "item" || str(f.kind) === "evo") found[str(f.ref)] = (found[str(f.ref)] ?? 0) + 1;
  const findPets = seen.filter((f) => str(f.kind) === "pokemon").length + unseen;

  // 우편 — 새로 넣은 편지 id 를 서버에서 받은 편지와 대조한다(받은 시각이 아니라 id 로 — 올리기와 받기가 엇갈려도 맞다)
  const prevApplied = new Set(appliedOf(prev));
  let mailPoints = 0;
  let mailPets = 0;
  const mailItems: Record<string, number> = {};
  for (const id of new Set(appliedOf(next))) {
    if (prevApplied.has(id)) continue;
    const gifts = ctx.letters[id];
    if (!gifts) {
      add("mail", 1, 0);
      continue;
    }
    for (const g of gifts) {
      if (!isObj(g)) continue;
      const count = num(g.count);
      if (g.kind === "points") mailPoints += count;
      else if (g.kind === "pokemon") mailPets += count;
      else if (g.kind === "item" && isMint(str(g.id))) mailPoints += count * r.mintRefund;
      else if (g.kind === "item") mailItems[str(g.id)] = (mailItems[str(g.id)] ?? 0) + count;
    }
  }

  // 교환 — 그사이 끝난 교환 + 직전 저장에 걸려 있다 풀린 교환(직전 저장 전에 끝났다)
  const heldBefore = pendingChannel(prev);
  const traded = ctx.trades + (heldBefore && !pendingChannel(next) && ctx.tradesBefore.includes(heldBefore) ? 1 : 0);

  // work
  add("work", workOf(next) - workOf(prev), hours * HOUR * m);

  // points — 판매는 가방에서 줄어든 도구로 센다(사용으로 줄었어도 판 것으로 넉넉히 본다)
  const prevBag = bagOf(prev);
  const nextBag = bagOf(next);
  const had = (id: string): number => (prevBag[id] ?? 0) + (found[id] ?? 0) + (mailItems[id] ?? 0);
  let sell = 0;
  let mint = 0;
  for (const id of new Set([...Object.keys(prevBag), ...Object.keys(found), ...Object.keys(mailItems)])) {
    if (isMint(id)) mint += (prevBag[id] ?? 0) * r.mintRefund;
    else sell += pos(had(id) - (nextBag[id] ?? 0)) * sellOf(id);
  }
  sell += unseen * maxSell;
  const earnPerHour = (HOUR / r.pointMs) * r.maxPartySlots * r.maxEarnFactor;
  const pointAllowance = earnPerHour * hours * m + 1 + findPoints + mailPoints + sell + mint;
  add("points", balanceOf(next) - balanceOf(prev), pointAllowance);
  // 그사이 쓴 포인트의 상한 — 산 도구·알·개체의 값은 이 안이어야 한다
  const spendable = pos(balanceOf(prev) + pointAllowance - balanceOf(next));

  // spend · bag — 출처 없이 늘어난 도구는 산 것이다. 팔지 않는 도구는 살 수도 없다
  let cost = 0;
  for (const id of new Set([...Object.keys(nextBag), ...Object.keys(prevBag)])) {
    if (isMint(id)) continue;
    const gain = pos((nextBag[id] ?? 0) - had(id));
    if (gain === 0) continue;
    const price = priceOf(id);
    if (price == null || price <= 0) add("bag", gain, 0);
    else cost += gain * price;
  }
  // 새 알 — 연 알만큼은 보너스 알일 수 있다. 나머지는 싼 것부터 산 것으로 본다
  const prevEggs = eggsOf(prev);
  const nextEggs = eggsOf(next);
  const nextEggIds = new Set(nextEggs.map((e) => e.id));
  const prevEggIds = new Set(prevEggs.map((e) => e.id));
  const opened = prevEggs.filter((e) => !nextEggIds.has(e.id)).length;
  const newEggs = nextEggs.filter((e) => !prevEggIds.has(e.id)).map((e) => data.eggs[e.kind] ?? 0).sort((a, b) => a - b);
  for (const price of newEggs.slice(0, pos(newEggs.length - opened))) cost += price;
  add("spend", cost, spendable * m + 1);
  // 산 것을 빼고 남은 포인트 — 그사이 사서 바로 쓴 사탕·약·장난감, 사서 연 알, 종 지정 구매의 상한
  const leftover = pos(spendable - cost);

  // achievement
  const prevClaimed = claimed(prev);
  let achievedPets = 0;
  for (const k of claimed(next)) {
    if (prevClaimed.has(k)) continue;
    const reward = data.achievements[k];
    if (!reward) add("achievement", 1, 0);
    else if (reward === "pokemon") achievedPets += 1;
  }

  // level — 범위와 레벨·경험치 일치(이상한사탕은 경험치를 그 레벨 시작값으로 맞춘다)
  const nextPets = petsOf(next);
  for (const p of nextPets) {
    if (p.level < 1 || p.level > 100) add("level", p.level, 100, p.id);
    if (p.exp < 0 || p.exp > data.maxExp) add("level", p.exp, data.maxExp, p.id);
    const table = data.expTable[data.growth[p.species] ?? ""];
    if (table) add("level", p.level, levelFor(table, p.exp), p.id);
  }

  // 같은 개체 — id 와 since 가 같다. 새 개체 — 그 밖
  const prevPets = petsOf(prev);
  const prevById = new Map(prevPets.map((p) => [p.id, p]));
  const same = nextPets.map((p) => ({ p, q: prevById.get(p.id) })).filter((x): x is { p: Pet; q: Pet } => x.q != null && x.q.since === x.p.since);
  const fresh = nextPets.filter((p) => prevById.get(p.id)?.since !== p.since);
  // 교환으로 받은 개체는 상대 개체 값 그대로다 — 경험치가 큰 것부터 교환 수만큼 뺀다. 나머지는 새로 얻어 키운 개체다
  const grown = [...fresh].sort((a, b) => b.exp - a.exp).slice(traded);

  // exp — 쓴 사탕 + 남은 포인트로 살 수 있었던 사탕
  let candy = 0;
  let expPerPoint = 0;
  for (const [id, it] of Object.entries(data.items)) {
    if (it.effect !== "exp" && it.effect !== "level") continue;
    const value = it.effect === "exp" ? it.amount : data.rareCandyExp;
    candy += pos(had(id) - (nextBag[id] ?? 0)) * value;
    if (it.price) expPerPoint = Math.max(expPerPoint, value / it.price);
  }
  const expGain = same.reduce((s, x) => s + pos(x.p.exp - x.q.exp), 0) + grown.reduce((s, p) => s + pos(p.exp), 0);
  add("exp", expGain, (candy + leftover * expPerPoint) * m);

  // affinity — 시간·돌봄 상한을 넘는 몫은 장난감으로 올렸어야 한다. 장난감은 모든 개체가 함께 쓴다
  let toyBudget = 0;
  for (const [id, it] of Object.entries(data.items)) {
    if (it.effect !== "play-buff") continue;
    toyBudget += pos(had(id) - (nextBag[id] ?? 0)) + (it.price ? Math.floor(leftover / it.price) : 0);
  }
  const affinityCap = (r.affinityPerHour + r.carePerHour) * hours * m + r.careOnce;
  let toyNeed = 0;
  for (const { p, q } of same) {
    if (p.affinity < q.affinity) add("affinity", q.affinity - p.affinity, 0, p.id);
    toyNeed += Math.ceil(pos(p.affinity - q.affinity - affinityCap) / r.toyAffinity);
  }
  for (const p of grown) toyNeed += Math.ceil(pos(p.affinity - affinityCap) / r.toyAffinity);
  add("affinity", toyNeed, toyBudget);

  // identity · species · shiny(기존 개체)
  let potionBudget = 0;
  for (const [id, it] of Object.entries(data.items)) {
    if (it.effect !== "shiny-on") continue;
    potionBudget += pos(had(id) - (nextBag[id] ?? 0)) + (it.price ? Math.floor(leftover / it.price) : 0);
  }
  let turnedShiny = 0;
  for (const { p, q } of same) {
    if (p.nature !== q.nature) add("identity", 1, 0, p.id);
    if (q.gender && p.gender !== q.gender) add("identity", 1, 0, p.id);
    if (p.species !== q.species) {
      const ok = reachable(data.evo, q.species, p.species) || q.forms.includes(p.species) || p.forms.includes(q.species);
      if (!ok) add("species", 1, 0, p.id);
    }
    if (p.shiny && !q.shiny) turnedShiny += 1;
  }
  add("shiny", turnedShiny, potionBudget);

  // new-pets · pet-id · shiny(새 개체)
  const prevIds = new Set(prevPets.map((p) => p.id));
  const prevMax = maxOf(prevPets.map((p) => idNo(p.id)));
  for (const p of fresh) {
    if (prevIds.has(p.id) || idNo(p.id) <= prevMax) add("pet-id", 1, 0, p.id);
  }
  const boughtAndOpened = Math.floor(leftover / minBuy); // 사서 연 알·종 지정 구매 — 두 저장 어디에도 흔적이 없다
  add("new-pets", fresh.length, opened + findPets + achievedPets + mailPets + traded + boughtAndOpened);
  add("shiny", fresh.filter((p) => p.shiny).length, opened + findPets + traded + boughtAndOpened);

  // eggs
  add("eggs", nextEggs.length, r.maxEggs);

  return out;
}
