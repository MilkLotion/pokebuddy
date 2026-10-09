// 친선 배틀 서버 E2E — 로컬 Supabase 에서 로그인 계정 둘(+익명 하나)로 링크·참가·준비·판·다시 하기·나가기를 본다
// 규칙: docs/specs/adventure.md "친선 배틀", 서버: supabase/migrations/20261010120000_friendly_battle.sql, supabase/functions/friendly-battle
//   준비: Docker Desktop, `npx supabase start`, `npx supabase functions serve`. 빌드: `npm run build`
//   실행: node dist/tools/e2e/e2e-friendly.js   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다)
//   DB 초기화가 서버 함수 컨테이너를 내릴 때가 있다 — 그러면 `npx supabase db reset` 뒤 functions serve 를 띄우고 E2E_KEEP_DB=1 로 돌린다
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { internalEmail } from "../../online/account";
import { emptySave } from "../../save/normalize";
import type { SaveV3 } from "../../shared/save-v3";
import { testPet } from "../harness/fixtures";
import { localServer, root, sql } from "./apps";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any — 함수 응답을 그대로 읽는다

const checks: string[] = [];
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const T0 = Date.now();

function saveWith(species: string[]): SaveV3 {
  const s = emptySave(T0);
  s.pets = species.map((sp, i) => testPet({ id: `p${i + 1}`, species: sp }, T0));
  s.pets.forEach((p, i) => (s.boxes[0]!.slots[i] = p.id));
  s.petSeq = s.pets.length;
  s.battle = { slots: Array.from({ length: 6 }, (_, i) => s.pets[i]?.id ?? null) };
  return s;
}

interface Player {
  name: string;
  client: SupabaseClient;
  id: string;
  device: string;
  rev: number;
}

// member 면 아이디로 가입한 로그인 계정, 아니면 익명 계정
async function player(name: string, url: string, key: string, member: boolean): Promise<Player> {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = member
    ? await client.auth.signUp({ email: internalEmail(`f${randomBytes(5).toString("hex")}`), password: "e2e-friendly-pass-1", options: { data: { display_name: `친구${name}` } } })
    : await client.auth.signInAnonymously();
  assert.ok(!error && data.user, `${name} 가입: ${error?.message}`);
  const device = randomUUID();
  const claim = await client.rpc("claim_device", { p_device: device, p_label: `e2e-${name}`, p_app_version: "99.0.0", p_mode: "boot", p_force: false });
  assert.ok(!claim.error, `${name} 기기 등록: ${claim.error?.message}`);
  return { name, client, id: data.user!.id, device, rev: 0 };
}

async function call(p: Player, body: Record<string, unknown>): Promise<{ status: number; body: Json }> {
  const { data, error } = await p.client.functions.invoke("friendly-battle", { body });
  if (!error) return { status: 200, body: data };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) return { status: ctx.status, body: await ctx.clone().json().catch(() => ({})) };
  throw error;
}

async function upload(p: Player, save: SaveV3): Promise<void> {
  const { data, error } = await p.client.functions.invoke("upload-save", { body: { device: p.device, baseRev: p.rev, save, saveV: 3, appVersion: "99.0.0", op: randomUUID() } });
  const ctx = (error as { context?: unknown } | null)?.context;
  const why = ctx instanceof Response ? await ctx.clone().text() : error?.message;
  assert.ok(!error, `${p.name} 올리기: ${why}`);
  p.rev = (data as { rev: number }).rev;
}

