// 친구 교환 E2E — 실제 앱(동반자) 여러 개를 임시 HOME 으로 띄우고 로컬 Supabase 에서 교환을 끝까지 돌린다.
// 설계: docs/work/trade/record.md "구현 2c~2e 계획과 E2E 설계"
//   준비: Docker Desktop 과 `npx supabase start`. 빌드: `npm run build`
//   실행: node scripts/e2e-trade.cjs   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다)
//   조작은 `pokebuddy game trade.*` CLI 의 JSON 결과로 판정한다. 창은 관측기가 숨긴다
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// 로컬 DB 컨테이너 이름 — supabase/config.toml 의 project_id 로 정해진다
const DB_CONTAINER = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'))[1]}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const apps = [];

// ── 로컬 서버 ─────────────────────────────────────────────────────────────────
function localServer() {
  const raw = execSync('npx supabase status -o json', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 90_000 }).toString();
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  const url = j.API_URL, key = j.PUBLISHABLE_KEY || j.ANON_KEY;
  if (!url || !key) throw new Error('로컬 Supabase 주소·키를 읽지 못했다. `npx supabase start` 를 먼저 한다');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) throw new Error(`로컬 주소가 아니다: ${url}`);
  return { url, key };
}

// 로컬 DB 컨테이너에서만 SQL 을 돌린다 — 만료 재현용
function sql(query) {
  const names = execSync('docker ps --format "{{.Names}}"').toString().split(/\r?\n/);
  if (!names.includes(DB_CONTAINER)) throw new Error(`로컬 DB 컨테이너가 없다: ${DB_CONTAINER}`);
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc "${query.replace(/"/g, '\\"')}"`).toString().trim();
}

