// 친선 배틀 앱 쪽 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-friendly.js
// 링크 글자, 참가자 쪽 판 뒤집기, 세션(가짜 서버)의 상태·새 판·나가기·로그인 막기를 본다. 서버는 e2e-friendly 가 본다
// 규칙 docs/specs/adventure.md "친선 배틀"
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENGINE_RULES, type BattleEvent } from "../../battle/engine";
import { createFriendlySession, type FriendlyBattle } from "../../online/friendly-session";
import { failTextOf } from "../../shared/fail-text";
import { friendlyLinkBase, isFriendlyLink, isTradeLink, tokenOf } from "../../trade/link";
import { slotOf } from "../../view/battle-offer";
import { battleScreenModel } from "../../view/battle-screen";
import { FRIENDLY_TEXT, flipEvent, friendlyScreenInput } from "../../view/friendly-battle";

const TOKEN = "Zr8lcWq0abcdEFGH_-12";

// (1) 링크 — 교환과 같은 모양, 앱 링크는 종류가 맞아야 한다
assert.equal(tokenOf(`https://milklotion.github.io/pokebuddy/battle#${TOKEN}`, "battle"), TOKEN);
assert.equal(tokenOf(`pokebuddy://battle/${TOKEN}`, "battle"), TOKEN);
assert.equal(tokenOf(`pokebuddy://trade/${TOKEN}`, "battle"), null, "교환 링크로 친선 배틀에 참가하지 않는다");
assert.equal(tokenOf(`pokebuddy://battle/${TOKEN}`), null, "친선 배틀 링크로 교환에 참가하지 않는다");
assert.equal(tokenOf(TOKEN, "battle"), TOKEN, "토큰만 붙여 넣은 것");
assert.ok(isFriendlyLink(`pokebuddy://battle/${TOKEN}`) && !isTradeLink(`pokebuddy://battle/${TOKEN}`));
assert.equal(friendlyLinkBase("https://milklotion.github.io/pokebuddy/trade"), "https://milklotion.github.io/pokebuddy/battle");
process.stdout.write("(1) 링크  ok\n");

// (2) 참가자 쪽 뒤집기 — 쪽 번호·승자·칸 자리(x)·HP 칸이 바뀐다. 목표 칸 번호는 그대로
{
  const W = ENGINE_RULES.fieldW - ENGINE_RULES.body;
  assert.deepEqual(flipEvent({ t: 0, kind: "step", side: 0, slot: 1, x: 3, y: 4 }), { t: 0, kind: "step", side: 1, slot: 1, x: W - 3, y: 4 });
  assert.deepEqual(flipEvent({ t: 5, kind: "damage", side: 1, slot: 0, target: 2, amount: 9, mult: 1, hp: 10, source: "x", hit: 1 }), { t: 5, kind: "damage", side: 0, slot: 0, target: 2, amount: 9, mult: 1, hp: 10, source: "x", hit: 1 });
  assert.deepEqual(flipEvent({ t: 9, kind: "end", winner: 0, timeout: false }), { t: 9, kind: "end", winner: 1, timeout: false });
  const start = flipEvent({ t: 0, kind: "start", obstacles: [], pos: [[{ x: 1, y: 2 }, null], [{ x: 16, y: 2 }]] } as BattleEvent);
  assert.deepEqual((start as Extract<BattleEvent, { kind: "start" }>).pos, [[{ x: W - 16, y: 2 }], [{ x: W - 1, y: 2 }, null]]);
  const fake = {
    round: 1,
    startAt: "2026-10-10T00:00:03Z",
    result: { winner: 0 as const, timeout: false, endMs: 1000, hp: [[10], [0]] as [number[], number[]], maxHp: [[10], [20]] as [number[], number[]], obstacles: [] },
    events: [{ t: 0, kind: "end", winner: 0, timeout: false }],
    sides: [["host"], ["guest"]] as [unknown[], unknown[]],
    looks: [[{ shiny: true }], [{ shiny: false }]] as [unknown[], unknown[]],
    dataHash: "x",
  } satisfies FriendlyBattle;
  const host = friendlyScreenInput(fake, "host", "지우");
  assert.equal(host.result.winner, 0);
  assert.equal(host.opponentName, "지우");
  assert.equal(host.title, FRIENDLY_TEXT.title);
  assert.deepEqual(host.reward, { lead: "", detail: "확인을 누르면 친구와 다시 준비할 수 있어요." }, "보상 줄 없음 (2026-10-10 사용자 \"친선 배틀이라 보상은 없어요 삭제\")");
  const guest = friendlyScreenInput(fake, "guest", null);
  assert.equal(guest.result.winner, 1, "참가자에게는 방장의 승리가 패배");
  assert.deepEqual(guest.sides, [["guest"], ["host"]]);
  assert.deepEqual(guest.result.hp, [[0], [10]]);
  assert.deepEqual(guest.looks, [[{ shiny: false }], [{ shiny: true }]]);
  assert.equal(guest.opponentName, "친구", "이름이 없으면 친구");
  // 배틀 창 머리 제목
  assert.equal(battleScreenModel({ ...host, sides: [[], []], result: { ...host.result, events: [{ t: 0, kind: "start", obstacles: [], pos: [[], []] }] } }).title, "친선 배틀");
}
process.stdout.write("(2) 참가자 쪽 뒤집기 · 결과 문구 · 제목  ok\n");

