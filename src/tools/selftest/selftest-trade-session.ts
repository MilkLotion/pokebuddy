// 교환 세션의 망 오류 처리 — 가짜 서버로 확정·나가기·반영 알림의 실패를 본다 (worklog/records/perf-refactor 8-2, G33-1·G33-2)
//
//   node dist/tools/selftest/selftest-trade-session.js   (npm run build 뒤)
//
// 망 오류는 서버가 요청을 받았는지 모른다 — 잠금을 두고 감시를 잇는다. 서버가 확실히 거절했으면 잠금을 푼다.
// 반영 알림이 망 오류로 실패하면 조금 뒤 다시 보낸다. 서버 통합은 selftest-trade-net 이 본다
import assert from "node:assert";
import { createTradeSession, type TradeSessionOptions } from "../../online/trade-session";
import type { ChannelView, NetResult, TradeNet } from "../../online/trade-net";
import { offerOf } from "../../trade/exchange";
import { newPet } from "../../party/create";
import { emptySave } from "../../save/normalize";
import type { SaveV3 } from "../../shared/save-v3";
import type { TradeCode } from "../../shared/names/online-codes";
import { createExecutor } from "../../tx/executor";
import { HANDLERS } from "../../tx/command-table";
import { okCounter, printLine } from "../harness/report";

const T0 = 1_700_000_000_000;
const t = okCounter();

const ok = <T>(data: T): NetResult<T> => ({ ok: true, data });
const no = (code: TradeCode): NetResult<never> => ({ ok: false, code });

function world(from?: SaveV3) {
  let disk: SaveV3 = from ? structuredClone(from) : emptySave(T0);
  if (!from) {
    disk.pets.push(newPet({ id: "p1", species: "pikachu", shiny: false, nature: "hardy", gender: "male", now: T0 }));
    disk.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  }
  const exec = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => T0, rand: () => 0.5 }, HANDLERS);
  const friend = offerOf(newPet({ id: "f1", species: "eevee", shiny: false, nature: "hardy", gender: "female", now: T0 }));
  let status: ChannelView["status"] = "joined";
  const view = (): ChannelView => ({ id: "c1", role: "host", status, offer_rev: 1, my_offer: null, friend_offer: friend, my_ready: false, friend_ready: false, friend_joined: true, friend_name: "친구", expires_at: "", done_at: null, closed_reason: null });
  // 가짜 서버 — 각 호출의 답을 시험이 바꾼다
  const answer: { ready: NetResult<"joined">; cancel: NetResult<"cancelled">; ack: NetResult<null>[] } = { ready: ok("joined"), cancel: ok("cancelled"), ack: [] };
  let acks = 0;
  const net = {
    client: null as unknown as TradeNet["client"],
    ensureSession: async () => ok({ userId: "u1", anonymous: false }),
    createChannel: async () => ok({ channelId: "c1", token: "tok", expiresAt: "" }),
    joinChannel: async () => ok("c1"),
    setOffer: async () => ok(1),
    setReady: async () => answer.ready,
    cancelChannel: async () => answer.cancel,
    getChannel: async () => ok(view()),
    ackApplied: async () => { acks += 1; return answer.ack.shift() ?? ok(null); },
    subscribe: async () => () => {},
  } satisfies TradeNet;
  // 타이머는 손으로 돌린다
  const timers: (() => void)[] = [];
  let settled = 0;
  const opts: TradeSessionOptions = {
    net, run: (id, name, args) => exec.run({ id, name, args }), read: () => disk, protocol: 1, dataVersion: "v", linkOf: (tok) => `link:${tok}`, onView: () => {},
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {}, onSettled: () => { settled += 1; }, isAnonymous: () => false,
  };
  const session = createTradeSession(opts);
  return { session, answer, save: () => disk, setStatus: (s: ChannelView["status"]) => (status = s), acks: () => acks, settled: () => settled, timers };
}

// 채널을 만들고 제안까지 — 확정할 수 있는 상태
async function readyToConfirm() {
  const w = world();
  assert.deepEqual(await w.session.create(), { ok: true });
  assert.deepEqual(await w.session.offer("p1"), { ok: true });
  assert.ok(w.session.view().friendPet, "친구 제안을 받았다");
  return w;
}

