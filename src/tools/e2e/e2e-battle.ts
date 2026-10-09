// 랜덤 배틀 서버 E2E (E3) — 로컬 Supabase 에서 익명 계정 넷으로 등록·상대 3개·판·쿨타임·보상·저장 검증을 본다
// 설계: worklog/records/battle-server/battle-server.md "E3 서버 설계", 규칙: docs/specs/adventure.md "서버", balance.md "배틀 보상"
//   준비: Docker Desktop, `npx supabase start`, `npx supabase functions serve`(함수 셋: upload-save·battle-offer·battle-start). 빌드: `npm run build`
//   실행: node dist/tools/e2e/e2e-battle.js   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다)
//   DB 초기화가 서버 함수 컨테이너를 내릴 때가 있다 — 그러면 `npx supabase db reset` 뒤 functions serve 를 띄우고 E2E_KEEP_DB=1 로 돌린다
//   앱 창은 띄우지 않는다. 앱이 부를 함수를 supabase-js 로 그대로 부른다
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { emptySave } from "../../save/normalize";
import type { SaveV3 } from "../../shared/save-v3";
import { testPet } from "../harness/fixtures";
import { localServer, root, sql } from "./apps";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any — 함수 응답을 그대로 읽는다

const checks: string[] = [];
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const T0 = Date.now();

// 배틀 파티를 채운 저장 — 박스 첫 칸부터 넣고 배틀 칸에 같은 개체를 둔다
function saveWith(species: string[], points = 0): SaveV3 {
  const s = emptySave(T0);
  s.pets = species.map((sp, i) => testPet({ id: `p${i + 1}`, species: sp }, T0));
  s.pets.forEach((p, i) => (s.boxes[0]!.slots[i] = p.id));
  s.petSeq = s.pets.length;
  s.battle = { slots: Array.from({ length: 6 }, (_, i) => s.pets[i]?.id ?? null) };
  s.points.balance = points;
  return s;
}

interface Player {
  name: string;
  client: SupabaseClient;
  id: string;
  device: string;
  rev: number;
}

async function player(name: string, url: string, key: string): Promise<Player> {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously();
  assert.ok(!error && data.user, `${name} 익명 가입: ${error?.message}`);
  const device = randomUUID();
  const claim = await client.rpc("claim_device", { p_device: device, p_label: `e2e-${name}`, p_app_version: "99.0.0", p_mode: "boot", p_force: false });
  assert.ok(!claim.error, `${name} 기기 등록: ${claim.error?.message}`);
  return { name, client, id: data.user!.id, device, rev: 0 };
}

async function call(p: Player, fn: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: Json }> {
  const { data, error } = await p.client.functions.invoke(fn, { body });
  if (!error) return { status: 200, body: data };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) return { status: ctx.status, body: await ctx.clone().json().catch(() => ({})) };
  throw error;
}

async function upload(p: Player, save: SaveV3): Promise<Json> {
  const r = await call(p, "upload-save", { device: p.device, baseRev: p.rev, save, saveV: 3, appVersion: "99.0.0", op: randomUUID() });
  assert.equal(r.status, 200, `${p.name} 올리기: ${JSON.stringify(r.body)}`);
  p.rev = r.body.rev;
  return r.body;
}