async function run(): Promise<void> {
  const local = localServer();
  if (process.env.E2E_KEEP_DB !== "1") execSync("npx supabase db reset", { cwd: root, stdio: "ignore", timeout: 300_000 });
  checks.push("로컬 Supabase 확인과 DB 초기화");

  const a = await player("A", local.url, local.key, true);
  const b = await player("B", local.url, local.key, true);
  const c = await player("C", local.url, local.key, false);
  await upload(a, saveWith(["garchomp", "lucario", "gengar"]));
  await upload(b, saveWith(["dragonite", "scizor", "alakazam", "snorlax"]));
  await upload(c, saveWith(["pikachu"]));

  // 익명 계정은 못 한다 (2026-10-10 사용자 결정 "로그인한 계정만")
  const anon = await call(c, { action: "create", protocol: 1 });
  assert.equal(anon.body.error, "FRIENDLY_LOGIN_REQUIRED");
  checks.push("익명 계정은 FRIENDLY_LOGIN_REQUIRED");

  // 링크 만들기 — 토큰은 이때만 준다. 상대 id 는 주지 않는다
  const made = await call(a, { action: "create", protocol: 1 });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const token = made.body.channel.token as string;
  const id = made.body.channel.id as string;
  assert.match(token, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(made.body.channel.status, "open");
  assert.equal(made.body.channel.friendJoined, false);
  assert.ok(!("friendId" in made.body.channel), "상대 id 를 주지 않는다");
  assert.equal(made.body.parties.mine.filter(Boolean).length, 3);
  assert.equal(made.body.parties.friend, null);
  assert.equal((await call(a, { action: "join", token, protocol: 1 })).body.error, "FRIENDLY_OWN_LINK");
  assert.equal((await call(b, { action: "join", token: "x".repeat(22), protocol: 1 })).body.error, "FRIENDLY_LINK_INVALID");
  assert.equal((await call(b, { action: "join", token, protocol: 9 })).body.error, "FRIENDLY_VERSION_MISMATCH");
  checks.push("링크 만들기: 토큰 한 번, 자기 링크·없는 링크·판 다름 거절");

  // 참가 — 양쪽이 서로의 배틀 파티 칸을 본다
  const joined = await call(b, { action: "join", token, protocol: 1 });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.channel.status, "joined");
  assert.equal(joined.body.channel.role, "guest");
  assert.equal(joined.body.channel.friendName, "친구A");
  assert.equal(joined.body.parties.friend.filter(Boolean).length, 3, "B 는 A 의 3칸을 본다");
  assert.deepEqual(joined.body.parties.friend[0], { species: "garchomp", form: null, types: ["dragon", "ground"], shiny: false });
  assert.equal((await call(a, { action: "get", channel: id })).body.parties.friend.filter(Boolean).length, 4, "A 는 B 의 4칸을 본다");
  assert.equal((await call(b, { action: "join", token, protocol: 1 })).body.error, "FRIENDLY_LINK_USED");
  checks.push("참가: 서로의 배틀 파티 칸·친구 이름, 쓴 링크 거절");

  // 준비 — 한쪽만이면 판이 없다. 둘 다면 마지막 요청이 판을 돌린다
  const r1 = await call(a, { action: "ready", channel: id, ready: true });
  assert.equal(r1.body.channel.myReady, true);
  assert.equal(r1.body.channel.round, 0);
  assert.equal((await call(b, { action: "get", channel: id })).body.channel.friendReady, true);
  const r2 = await call(b, { action: "ready", channel: id, ready: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const fight = r2.body.channel.battle;
  assert.equal(r2.body.channel.round, 1);
  assert.equal(fight.round, 1);
  assert.ok(fight.events.length > 10 && fight.events[0].kind === "start");
  assert.equal(fight.sides[0].filter(Boolean).length, 3, "0번이 방장(A)");
  assert.equal(fight.sides[1].filter(Boolean).length, 4);
  assert.ok(Date.parse(fight.startAt) > Date.parse(r2.body.channel.serverNow), "시작 시각은 판정 뒤");
  assert.equal(r2.body.channel.myReady, false, "판이 끝나면 준비가 풀린다");
  assert.equal((await call(a, { action: "get", channel: id })).body.channel.battle.round, 1, "A 도 같은 판");
  checks.push(`준비: 둘 다 준비하면 판(${fight.result.endMs}ms, 이벤트 ${fight.events.length}개), 방장이 0번, 같은 시각 시작`);

  // 판 기록 — 친선 판은 kind friendly, 보상 0, 승무패·쿨타임에 들지 않는다
  assert.equal(sql(`select concat_ws(',', count(*), sum(reward)) from cloud_private.battles where kind = 'friendly'`), "1,0");
  assert.equal(sql(`select count(*) from cloud_private.battle_stats`), "0", "승무패에 넣지 않는다");
  assert.equal(sql(`select (public.battle_context('${a.id}') ->> 'cooldown_ms')`), "0", "쿨타임에 들지 않는다");
  assert.equal(sql(`select jsonb_array_length(public.admin_battle_archive_take(10))`), "1", "밸런스용 받기에는 든다");
  checks.push("판 기록: kind friendly·보상 0, 승무패·쿨타임 밖, 관리자 받기에는 듦");

  // 다시 하기 — 둘이 다시 준비하면 같은 상대와 한 판 더
  await call(a, { action: "ready", channel: id, ready: true });
  await call(a, { action: "ready", channel: id, ready: false });
  assert.equal((await call(b, { action: "get", channel: id })).body.channel.friendReady, false, "준비 취소");
  await call(a, { action: "ready", channel: id, ready: true });
  const again = await call(b, { action: "ready", channel: id, ready: true });
  assert.equal(again.body.channel.round, 2);
  checks.push("다시 하기: 준비 취소, 둘이 다시 준비하면 둘째 판");

  // 출전 불가 — 배틀 파티가 비었으면 준비를 받지 않는다
  const empty = saveWith(["garchomp"]);
  empty.battle = { slots: Array.from({ length: 6 }, () => null) };
  await upload(a, empty);
  assert.equal((await call(a, { action: "ready", channel: id, ready: true })).body.error, "FRIENDLY_PARTY_INVALID");
  assert.equal((await call(a, { action: "get", channel: id })).body.parties.myBlocked, true);
  checks.push("빈 배틀 파티는 FRIENDLY_PARTY_INVALID, myBlocked");

  // 내 채널 — 앱을 다시 켰을 때 이어 붙는다
  assert.equal((await call(b, { action: "mine" })).body.channel.id, id);
  // 나가기 — 친구에게 닫힘과 이유가 보인다
  await call(a, { action: "leave", channel: id });
  const after = await call(b, { action: "get", channel: id });
  assert.equal(after.body.channel.status, "closed");
  assert.equal(after.body.channel.closedReason, "host_left");
  assert.equal((await call(b, { action: "ready", channel: id, ready: true })).body.error, "FRIENDLY_CLOSED");
  assert.equal((await call(b, { action: "mine" })).body.channel, null, "닫힌 채널은 이어 붙지 않는다");
  checks.push("나가기: 친구에게 closed·host_left, 닫힌 채널 준비 거절, mine 없음");

  for (const line of checks) say(`  ✓ ${line}`);
  say(`친선 배틀 서버 E2E 통과 (${checks.length})`);
}

run().catch((e) => {
  for (const line of checks) say(`  ✓ ${line}`);
  console.error(e);
  process.exit(1);
});
