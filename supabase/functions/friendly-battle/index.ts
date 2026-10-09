// 친선 배틀 — 링크로 친구를 불러 한 판 (docs/specs/adventure.md "친선 배틀", 채널은 supabase/migrations/20261010120000_friendly_battle.sql)
//   요청 { action, ... }
//     create { protocol }                 링크 만들기 — 답에 token 이 한 번만 있다
//     join   { token, protocol }          링크로 참가
//     get    { channel }                  채널 보기
//     mine   {}                           내 열린 채널(앱을 다시 켰을 때). 없으면 { channel: null }
//     ready  { channel, ready: boolean }  준비·준비 취소. 둘 다 준비하면 이 요청이 판을 돌린다
//     leave  { channel }                  나가기 — 채널을 닫는다
//   답 { channel: 채널 보기, parties: { mine, friend } } — 칸은 { species, form, types, shiny } 또는 null. 상대 계정 id 는 주지 않는다
//   판은 방장 쪽이 0번이다. 채널 보기의 battle 에 이벤트·전투 개체·그림 값·시작 시각이 있고, 참가자 앱은 양쪽을 뒤집어 재생한다
// 로그인한 계정만(2026-10-10 사용자 결정). 보상·쿨타임 없음. 판은 cloud_private.battles 에 kind 'friendly' 로 남는다
import { runBattle, type EngineFighter } from "../_shared/battle/engine.ts";
import { fighterFrom, lookOfSource, partyOf, type FighterSource } from "../_shared/battle/fighter-core.ts";
import { battle, codeOf, fail, json, slotView, whoAmI, type BattleContext } from "../_shared/battle-common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const PROTOCOL = 1; // 채널 판 — 앱(src/online/friendly-net.ts FRIENDLY_PROTOCOL)과 같아야 참가한다

const fighters = (party: (FighterSource | null)[]): (EngineFighter | null)[] => party.map((s) => (s ? fighterFrom(battle.data, s) : null));
const UUID = /^[0-9a-f-]{36}$/i;

type View = Record<string, unknown> & { friendId?: string | null; friendJoined?: boolean };

async function saveOf(admin: SupabaseClient, user: string): Promise<unknown> {
  const r = await admin.rpc("battle_context", { p_user: user });
  return r.error ? null : (r.data as BattleContext).save;
}

// 답 — 채널 보기에서 상대 id 를 빼고 양쪽 배틀 파티 칸을 더한다
async function reply(admin: SupabaseClient, user: string, view: View, extra: Record<string, unknown> = {}): Promise<Response> {
  const friendId = typeof view.friendId === "string" ? view.friendId : null;
  const { friendId: _drop, ...channel } = view;
  const mine = partyOf(await saveOf(admin, user), battle.data);
  const friend = friendId ? partyOf(await saveOf(admin, friendId), battle.data) : null;
  return json({
    channel,
    parties: {
      mine: mine.party.map(slotView),
      myBlocked: mine.count === 0 || mine.blocked,
      friend: friend ? friend.party.map(slotView) : null,
    },
    ...extra,
  });
}

const failed = (message: string): Response => {
  const code = codeOf(message);
  return code ? fail(code) : json({ error: "SERVER_ERROR", detail: message }, 500);
};

Deno.serve(async (req: Request): Promise<Response> => {
  const me = await whoAmI(req);
  if (me instanceof Response) return me;
  const { admin, user } = me;

  let body: { action?: unknown; channel?: unknown; token?: unknown; protocol?: unknown; ready?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("FRIENDLY_BAD_ARGS");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const channel = typeof body.channel === "string" && UUID.test(body.channel) ? body.channel : null;
  const protocol = typeof body.protocol === "number" && Number.isInteger(body.protocol) ? body.protocol : PROTOCOL;

  if (action === "create") {
    const r = await admin.rpc("friendly_create", { p_user: user, p_protocol: protocol });
    return r.error ? failed(r.error.message) : reply(admin, user, r.data as View);
  }
  if (action === "join") {
    const token = typeof body.token === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(body.token) ? body.token : null;
    if (!token) return fail("FRIENDLY_LINK_INVALID");
    const r = await admin.rpc("friendly_join", { p_user: user, p_token: token, p_protocol: protocol });
    return r.error ? failed(r.error.message) : reply(admin, user, r.data as View);
  }
  if (action === "mine") {
    const r = await admin.rpc("friendly_mine", { p_user: user });
    if (r.error) return failed(r.error.message);
    if (!r.data) return json({ channel: null, parties: null });
    const g = await admin.rpc("friendly_get", { p_user: user, p_channel: r.data as string });
    return g.error ? failed(g.error.message) : reply(admin, user, g.data as View);
  }
  if (!channel) return fail("FRIENDLY_BAD_ARGS");
  if (action === "get") {
    const r = await admin.rpc("friendly_get", { p_user: user, p_channel: channel });
    return r.error ? failed(r.error.message) : reply(admin, user, r.data as View);
  }
  if (action === "leave") {
    const r = await admin.rpc("friendly_leave", { p_user: user, p_channel: channel });
    return r.error ? failed(r.error.message) : reply(admin, user, r.data as View);
  }
  if (action !== "ready" || typeof body.ready !== "boolean") return fail("FRIENDLY_BAD_ARGS");

  // 준비 — 내 배틀 파티가 비었거나 출전 불가면 받지 않는다
  if (body.ready) {
    const mine = partyOf(await saveOf(admin, user), battle.data);
    if (mine.count === 0 || mine.blocked) return fail("FRIENDLY_PARTY_INVALID");
  }
  const r = await admin.rpc("friendly_ready", { p_user: user, p_channel: channel, p_ready: body.ready });
  if (r.error) return failed(r.error.message);
  const ready = r.data as { go: boolean; round: number; host: string; guest: string; view: View };
  if (!ready.go) return reply(admin, user, ready.view);

  // 둘 다 준비했다 — 이 요청이 판을 돌린다. 양쪽 모두 지금 서버 저장의 배틀 파티로 싸운다
  const host = partyOf(await saveOf(admin, ready.host), battle.data);
  const guest = partyOf(await saveOf(admin, ready.guest), battle.data);
  if (host.count === 0 || host.blocked || guest.count === 0 || guest.blocked) {
    await admin.rpc("friendly_abort", { p_channel: channel, p_round: ready.round });
    return fail("FRIENDLY_PARTY_INVALID");
  }
  const sides: [(EngineFighter | null)[], (EngineFighter | null)[]] = [fighters(host.party), fighters(guest.party)];
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const result = runBattle({ seed, sides, typeChart: battle.data.typeChart });
  const rec = await admin.rpc("friendly_record", {
    p_channel: channel,
    p_round: ready.round,
    p_battle: {
      result: { winner: result.winner, timeout: result.timeout, endMs: result.endMs, hp: result.hp, maxHp: result.maxHp, obstacles: result.obstacles },
      events: result.events,
      sides,
      looks: [host.party.map(lookOfSource), guest.party.map(lookOfSource)],
      dataHash: battle.hash,
    },
    p_seed: seed,
    p_winner: result.winner,
    p_timeout: result.timeout,
    p_end_ms: result.endMs,
    p_data_hash: battle.hash,
    p_sides: [host.party, guest.party],
    p_events: result.events,
  });
  if (rec.error) {
    await admin.rpc("friendly_abort", { p_channel: channel, p_round: ready.round });
    return failed(rec.error.message);
  }
  const g = await admin.rpc("friendly_get", { p_user: user, p_channel: channel });
  return g.error ? failed(g.error.message) : reply(admin, user, g.data as View);
});