async function main(): Promise<void> {
  await t.okAsync("확정이 망 오류면 잠금을 둔다", async () => {
    const w = await readyToConfirm();
    w.answer.ready = no("NETWORK");
    const r = await w.session.ready();
    assert.equal(r.ok, false);
    assert.equal(w.save().trade?.pending?.channelId, "c1", "잠금이 남는다");
    assert.equal(w.session.view().error?.code, "NETWORK");
  });

  await t.okAsync("확정을 서버가 거절하면 잠금을 푼다", async () => {
    const w = await readyToConfirm();
    w.answer.ready = no("TRADE_NOT_FOUND");
    await w.session.ready();
    assert.equal(w.save().trade?.pending ?? null, null);
  });

  await t.okAsync("나가기가 망 오류면 잠금과 채널을 두고, 다시 나가면 푼다", async () => {
    const w = await readyToConfirm();
    w.answer.ready = ok("joined");
    await w.session.ready();
    assert.equal(w.save().trade?.pending?.channelId, "c1");
    w.answer.cancel = no("NETWORK");
    const r = await w.session.leave();
    assert.deepEqual(r, { ok: false, reason: "NETWORK" });
    assert.equal(w.save().trade?.pending?.channelId, "c1", "잠금이 남는다");
    assert.equal(w.session.view().phase, "trading", "채널을 놓지 않는다");
    assert.equal(w.session.view().busy, false);
    w.answer.cancel = ok("cancelled");
    assert.deepEqual(await w.session.leave(), { ok: true });
    assert.equal(w.save().trade?.pending ?? null, null);
  });

  await t.okAsync("반영 알림이 망 오류면 다시 보낸다", async () => {
    const w = await readyToConfirm();
    await w.session.ready();
    w.answer.ack = [no("NETWORK"), no("NETWORK")];
    w.setStatus("done");
    await w.session.refresh();
    assert.equal(w.session.view().phase, "done");
    assert.equal(w.acks(), 1);
    assert.equal(w.settled(), 0);
    for (let i = 0; i < 2; i += 1) {
      const fn = w.timers.pop();
      assert.ok(fn, "다시 보낼 타이머");
      fn();
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(w.acks(), 3);
    assert.equal(w.settled(), 1, "알림이 닿으면 한 번 끝낸다");
    assert.deepEqual(w.save().trade?.unacked ?? [], [], "닿은 알림은 저장의 목록에서 뺀다");
  });

  await t.okAsync("반영 알림을 서버가 거절하면 다시 보내지 않는다", async () => {
    const w = await readyToConfirm();
    await w.session.ready();
    w.answer.ack = [no("TRADE_NOT_FOUND")];
    w.setStatus("done");
    const before = w.timers.length;
    await w.session.refresh();
    assert.equal(w.acks(), 1);
    assert.equal(w.timers.length, before, "다시 보낼 타이머가 없다");
  });

  await t.okAsync("알림을 못 보내고 앱이 꺼지면 다시 켤 때 보낸다 (저장 trade.unacked)", async () => {
    const w = await readyToConfirm();
    await w.session.ready();
    w.answer.ack = [no("NETWORK")];
    w.setStatus("done");
    await w.session.refresh();
    assert.deepEqual(w.save().trade?.unacked, ["c1"], "반영했지만 알리지 못한 채널이 저장에 남는다");
    assert.equal(w.save().trade?.pending ?? null, null, "잠금은 풀렸다");
    w.session.stop(); // 앱이 꺼진다
    const again = world(w.save());
    await again.session.start();
    await new Promise((r) => setImmediate(r));
    assert.equal(again.acks(), 1, "켤 때 다시 보낸다");
    assert.equal(again.settled(), 1);
    assert.deepEqual(again.save().trade?.unacked ?? [], []);
  });

  await t.okAsync("서버가 거절한 알림(채널 없음)은 목록에서 뺀다", async () => {
    const w = await readyToConfirm();
    await w.session.ready();
    w.answer.ack = [no("TRADE_NOT_FOUND")];
    w.setStatus("done");
    await w.session.refresh();
    assert.deepEqual(w.save().trade?.unacked ?? [], []);
  });

  printLine(`selftest-trade-session: 통과 (${t.count()}건)`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