async function run(): Promise<void> {
  const local = localServer();
  if (process.env.E2E_KEEP_DB !== "1") execSync("npx supabase db reset", { cwd: root, stdio: "ignore", timeout: 300_000 });
  checks.push("로컬 Supabase 확인과 DB 초기화");

  const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((n) => player(n, local.url, local.key)));
  // A·B·C 는 배틀 파티가 있고, D 는 비었다. C 는 초전설 둘이라 출전 불가 — 등록되지 않는다
  await upload(a!, saveWith(["garchomp", "lucario", "gengar"]));
  const bSave = saveWith(["dragonite", "scizor", "alakazam", "snorlax"]);
  bSave.pets[0]!.shiny = true; // 그림 값 — 상대 칸과 판 응답의 looks 가 이로치를 싣는지
  await upload(b!, bSave);
  await upload(c!, saveWith(["mewtwo", "lugia", "pikachu"]));
  const dSave = saveWith(["pikachu"]);
  dSave.battle = { slots: Array.from({ length: 6 }, () => null) }; // 포켓몬은 있지만 배틀 파티는 비었다
  await upload(d!, dSave);
  const entries = sql(`select string_agg(user_id::text, ',' order by user_id) from cloud_private.battle_entries`).split(",").filter(Boolean);
  assert.deepEqual(entries.sort(), [a!.id, b!.id].sort(), "등록: 파티가 있고 출전 불가가 없는 계정만");
  checks.push("저장 올리기 → 배틀 파티 자동 등록 (빈 파티·출전 불가는 등록 안 함)");

  // 상대 받기 — 자기는 빠진다. 후보가 하나뿐이면 하나만
  const offerA = await call(a!, "battle-offer");
  assert.equal(offerA.status, 200, JSON.stringify(offerA.body));
  assert.equal(offerA.body.picks.length, 1, "A 의 후보는 B 하나");
  const party = offerA.body.picks[0].party as Json[];
  assert.equal(party.filter(Boolean).length, 4);
  assert.deepEqual(party[0], { species: "dragonite", form: null, types: ["dragon", "flying"], shiny: true }, "칸에는 종·모습·타입·이로치만");
  assert.ok(!JSON.stringify(offerA.body).includes(b!.id), "상대 계정 id 는 주지 않는다");
  checks.push("battle-offer: 자기 제외, 있는 만큼, 종·모습·타입·이로치만, 계정 id 없음");
  assert.equal((await call(a!, "battle-offer")).body.error, "BATTLE_TOO_FAST", "1초에 한 번");
  checks.push("battle-offer 1초에 한 번 (BATTLE_TOO_FAST)");
  assert.equal((await call(d!, "battle-offer")).body.error, "BATTLE_PARTY_INVALID");
  assert.equal((await call(c!, "battle-offer")).body.error, "BATTLE_PARTY_INVALID");
  checks.push("빈 파티·출전 불가 파티는 BATTLE_PARTY_INVALID");

  // 판 — 그날 첫 판 500
  await new Promise((r) => setTimeout(r, 1100));
  const offer1 = (await call(a!, "battle-offer")).body;
  assert.equal((await call(a!, "battle-start", { offerId: offer1.offerId, pick: 2 })).body.error, "BATTLE_OFFER_GONE", "없는 줄");
  assert.equal((await call(a!, "battle-start", { offerId: randomUUID(), pick: 1 })).body.error, "BATTLE_OFFER_GONE", "다른 offer");
  const first = await call(a!, "battle-start", { offerId: offer1.offerId, pick: 1 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.reward, 500, "그날 첫 판 500");
  assert.ok(first.body.events.length > 10 && first.body.events[0].kind === "start");
  assert.equal(first.body.sides[0].filter(Boolean).length, 3);
  assert.equal(first.body.sides[1].filter(Boolean).length, 4);
  assert.match(first.body.dataHash, /^[0-9a-f]{16}$/);
  assert.equal(first.body.looks?.[1]?.[0]?.shiny, true, "looks: 상대 첫 칸은 이로치");
  assert.equal(first.body.looks?.[0]?.[0]?.shiny, false, "looks: 내 첫 칸은 보통");
  assert.equal(sql(`select count(*) from cloud_private.battle_events`), "1");
  checks.push(`battle-start: 판 ${first.body.result.endMs}ms, 이벤트 ${first.body.events.length}개, 그날 첫 판 500P, 판·이벤트 기록, 칸별 그림 값(looks)`);
  // 쿨타임 5분
  await new Promise((r) => setTimeout(r, 1100));
  const offer2 = (await call(a!, "battle-offer")).body;
  assert.ok(offer2.cooldownMs > 290_000, `남은 쿨타임 ${offer2.cooldownMs}`);
  const cool = await call(a!, "battle-start", { offerId: offer2.offerId, pick: 1 });
  assert.equal(cool.body.error, "BATTLE_COOLDOWN");
  assert.ok(cool.body.remainMs > 290_000);
  checks.push("쿨타임 5분 (BATTLE_COOLDOWN, remainMs)");
  // 쿨타임을 0 으로 두고 다음 판 — 이기면 50, 지거나 비기면 10. 쓴 offer 는 다시 못 쓴다
  sql(`insert into cloud_private.settings (key, value) values ('battle_cooldown_sec', '0') on conflict (key) do update set value = excluded.value`);
  const second = await call(a!, "battle-start", { offerId: offer2.offerId, pick: 1 });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.reward, second.body.result.winner === 0 ? 50 : 10, "그다음 판은 이기면 50, 아니면 10");
  assert.equal((await call(a!, "battle-start", { offerId: offer2.offerId, pick: 1 })).body.error, "BATTLE_OFFER_GONE", "쓴 offer");
  sql(`delete from cloud_private.settings where key = 'battle_cooldown_sec'`);
  checks.push(`다음 판 ${second.body.reward}P (승자 ${second.body.result.winner}), 쓴 offer 는 BATTLE_OFFER_GONE`);

  // 승무패 — A 는 건 판 2, B 는 받은 판 2. 건 쪽 승 = 받은 쪽 패 (supabase/migrations/20261010100000_battle_archive.sql)
  const stat = (id: string): number[] => sql(`select concat_ws(',', wins, losses, draws, def_wins, def_losses, def_draws) from cloud_private.battle_stats where user_id = '${id}'`).split(",").map(Number);
  const [aw, al, ad] = stat(a!.id);
  const [, , , bw, bl, bd] = stat(b!.id);
  assert.equal(aw! + al! + ad!, 2, "A 건 판 2");
  assert.deepEqual([bw, bl, bd], [al, aw, ad], "B 받은 판은 A 의 거울");
  checks.push(`승무패: A 건 판 ${aw}/${al}/${ad}, B 받은 판 ${bw}/${bl}/${bd}`);

  // 배틀 기록 보이기 — 앱이 직접 부르는 함수 (supabase/migrations/20261010110000_battle_record_view.sql). A 는 건 판 2, B 는 받은 판 2
  const viewA = (await a!.client.rpc("battle_record_view")).data as Json;
  assert.equal(viewA.recent.length, 2);
  assert.ok(viewA.recent.every((r: Json) => r.mine === true), "A 의 최근 판은 건 배틀");
  assert.equal(viewA.recent[0].reward, second.body.reward, "새 판이 앞");
  assert.equal(viewA.unseen.wins + viewA.unseen.losses + viewA.unseen.draws, 0, "A 는 받은 판이 없다");
  const viewB = (await b!.client.rpc("battle_record_view")).data as Json;
  assert.ok(viewB.recent.every((r: Json) => r.mine === false && r.reward === null), "B 의 최근 판은 받은 배틀, 포인트 없음");
  assert.equal(viewB.unseen.wins + viewB.unseen.losses + viewB.unseen.draws, 2, "알림 전 받은 판 2");
  assert.equal((await b!.client.rpc("battle_record_seen", { p_until: viewB.unseen.until })).error, null);
  const afterB = (await b!.client.rpc("battle_record_view")).data as Json;
  assert.equal(afterB.unseen.wins + afterB.unseen.losses + afterB.unseen.draws, 0, "본 뒤에는 0");
  assert.deepEqual(afterB.def, viewB.def, "승무패는 그대로");
  checks.push("배틀 기록 보이기: 내 판·받은 판 최근 줄, 받은 판 알림 수와 본 시각");

  // 판 내용 받기·정리 — 관리자 함수. 정리한 뒤에도 장부 줄은 남아 아래 저장 검증이 보상 id 를 찾는다
  assert.equal(sql(`select jsonb_array_length(public.admin_battle_archive_take(10))`), "2", "받을 판 2");
  assert.equal(sql(`select public.admin_battle_archive_done(array(select id from cloud_private.battles))`), "2");
  assert.equal(sql(`select count(*) from cloud_private.battle_events`), "0", "이벤트는 지웠다");
  assert.equal(sql(`select count(*) from cloud_private.battles where sides is null and archived_at is not null`), "2", "장부 줄은 남는다");
  assert.equal(sql(`select jsonb_array_length(public.admin_battle_archive_take(10))`), "0", "다시 받을 판 없음");
  checks.push("판 내용 받기·정리: 이벤트·양쪽 파티만 지우고 장부 줄은 남김");

  // 저장 검증 — 판 id 를 넣으면 보상만큼 포인트가 늘어도 위반이 아니다. 없는 id 와 id 없는 포인트는 위반
  const base = saveWith(["garchomp", "lucario", "gengar"]);
  const withReward: SaveV3 = { ...base, points: { ...base.points, balance: 560 }, battle: { ...base.battle!, applied: [first.body.battleId, second.body.battleId] } };
  withReward.points.balance = first.body.reward + second.body.reward;
  assert.equal((await upload(a!, withReward)).violations, 0, "보상 id 를 넣은 포인트는 위반 아님");
  const fake: SaveV3 = { ...withReward, points: { ...withReward.points, balance: withReward.points.balance + 500 }, battle: { ...withReward.battle!, applied: [...withReward.battle!.applied!, randomUUID()] } };
  const bad = await upload(a!, fake);
  assert.ok(bad.violations >= 1, "없는 판 id 는 위반");
  const rules = sql(`select string_agg(distinct rule, ',') from cloud_private.save_violations where user_id = '${a!.id}'`);
  assert.ok(rules.includes("battle"), `위반 규칙: ${rules}`);
  checks.push(`저장 검증: 판 id 보상은 허용, 없는 판 id 는 위반(${rules})`);

  for (const line of checks) say(`  ✓ ${line}`);
  say(`배틀 서버 E2E 통과 (${checks.length})`);
}

run().catch((e) => {
  for (const line of checks) say(`  ✓ ${line}`);
  console.error(e);
  process.exit(1);
});
