// 랜덤 배틀 한 판 — E3 (docs/specs/adventure.md "서버", docs/specs/balance.md "배틀 보상")
//   요청 { random: true } — 바로 랜덤 상대(2026-10-22 사용자 "상대방 고르지 않고 랜덤으로"). 서버가 상대를 고른다
//        { offerId, pick: 1~3 } — 상대 고르기(옛 앱). 지금 앱은 쓰지 않지만 그대로 받는다
//   1. 본인 확인 → 정지 계정·쿨타임(5분) 먼저 거부
//   2. 상대 — 바로 랜덤이면 battle_random_pick 이 실제 후보 하나를 주고, 여기서 샘플과 섞는다(아래 pickRandom)
//      상대 고르기면 보인 3개에 고정한 모습이다
//   3. 내 파티는 지금 서버 저장에서 전투 개체를 만든다. 시드는 서버가 만든다. 엔진(_shared/battle/engine.ts)을 돌린다
//   4. 판 요약(양쪽 칸의 종·모습·이로치와 준 피해·받은 피해·싸운 시간)을 만든다 — 관리자 정리 뒤에도 남아 배틀 상세가 읽는다(docs/specs/adventure.md "배틀 기록")
//      샘플 판은 요약에 상대 이름(foe.name)을 남긴다 — 배틀 기록이 상대 이름으로 읽는다
//   5. battle_record 가 쿨타임·offer 를 다시 보고(동시 요청), 보상(그날 첫 판 500 / 이기면 50 / 지거나 비기면 10)을 정해 판과 이벤트를 남긴다
//      샘플 판도 보상이 같다(2026-10-22 사용자 "권장대로 다 진행해")
//   6. { battleId, reward, result, events, sides, looks, dataHash, foe } — 앱은 이벤트를 재생하고, 보상을 저장에 더하고 battleId 를 남긴다
//      foe 는 바로 랜덤 판만 — { name } 상대 이름. 샘플은 샘플 이름, 실제 상대는 표시 이름(없으면 null)
import { damageLog, damageTally, runBattle, type EngineFighter } from "../_shared/battle/engine.ts";
import { BATTLE_BASIS, fighterFrom, lookOfSource, partyOf, type FighterSource, type StatBasis } from "../_shared/battle/fighter-core.ts";
import { battle, codeOf, fail, json, whoAmI, type BattleContext, type BattleSample } from "../_shared/battle-common.ts";

// basis — 능력치 기준. 챔피언 샘플만 싸움 레벨 60 이고 나머지는 BATTLE_BASIS(50)
const fighters = (party: (FighterSource | null)[], basis: StatBasis = BATTLE_BASIS): (EngineFighter | null)[] => party.map((s) => (s ? fighterFrom(battle.data, s, basis) : null));

// 판 요약 — 칸마다 { species, form, shiny, dealt, taken, activeMs }, 빈 칸은 null. 앞이 건 쪽(user_id)이다
function summaryOf(parties: [(FighterSource | null)[], (FighterSource | null)[]], result: ReturnType<typeof runBattle>, foeName: string | null): unknown {
  const tally = damageTally(damageLog(result.events, result.maxHp), result.maxHp, result.endMs);
  return {
    v: 1,
    endMs: result.endMs,
    ...(foeName ? { foe: { name: foeName } } : {}),
    sides: parties.map((party, side) =>
      party.map((s, slot) => {
        const d = tally[side as 0 | 1][slot];
        return s && d ? { species: s.species, form: s.form ?? null, shiny: s.shiny === true, dealt: d.dealt, taken: d.taken, activeMs: d.activeMs } : null;
      }),
    ),
  };
}

// 바로 랜덤의 상대 — battle_random_pick 의 답
interface RandomPick {
  pick: { user_id: string; party: (FighterSource | null)[]; name: string | null } | null; // 실제 후보 하나(직전 상대는 다른 후보가 있으면 뺐다)
  rate: number; // 실제 후보가 있을 때 샘플을 고를 확률 — 설정 battle_sample_rate
  last_sample: string | null; // 직전 판의 샘플 id
}
interface Foe {
  userId: string | null;
  sample: string | null;
  name: string | null;
  party: (FighterSource | null)[];
  basis?: StatBasis; // 샘플의 싸움 레벨 — 없으면 BATTLE_BASIS
}

const rand01 = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
const pickOf = <T,>(list: readonly T[]): T => list[Math.floor(rand01() * list.length)]!;

