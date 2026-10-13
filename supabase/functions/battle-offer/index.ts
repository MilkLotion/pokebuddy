// 랜덤 배틀 상대 3개 — E3 (docs/specs/adventure.md "상대 고르기", "서버")
//   1. 본인 확인 → 정지 계정 거부
//   2. 내 서버 저장의 배틀 파티를 본다. 비었거나 출전 불가면 BATTLE_PARTY_INVALID
//   3. battle_offer_make 가 6칸이 다 찬 배틀 파티 가운데 자기를 뺀 무작위 3개를 고정해 둔다
//      본문 { reroll: true } 는 새로고침이다. 판마다 1번이고, 이 판에서 이미 보인 상대를 뺀다. 두 번째는 BATTLE_REROLL_USED
//      reroll 이 없으면(옛 앱 포함) 열기다. 남은 offer 가 있으면 같은 3개를 다시 준다
//   4. { offerId, picks: [{ slot: 1~3, party: 칸 6개의 { species, form, types, shiny } | null }], cooldownMs, rerollLeft } — 상대 이름·계정은 주지 않는다
// 후보가 3개보다 적으면 있는 만큼만 준다. 앱은 빈 줄을 실패 글자로 보인다
import { partyOf } from "../_shared/battle/fighter-core.ts";
import { battle, codeOf, fail, json, slotView, whoAmI, type BattleContext } from "../_shared/battle-common.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const me = await whoAmI(req);
  if (me instanceof Response) return me;
  const { admin, user } = me;

  const ctxRes = await admin.rpc("battle_context", { p_user: user });
  if (ctxRes.error) return json({ error: "SERVER_BUSY", detail: ctxRes.error.message }, 503);
  const ctx = ctxRes.data as BattleContext;
  if (ctx.held) return fail("CLOUD_ACCOUNT_HELD");
  const mine = partyOf(ctx.save, battle.data);
  if (mine.count === 0 || mine.blocked) return fail("BATTLE_PARTY_INVALID");

  const body = (await req.json().catch(() => null)) as { reroll?: unknown } | null;
  const res = await admin.rpc("battle_offer_make", { p_user: user, p_reroll: body?.reroll === true });
  if (res.error) {
    const code = codeOf(res.error.message);
    return code ? fail(code) : json({ error: "SERVER_ERROR", detail: res.error.message }, 500);
  }
  const made = res.data as { offer_id: string; picks: { party: unknown }[]; rerolled: boolean };
  const picks = made.picks.map((p, i) => ({
    slot: i + 1,
    party: (Array.isArray(p.party) ? p.party : []).map((s) => slotView(s as { species: string; form?: string | null; shiny?: boolean } | null)),
  }));
  return json({ offerId: made.offer_id, picks, cooldownMs: ctx.cooldown_ms, rerollLeft: made.rerolled ? 0 : 1 });
});
