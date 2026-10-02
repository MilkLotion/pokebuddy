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
//   points      포인트 증가 ≤ 시간 적립 + 줍기 + 우편 + 판매(도구·포켓몬) + 민트 환불
//   spend       늘어난 도구·새 알의 값 ≤ 그사이 쓸 수 있었던 포인트
//   bag         팔지 않는 도구가 출처 없이 늘었다
//   mail        서버에서 받지 않은 편지를 넣었다
//   achievement 없는 업적을 받았다
//   level       레벨 1~100, 경험치 0~최대, 레벨 ≤ 경험치가 허락하는 레벨
//   exp         경험치 증가 합 ≤ 쓴 사탕 + 살 수 있었던 사탕
//   affinity    친밀도는 줄지 않고, 증가 ≤ 시간·돌봄 상한 + 장난감
//   new-pets    새 개체 수(같은 틈에 얻어서 판 개체 포함) ≤ 출처 수
//   pet-id      사라진 id 가 다시 나타나거나, 새 id 가 이전 번호(petSeq) 이하
//   species     기존 개체의 종 변경은 진화 간선·forms 안에서만
//   identity    기존 개체의 성격·성별 변경
//   shiny       새 이로치는 알·줍기·교환·모습이 바뀌는 약에서만
//   eggs        알은 6개 이하
//   egg         알을 고쳤다 — 같은 id 알의 종류·후보가 바뀜, 새 알 id 가 이전 번호 이하, eggSeq 감소, 후보가 그 알의 범위 밖
//   egg-roll    계정 시드로 다시 계산한 알 결과(보너스 알·종·이로치)와 새 저장이 다르다 (P4b, D24)
//
// 결정적 난수(seededRand)와 알 결과 계산(rollEgg)도 여기 둔다 — 앱의 알 열기(src/egg/open.ts)가 같은 난수를 쓰고,
// 자체 검사가 앱의 open() 과 rollEgg() 의 결과가 같은지 대조한다

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
  eggKinds: Record<string, EggKind>;
  ranks: Record<string, number>; // 종 → 수집 난이도(1 이 아닌 것만). 없으면 1
  rankWeight: Record<string, number>; // 난이도 → 추첨 가중치 (src/egg/hatch.ts RANK_WEIGHT)
  shinyOneIn: number;
  randomPool: string[]; // 랜덤알 후보가 될 수 있는 종 전체(src/shop/catalog.ts inRandomEgg). 해금 여부는 보지 않는다
  rules: {
    pointMs: number; // 가중 시간 이만큼에 1P
    maxPartySlots: number;
    maxEarnFactor: number; // 친밀도 배율(2) × 작업 배율(2) × 돌봄 보너스 최대(2.8)
    findPointsMax: number; // 줍기 한 번 최대 포인트
    mintRefund: number;
    sellRatio: number;
    petSellMax: number; // 포켓몬 한 마리 판매가의 최대 (src/shop/sell-pet.ts)
    speciesMinPrice: number; // 종 지정 구매 최저가
    affinityPerHour: number; // 시간 적립 최대(버프·작업 반영)
    carePerHour: number; // 밥·놀기 쿨타임 기준 최대
    careOnce: number; // 밥 한 번 + 놀기 한 번 — 짧은 틈에도 한 번씩은 할 수 있다
    toyAffinity: number;
    maxEggs: number;
    slackMs: number; // 파일 쓰기(15초)·틱(30초) 지연 — 짧은 틈에도 이만큼은 흐른 것으로 본다
  };
}

// 알 종류 — 보너스 알 표(데이터 순서 그대로), 단일 포켓몬 알 여부와 그 후보 전체
export interface EggKind {
  bonus: [string, number][];
  single: boolean;
  pool: string[];
}

export interface VerifyContext {
  gapMs: number; // 서버 시각 기준 직전 저장 뒤 흐른 시간 — 부르는 쪽이 72시간(D25)으로 자른다
  margin: number; // D32 1.1
  letters: Record<string, unknown[]>; // 이 사용자가 서버에서 받은 편지 → 선물 (mail_claims). 새로 넣은 편지 id 를 여기서 찾는다
  // 교환으로 받은 개체 — 서버가 남긴 상대 제안(P5: 제안 값은 서버가 서버 저장에서 만든다). 받은 개체는 종·성격이 같고 레벨이 제안 이상이어야 한다
  received: unknown[]; // 직전 저장 뒤 끝난 교환에서 받은 제안
  receivedBefore: Record<string, unknown>; // 직전 저장 전(30일 안)에 끝난 교환 채널 → 받은 제안 — 걸려 있던 교환(trade.pending)이 풀렸을 때
  seed: string | null; // 계정 시드 (P4b) — 없으면 알 결과를 대조하지 않는다
}

