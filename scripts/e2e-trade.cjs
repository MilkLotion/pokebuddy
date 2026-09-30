// 친구 교환 E2E — 실제 앱(동반자) 여러 개를 임시 HOME 으로 띄우고 로컬 Supabase 에서 교환을 끝까지 돌린다.
// 설계: worklog/records/trade/record.md "구현 2c~2e 계획과 E2E 설계"
//   준비: Docker Desktop 과 `npx supabase start`. 빌드: `npm run build`
//   실행: node scripts/e2e-trade.cjs [--ui]   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다. --ui 면 화면 시나리오만)
//   조작은 `pokebuddy game trade.*` CLI 의 JSON 결과로 판정한다. 창은 관측기가 숨긴다
//   교환 규약 2(worklog-mac/records/cloud-authority/design-p2.md 13·14절): 익명 계정은 교환하지 못한다.
//     앱마다 계정 탭에서 가입해 익명 저장을 새 계정으로 옮기고, 계정 저장이 올라간 뒤 교환한다
//     제안은 개체 지문(ref)이 서버 저장에 있어야 한다 — 조작한 클라이언트도 가입하고 저장을 올린 뒤 제안한다
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { root, apps, localServer, sql, makeApp, until, ok, online } = require('./e2e/apps.cjs');
const checks = [];
const PASSWORD = 'correct-horse-8';
const stamp = Date.now().toString(36);
const emailOf = (username) => `${username}@id.pokebuddy.invalid`;
const accountRev = (username) => Number(sql(`select coalesce((select s.rev from public.cloud_saves s join auth.users u on u.id = s.user_id where u.email = '${emailOf(username)}' and s.save is not null), -1)`));

// 가입하고 계정 저장이 올라갈 때까지 기다린다 — 교환은 로그인 계정만, 제안은 서버 저장에 있는 개체만
async function member(X) {
  const username = `t${stamp}${X.name}`;
  await X.signUp(username, PASSWORD);
  await until(() => accountRev(username) >= 1, `[${X.name}] 계정 저장`, 30_000);
  return username;
}

// 조작한 클라이언트 — 가입하고 단일 포켓몬(뮤츠)을 담은 저장을 올린다. 앱이 막는 개체를 서버에 곧바로 제안하려고 쓴다
async function badMember(server) {
  const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
  const { empty } = require(path.join(root, 'dist/save/v3.js'));
  const { newPet } = require(path.join(root, 'dist/party/create.js'));
  const bad = createClient(server.url, server.key, { auth: { persistSession: false } });
  const signed = await bad.auth.signUp({ email: emailOf(`bad${Date.now().toString(36)}`), password: PASSWORD, options: { data: { display_name: 'bad' } } });
  assert.ifError(signed.error);
  const version = require(path.join(root, 'package.json')).version;
  const device = crypto.randomUUID();
  const claim = await bad.rpc('claim_device', { p_device: device, p_label: 'bad', p_app_version: version, p_mode: 'boot', p_force: false });
  assert.ifError(claim.error);
  const now = Date.now();
  const save = empty(now);
  const pet = newPet({ id: 'p1', species: 'mewtwo', shiny: false, nature: 'hardy', now });
  save.pets.push(pet);
  save.party.slots[0] = { state: 'pokemon', petId: pet.id, hidden: false };
  save.starterPetId = pet.id;
  // 앱처럼 Edge Function upload-save 로 올린다(서버 검증 P4a — 로컬 functions serve 필요)
  const up = await bad.functions.invoke('upload-save', { body: { device, baseRev: claim.data?.[0]?.rev ?? 0, save, saveV: 3, appVersion: version, op: crypto.randomUUID() } });
  assert.ifError(up.error);
  return { bad, ref: { id: pet.id, since: pet.since } };
}
// 서버 저장의 뮤츠(레벨 1)와 같은 값 — P5 부터 앱이 서버보다 큰 레벨을 보내면 TRADE_PET_NOT_SYNCED 다. 제안 값은 서버 저장으로 만든다
const MEWTWO = { species: 'mewtwo', shiny: false, nature: 'hardy', size: 1.5, level: 1, exp: 0, affinity: 0, fullness: 100, mood: 60, stage: 0, evolved: [] };

