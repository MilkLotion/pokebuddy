// 친구 교환 서버 통합 확인 — 로컬 Supabase 에 사용자들을 붙여 교환을 끝까지 돌린다
//   npx supabase start 뒤: npm run build && node dist/tools/selftest/selftest-trade-net.js
//   주소와 키는 POKEBUDDY_SUPABASE_URL, POKEBUDDY_SUPABASE_KEY 로 받는다. 없으면 `npx supabase status -o json` 에서 읽는다
//   로컬 서버가 없으면 건너뛴다(종료 코드 0). 실제 프로젝트에는 붙지 않는다 — 주소가 127.0.0.1 이 아니면 멈춘다
// 설계는 worklog/records/trade/record.md "전체 구조", "로컬 저장과 복구"
// 규약 2 (worklog-mac/records/cloud-authority/design-p2.md 4절·8절·13절)
//   교환하는 사용자는 로그인 계정이다 — 아이디로 바로 가입한다(익명 발급을 거치지 않는다. 로컬 익명 가입 한도 5/시간)
//   제안한 개체는 서버 저장에 먼저 있어야 한다 — 제안 직전 올리기(beforeOffer)가 claim_device·Edge Function upload-save 를 부른다
//   익명 계정은 한 번만 발급해 서버 거절과 클라이언트 거절을 함께 본다
import assert from "node:assert";
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOnlineClient, memoryStorage } from "../../online/client";
import { internalEmail } from "../../online/account";
import { createSessionGate, type SessionGate } from "../../online/session";
import { createTradeNet, type TradeNet } from "../../trade/net";
import { createTradeSession, type TradeViewModel } from "../../trade/session";
import { dataVersion, onlineConfig } from "../../trade/config";
import { refOf, snapshot } from "../../trade/core";
import { newPet } from "../../party/create";
import { empty } from "../../save/v3";
import type { SaveV3 } from "../../shared/save-v3";
import { createExecutor } from "../../tx/executor";
import { HANDLERS } from "../../tx/handlers";

const APP_VERSION = "0.13.0"; // 서버 최소 버전(cloud_private.settings) 이상
const PROTOCOL = onlineConfig(undefined, {}).protocol;
const PASSWORD = "correct-horse-8";

function local(): { url: string; key: string } | null {
  if (process.env.POKEBUDDY_SUPABASE_URL && process.env.POKEBUDDY_SUPABASE_KEY) return { url: process.env.POKEBUDDY_SUPABASE_URL, key: process.env.POKEBUDDY_SUPABASE_KEY };
  try {
    const raw = execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).toString();
    const j = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
    const url = j.API_URL, key = j.PUBLISHABLE_KEY ?? j.ANON_KEY;
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}

type Upload = { ok: true; rev: number } | { ok: false; code: string };

// 클라우드 저장 올리기 — 앱의 cloud.flush 대신. 처음이면 이 PC 를 활성 기기로 만든다
function cloudOf(client: SupabaseClient) {
  const device = randomUUID();
  let rev: number | null = null;
  const claim = async (): Promise<number> => {
    const { data, error } = await client.rpc("claim_device", { p_device: device, p_label: "시험", p_app_version: APP_VERSION, p_mode: "boot", p_force: false });
    if (error) throw new Error(`claim_device: ${error.message}`);
    return Number((data as { rev: number }[])[0]!.rev);
  };
  const upload = async (save: SaveV3): Promise<Upload> => {
    rev ??= await claim();
    // 앱처럼 Edge Function upload-save 로 올린다(서버 검증 P4a). 오류 본문의 코드를 쓴다
    const { data, error } = await client.functions.invoke("upload-save", { body: { device, baseRev: rev, save, saveV: 3, appVersion: APP_VERSION, op: randomUUID() } });
    if (error) {
      const context = (error as { context?: unknown }).context;
      const body = context instanceof Response ? ((await context.clone().json().catch(() => null)) as { error?: string } | null) : null;
      return { ok: false, code: body?.error ?? error.message };
    }
    rev = Number((data as { rev: number }).rev);
    return { ok: true, rev };
  };
  return { upload };
}