// ── 앱 하나 ───────────────────────────────────────────────────────────────────
// pets: [{ id, species, where: 'party'|'box' }]
function makeApp(name, server, pets, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pokebuddy-trade-e2e-${name}-`));
  const temp = path.join(dir, 'tmp');
  fs.mkdirSync(temp);
  const env = { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, 'appdata'), LOCALAPPDATA: path.join(dir, 'localappdata'), TEMP: temp, TMP: temp };
  for (const key of Object.keys(env)) if (key.startsWith('POKEBUDDY_') || key === 'NODE_OPTIONS' || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  env.PB_E2E_DIR = dir;
  env.NODE_OPTIONS = `--require "${path.join(__dirname, 'e2e/companion-observer.cjs').split(path.sep).join('/')}"`;
  env.POKEBUDDY_SUPABASE_URL = server.url;
  env.POKEBUDDY_SUPABASE_KEY = server.key;
  env.POKEBUDDY_TRADE_POLL_MS = '600000'; // 주기 새로 고침을 사실상 끈다 — 보기가 바뀌면 실시간 신호 때문이다
  env.POKEBUDDY_TRADE_RETRY_MS = '2000';
  Object.assign(env, extraEnv);

  const data = path.join(dir, '.claude', 'pokebuddy');
  fs.mkdirSync(data, { recursive: true });
  const { empty } = require(path.join(root, 'dist/save/v3.js'));
  const { newPet } = require(path.join(root, 'dist/party/create.js'));
  const save = empty(Date.now());
  for (const p of pets) {
    save.pets.push(newPet({ id: p.id, species: p.species, shiny: false, nature: 'hardy', now: Date.now() }));
    if (p.where === 'party') save.party.slots[save.party.slots.findIndex((s) => s.state === 'empty')] = { state: 'pokemon', petId: p.id, hidden: false };
    else save.boxes[0].slots[save.boxes[0].slots.indexOf(null)] = p.id;
  }
  save.starterPetId = pets[0].id;
  save.tutorials = Object.fromEntries(['first-care', 'playground', 'shop', 'hatch', 'party'].map((k) => [k, { state: 'skipped', steps: 0 }]));
  fs.writeFileSync(path.join(data, 'save.json'), JSON.stringify(save));

  const app = { name, dir, env, data, lock: path.join(data, 'companion.lock') };
  app.cli = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'bin/pokebuddy'), ...args], { cwd: root, env: app.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`[${name}] CLI 시간 초과: ${args.join(' ')}`)); }, 150_000);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  app.start = async () => {
    const r = await app.cli(['companion']);
    assert.equal(r.code, 0, `[${name}] 동반자 시작 실패: ${r.stderr}`);
  };
  // save.lock 의 pid — 살아 있는 writer
  app.pid = () => { try { return Number(fs.readFileSync(path.join(data, 'save.lock'), 'utf8')) || null; } catch { return null; } };
  app.alive = () => { const pid = app.pid(); if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  app.stop = async () => {
    await app.cli(['companion', 'stop']);
    try {
      await until(() => !fs.existsSync(app.lock) && !app.alive(), `[${name}] 종료`);
    } catch (e) {
      // 끝나지 않으면 강제로 끝낸다 — 다음 시나리오가 같은 저장을 쓴다
      const pid = app.pid();
      if (pid) try { process.kill(pid); } catch { /* 이미 끝났다 */ }
      if (fs.existsSync(app.lock)) fs.unlinkSync(app.lock);
      throw e;
    }
  };
  app.game = async (...args) => {
    const r = await app.cli(['game', ...args]);
    try { return JSON.parse(r.stdout); } catch { throw new Error(`[${name}] JSON 아님: ${r.stdout} ${r.stderr}`); }
  };
  app.status = async () => (await app.game('trade.status')).trade;
  app.save = () => JSON.parse(fs.readFileSync(path.join(data, 'save.json'), 'utf8'));
  app.partyPet = () => { const s = app.save(); const id = s.party.slots[0].petId; return s.pets.find((p) => p.id === id); };
  apps.push(app);
  return app;
}

async function until(test, label, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(200);
  }
  throw new Error(`대기 실패: ${label}`);
}
const ok = (r, label) => assert.equal(r.ok, true, `${label}: ${JSON.stringify(r)}`);
const online = () => require(path.join(root, 'dist/trade/config.js'));

// ── 시나리오 ──────────────────────────────────────────────────────────────────
async function run() {
  const server = localServer();
  execSync('npx supabase db reset', { cwd: root, stdio: 'ignore', timeout: 300_000 });
  checks.push('로컬 Supabase 확인과 DB 초기화');

  const A = makeApp('a', server, [{ id: 'p1', species: 'charmander', where: 'party' }, { id: 'p2', species: 'mewtwo', where: 'box' }]);
  const B = makeApp('b', server, [{ id: 'p1', species: 'eevee', where: 'party' }]);
  const C = makeApp('c', server, [{ id: 'p1', species: 'pikachu', where: 'party' }]);
  await A.start(); await B.start(); await C.start();

  // E1 링크 만들기·참가, 세 번째 사람은 사용됨
  const created = await A.game('trade.create');
  ok(created, 'E1 만들기');
  const link = created.trade.link;
  assert.match(link, /#[A-Za-z0-9_-]{16,}$/);
  ok(await B.game('trade.join', '-', `link=${link}`), 'E1 B 참가');
  const third = await C.game('trade.join', '-', `link=${link}`);
  assert.equal(third.reason, 'TRADE_LINK_USED');
  checks.push('E1 링크 만들기·참가, 세 번째 사람은 TRADE_LINK_USED');

  // E3 제안 변경으로 확정 풀림 + 실시간 신호
  ok(await A.game('trade.offer', 'p1'), 'E3 A 제안');
  ok(await B.game('trade.offer', 'p1'), 'E3 B 제안');
  await until(async () => (await A.status()).friendPet?.species === 'eevee', 'A 가 B 제안을 본다(실시간)');
  ok(await A.game('trade.ready'), 'E3 A 확정');
  assert.ok(A.save().trade?.pending, 'A 확정 → 로컬 잠금');
  ok(await B.game('pet.set', 'p1', 'size=3'), 'B 크기 바꾸기');
  ok(await B.game('trade.offer', 'p1'), 'E3 B 제안 변경');
  await until(async () => { const s = await A.status(); return s.channel?.my_ready === false && s.friendPet?.size !== 1.5; }, 'A 의 확정이 풀린다(실시간)');
  assert.equal((await A.status()).refreshedBy, 'signal', '보기는 실시간 신호로 바뀌었다');
  await until(() => !A.save().trade?.pending, 'A 로컬 잠금이 풀린다');
  checks.push('E3 제안 변경으로 확정 풀림, 로컬 잠금 해제, 실시간 신호로 갱신');

  // E4 둘 다 확정 → 양쪽 저장 반영
  ok(await A.game('trade.ready'), 'E4 A 확정');
  ok(await B.game('trade.ready'), 'E4 B 확정');
  await until(() => A.partyPet()?.species === 'eevee', 'A 저장에 이브이');
  await until(() => B.partyPet()?.species === 'charmander', 'B 저장에 파이리');
  for (const X of [A, B]) {
    const s = X.save();
    assert.equal(s.trade.pending, null);
    assert.equal(s.party.slots[0].state, 'pokemon', '같은 칸');
  }
  assert.equal(A.save().pets.length, 2, 'A 개체 수 그대로');
  assert.equal(B.save().pets.length, 1, 'B 개체 수 그대로');
  checks.push('E4 둘 다 확정 → 양쪽 저장에서 같은 칸에 맞바뀜, 개체 수 그대로');

  // E6 단일 포켓몬 — 앱은 올리지 못하고, 조작한 클라이언트가 올리면 받는 쪽이 막는다
  const c6 = await A.game('trade.create');
  ok(c6, 'E6 만들기');
  const single = await A.game('trade.offer', 'p2');
  assert.equal(single.reason, 'LOCAL', '앱이 올리기 전에 막는다');
  assert.equal(single.detail, 'single', '뮤츠는 올리지 못한다');
  const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
  const bad = createClient(server.url, server.key, { auth: { persistSession: false } });
  await bad.auth.signInAnonymously();
  const token = c6.trade.link.split('#')[1];
  const { data: badChannel } = await bad.rpc('join_channel', { p_token: token, p_protocol: online().onlineConfig().protocol, p_data_version: online().dataVersion() });
  assert.ok(badChannel, '조작한 클라이언트 참가');
  await bad.rpc('set_offer', { p_channel: badChannel, p_pet: { species: 'mewtwo', shiny: false, nature: 'hardy', size: 1.5, level: 70, exp: 0, affinity: 0, fullness: 100, mood: 60, stage: 0, evolved: [] } });
  await until(async () => (await A.status()).friendBlocked === 'single', 'A 가 조작한 제안을 막는다');
  ok(await A.game('trade.offer', A.partyPet().id), 'E6 A 제안');
  assert.equal((await A.game('trade.ready')).reason, 'not-ready', '막힌 제안에는 확정하지 않는다');
  assert.equal((await A.status()).channel?.my_ready, false, '서버에도 확정이 없다');
  assert.ok(!A.save().trade?.pending, '잠금도 없다');
  ok(await A.game('trade.leave'), 'E6 나가기');
  checks.push('E6 단일 포켓몬: 올리기 거절, 조작한 제안은 friendBlocked=single, 확정 안 됨');

  // E2 참가 전 만료
  const c2 = await A.game('trade.create');
  ok(c2, 'E2 만들기');
  sql("update public.trade_channels set expires_at = now() - interval '1 minute' where status = 'open'");
  assert.equal((await B.game('trade.join', '-', `link=${c2.trade.link}`)).reason, 'TRADE_LINK_EXPIRED');
  assert.equal((await A.game('trade.create')).reason, 'in-trade', '진행 중 채널이 있으면 새로 만들지 않는다');
  await A.game('trade.leave');
  checks.push('E2 참가 전 만료 → TRADE_LINK_EXPIRED');

  // E9 친구 나감
  const c9 = await A.game('trade.create');
  ok(await B.game('trade.join', '-', `link=${c9.trade.link}`), 'E9 B 참가');
  ok(await B.game('trade.leave'), 'E9 B 나감');
  await until(async () => (await A.status()).phase === 'closed', 'A 가 닫힘을 본다');
  assert.equal((await A.status()).channel.closed_reason, 'guest_left');
  checks.push('E9 친구 나감 → closed, guest_left');

  // E5 완료 직후 강제 종료 → 다시 켜면 한 번만 반영
  await A.stop();
  A.env.POKEBUDDY_TRADE_FAULT = 'before-apply';
  await A.start();
  const before = { a: A.partyPet().species, b: B.partyPet().species };
  const c5 = await A.game('trade.create');
  ok(await B.game('trade.join', '-', `link=${c5.trade.link}`), 'E5 B 참가');
  ok(await A.game('trade.offer', A.partyPet().id), 'E5 A 제안');
  ok(await B.game('trade.offer', B.partyPet().id), 'E5 B 제안');
  await until(async () => (await A.status()).friendPet != null, 'A 가 제안을 본다');
  ok(await A.game('trade.ready'), 'E5 A 확정');
  await B.game('trade.ready');
  await until(() => B.partyPet()?.species === before.a, 'B 반영');
  await until(() => { try { process.kill(Number(fs.readFileSync(path.join(A.data, 'save.lock'), 'utf8')), 0); return false; } catch { return true; } }, 'A 가 반영 직전에 끝난다', 30_000);
  assert.equal(A.partyPet().species, before.a, '끝난 A 는 아직 반영하지 않았다');
  assert.ok(A.save().trade.pending, 'pending 이 남아 있다');
  delete A.env.POKEBUDDY_TRADE_FAULT;
  if (fs.existsSync(A.lock)) fs.unlinkSync(A.lock);
  await A.start();
  await until(() => A.partyPet()?.species === before.b, '다시 켠 A 가 반영한다');
  const countAfter = A.save().pets.length;
  await A.stop(); await A.start();
  await until(async () => { const s = await A.status(); return s.busy === false && s.error === null; }, '다시 켠 A 의 시작 확인이 끝난다');
  assert.equal(A.save().pets.length, countAfter, '또 켜도 한 번만');
  assert.equal(A.partyPet().species, before.b);
  checks.push('E5 완료 직후 강제 종료 → 다시 켜면 한 번만 반영');

  // E8 데이터 버전이 다르면 참가 거절
  await B.stop();
  B.env.POKEBUDDY_TRADE_DATA_VERSION = 'zzzzzzzzzzzz';
  await B.start();
  const c8 = await A.game('trade.create');
  assert.equal((await B.game('trade.join', '-', `link=${c8.trade.link}`)).reason, 'TRADE_VERSION_MISMATCH');
  await A.game('trade.leave');
  checks.push('E8 데이터 버전이 다르면 TRADE_VERSION_MISMATCH');

  // E7 서버에 닿지 못해도 게임은 된다
  const D = makeApp('d', { url: 'http://127.0.0.1:1', key: server.key }, [{ id: 'p1', species: 'bulbasaur', where: 'party' }]);
  await D.start();
  assert.equal((await D.game('trade.create')).reason, 'NETWORK');
  ok(await D.game('play', 'p1'), 'E7 오프라인에서 놀아주기');
  checks.push('E7 연결 실패 → NETWORK, 게임 명령은 된다');
}

async function main() {
  let failed = null;
  try {
    await run();
  } catch (e) {
    failed = e;
  } finally {
    for (const a of apps) {
      try { if (fs.existsSync(a.lock)) await a.stop(); } catch { /* 끄기 실패는 아래에서 알린다 */ }
    }
  }
  for (const c of checks) console.log(`ok  ${c}`);
  if (failed) {
    console.error(`실패: ${failed.stack || failed}`);
    console.error(`임시 데이터: ${apps.map((a) => a.dir).join(', ')}`);
    process.exit(1);
  }
  for (const a of apps) {
    try { fs.rmSync(a.dir, { recursive: true, force: true }); } catch (e) { console.error(`임시 폴더를 지우지 못했다: ${a.dir}`, e.message); }
  }
  console.log(`e2e-trade: 통과 (${checks.length}개)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