// ── 시나리오 ──────────────────────────────────────────────────────────────────
async function run() {
  const server = localServer();
  execSync('npx supabase db reset', { cwd: root, stdio: 'ignore', timeout: 300_000 });
  checks.push('로컬 Supabase 확인과 DB 초기화');
  if (process.argv.includes('--ui')) return ui(server); // 화면 시나리오만 — 고칠 때 빨리 돌린다

  const A = makeApp('a', server, [{ id: 'p1', species: 'charmander', where: 'party' }, { id: 'p2', species: 'mewtwo', where: 'box' }]);
  const B = makeApp('b', server, [{ id: 'p1', species: 'eevee', where: 'party' }]);
  const C = makeApp('c', server, [{ id: 'p1', species: 'pikachu', where: 'party' }]);
  await A.start(); await B.start(); await C.start();

  // E0 익명 계정은 교환하지 못한다 — 가입해 익명 저장을 계정으로 옮긴 뒤 교환한다
  assert.equal((await A.game('trade.create')).reason, 'login-required', 'E0 익명 만들기 거절');
  await member(A); await member(B); await member(C);
  checks.push('E0 익명 만들기 login-required → 세 앱 가입, 계정 저장 올라감');

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
  const { bad, ref } = await badMember(server);
  const token = c6.trade.link.split('#')[1];
  const { data: badChannel } = await bad.rpc('join_channel', { p_token: token, p_protocol: online().onlineConfig().protocol, p_data_version: online().dataVersion() });
  assert.ok(badChannel, '조작한 클라이언트 참가');
  const offered = await bad.rpc('set_offer', { p_channel: badChannel, p_pet: MEWTWO, p_ref: ref });
  assert.ifError(offered.error);
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
  // 다시 켠 직후에는 클라우드 저장이 연결 중일 수 있다(cloud-wait) — 만들어질 때까지 다시 시도한다
  let c5 = null;
  await until(async () => (c5 = await A.game('trade.create')).ok, `E5 A 만들기: ${JSON.stringify(c5)}`, 30_000);
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
  let c8 = null;
  await until(async () => (c8 = await A.game('trade.create')).ok, 'E8 A 만들기', 30_000);
  assert.equal((await B.game('trade.join', '-', `link=${c8.trade.link}`)).reason, 'TRADE_VERSION_MISMATCH');
  await A.game('trade.leave');
  checks.push('E8 데이터 버전이 다르면 TRADE_VERSION_MISMATCH');

  // E7 서버에 닿지 못해도 게임은 된다
  const D = makeApp('d', { url: 'http://127.0.0.1:1', key: server.key }, [{ id: 'p1', species: 'bulbasaur', where: 'party' }]);
  await D.start();
  // 켜진 직후에는 교환 세션의 시작 확인이 끝나기 전이라 busy 로 거절할 수 있다 — 풀릴 때까지 기다린 뒤 NETWORK 를 본다 (2026-09-30 간헐 실패)
  let e7;
  await until(async () => (e7 = await D.game('trade.create')).reason !== 'busy', 'E7 시작 확인 끝', 30_000);
  assert.equal(e7.reason, 'NETWORK');
  ok(await D.game('play', 'p1'), 'E7 오프라인에서 놀아주기');
  checks.push('E7 연결 실패 → NETWORK, 게임 명령은 된다');

  await ui(server);
}