// 아이디로 바로 가입한다 — 가입하면 세션이 이 클라이언트에 선다
async function signUp(client: SupabaseClient): Promise<void> {
  const name = `t${randomBytes(5).toString("hex")}`;
  const { data, error } = await client.auth.signUp({ email: internalEmail(name), password: PASSWORD, options: { data: { display_name: "시험" } } });
  if (error || !data.session) throw new Error(`가입 실패: ${error?.message ?? "no-session"}`);
}

interface PlayerOptions {
  member: boolean; // 로그인 계정인가. 거짓이면 익명 계정을 쓴다
  hold?: () => boolean;
  clientCheck?: boolean; // 익명 판정을 세션에 넘기는가(앱은 넘긴다). 거짓이면 서버 판정만 본다
  shared?: { client: SupabaseClient; gate: SessionGate }; // 같은 계정의 두 번째 세션
  mayIssue?: () => boolean; // 세션이 없을 때 익명 계정을 만들어도 되는가(앱은 분실·주인 있음이면 거짓)
}

async function player(species: string, url: string, key: string, po: PlayerOptions) {
  const T0 = Date.now();
  let disk: SaveV3 = empty(T0);
  disk.pets.push(newPet({ id: "p1", species, shiny: false, nature: "hardy", gender: "male", now: T0 }));
  disk.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  const exec = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => Date.now() }, HANDLERS);
  const client = po.shared?.client ?? createOnlineClient({ url, key, storage: memoryStorage() });
  const gate = po.shared?.gate ?? createSessionGate(client);
  if (po.member && !po.shared) await signUp(client);
  const cloud = cloudOf(client);
  // 서버 호출을 센다 — 클라이언트 거절이 서버에 닿지 않았는지 본다
  const calls = { create: 0, join: 0, offer: 0 };
  const raw = createTradeNet({ client, gate });
  const net: TradeNet = {
    ...raw,
    createChannel: (...a) => { calls.create++; return raw.createChannel(...a); },
    joinChannel: (...a) => { calls.join++; return raw.joinChannel(...a); },
    setOffer: (...a) => { calls.offer++; return raw.setOffer(...a); },
  };
  const flags = { anonymous: false, autoFlush: true, flushed: 0, lastFlush: null as Upload | null };
  const views: TradeViewModel[] = [];
  const session = createTradeSession({
    net,
    run: (id, name, args) => exec.run({ id, name, args }),
    read: () => disk,
    protocol: PROTOCOL,
    dataVersion: dataVersion(),
    linkOf: (t) => `https://example.invalid/trade#${t}`,
    onView: (v) => views.push(v),
    pollMs: 3_600_000,
    ...(po.hold ? { hold: po.hold } : {}),
    ...(po.mayIssue ? { mayIssue: po.mayIssue } : {}),
    ...(po.clientCheck
      ? { isAnonymous: async () => flags.anonymous || (await gate.current())?.is_anonymous === true }
      : {}),
    beforeOffer: async () => {
      if (!flags.autoFlush) return;
      flags.flushed++;
      flags.lastFlush = await cloud.upload(disk);
    },
  });
  return {
    session, views, net, client, gate, calls, flags,
    save: () => disk,
    restore: (s: SaveV3) => { disk = structuredClone(s); },
    upload: () => cloud.upload(disk),
    uploadOf: (s: SaveV3) => cloud.upload(s),
  };
}

