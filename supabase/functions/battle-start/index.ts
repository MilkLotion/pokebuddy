// 랜덤 배틀 한 판 — E3 (docs/specs/adventure.md "서버", docs/specs/balance.md "배틀 보상")
//   요청 { offerId, pick: 1~3 }
//   1. 본인 확인 → 정지 계정·쿨타임(5분) 먼저 거부
//   2. 내 파티는 지금 서버 저장에서, 상대 파티는 보인 3개에 고정한 모습으로 전투 개체를 만든다
//   3. 시드는 서버가 만든다. 엔진(_shared/battle/engine.ts)을 돌린다
//   4. battle_record 가 쿨타임·offer 를 다시 보고(동시 요청), 보상(그날 첫 판 500 / 이기면 50 / 지거나 비기면 10)을 정해 판과 이벤트를 남긴다
//   5. { battleId, reward, result, events, sides, looks, dataHash } — 앱은 이벤트를 재생하고, 보상을 저장에 더하고 battleId 를 남긴다
import { runBattle, type EngineFighter } from "../_shared/battle/engine.ts";
import { fighterFrom, lookOfSource, partyOf, type FighterSource } from "../_shared/battle/fighter-core.ts";
import { battle, codeOf, fail, json, whoAmI, type BattleContext } from "../_shared/battle-common.ts";

const fighters = (party: (FighterSource | null)[]): (EngineFighter | null)[] => party.map((s) => (s ? fighterFrom(battle.data, s) : null));

Deno.serve(async (req: Request): Promise<Response> => {
  const me = await whoAmI(req);
  if (me instanceof Response) return me;
  const { admin, user } = me;

  let body: { offerId?: unknown; pick?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("BATTLE_BAD_ARGS");
  }
  const offerId = typeof body.offerId === "string" ? body.offerId : "";
  const pick = typeof body.pick === "number" && Number.isInteger(body.pick) ? body.pick : 0;
  if (!/^[0-9a-f-]{36}$/i.test(offerId) || pick < 1 || pick > 3) return fail("BATTLE_BAD_ARGS");

  const ctxRes = await admin.rpc("battle_context", { p_user: user });
  if (ctxRes.error) return json({ error: "SERVER_BUSY", detail: ctxRes.error.message }, 503);
  const ctx = ctxRes.data as BattleContext;
  if (ctx.held) return fail("CLOUD_ACCOUNT_HELD");
  if (ctx.cooldown_ms > 0) return fail("BATTLE_COOLDOWN", { remainMs: ctx.cooldown_ms });
  const mine = partyOf(ctx.save, battle.data);
  if (mine.count === 0 || mine.blocked) return fail("BATTLE_PARTY_INVALID");

  const got = await admin.rpc("battle_offer_get", { p_user: user, p_offer: offerId, p_pick: pick });
  if (got.error) return json({ error: "SERVER_BUSY", detail: got.error.message }, 503);
  const chosen = got.data as { user_id: string; party: (FighterSource | null)[] } | null;
  if (!chosen) return fail("BATTLE_OFFER_GONE");

  const sides: [(EngineFighter | null)[], (EngineFighter | null)[]] = [fighters(mine.party), fighters(chosen.party)];
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const result = runBattle({ seed, sides, typeChart: battle.data.typeChart });

  const rec = await admin.rpc("battle_record", {
    p_user: user,
    p_offer: offerId,
    p_pick: pick,
    p_opponent: chosen.user_id,
    p_seed: seed,
    p_winner: result.winner,
    p_timeout: result.timeout,
    p_end_ms: result.endMs,
    p_data_hash: battle.hash,
    p_sides: [mine.party, chosen.party],
    p_events: result.events,
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
    looks: [mine.party.map(lookOfSource), chosen.party.map(lookOfSource)],
    dataHash: battle.hash,
  });
});