// ── 화면 — 관리 창의 교환 모달(박스 머리 `교환` 단추)을 실제 앱에서 눌러 본다 ─────────────────────────────
// 찍은 화면은 worklog/records/trade/evidence/(Mac 은 worklog-mac/) 에 남긴다. Figma 05 Screens `633:18522` 와 견준다
async function ui(server) {
  // Mac 은 작업 기록을 worklog-mac/ 에 둔다 — 있는 쪽에 찍는다
  const logRoot = fs.existsSync(path.join(root, 'worklog')) ? 'worklog' : 'worklog-mac';
  const shots = path.join(root, logRoot, 'records/trade/evidence');
  fs.mkdirSync(shots, { recursive: true });
  const shot = (X, name) => X.shot(path.join(shots, name));
  const has = async (X, words) => { const t = await X.text(); return words.every((w) => t.includes(w)); };
  const opened = (X) => until(async () => { try { return await X.dom('!!document.querySelector("nav .tabs button")'); } catch { return false; } }, `[${X.name}] 관리 창`);
  // 보낼 포켓몬 칸 하나를 누른다
  const pick = (X, petName) => X.dom(`(() => { const c = [...document.querySelectorAll('.trade-cell')].find((x) => x.querySelector('.who')?.textContent === ${JSON.stringify(petName)}); if (!c || c.disabled) return false; c.click(); return true; })()`);

  const UA = makeApp('ua', server, [{ id: 'p1', species: 'charmander', where: 'party' }, { id: 'p2', species: 'pikachu', where: 'party' }, { id: 'p3', species: 'mewtwo', where: 'box' }]);
  const UB = makeApp('ub', server, [{ id: 'p1', species: 'eevee', where: 'party' }]);
  await UA.start(); await UB.start();
  await member(UA); await member(UB);

  // U1 교환 모달 — 박스 탭 머리의 `교환` 단추로 연다. 두 카드와 규칙
  await UA.ui('open');
  await opened(UA);
  assert.equal(await UA.press('박스'), true, '박스 탭');
  assert.equal(await UA.press('교환'), true, '교환 단추');
  await until(() => has(UA, ['친구 교환', '공유 채널 만들기', '링크로 참가', '교환 규칙']), 'U1 교환 모달 첫 화면');
  await shot(UA, 'trade-base.png');
  checks.push('U1 박스 `교환` 단추 → 교환 모달 첫 화면(공유 채널 만들기·링크로 참가·규칙)');

  // U2 링크 만들기 — 남은 시간과 링크 복사
  assert.equal(await UA.press('링크 만들기'), true);
  await until(() => has(UA, ['친구 기다리는 중', '참가 전 남은 시간', '링크 복사']), 'U2 링크 만든 화면');
  await shot(UA, 'trade-link.png');
  const link = (await UA.status()).link;
  assert.ok(link, 'U2 링크');
  checks.push('U2 링크 만들기 → 공유 채널 카드(남은 시간·링크 복사·취소)');

  // U3 딥링크로 참가 — B 는 링크로 앱을 연 것처럼 second-instance 를 받는다. A 는 실시간 신호로 바뀐다
  await UB.ui('link', { url: `pokebuddy://trade/${link.split('#')[1]}` });
  await opened(UB);
  await until(() => has(UB, ['친구 교환', '내 포켓몬', '의 포켓몬', '보낼 포켓몬']), 'U3 B 교환 모달'); // 친구가 로그인했으면 제목은 `<이름>의 포켓몬`
  await until(() => has(UA, ['내 포켓몬', '보낼 포켓몬']), 'U3 A 가 참가를 본다');
  // 보낼 포켓몬은 ◀ ▶ 로 파티 → 박스 판을 넘긴다(9ec7581). 뮤츠는 박스에 있다 — 판을 넘겨 찾고, 본 뒤 파티 판으로 돌아온다
  const singleBlocked = await UA.dom(`(() => {
    for (let i = 0; i < 10; i++) {
      const c = [...document.querySelectorAll('.trade-cell')].find((x) => x.querySelector('.who')?.textContent === '뮤츠');
      if (c) return c.disabled === true;
      const n = document.querySelector('.trade-pager button[aria-label="다음 판"]');
      if (!n || n.disabled) return 'none';
      n.click();
    }
    return 'none';
  })()`);
  await UA.dom(`(() => { for (let i = 0; i < 10; i++) { const p = document.querySelector('.trade-pager button[aria-label="앞 판"]'); if (!p || p.disabled) return true; p.click(); } return true; })()`);
  assert.equal(singleBlocked, true, 'U3 단일 포켓몬 칸은 막힌다');
  checks.push('U3 딥링크(second-instance)로 참가 → B 는 박스 탭 + 교환 모달, 양쪽 교환 화면, 단일 포켓몬 칸 막힘');

  // U4 두 사람이 화면에서 고른다
  assert.equal(await pick(UA, '파이리'), true);
  assert.equal(await pick(UB, '이브이'), true);
  await until(() => has(UA, ['파이리', '이브이', '확정 전']), 'U4 A 가 두 제안을 본다');
  await shot(UA, 'trade-offer.png');
  checks.push('U4 화면에서 제안 → 양쪽 카드');

  // U5 둘 다 확정 → 완료 화면
  assert.equal(await UA.press('확정'), true);
  await until(() => has(UA, ['확정함', '확정 취소']), 'U5 A 확정');
  assert.equal(await UB.press('확정'), true);
  await until(() => has(UA, ['교환 완료', '받은 포켓몬', '파티 1번 칸에 들어갔어요']), 'U5 A 완료 화면');
  await until(() => has(UB, ['교환 완료', '파이리']), 'U5 B 완료 화면');
  await shot(UA, 'trade-done.png');
  assert.equal(UA.partyPet().species, 'eevee');
  assert.equal(UB.partyPet().species, 'charmander');
  checks.push('U5 화면에서 확정 → 완료 화면(받은 포켓몬·들어간 칸), 저장 반영');

  // U6 잘못된 링크 → 오류 배너
  assert.equal(await UA.press('확인'), true);
  await until(() => has(UA, ['공유 채널 만들기']), 'U6 첫 화면으로');
  await UA.dom(`(() => { const i = document.querySelector('.trade-input:not([readonly])'); i.value = 'https://example.invalid/trade#bad'; i.dispatchEvent(new Event('input')); return true; })()`);
  assert.equal(await UA.press('참가'), true);
  await until(() => has(UA, ['링크가 올바르지 않아요']), 'U6 오류 배너');
  await shot(UA, 'trade-error.png');
  checks.push('U6 잘못된 링크 → 오류 배너');

  // U7 받을 수 없는 제안 → 막힘 화면, 확정 단추 막힘
  assert.equal(await UA.press('링크 만들기'), true);
  await until(() => has(UA, ['링크 복사']), 'U7 링크');
  const token = (await UA.status()).link.split('#')[1];
  const { bad, ref } = await badMember(server);
  const { data: ch } = await bad.rpc('join_channel', { p_token: token, p_protocol: online().onlineConfig().protocol, p_data_version: online().dataVersion() });
  const offered = await bad.rpc('set_offer', { p_channel: ch, p_pet: MEWTWO, p_ref: ref });
  assert.ifError(offered.error);
  await until(() => has(UA, ['받을 수 없음', '받을 수 없는 포켓몬이에요']), 'U7 막힘 화면');
  assert.equal(await pick(UA, '이브이'), true, `U7 이브이 칸: ${JSON.stringify(await UA.dom("[...document.querySelectorAll('.trade-cell')].map((c) => [c.querySelector('.who')?.textContent, c.disabled])"))}`);
  await until(() => has(UA, ['받을 수 없는 포켓몬이에요', 'Lv.']), 'U7 내 제안');
  assert.equal(await UA.press('확정'), false, 'U7 확정 막힘');
  await shot(UA, 'trade-blocked.png');
  assert.equal(await UA.press('나가기'), true);
  await until(() => has(UA, ['공유 채널 만들기']), 'U7 나가기');
  checks.push('U7 받을 수 없는 제안 → 막힘 배너, 확정 단추 막힘, 나가기');

  // U8 링크로 처음 켜기 — 교환 세션의 시작 확인 중에 참가해도 링크가 사라지지 않는다(2026-09-27 검수 R2-01)
  assert.equal(await UA.press('링크 만들기'), true);
  await until(() => has(UA, ['링크 복사']), 'U8 링크');
  const first = (await UA.status()).link.split('#')[1];
  // C 는 먼저 가입해 두고 끈 뒤 링크 인자로 다시 켠다 — 익명으로 켜면 참가하지 못한다(login-required)
  const UC = makeApp('uc', server, [{ id: 'p1', species: 'bulbasaur', where: 'party' }]);
  await UC.start();
  await member(UC);
  await UC.stop();
  UC.env.PB_E2E_ARGV_LINK = `pokebuddy://trade/${first}`;
  await UC.start();
  await until(async () => (await UC.status())?.phase === 'trading', 'U8 C 가 참가한다', 60_000);
  await opened(UC);
  await until(() => has(UC, ['내 포켓몬', '보낼 포켓몬']), 'U8 C 의 교환 모달이 열린다');
  await until(() => has(UA, ['내 포켓몬', '보낼 포켓몬']), 'U8 A 가 참가를 본다');
  assert.equal(await UA.press('나가기'), true);
  checks.push('U8 링크로 처음 켜기(인자) → 시작 확인 뒤 참가, 교환 모달 열림');
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