async function main(): Promise<void> {
  const cfg = local();
  if (!cfg) { process.stdout.write("selftest-trade-net: 로컬 Supabase 가 없어 건너뜀\n"); return; }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");
  assert.equal(PROTOCOL, 2, "앱 규약은 2");

  // (0) 익명 계정 — 서버 거절과 클라이언트 거절. 익명 발급은 여기서 한 번만
  const x = await player("pikachu", cfg.url, cfg.key, { member: false });
  const y = await player("pikachu", cfg.url, cfg.key, { member: false, clientCheck: true, shared: { client: x.client, gate: x.gate } });
  const fakeLink = `https://example.invalid/trade#${randomBytes(24).toString("base64url")}`;
  const s = await x.net.ensureSession();
  assert.ok(s.ok && s.data.anonymous, `익명 세션을 만든다 (${s.ok ? "" : `${s.code} ${s.detail ?? ""} — 로컬 익명 가입 한도(시간당 5)일 수 있다`})`);
  const serverCreate = await x.net.createChannel(PROTOCOL, dataVersion());
  assert.deepEqual(serverCreate, { ok: false, code: "TRADE_LOGIN_REQUIRED" }, "익명은 서버가 만들기를 거절한다");
  const serverOffer = await x.net.setOffer(randomUUID(), { species: "pikachu", level: 5 }, { id: "p1", since: 1 });
  assert.equal(serverOffer.ok ? null : serverOffer.code, "TRADE_LOGIN_REQUIRED", "익명은 서버가 제안을 거절한다");
  assert.deepEqual(await x.session.create(), { ok: false, reason: "login-required" }, "서버 거절도 같은 거절 이유로");
  assert.deepEqual(await x.session.join(fakeLink), { ok: false, reason: "login-required" }, "참가도 서버가 거절한다");
  assert.equal(x.session.view().busy, false, "거절 뒤 busy 를 끈다");
  const before = { ...y.calls };
  assert.deepEqual(await y.session.create(), { ok: false, reason: "login-required" }, "앱이 익명 판정을 넘기면 먼저 거절한다");
  assert.deepEqual(await y.session.join(fakeLink), { ok: false, reason: "login-required" });
  assert.deepEqual(y.calls, before, "클라이언트 거절은 서버에 닿지 않는다");
  assert.equal(y.session.view().phase, "idle");
  x.session.stop();
  y.session.stop();
  // 익명 발급을 막은 세션(검수 H1) — 세션이 없으면 시작·만들기가 익명 계정을 만들지 않는다
  const z = await player("pikachu", cfg.url, cfg.key, { member: false, clientCheck: true, mayIssue: () => false });
  await z.session.start();
  assert.equal(z.session.view().error, null, "복구할 교환이 없으면 오류 없이 끝난다");
  assert.equal(await z.gate.current(), null, "시작이 익명 계정을 만들지 않는다");
  assert.deepEqual(await z.session.create(), { ok: false, reason: "login-required" }, "만들기도 만들지 않고 거절");
  assert.equal(z.calls.create, 0, "서버에 보내지 않는다");
  assert.equal(await z.gate.current(), null);
  z.session.stop();
  process.stdout.write("(0) 익명 거절 — 서버·클라이언트, 발급 막음  ok\n");

  const a = await player("charmander", cfg.url, cfg.key, { member: true, clientCheck: true });
  const b = await player("eevee", cfg.url, cfg.key, { member: true, clientCheck: true });
  try {
    // 규약 1 은 거절한다. 지문 없는 옛 제안(2인자)도 거절한다
    assert.deepEqual(await a.net.createChannel(1, dataVersion()), { ok: false, code: "TRADE_VERSION_MISMATCH" }, "규약 1 만들기");

    await a.session.create();
    const link = a.session.view().link;
    assert.ok(link && link.includes("#"), "A 가 링크를 만든다");
    await b.session.join(link!);
    assert.equal(b.session.view().phase, "trading", "B 가 참가한다");
    await a.session.refresh();
    assert.equal(a.session.view().phase, "trading");
    const channel = a.session.view().channel!.id;
    const old = await a.client.rpc("set_offer", { p_channel: channel, p_pet: snapshot(a.save().pets[0]!) });
    assert.match(old.error?.message ?? "", /TRADE_VERSION_MISMATCH/, "옛 앱의 2인자 제안");
    process.stdout.write("(1) 링크 만들기·참가·규약  ok\n");

    // 서버 저장에 없는 개체는 받지 않는다 — B 는 아직 저장을 올리지 않았다
    b.flags.autoFlush = false;
    const calls = b.calls.offer;
    assert.deepEqual(await b.session.offer("p1"), { ok: false, reason: "save-wait" }, "서버 저장에 없는 개체는 저장이 끝나면 다시");
    assert.equal(b.calls.offer, calls + 1, "서버가 판정했다");
    assert.equal(b.session.view().busy, false);
    assert.equal(b.session.view().myPetId, null, "거절된 제안은 내 제안으로 두지 않는다");
    b.flags.autoFlush = true;

    // 지문 대조 — 만든 시각·이로치가 다르면 서버 저장의 개체가 아니다. 정수가 아닌 since 는 형식 오류
    const aPet = a.save().pets[0]!;
    assert.equal((await a.upload()).ok, true, "A 가 저장을 올린다");
    assert.deepEqual(await a.net.setOffer(channel, snapshot(aPet), { id: aPet.id, since: aPet.since + 1 }), { ok: false, code: "TRADE_PET_NOT_SYNCED" }, "since 가 다르다");
    assert.deepEqual(await a.net.setOffer(channel, { ...snapshot(aPet), shiny: true }, refOf(aPet)), { ok: false, code: "TRADE_PET_NOT_SYNCED" }, "이로치가 다르다");
    assert.deepEqual(await a.net.setOffer(channel, snapshot(aPet), { id: aPet.id, since: 1.5 }), { ok: false, code: "TRADE_OFFER_INVALID" }, "since 가 정수가 아니다");
    // P5 — 앱 레벨이 서버보다 크면 아직 올리지 않은 진행이다. 제안 값은 서버 저장으로 만든다(앱이 보낸 다른 값은 쓰지 않는다)
    assert.deepEqual(await a.net.setOffer(channel, { ...snapshot(aPet), level: aPet.level + 5 }, refOf(aPet)), { ok: false, code: "TRADE_PET_NOT_SYNCED" }, "앱 레벨이 서버보다 크다 (P5)");
    assert.deepEqual(await a.net.setOffer(channel, { ...snapshot(aPet), affinity: 100 }, refOf(aPet)).then((r) => r.ok), true, "레벨이 서버 이하면 받는다 — 다른 값은 서버 저장으로 (P5)");

    // 제안 도중 익명으로 바뀌면 먼저 거절한다
    a.flags.anonymous = true;
    const aCalls = a.calls.offer;
    assert.deepEqual(await a.session.offer("p1"), { ok: false, reason: "login-required" });
    assert.equal(a.calls.offer, aCalls, "서버에 보내지 않는다");
    a.flags.anonymous = false;

    const flushedA = a.flags.flushed;
    await a.session.offer("p1");
    await b.session.offer("p1");
    assert.equal(a.flags.flushed, flushedA + 1, "제안 직전 저장을 올린다");
    assert.equal(b.flags.lastFlush?.ok, true, "B 는 제안하면서 첫 저장을 올린다");
    assert.equal(b.session.view().myPetId, "p1", "올린 뒤에는 받는다");
    await a.session.refresh();
    assert.equal(a.session.view().friendPet?.species, "eevee", "A 가 친구 제안을 본다");
    assert.equal(b.session.view().friendPet?.species, "charmander");
    assert.equal("id" in (a.session.view().channel!.friend_offer as object), false, "친구에게는 지문이 가지 않는다");
    process.stdout.write("(2) 제안 — 지문 전달·NOT_SYNCED·save-wait·올리기 훅  ok\n");

    const bak = structuredClone(a.save()); // 교환 전 백업 — 보낸 개체가 남아 있다
    await a.session.ready();
    assert.equal(a.save().trade?.pending?.petId, "p1", "A 가 확정하면 로컬에 잠근다");
    await b.session.ready(); // 뒤에 확정한 B 가 완료를 쓰고 반영한다
    assert.equal(b.session.view().phase, "done");
    await a.session.refresh();
    assert.equal(a.session.view().phase, "done");
    process.stdout.write("(3) 확정·완료  ok\n");

    const sa = a.save(), sb = b.save();
    assert.equal(sa.pets.length, 1);
    assert.equal(sa.pets[0]!.species, "eevee", "A 는 이브이를 받는다");
    assert.equal(sb.pets[0]!.species, "charmander", "B 는 파이리를 받는다");
    assert.equal(sa.party.slots[0]!.petId, sa.pets[0]!.id, "받은 개체가 같은 칸에");
    assert.equal(sa.trade?.pending, null);
    assert.equal(sb.trade?.pending, null);
    await a.session.refresh();
    assert.equal(a.save().pets.length, 1, "다시 읽어도 한 번만 반영");
    process.stdout.write("(4) 양쪽 저장 반영  ok\n");

    // 원장 — 반영한 저장은 올라간다. 보낸 개체가 남은 백업(.bak 되돌리기)은 막는다
    assert.equal((await a.upload()).ok, true, "반영한 저장은 올라간다 (받은 개체는 새 지문)");
    assert.equal((await b.upload()).ok, true);
    const back = await a.uploadOf(bak);
    assert.equal(back.ok ? null : back.code, "CLOUD_PET_TRADED_OUT", "교환 전 백업으로 되돌려 올리기");
    const sentRef = refOf(bak.pets[0]!);

    // 같은 개체를 두 번 보낼 수 없다 — 백업을 로컬에 되돌려 다시 제안한다
    const after = structuredClone(a.save());
    await a.session.create();
    await b.session.join(a.session.view().link!);
    await a.session.refresh();
    a.restore(bak);
    const again = await a.session.offer("p1");
    assert.deepEqual(again, { ok: false, reason: "TRADE_PET_TRADED" }, "이미 교환으로 보낸 개체");
    assert.equal(a.session.view().error?.code, "TRADE_PET_TRADED");
    assert.equal(a.flags.lastFlush?.ok ? null : (a.flags.lastFlush as { code: string } | null)?.code, "CLOUD_PET_TRADED_OUT", "제안 전 올리기도 막혔다");
    assert.deepEqual(await a.net.setOffer(a.session.view().channel!.id, snapshot(bak.pets[0]!), sentRef), { ok: false, code: "TRADE_PET_TRADED" }, "지문이 원장에 있으면 서버 저장과 무관하게 거절");
    a.restore(after);
    await b.session.leave();
    await a.session.refresh();
    assert.equal(a.session.view().phase, "closed");
    assert.equal(a.session.view().channel?.closed_reason, "guest_left");
    process.stdout.write("(5) 원장 — .bak 올리기 CLOUD_PET_TRADED_OUT·두 번 보내기 TRADE_PET_TRADED·친구 나감  ok\n");

    // 오류: 닫힌 채널의 링크는 만료, 참가가 끝난 채널의 링크는 사용됨
    const closed = a.session.view().link!;
    const c = await player("pikachu", cfg.url, cfg.key, { member: true, clientCheck: true });
    await c.session.join(closed);
    assert.equal(c.session.view().error?.code, "TRADE_LINK_EXPIRED", "닫힌 채널의 링크");
    await a.session.create();
    const open = a.session.view().link!;
    await b.session.join(open);
    await c.session.join(open);
    assert.equal(c.session.view().error?.code, "TRADE_LINK_USED", "세 번째 사람");
    process.stdout.write("(6) 오류 코드 전달  ok\n");

    // 거절 이유: 진행 중 채널이 있으면 새로 만들지 않는다. 채널이 없으면 확정하지 않는다. 멈춘 세션은 조작하지 않는다
    assert.deepEqual(await a.session.create(), { ok: false, reason: "in-trade" });
    assert.deepEqual(await c.session.ready(), { ok: false, reason: "no-channel" });
    assert.equal((await b.session.ready()).ok, false, "제안이 없으면 확정하지 않는다");
    assert.deepEqual(await a.session.leave(), { ok: true });
    c.session.stop();
    assert.deepEqual(await c.session.create(), { ok: false, reason: "stopped" });
    await b.session.leave();
    // 로그인 계정의 클라우드 저장이 올릴 수 없는 상태면 새 교환을 시작·참가하지 않는다
    let held = true;
    const d = await player("bulbasaur", cfg.url, cfg.key, { member: true, clientCheck: true, hold: () => held });
    assert.deepEqual(await d.session.create(), { ok: false, reason: "cloud-wait" });
    assert.deepEqual(await d.session.join(open), { ok: false, reason: "cloud-wait" });
    assert.equal(d.session.view().phase, "idle", "막히면 채널을 열지 않는다");
    held = false;
    assert.equal((await d.session.create()).ok, true, "풀리면 만든다");
    await d.session.leave();
    d.session.stop();
    process.stdout.write("(7) 조작 거절 이유  ok\n");

    // (8) 같은 개체를 두 채널에 제안 — 서버 교환 중 예약(design-p2.md 17절 D31). 확정 전에 두 번째 제안이 TRADE_PET_BUSY
    //   한 계정은 열린 채널이 하나뿐이다 — e2 는 e 의 저장을 복사한 다른 계정이다(같은 지문). 예약은 계정과 무관하다
    //   첫 채널을 닫으면 예약이 풀려 두 번째 채널이 올릴 수 있다. 끝난 뒤 원래 개체는 원장에 막힌다(확정 순간의 거부는 SQL 시험이 본다)
    const e = await player("squirtle", cfg.url, cfg.key, { member: true, clientCheck: true });
    const e2 = await player("squirtle", cfg.url, cfg.key, { member: true, clientCheck: true });
    e2.restore(e.save());
    const f = await player("oddish", cfg.url, cfg.key, { member: true, clientCheck: true });
    const g = await player("psyduck", cfg.url, cfg.key, { member: true, clientCheck: true });
    try {
      await e.session.create();
      await f.session.join(e.session.view().link!);
      await e2.session.create();
      await g.session.join(e2.session.view().link!);
      assert.deepEqual(await e.session.offer("p1"), { ok: true }, "첫 채널이 먼저 올린다");
      await f.session.offer("p1");
      await g.session.offer("p1");
      const busy = await e2.session.offer("p1");
      assert.deepEqual(busy, { ok: false, reason: "TRADE_PET_BUSY" }, "다른 계정이라도 다른 활성 교환에 올라간 지문은 거절");
      assert.equal(e2.session.view().error?.code, "TRADE_PET_BUSY", "보기 오류로 보인다");
      assert.equal(e2.session.view().busy, false);
      assert.equal(e2.session.view().myPetId, null, "거절된 제안은 내 제안으로 두지 않는다");
      assert.equal(e2.save().trade?.pending ?? null, null, "로컬 잠금이 없다");
      await e2.session.refresh();
      assert.equal(e2.session.view().channel?.my_offer ?? null, null, "서버 채널에도 제안이 없다");

      // 첫 채널을 닫으면 예약이 풀린다
      assert.deepEqual(await e.session.leave(), { ok: true });
      assert.deepEqual(await e2.session.offer("p1"), { ok: true }, "예약이 풀린 뒤에는 올린다");
      assert.equal(e2.session.view().myPetId, "p1");
      await g.session.refresh();
      await e2.session.ready();
      await g.session.ready(); // 두 번째 채널이 끝난다 — 원장에 e2 의 p1(e 와 같은 지문)
      assert.equal(g.session.view().phase, "done");
      await e2.session.refresh();
      assert.equal(e2.session.view().phase, "done");

      // 같은 지문은 이제 원장에 있다 — e 가 새 채널에서 올려도 거절
      await e.session.create();
      await f.session.join(e.session.view().link!);
      assert.deepEqual(await e.session.offer("p1"), { ok: false, reason: "TRADE_PET_TRADED" }, "교환이 끝난 지문은 원장이 막는다");
      process.stdout.write("(8) 두 채널 같은 지문 — 두 번째 제안 TRADE_PET_BUSY, 첫 채널 닫으면 풀림, 끝난 뒤 원장  ok\n");
    } finally {
      await e.session.leave();
      for (const p of [e, e2, f, g]) p.session.stop();
    }
  } finally {
    a.session.stop();
    b.session.stop();
  }
  process.stdout.write("selftest-trade-net: 통과 (익명 거절·발급 막음·규약·지문·NOT_SYNCED·만들기·참가·제안·확정·완료·반영·원장·나가기·오류·거절·교환 중 예약)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
