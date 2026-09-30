// 계정·클라우드 저장 E2E — 실제 앱(동반자) 여러 개를 임시 HOME 으로 띄우고 로컬 Supabase 에서 사용자 모달의 계정 탭을 눌러 본다.
// 설계: worklog/records/trade/record.md "로그인·클라우드 저장 구현 계획" L6, 두 PC 규칙은 worklog-mac/records/cloud-authority/design-p1.md,
//   익명 계정 저장·진행 옮기기·새로 시작·저장 정보 분실은 worklog-mac/records/cloud-authority/design-p2.md 5절·8절
//   두 PC 규칙(P1): 고르기 창·저장 단추가 없다. 나중에 로그인한 PC 가 계정 저장을 받아 잇고, 먼저 켜진 PC 는 안내 뒤 종료한다
//   익명 계정(P2): 로그인하지 않은 설치도 익명 계정으로 저장한다. 교환은 로그인해야 한다. 로그아웃·삭제는 앱을 다시 켜 처음부터 시작한다
//   준비: Docker Desktop 과 `npx supabase start`. 계정 삭제까지 보려면 `npx supabase functions serve` 도 띄운다. 빌드: `npm run build`
//   실행: node scripts/e2e-account.cjs   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다)
//   익명 계정을 7개 만든다(계정 삭제를 건너뛰면 6개) — 로컬 auth 의 익명 가입 제한(GOTRUE_RATE_LIMIT_ANONYMOUS_USERS, 시간당·IP당)이 그보다 작으면 실패한다
//   앱은 로컬 서버를 직접 보지 않고 이 스크립트의 TCP 중계를 거친다 — 중계를 끊어 오프라인을 재현한다
//   GitHub 로그인은 실제 GitHub 가 필요해 여기서 보지 않는다(selftest-github 와 사용자 실기)
//   분실 창(D29)은 네이티브 대화상자라 누르지 않는다 — 계정 탭·헤더의 분실 표시까지 본다
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { root, apps, localServer, sql, makeApp, until, sleep } = require('./e2e/apps.cjs');

const checks = [];

// 끊을 수 있는 TCP 중계 — HTTP 와 실시간(WebSocket)을 그대로 넘긴다
function tcpProxy(targetUrl) {
  const target = new URL(targetUrl);
  const sockets = new Set();
  let down = false;
  const server = net.createServer((client) => {
    if (down) return client.destroy();
    const upstream = net.connect(Number(target.port), target.hostname);
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('error', () => undefined);
      s.on('close', () => { sockets.delete(s); client.destroy(); upstream.destroy(); });
    }
    client.pipe(upstream).pipe(client);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    setDown(v) {
      down = v;
      if (v) for (const s of sockets) s.destroy();
    },
    close() {
      server.close();
      for (const s of sockets) s.destroy();
    },
  })));
}