// (3) 오류 문구 — 첫 문장이 제목, 나머지가 설명. 연결 실패는 다른 게임이 그대로라는 설명
assert.deepEqual(failTextOf("FRIENDLY_LINK_EXPIRED", "friendly"), { text: "링크가 만료됐어요", detail: "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요" });
assert.deepEqual(failTextOf("NETWORK", "friendly"), { text: "서버에 연결할 수 없어요", detail: "친선 배틀 밖의 게임은 그대로 할 수 있어요" });
assert.equal(failTextOf("FRIENDLY_PARTY_INVALID", "friendly").text, "출전할 수 없는 포켓몬이 있어요");
process.stdout.write("(3) 오류 문구  ok\n");

// (4) 세션 — 가짜 서버. 만들기 → 친구 참가(신호) → 준비 → 새 판 → 나가기
void (async () => {
  const slot = { species: "garchomp", form: null, types: ["dragon", "ground"] };
  let view: Record<string, unknown> = {};
  const calls: string[] = [];
  let signedIn = true;
  const reply = (v: Record<string, unknown> | null): { data: unknown; error: null } => ({ data: { channel: v, parties: v ? { mine: [slot, null, null, null, null, null], myBlocked: false, friend: v.friendJoined ? [slot] : null } : null }, error: null });
  const base = { id: "11111111-1111-1111-1111-111111111111", role: "host", status: "open", closedReason: null, friendJoined: false, friendName: null, myReady: false, friendReady: false, running: false, round: 0, battle: null, expiresAt: "2026-10-10T00:10:00Z", serverNow: "2026-10-10T00:00:00Z" };
  const client = {
    realtime: { setAuth: async () => undefined },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => undefined,
    functions: {
      invoke: async (_fn: string, o: { body: Record<string, unknown> }) => {
        calls.push(String(o.body.action));
        if (o.body.action === "create") return reply({ ...(view = { ...base }), token: TOKEN });
        if (o.body.action === "leave") return reply((view = { ...view, status: "closed", closedReason: "host_left" }));
        if (o.body.action === "ready") return reply((view = { ...view, myReady: o.body.ready }));
        return reply(view);
      },
    },
  } as unknown as SupabaseClient;
  const battles: { role: string; delay: number }[] = [];
  let uploads = 0;
  const s = createFriendlySession({
    client,
    signedIn: () => signedIn,
    beforeReady: async () => void uploads++,
    linkBase: "https://x/battle",
    slotView: slotOf,
    onScreen: () => undefined,
    onBattle: (_b, role, _n, delay) => void battles.push({ role, delay }),
    pollMs: 3_600_000,
    now: () => Date.parse("2026-10-10T00:00:01Z"),
  });
  signedIn = false;
  assert.equal((await s.act({ action: "create" })).error?.code, "FRIENDLY_LOGIN_REQUIRED", "익명은 서버에 보내지 않는다");
  assert.equal(calls.length, 0);
  signedIn = true;
  const made = await s.act({ action: "create" });
  assert.equal(made.phase, "hosting");
  assert.equal(made.link, `https://x/battle#${TOKEN}`);
  assert.equal(made.expiresAt, Date.parse("2026-10-10T00:10:00Z") + 1000, "서버가 이 PC 보다 1초 늦다 — 이 PC 시계로는 1초 뒤에 끝난다");
  assert.equal(made.mine?.[0]?.name !== undefined, true);
  // 친구 참가 — 다시 읽기로 만남
  view = { ...view, status: "joined", friendJoined: true, friendName: "지우" };
  await s.act({ action: "ready", ready: true });
  assert.equal(uploads, 1, "준비 직전 저장 올리기");
  const met = s.screen();
  assert.equal(met.phase, "meet");
  assert.equal(met.friendName, "지우");
  assert.equal(met.myReady, true);
  assert.equal(met.friend?.length, 1);
  // 새 판 — 한 번만 넘긴다. 시작 시각까지 기다릴 시간
  view = { ...view, round: 1, myReady: false, battle: { round: 1, startAt: "2026-10-10T00:00:03Z", result: { winner: 0, timeout: false, endMs: 1, hp: [[], []], maxHp: [[], []], obstacles: [] }, events: [], sides: [[], []], dataHash: "x" } };
  await s.act({ action: "ready", ready: false });
  await s.act({ action: "ready", ready: false });
  assert.deepEqual(battles, [{ role: "host", delay: 3000 }], "새 판은 한 번, 서버 시작 시각까지 3초");
  // 나가기 — 내가 나갔으면 닫힘 배너 없이 시작 화면
  const left = await s.act({ action: "leave" });
  assert.equal(left.phase, "idle");
  assert.equal(left.closedReason, null);
  // 링크 글자가 틀리면 서버에 보내지 않는다
  const before = calls.length;
  assert.equal((await s.act({ action: "join", link: "pokebuddy://trade/" + TOKEN })).error?.code, "FRIENDLY_LINK_INVALID");
  assert.equal(calls.length, before);
  s.stop();
  process.stdout.write("(4) 세션 — 로그인 막기·만들기·만남·준비 전 올리기·새 판 한 번·나가기  ok\n");
  process.stdout.write("selftest-friendly: 통과 (링크·뒤집기·문구·세션)\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