// 샘플 — 난이도를 같은 확률로 고르고 그 안에서 하나. 직전 샘플은 뺀다
function sampleFoe(last: string | null): Foe | null {
  const all = battle.samples ?? [];
  const levels = [...new Set(all.map((s) => s.level))];
  if (!levels.length) return null;
  const level = pickOf(levels);
  const inLevel = all.filter((s) => s.level === level);
  const rest = inLevel.filter((s) => s.id !== last);
  const s: BattleSample = pickOf(rest.length ? rest : inLevel);
  return { userId: null, sample: s.id, name: s.name, party: s.slots, ...(s.battleLevel ? { basis: { ...BATTLE_BASIS, level: s.battleLevel } } : {}) };
}

// 실제 후보가 없으면 샘플, 있으면 rate 확률로 샘플 (2026-10-22 사용자 결정 — 샘플 50%)
function pickRandom(r: RandomPick): Foe | null {
  const real = r.pick && Array.isArray(r.pick.party) ? { userId: r.pick.user_id, sample: null, name: r.pick.name, party: r.pick.party } : null;
  if (!real || rand01() < r.rate) return sampleFoe(r.last_sample) ?? real;
  return real;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const me = await whoAmI(req);
  if (me instanceof Response) return me;
  const { admin, user } = me;

  let body: { random?: unknown; offerId?: unknown; pick?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("BATTLE_BAD_ARGS");
  }
  const random = body.random === true;
  const offerId = typeof body.offerId === "string" ? body.offerId : "";
  const pick = typeof body.pick === "number" && Number.isInteger(body.pick) ? body.pick : 0;
  if (!random && (!/^[0-9a-f-]{36}$/i.test(offerId) || pick < 1 || pick > 3)) return fail("BATTLE_BAD_ARGS");

  const ctxRes = await admin.rpc("battle_context", { p_user: user });
  if (ctxRes.error) return json({ error: "SERVER_BUSY", detail: ctxRes.error.message }, 503);
  const ctx = ctxRes.data as BattleContext;
  if (ctx.held) return fail("CLOUD_ACCOUNT_HELD");
  if (ctx.cooldown_ms > 0) return fail("BATTLE_COOLDOWN", { remainMs: ctx.cooldown_ms });
  const mine = partyOf(ctx.save, battle.data);
  if (mine.count === 0 || mine.blocked) return fail("BATTLE_PARTY_INVALID");

  let foe: Foe | null;
  if (random) {
    const got = await admin.rpc("battle_random_pick", { p_user: user });
    if (got.error) return json({ error: "SERVER_BUSY", detail: got.error.message }, 503);
    foe = pickRandom(got.data as RandomPick);
    if (!foe) return fail("BATTLE_NO_OPPONENT"); // 실제 후보도 샘플도 없다 — 샘플을 싣지 않은 서버 데이터
  } else {
    const got = await admin.rpc("battle_offer_get", { p_user: user, p_offer: offerId, p_pick: pick });
    if (got.error) return json({ error: "SERVER_BUSY", detail: got.error.message }, 503);
    const chosen = got.data as { user_id: string; party: (FighterSource | null)[] } | null;
    if (!chosen) return fail("BATTLE_OFFER_GONE");
    foe = { userId: chosen.user_id, sample: null, name: null, party: chosen.party };
  }

  const sides: [(EngineFighter | null)[], (EngineFighter | null)[]] = [fighters(mine.party), fighters(foe.party, foe.basis)];
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const result = runBattle({ seed, sides, typeChart: battle.data.typeChart });

  const rec = await admin.rpc("battle_record", {
    p_user: user,
    p_offer: random ? null : offerId,
    p_pick: random ? null : pick,
    p_opponent: foe.userId,
    p_seed: seed,
    p_winner: result.winner,
    p_timeout: result.timeout,
    p_end_ms: result.endMs,
    p_data_hash: battle.hash,
    p_sides: [mine.party, foe.party],
    p_events: result.events,
    p_summary: summaryOf([mine.party, foe.party], result, foe.sample ? foe.name : null),
    p_sample: foe.sample,
  });
  if (rec.error) {
    const code = codeOf(rec.error.message);
    if (code === "BATTLE_COOLDOWN") return fail(code, { remainMs: 1000 });
    return code ? fail(code) : json({ error: "SERVER_ERROR", detail: rec.error.message }, 500);
  }
  const saved = rec.data as { battle_id: string; reward: number };
  return json({
    battleId: saved.battle_id,
    reward: saved.reward,
    result: { winner: result.winner, timeout: result.timeout, endMs: result.endMs, hp: result.hp, maxHp: result.maxHp, obstacles: result.obstacles },
    events: result.events,
    sides,
    // 칸마다 그림 값(이로치·성별) — 배틀 창이 실제 개체 그림을 고른다. 옛 등록의 상대는 null 대신 기본값
    looks: [mine.party.map(lookOfSource), foe.party.map(lookOfSource)],
    dataHash: battle.hash,
    ...(random ? { foe: { name: foe.name } } : {}),
  });
});