async function run() {
  const local = localServer();
  execSync('npx supabase db reset', { cwd: root, stdio: 'ignore', timeout: 300_000 });
  checks.push('로컬 Supabase 확인과 DB 초기화');
  const proxy = await tcpProxy(local.url);
  const server = { url: proxy.url, key: local.key };
  // Mac 은 작업 기록을 worklog-mac/ 에 둔다 — 있는 쪽에 찍는다
  const logRoot = fs.existsSync(path.join(root, 'worklog')) ? 'worklog' : 'worklog-mac';
  const shots = path.join(root, logRoot, 'records/cloud-authority/evidence');
  fs.mkdirSync(shots, { recursive: true });
  const env = { POKEBUDDY_CLOUD_UPLOAD_MS: '1000', POKEBUDDY_CLOUD_RETRY_MS: '1500', POKEBUDDY_CLOUD_HEARTBEAT_MS: '2000' };
  const opts = { prefix: 'pokebuddy-account-e2e' };
  const name = `e2e${Date.now().toString(36)}`;
  const pw = 'correct-horse-8';
  const email = `${name}@id.pokebuddy.invalid`;
  const minVersion = sql(`select value from cloud_private.settings where key = 'min_app_version'`);
  const revOf = () => Number(sql(`select coalesce((select s.rev from public.cloud_saves s join auth.users u on u.id = s.user_id where u.email = '${email}'), -1)`));
  const serverPoints = () => sql(`select s.save->'points'->>'balance' from public.cloud_saves s join auth.users u on u.id = s.user_id where u.email = '${email}'`);
  const userCount = (id) => sql(`select count(*) from auth.users where id = '${id}'`);
  const anonSaved = (id) => sql(`select count(*) from public.cloud_saves s join auth.users u on u.id = s.user_id where u.id = '${id}' and u.is_anonymous and s.save is not null`) === '1';
  const pickers = (X) => X.events().filter((e) => e.event === 'picker-ready').length;
  const boots = (X) => X.events().filter((e) => e.event === 'boot').length;
  const bak = (X, kind) => fs.readdirSync(X.data).some((f) => f.startsWith(`save.json.${kind}-`) && f.endsWith('.bak'));
  // 익명 계정이 첫 저장을 올릴 때까지 기다리고 그 계정 ID 를 돌려준다
  const anonOf = async (X, label) => {
    await until(() => X.cloud()?.ownerKind === 'anonymous' && X.cloud()?.syncedRev >= 1, `${label} 익명 첫 저장`, 30_000);
    return X.cloud().owner;
  };

  // AC0 새 설치 — 선택 창에서 고르면 익명 계정으로 저장한다. 헤더 저장 표시, 계정 탭 `익명으로 저장 중`
  const N = makeApp('n', server, [], env, { ...opts, fresh: true });
  await N.startFresh();
  const anonN = await anonOf(N, 'AC0');
  assert.ok(anonSaved(anonN), 'AC0 서버에 익명 저장이 있다');
  assert.equal(sql(`select trust from public.cloud_saves where user_id = '${anonN}'`), 'fresh', 'AC0 새 게임 첫 저장은 fresh');
  await N.accountTab();
  await until(async () => (await N.indicator()).includes('저장됨'), 'AC0 헤더 저장 표시(익명)');
  await until(() => N.has(['익명으로 저장 중', '로그인하면 다른 PC 에서도 이어서 하고 교환할 수 있어요', 'GitHub로 계속']), 'AC0 계정 탭 익명 저장 줄');
  assert.equal(await N.has(['로그인하지 않아도 교환할 수 있어요']), false, 'AC0 옛 안내가 없다');
  await N.shot(path.join(shots, 'account-anonymous.png'));
  checks.push('AC0 새 설치 → 선택 창 → 익명 계정 첫 저장(fresh), 헤더 저장됨, 계정 탭 익명으로 저장 중');

  // AC0-1 익명은 교환하지 못한다 — 교환 모달에 로그인 안내, 누르면 계정 탭. 명령은 login-required
  await N.closeDialog();
  assert.equal(await N.press('박스'), true, 'AC0-1 박스 탭');
  assert.equal(await N.press('교환'), true, 'AC0-1 교환 단추');
  await until(() => N.has(['친구 교환', '교환은 로그인해야 할 수 있어요']), 'AC0-1 교환 모달 로그인 안내');
  assert.equal(await N.has(['링크 만들기']), false, 'AC0-1 링크 만들기 없음');
  await N.shot(path.join(shots, 'trade-login-required.png'));
  assert.equal(await N.press('로그인'), true, 'AC0-1 로그인 단추');
  await until(() => N.has(['익명으로 저장 중', 'GitHub로 계속']), 'AC0-1 계정 탭이 열린다');
  assert.equal((await N.game('trade.create')).reason, 'login-required', 'AC0-1 trade.create 거절');
  checks.push('AC0-1 익명 교환 — 모달에 로그인 안내(링크 만들기 없음), 로그인 단추로 계정 탭, 명령은 login-required');

  // AC8 저장 정보 분실(D29) — 세션 파일을 지우고 다시 켜면 분실 창. 게임은 계속, 클라우드 저장은 꺼진다.
  //   분실 창(네이티브)은 관측기가 가로챈다 — 문구·단추를 보고 [이 PC 저장으로 계속] 을 누른다
  await N.stop();
  // 저장 잠금이 풀린 뒤에도 끝나는 중인 프로세스가 세션 파일을 다시 쓸 수 있다 — 프로세스가 끝날 때까지 기다린다
  const lastBoot = N.events().filter((e) => e.event === 'boot').pop()?.pid;
  await until(() => { try { process.kill(lastBoot, 0); return false; } catch { return true; } }, 'AC8 앱 프로세스 종료', 30_000);
  const online = path.join(N.data, 'online');
  const sessionFiles = ['session.bin', 'session.json'].filter((f) => fs.existsSync(path.join(online, f)));
  assert.ok(sessionFiles.length > 0, 'AC8 세션 파일이 있다');
  for (const f of sessionFiles) fs.rmSync(path.join(online, f));
  await N.start();
  await until(() => N.dialogs().some((d) => d.title === '저장 정보를 찾지 못했어요'), 'AC8 분실 창');
  const lost = N.dialogs().find((d) => d.title === '저장 정보를 찾지 못했어요');
  assert.deepEqual(lost.buttons, ['이 PC 저장으로 계속', '처음부터'], 'AC8 익명 분실 창 단추');
  assert.ok(lost.detail.includes('서버에 둔 익명 저장은 되찾을 수 없어요'), `AC8 한 번 올린 익명은 되찾을 수 없다는 줄: ${lost.detail}`);
  await N.accountTab();
  await until(async () => (await N.indicator()) === '저장 꺼짐', 'AC8 헤더 저장 꺼짐');
  await until(() => N.has(['저장 정보를 찾지 못했어요', '로그인하면 다시 계정에 저장해요']), 'AC8 계정 탭 분실 안내');
  await N.shot(path.join(shots, 'account-lost.png'));
  assert.equal(N.cloud()?.owner, anonN, 'AC8 저장 주인은 그대로 — 새 익명 계정을 저절로 만들지 않는다');
  assert.equal((await N.game('pet.set', N.partyPet().id, 'size=2')).ok, true, 'AC8 게임은 계속');
  const lostPoints = N.save().points.balance;
  await N.answer('이 PC 저장으로 계속');
  await until(() => N.cloud()?.ownerKind === 'anonymous' && N.cloud()?.owner !== anonN && N.cloud()?.syncedRev >= 1, 'AC8 새 익명 계정으로 이 PC 저장을 올린다', 30_000);
  const anonN2 = N.cloud().owner;
  assert.ok(anonSaved(anonN2), 'AC8 새 익명 계정 첫 저장');
  assert.equal(sql(`select s.save->'points'->>'balance' from public.cloud_saves s where s.user_id = '${anonN2}'`), String(lostPoints), 'AC8 이 PC 진행 그대로');
  await until(async () => (await N.indicator()).includes('저장됨'), 'AC8 다시 저장됨');
  await N.stop();
  checks.push(`AC8 세션 파일(${sessionFiles.join('·')}) 삭제 → 분실 창(익명 문구·[이 PC 저장으로 계속][처음부터]), 헤더 저장 꺼짐, 계정 탭 안내, 게임 계속 → 이 PC 저장으로 계속 → 새 익명 첫 저장`);

  // AC1 가입 — 익명 진행을 새 계정으로 옮긴다(포인트 유지). 익명 계정은 서버에서 지운다
  const A = makeApp('a', server, [{ id: 'p1', species: 'bulbasaur', where: 'party' }], env, { ...opts, points: 100 });
  const B = makeApp('b', server, [{ id: 'p1', species: 'squirtle', where: 'party' }], env, { ...opts, points: 5 });
  await A.start(); await B.start();
  const anonA = await anonOf(A, 'AC1 A');
  const anonB = await anonOf(B, 'AC2 B');
  await A.accountTab();
  await until(() => A.has(['익명으로 저장 중', 'GitHub로 계속']), 'AC1 로그인 화면');
  await A.shot(path.join(shots, 'account-sign-in.png'));
  assert.equal(await A.press('가입'), true);
  // 가입 화면 — 설명 문구는 문구 정리(0e8a76f)로 뺐다. 아이디 입력칸이 보이면 가입 화면이다
  await until(() => A.dom(`!!document.getElementById('search-acct-new-user')`), 'AC1 가입 화면');
  await A.fill('search-acct-new-user', 'admin');
  await until(() => A.has(['이미 쓰는 아이디']), 'AC1 예약 아이디는 이미 쓰는 아이디');
  await A.fill('search-acct-new-user', name);
  await until(() => A.has(['사용할 수 있는 아이디']), 'AC1 사용할 수 있는 아이디');
  await A.fill('search-acct-new-name', '지우');
  await A.fill('search-acct-new-pass', pw);
  await A.fill('search-acct-new-pass2', pw);
  await A.shot(path.join(shots, 'account-sign-up.png'));
  assert.equal(await A.press('가입'), true);
  await until(() => A.has(['지우', `아이디 ${name}`]), 'AC1 로그인 뒤 화면');
  await until(() => revOf() >= 1, 'AC1 계정 저장이 생긴다');
  assert.equal(serverPoints(), '100', 'AC1 옮긴 계정 저장의 포인트');
  assert.equal(A.save().points.balance, 100, 'AC1 이 PC 포인트 그대로');
  await until(() => userCount(anonA) === '0', 'AC1 익명 계정을 서버에서 지운다');
  await until(() => A.cloud()?.ownerKind === 'member', 'AC1 저장 주인이 정식 계정');
  await until(async () => (await A.indicator()).includes('저장됨'), 'AC1 헤더 저장 표시');
  await A.shot(path.join(shots, 'account-signed-in.png'));
  checks.push('AC1 가입 — 예약·중복 안내, 익명 진행 옮기기(포인트 100 유지), 익명 계정 삭제, 헤더 저장 표시');

  // AC2 저장 있는 계정으로 로그인 — 계정 저장을 받고 이 PC 진행은 백업. B 의 익명 계정도 지운다.
  //   먼저 켠 A 는 "다른 PC 에서 시작" 뒤 종료한다(로그아웃하지 않는다, D19)
  await B.accountTab();
  await until(() => B.has(['익명으로 저장 중']), 'AC2 B 로그인 화면');
  await B.fill('search-acct-user', name);
  await B.fill('search-acct-pass', 'wrong-password');
  assert.equal(await B.press('로그인'), true);
  await until(() => B.has(['아이디 또는 비밀번호가 맞지 않아요']), 'AC2 틀린 비밀번호');
  await B.fill('search-acct-pass', pw);
  assert.equal(await B.press('로그인'), true);
  await until(() => B.save().points.balance === 100, 'AC2 B 가 계정 저장(100P)을 받는다');
  assert.equal(await B.has(['어느 저장을 쓸까요?']), false, 'AC2 고르기 창이 없다');
  assert.ok(bak(B, 'cloud'), 'AC2 이 PC 저장은 백업');
  await until(() => userCount(anonB) === '0', 'AC2 B 의 익명 계정도 지운다');
  await until(async () => (await B.indicator()).includes('저장됨'), 'AC2 B 헤더 저장 표시');
  await until(() => A.cloud()?.superseded === true, 'AC2 A 는 다른 PC 에서 시작 상태');
  try {
    // A 는 안내 창(네이티브)을 띄운 채 곧 꺼진다 — 꺼지기 전이면 헤더 글자를 찍는다
    if ((await A.indicator()).includes('다른 PC 에서 시작')) await A.shot(path.join(shots, 'account-superseded.png'));
  } catch { /* 이미 꺼졌다 */ }
  assert.ok(A.cloud()?.userId, 'AC2 A 는 로그아웃하지 않는다(D19)');
  assert.equal(A.save().points.balance, 100, 'AC2 A 의 로컬 진행은 그대로');
  await until(() => !fs.existsSync(A.lock), 'AC2 A 는 안내 뒤 종료', 60_000);
  checks.push('AC2 저장 있는 계정 로그인 — 틀린 비밀번호 안내, 계정 저장 받기·백업, 익명 계정 삭제, 먼저 켠 PC 는 로그인 유지한 채 종료');

  // AC3 자동 저장 — 저장이 바뀌면 올라간다
  const before = revOf();
  const played = await B.game('play', 'p1');
  assert.equal(played.ok, true, JSON.stringify(played));
  await until(() => revOf() > before, 'AC3 자동 저장');
  checks.push('AC3 게임 진행이 자동으로 올라간다');

  // AC4 오프라인 — 올리기에 실패하면 오프라인, 다시 연결되면 단추 없이 올라간다
  proxy.setDown(true);
  await B.game('pet.set', 'p1', 'size=2'); // 늘 저장이 바뀌는 명령 — 쿨타임이 없다
  await until(async () => (await B.indicator()).includes('오프라인'), 'AC4 오프라인 표시');
  await B.shot(path.join(shots, 'account-offline.png'));
  // 오프라인이면 로그아웃 확인 창에 경고 줄이 보인다(검수 M3) — 막지는 않는다. 확인 창은 닫는다
  await until(() => B.press('로그아웃'), 'AC4 오프라인 로그아웃 확인 창');
  await until(() => B.has(['로그아웃할까요?', '올리지 못한 진행은 이 PC 백업에만 남아요', '로그아웃하고 새로 시작']), 'AC4 경고 줄');
  assert.equal(await B.dom(`(() => { const b = [...document.querySelectorAll('.acct-confirm button')].find((x) => x.textContent.trim() === '취소'); if (!b) return false; b.click(); return true; })()`), true, 'AC4 확인 창 닫기');
  await B.game('pet.set', 'p1', 'size=3'); // 오프라인 동안의 진행
  const offlineRev = revOf();
  proxy.setDown(false);
  await until(() => revOf() > offlineRev, 'AC4 다시 연결되면 자동으로 올린다', 30_000);
  await until(async () => (await B.indicator()).includes('저장됨'), 'AC4 다시 저장됨');
  assert.equal(await B.press('지금 저장'), false, 'AC4 저장 단추가 없다');
  checks.push('AC4 오프라인 → 로그아웃 확인 창 경고 줄, 다시 연결되면 자동 저장(저장 단추 없음)');

  // AC5 교환 중에는 계정을 바꿀 수 없다
  const link = await B.game('trade.create');
  assert.equal(link.ok, true, JSON.stringify(link));
  await until(() => B.has(['교환 중에는 계정을 바꿀 수 없어요']), 'AC5 막힘 안내');
  assert.equal(await B.press('로그아웃'), false, 'AC5 로그아웃 단추 막힘');
  await B.game('trade.leave');
  checks.push('AC5 교환 중에는 로그아웃·삭제 막힘');

  // AC5-1 업데이트 필요 — 서버 최소 버전을 올리면 게임은 계속, 올리기만 멈춘다(D28, Q6)
  sql(`update cloud_private.settings set value = '99.0.0' where key = 'min_app_version'`);
  try {
    const held = revOf();
    await B.game('pet.set', 'p1', 'size=2');
    await until(async () => (await B.indicator()).includes('업데이트 필요'), 'AC5-1 업데이트 필요 표시', 30_000);
    await B.shot(path.join(shots, 'account-update-required.png'));
    const played2 = await B.game('pet.set', 'p1', 'size=3');
    assert.equal(played2.ok, true, 'AC5-1 게임은 계속');
    await sleep(2500);
    assert.equal(revOf(), held, 'AC5-1 올리지 않는다');
  } finally {
    sql(`update cloud_private.settings set value = '${minVersion}' where key = 'min_app_version'`);
  }
  // 최소 버전을 되돌리면 다시 연결 간격마다 다시 확인해 풀린다 — 멈춘 동안의 진행을 올린다(W5)
  const heldRev = revOf();
  await until(async () => (await B.indicator()).includes('저장됨'), 'AC5-1 되돌리면 다시 확인해 풀린다', 30_000);
  await until(() => revOf() > heldRev, 'AC5-1 풀린 뒤 멈춘 동안의 진행을 올린다', 30_000);
  checks.push('AC5-1 업데이트 필요 — 헤더 표시, 게임 계속, 올리기 멈춤, 최소 버전을 되돌리면 다시 확인해 풀림');

  // AC6 로그아웃 — 확인 창 → 저장 백업 → cloud.json 비움 → 앱이 다시 켜져 선택 창. 계정 저장은 서버에 그대로
  const accountRev = revOf();
  const bootsBefore = boots(B);
  const pickersBefore = pickers(B);
  await until(() => B.press('로그아웃'), 'AC6 로그아웃 누르기');
  await until(() => B.has(['로그아웃할까요?', '로그아웃하면 이 PC 는 처음부터 새로 시작해요. 계정 저장은 그대로라 다시 로그인하면 이어서 할 수 있어요.', '로그아웃하고 새로 시작']), 'AC6 확인 창');
  await B.shot(path.join(shots, 'account-sign-out.png'));
  assert.equal(await B.press('로그아웃하고 새로 시작'), true);
  await until(() => boots(B) > bootsBefore && pickers(B) > pickersBefore, 'AC6 앱이 다시 켜져 선택 창', 60_000);
  assert.ok(bak(B, 'signout'), 'AC6 이 PC 저장은 save.json.signout-*.bak');
  assert.equal(fs.existsSync(path.join(B.data, 'save.json')), false, 'AC6 save.json 없음');
  assert.equal(B.cloud()?.owner ?? null, null, 'AC6 cloud.json 비움(주인 없음)');
  // 로그아웃은 올리지 않은 진행을 먼저 올린다 — rev 는 그대로거나 오른다. 서버 저장은 지우지 않는다
  assert.ok(revOf() >= accountRev, `AC6 계정 저장은 서버에 그대로 (${revOf()} >= ${accountRev})`);
  await B.pickEevee(pickersBefore);
  const anonB2 = await anonOf(B, 'AC6 새 익명');
  assert.notEqual(anonB2, anonB);
  await until(() => B.ui('open').then(() => true, () => false), 'AC6 관리 창');
  await until(async () => { try { return (await B.indicator()).includes('저장됨'); } catch { return false; } }, 'AC6 새 익명 헤더 저장됨');
  checks.push('AC6 로그아웃 — 확인 창 문구, signout 백업, cloud.json 비움, 앱 다시 켜기 → 선택 창 → 새 익명 계정, 계정 저장 그대로');

  // AC6-1 GitHub 로그인을 마친 브라우저가 pokebuddy://account 를 열면 계정 탭이 열린다
  await B.ui('link', { url: 'pokebuddy://account' });
  await until(async () => { try { return await B.has(['익명으로 저장 중', 'GitHub로 계속']); } catch { return false; } }, 'AC6-1 계정 탭이 열린다');
  checks.push('AC6-1 pokebuddy://account — 계정 탭이 열린다');

  // AC7 계정 삭제 — 로컬 함수 서버가 있을 때만. 다시 로그인(계정 저장 받기) → 삭제 확인 → 앱 다시 켜기 → 선택 창
  const probe = await fetch(`${local.url}/functions/v1/delete-account`, { method: 'POST' }).then((r) => r.status, () => 0);
  if (probe === 404 || probe === 0) {
    checks.push('AC7 계정 삭제 — 건너뜀(npx supabase functions serve 없음)');
  } else {
    await B.fill('search-acct-user', name);
    await B.fill('search-acct-pass', pw);
    assert.equal(await B.press('로그인'), true);
    await until(() => B.has(['계정 삭제']), 'AC7 다시 로그인하면 로그인 뒤 화면');
    await until(() => B.save()?.points?.balance === 100, 'AC7 계정 저장을 받는다');
    await until(() => userCount(anonB2) === '0', 'AC7 새 익명 계정도 지운다');
    const bootsDel = boots(B);
    const pickersDel = pickers(B);
    assert.equal(await B.press('계정 삭제'), true);
    await until(() => B.has(['계정을 삭제할까요?', '계정과 저장을 지우고 이 PC 는 처음부터 새로 시작해요. 되돌릴 수 없어요.']), 'AC7 삭제 확인');
    await B.shot(path.join(shots, 'account-delete.png'));
    assert.equal(await B.press('삭제'), true);
    await until(() => boots(B) > bootsDel && pickers(B) > pickersDel, 'AC7 앱이 다시 켜져 선택 창', 60_000);
    await until(() => sql(`select count(*) from auth.users where email = '${email}'`) === '0', 'AC7 서버에서 계정이 지워진다');
    assert.equal(revOf(), -1, 'AC7 클라우드 저장도 지워진다');
    assert.ok(bak(B, 'delete'), 'AC7 이 PC 저장은 save.json.delete-*.bak');
    assert.equal(B.cloud()?.owner ?? null, null, 'AC7 cloud.json 비움');
    await B.pickEevee(pickersDel);
    const anonB3 = await anonOf(B, 'AC7 새 익명');
    assert.ok(anonSaved(anonB3), 'AC7 새 익명 계정 첫 저장 — CLOUD_OWNER_OTHER 없음');
    await until(() => B.ui('open').then(() => true, () => false), 'AC7 관리 창');
    await until(async () => { try { return (await B.indicator()).includes('저장됨'); } catch { return false; } }, 'AC7 새 익명 헤더 저장됨');
    checks.push('AC7 계정 삭제 — 확인 창 문구, 서버 계정·클라우드 저장 삭제, delete 백업, 앱 다시 켜기 → 선택 창 → 새 익명 첫 저장(OWNER_OTHER 없음)');
  }

  // AC9 로컬 저장 암호화(P3, worklog/records/cloud-authority/record.md "P3 로컬 암호화") — 이 사례만 암호화를 켠다
  //   기존 평문 저장은 첫 실행에 백업 뒤 암호화한다. 올리기는 푼 저장을 보낸다.
  //   손으로 고친 평문을 넣으면 받지 않고 격리한다 — 선택 창에서 새로 고른 저장은 서버 저장으로 바뀌고, 서버 저장은 덮이지 않는다
  const K = makeApp('k', server, [{ id: 'k1', species: 'pichu', where: 'party' }], { ...env, POKEBUDDY_SAVE_CRYPT: 'on' }, { ...opts, points: 321 });
  const sealed = () => { try { return fs.readFileSync(path.join(K.data, 'save.json')).subarray(0, 4).toString('latin1') === 'PBS1'; } catch { return false; } };
  const kFiles = (prefix) => fs.readdirSync(K.data).filter((f) => f.startsWith(prefix));
  await K.start();
  await until(sealed, 'AC9 저장을 암호화했다');
  assert.ok(fs.existsSync(path.join(K.data, 'save.key')), 'AC9 save.key');
  assert.equal(kFiles('save.json.plain-').length, 1, 'AC9 평문 백업');
  const anonK = await anonOf(K, 'AC9');
  assert.equal(sql(`select s.save->'points'->>'balance' from public.cloud_saves s where s.user_id = '${anonK}'`), '321', 'AC9 올린 저장은 푼 값');
  const revK = K.cloud().syncedRev;
  await K.stop();
  const { empty } = require(path.join(root, 'dist/save/v3.js'));
  const forged = empty(Date.now());
  forged.points.balance = 99999;
  fs.writeFileSync(path.join(K.data, 'save.json'), JSON.stringify(forged));
  await K.startFresh(); // 격리했으니 저장이 없다 — 선택 창
  await until(() => kFiles('save.json.cloud-').length === 1, 'AC9 새로 고른 저장을 백업하고 서버 저장을 받는다', 30_000);
  await until(sealed, 'AC9 받은 저장도 암호화');
  assert.equal(kFiles('save.json.broken-').length, 1, 'AC9 고친 평문은 격리');
  assert.equal(fs.existsSync(path.join(K.data, 'save.json.lost')), false, 'AC9 격리 표시는 클라우드가 지웠다');
  await sleep(3000);
  assert.equal(sql(`select s.save->'points'->>'balance' from public.cloud_saves s where s.user_id = '${anonK}'`), '321', 'AC9 서버 저장은 덮이지 않았다');
  assert.equal(K.cloud().owner, anonK, 'AC9 같은 익명 계정');
  assert.ok(K.cloud().syncedRev >= revK, 'AC9 맞춘 rev 를 되찾았다');
  checks.push('AC9 암호화 — 평문 저장 백업 뒤 암호화(save.key), 올린 값 321, 고친 평문(99999) 격리 → 선택 창 → 서버 저장 받기, 서버 321 유지');

  // AC9-1 저장 잠김 창 — 키를 쓰지 못하는데 암호화 저장이 있으면 옮기지 않고 묻는다(검수 P3-3, 사용자 결정 "안내 창으로 묻기")
  //   키 파일 자리를 폴더로 바꿔 읽기 오류를 낸다(키체인 거부는 시험에서 만들 수 없다 — 같은 창으로 간다)
  await K.stop();
  const keyPath = path.join(K.data, 'save.key');
  const savePath = path.join(K.data, 'save.json');
  const saveBefore = fs.readFileSync(savePath);
  fs.rmSync(keyPath);
  fs.mkdirSync(keyPath);
  const lockedDialog = async (label) => {
    const seen = K.dialogs().length;
    const run = K.cli(['companion']);
    await until(() => K.dialogs().length > seen, `${label} 저장 잠김 창`, 60_000);
    const d = K.dialogs().at(-1);
    assert.equal(d.title, '저장을 열지 못했어요', `${label} 창 제목`);
    assert.deepEqual(d.buttons, ['종료', '새로 시작'], `${label} 단추`);
    return { run }; // 감싼다 — async 가 CLI 약속을 그대로 돌려주면 끝날 때까지 기다리게 된다
  };
  const quit = await lockedDialog('AC9-1 종료');
  await K.answer('종료');
  await quit.run;
  assert.ok(fs.readFileSync(savePath).equals(saveBefore), 'AC9-1 종료면 저장 그대로');
  assert.equal(kFiles('save.json.unreadable-').length, 0, 'AC9-1 옮기지 않았다');
  const fresh = await lockedDialog('AC9-1 새로 시작');
  const seenPick = K.events().filter((e) => e.event === 'picker-ready').length;
  await K.answer('새로 시작');
  await until(() => kFiles('save.json.unreadable-').length === 1, 'AC9-1 새로 시작이면 저장을 백업한다');
  await K.pickEevee(seenPick);
  await fresh.run;
  await until(() => kFiles('save.json.cloud-').length === 2, 'AC9-1 새로 고른 저장을 백업하고 서버 저장을 받는다', 30_000);
  await until(sealed, 'AC9-1 새 키로 암호화');
  assert.equal(sql(`select s.save->'points'->>'balance' from public.cloud_saves s where s.user_id = '${anonK}'`), '321', 'AC9-1 서버 저장은 덮이지 않았다');
  assert.equal(kFiles('save.key.unreadable-').length, 1, 'AC9-1 옛 키 자리도 옮겼다');
  checks.push('AC9-1 저장 잠김 창 — [종료][새로 시작], 종료면 저장 그대로, 새로 시작이면 키·저장 백업 → 선택 창 → 서버 저장 받기');
  proxy.close();
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
  console.log(`e2e-account: 통과 (${checks.length}개)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