// ── 결정적 난수 (P4b) ──────────────────────────────────────────────────────────
// FNV-1a 로 32비트 씨앗을 만들고 mulberry32 로 수를 낸다. 순수 JS 라 앱(node)과 Edge Function(Deno)이 같은 수를 낸다
export function seededRand(seed: string, key: string): () => number {
  const text = `${seed}:${key}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 알 하나를 열면 무엇이 나오는가 — src/egg/open.ts 와 같은 순서로 수를 쓴다
//   보너스 알 표가 있으면 1회 → (보너스가 아니면) 종 가중 추첨 1회 → 이로치 1회
//   waiting 은 그 알을 열 때 돌보미집에 있던 알(연 알 포함), obtained 는 그때 얻은 종 — 앱은 열기 직전 저장, 규칙은 여는 순서를 대입한 모의 상태
export type EggRoll = { egg: string } | { species: string; shiny: boolean } | null;
export function rollEgg(egg: { id: string; kind: string; candidates: string[] }, waiting: { kind: string }[], obtained: string[], rand: () => number, data: VerifyData): EggRoll {
  const kind = data.eggKinds[egg.kind];
  const table = kind?.bonus ?? [];
  if (table.length) {
    const roll = rand();
    let acc = 0;
    for (const [next, p] of table) {
      acc += p;
      if (roll < acc) {
        const single = data.eggKinds[next];
        const give = !single?.single || single.pool.filter((s) => !obtained.includes(s)).length > waiting.filter((e) => e.kind === next).length;
        if (give) return { egg: next };
        break;
      }
    }
  }
  const candidates = kind?.single ? egg.candidates.filter((s) => !obtained.includes(s)) : egg.candidates;
  if (!candidates.length) return null;
  const weights = candidates.map((s) => data.rankWeight[String(data.ranks[s] ?? 1)] ?? 1);
  const total = weights.reduce((a, w) => a + w, 0);
  let species = candidates[candidates.length - 1] as string;
  if (total <= 0) species = candidates[0] as string;
  else {
    let roll = rand() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll < 0) {
        species = candidates[i] as string;
        break;
      }
    }
  }
  return { species, shiny: rand() < 1 / data.shinyOneIn };
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
const eggsOf = (save: Raw): { id: string; kind: string; candidates: string[] }[] =>
  list(save.eggs).filter(isObj).map((e) => ({ id: str(e.id), kind: str(e.kind), candidates: list(e.candidates).map(str) }));
const obtainedOf = (save: Raw): string[] => (isObj(save.dex) ? list(save.dex.obtained).map(str) : []);
const eggNo = (id: string): number => {
  const m = /^e(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};
// 다음 알 번호의 바탕 — src/shop/buy.ts nextEggId 와 같다
const eggSeqOf = (save: Raw): number => Math.max(num(save.eggSeq), maxOf(eggsOf(save).map((e) => eggNo(e.id))));
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
// 지금까지 쓴 개체 번호 — src/party/create.ts nextPetId 와 같다. petSeq 가 없는 옛 저장은 지금 있는 개체의 가장 큰 번호
const petSeqOf = (save: Raw): number => Math.max(num(save.petSeq), maxOf(petsOf(save).map((p) => idNo(p.id))));
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

  // 교환 — 그사이 끝난 교환에서 받은 제안 + 직전 저장에 걸려 있다 풀린 교환의 제안(직전 저장 전에 끝났다)
  const heldBefore = pendingChannel(prev);
  const offers = [...ctx.received];
  if (heldBefore && !pendingChannel(next) && ctx.receivedBefore[heldBefore] != null) offers.push(ctx.receivedBefore[heldBefore]);

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
  // 포켓몬 판매 — 사라진 개체와, 같은 틈에 얻어서 판 개체(번호만 늘고 두 저장 어디에도 없다)를 가장 비싼 값에 판 것으로 넉넉히 본다.
  // 교환으로 보낸 개체도 사라진 개체로 센다
  const prevPetSeq = petSeqOf(prev);
  const keptIds = new Set(petsOf(next).map((p) => p.id));
  const gonePets = petsOf(prev).filter((p) => !keptIds.has(p.id)).length;
  const vanishedPets = pos(petSeqOf(next) - prevPetSeq - petsOf(next).filter((p) => idNo(p.id) > prevPetSeq).length);
  const petSell = (gonePets + vanishedPets) * num(r.petSellMax);
  const earnPerHour = (HOUR / r.pointMs) * r.maxPartySlots * r.maxEarnFactor;
  const pointAllowance = earnPerHour * hours * m + 1 + findPoints + mailPoints + sell + petSell + mint;
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
  // 같은 틈에 만들어 연 알 — 번호만 늘고 두 저장 어디에도 없다. 연 알 수만큼은 보너스 알일 수 있고 나머지는 산 것이다
  const minEgg = Math.min(...Object.values(data.eggs).filter((p) => p > 0));
  const created = pos(eggSeqOf(next) - eggSeqOf(prev));
  const vanished = pos(created - newEggs.length);
  cost += pos(vanished - opened) * minEgg;
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
  // 교환으로 받은 개체 — 서버 제안과 종(같은 틈의 진화 포함)·성격이 같고 레벨이 제안 이상이어야 한다(P5).
  // 이로치는 같은 틈에 약으로 켜거나 껐을 수 있다 — 켠 수는 아래 약 예산으로 센다(검수 P5 M1).
  // 맞은 개체는 제안 값에서 늘어난 경험치·친밀도만 예산으로 센다. 나머지 새 개체는 새로 얻어 키운 개체다.
  // 레벨이 높은 제안부터, 레벨·경험치가 가장 가까운 개체와 맞춘다 — 같은 종·성격의 교환 둘을 엇갈려 맞추지 않게(검수 P5 M2)
  const tradedFrom = new Map<string, Pet>(); // 받은 개체 id → 그 제안
  const offerPets = offers.map((raw) => petOf({ id: "offer", ...(isObj(raw) ? raw : {}) })).filter((o): o is Pet => o != null).sort((a, b) => b.level - a.level);
  for (const o of offerPets) {
    const fits = fresh.filter((p) => !tradedFrom.has(p.id) && (p.species === o.species || reachable(data.evo, o.species, p.species))
      && p.nature === o.nature && p.level >= o.level);
    fits.sort((a, b) => (a.level - o.level) - (b.level - o.level) || Math.abs(a.exp - o.exp) - Math.abs(b.exp - o.exp));
    const hit = fits[0];
    if (hit) tradedFrom.set(hit.id, o);
  }
  let tradedTurnedShiny = 0;
  for (const [id, o] of tradedFrom) if (fresh.find((p) => p.id === id)?.shiny && !o.shiny) tradedTurnedShiny += 1;
  const traded = tradedFrom.size;
  const grown = fresh.filter((p) => !tradedFrom.has(p.id));

  // exp — 쓴 사탕 + 남은 포인트로 살 수 있었던 사탕
  let candy = 0;
  let expPerPoint = 0;
  for (const [id, it] of Object.entries(data.items)) {
    if (it.effect !== "exp" && it.effect !== "level") continue;
    const value = it.effect === "exp" ? it.amount : data.rareCandyExp;
    candy += pos(had(id) - (nextBag[id] ?? 0)) * value;
    if (it.price) expPerPoint = Math.max(expPerPoint, value / it.price);
  }
  const expGain = same.reduce((s, x) => s + pos(x.p.exp - x.q.exp), 0) + grown.reduce((s, p) => s + pos(p.exp), 0)
    + fresh.reduce((s, p) => s + pos(p.exp - (tradedFrom.get(p.id)?.exp ?? p.exp)), 0);
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
  for (const [id, o] of tradedFrom) {
    const p = fresh.find((x) => x.id === id);
    if (p) toyNeed += Math.ceil(pos(p.affinity - o.affinity - affinityCap) / r.toyAffinity);
  }
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
  add("shiny", turnedShiny + tradedTurnedShiny, potionBudget);

  // new-pets · pet-id · shiny(새 개체)
  const prevIds = new Set(prevPets.map((p) => p.id));
  for (const p of fresh) {
    if (prevIds.has(p.id) || idNo(p.id) <= prevPetSeq) add("pet-id", 1, 0, p.id);
  }
  const boughtAndOpened = Math.floor(leftover / minBuy); // 사서 연 알·종 지정 구매 — 두 저장 어디에도 흔적이 없다
  add("new-pets", fresh.length + vanishedPets, opened + vanished + findPets + achievedPets + mailPets + traded + boughtAndOpened);
  add("shiny", fresh.filter((p) => p.shiny).length, opened + vanished + findPets + traded + boughtAndOpened);

  // eggs
  add("eggs", nextEggs.length, r.maxEggs);

  // egg — 알을 고쳐 결과를 고르지 못하게 한다(검수 P4b H3). 결과는 알 id·종류·후보로 정해진다
  const prevEggById = new Map(prevEggs.map((e) => [e.id, e]));
  const prevSeq = eggSeqOf(prev);
  if (num(next.eggSeq) < num(prev.eggSeq)) add("egg", 1, 0);
  for (const e of nextEggs) {
    const q = prevEggById.get(e.id);
    if (q) {
      if (q.kind !== e.kind || q.candidates.join("|") !== e.candidates.join("|")) add("egg", 1, 0);
      continue;
    }
    const kind = data.eggKinds[e.kind];
    const range = kind ? (kind.pool.length ? kind.pool : data.randomPool) : [];
    if (!kind || eggNo(e.id) <= prevSeq || e.candidates.some((c) => !range.includes(c))) add("egg", 1, 0);
  }

  // egg-roll — 열린 알마다 계정 시드로 결과를 다시 계산한다. 한 틈에 여러 알을 열면 순서를 모른다 —
  // 여는 순서를 모두 대입해(알은 6개 이하) 돌보미집·얻은 종을 차례로 바꾸며 계산하고, 하나라도 맞으면 인정한다(검수 P4b H1)
  //   보너스 알 — 새 저장에 그 종류의 새 알이 있으면 그것, 없으면 같은 틈에 열린 알(vanished)로 본다. 그 결과는 대조할 수 없다
  //   부화한 개체 — 같은 틈에 진화·모습 바꾸기·이로치 약을 썼을 수 있다. 종은 진화 간선·forms 로, 이로치는 어느 쪽이든 인정한다
  if (ctx.seed) {
    const seed = ctx.seed;
    const toOpen = prevEggs.filter((x) => !nextEggIds.has(x.id));
    const freshEggs = nextEggs.filter((e) => !prevEggIds.has(e.id));
    const petFits = (p: Pet, species: string, shiny: boolean): boolean =>
      (p.species === species || reachable(data.evo, species, p.species) || p.forms.includes(species)) && (p.shiny === shiny || potionBudget > 0 || p.shiny === false);
    // 한 순서의 결과 — 대조하지 못한 알 수
    const tryOrder = (order: typeof toOpen): number => {
      const waiting = [...prevEggs];
      const obtained = [...obtainedOf(prev)];
      const usedPets = new Set<string>();
      const usedEggs = new Set<string>();
      let vanishedLeft = vanished;
      let misses = 0;
      for (const e of order) {
        const roll = rollEgg(e, waiting, obtained, seededRand(seed, `egg:${e.id}`), data);
        const at = waiting.findIndex((w) => w.id === e.id);
        if (at >= 0) waiting.splice(at, 1);
        if (!roll) continue;
        if ("egg" in roll) {
          const hit = freshEggs.find((x) => x.kind === roll.egg && !usedEggs.has(x.id));
          if (hit) {
            usedEggs.add(hit.id);
            waiting.push(hit);
          } else if (vanishedLeft > 0) vanishedLeft -= 1;
          else misses += 1;
          continue;
        }
        const hit = grown.find((p) => !usedPets.has(p.id) && petFits(p, roll.species, roll.shiny));
        if (hit) {
          usedPets.add(hit.id);
          if (!obtained.includes(roll.species)) obtained.push(roll.species);
        } else misses += 1;
      }
      return misses;
    };
    let best = toOpen.length;
    const walk = (left: typeof toOpen, order: typeof toOpen): void => {
      if (best === 0) return;
      if (!left.length) {
        best = Math.min(best, tryOrder(order));
        return;
      }
      for (let i = 0; i < left.length; i++) walk([...left.slice(0, i), ...left.slice(i + 1)], [...order, left[i] as (typeof toOpen)[number]]);
    };
    if (toOpen.length <= 6) walk(toOpen, []);
    else best = tryOrder(toOpen); // 알은 6개가 상한이다 — 넘으면 eggs 규칙이 이미 걸었다
    add("egg-roll", best, 0);
  }

  return out;
}
