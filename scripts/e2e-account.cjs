// 계정·클라우드 저장 E2E — 실제 앱(동반자) 두 개를 임시 HOME 으로 띄우고 로컬 Supabase 에서 설정의 계정 탭을 눌러 본다.
// 설계: worklog/records/trade/record.md "로그인·클라우드 저장 구현 계획" L6
//   준비: Docker Desktop 과 `npx supabase start`. 계정 삭제까지 보려면 `npx supabase functions serve` 도 띄운다. 빌드: `npm run build`
//   실행: node scripts/e2e-account.cjs   (DB 를 비우고 시작한다 — 로컬 DB 에만 쓴다)
//   앱은 로컬 서버를 직접 보지 않고 이 스크립트의 TCP 중계를 거친다 — 중계를 끊어 오프라인을 재현한다
//   GitHub 로그인은 실제 GitHub 가 필요해 여기서 보지 않는다(selftest-github 와 사용자 실기)
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
  const shots = path.join(root, 'worklog/records/trade/evidence');
  fs.mkdirSync(shots, { recursive: true });
  const env = { POKEBUDDY_CLOUD_UPLOAD_MS: '1000', POKEBUDDY_CLOUD_RETRY_MS: '1500' };
  const name = `e2e${Date.now().toString(36)}`;
  const pw = 'correct-horse-8';
  const revOf = () => Number(sql(`select coalesce((select s.rev from public.cloud_saves s join auth.users u on u.id = s.user_id where u.email = '${name}@id.pokebuddy.invalid'), -1)`));

  const has = async (X, words) => { const t = await X.text(); return words.every((w) => t.includes(w)); };
  const opened = (X) => until(async () => { try { return await X.dom('!!document.querySelector("nav .tabs button")'); } catch { return false; } }, `[${X.name}] 관리 창`);
  const fill = (X, id, value) => X.dom(`(() => { const i = document.getElementById(${JSON.stringify(id)}); if (!i) return false; i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')); return true; })()`);
  const indicator = (X) => X.dom(`(() => { const e = document.getElementById('save-indicator'); return e && !e.hidden ? e.textContent : ''; })()`);
  const accountTab = async (X) => {
    await X.ui('open');
    await opened(X);
    await X.dom(`document.getElementById('open-settings').click()`);
    await until(() => X.press('계정'), `[${X.name}] 계정 탭`);
  };

  const A = makeApp('a', server, [{ id: 'p1', species: 'bulbasaur', where: 'party' }], env, { prefix: 'pokebuddy-account-e2e', points: 100 });
  const B = makeApp('b', server, [{ id: 'p1', species: 'squirtle', where: 'party' }], env, { prefix: 'pokebuddy-account-e2e', points: 5 });
  await A.start(); await B.start();

  // AC1 가입 — 중복검사, 가입하면 바로 로그인, 첫 저장
  await accountTab(A);
  await until(() => has(A, ['로그인하지 않아도 교환할 수 있어요', 'GitHub로 계속']), 'AC1 로그인 화면');
  await A.shot(path.join(shots, 'account-sign-in.png'));
  assert.equal(await A.press('가입'), true);
  // 가입 화면 — 설명 문구는 문구 정리(0e8a76f)로 뺐다. 아이디 입력칸이 보이면 가입 화면이다
  await until(() => A.dom(`!!document.getElementById('search-acct-new-user')`), 'AC1 가입 화면');
  await fill(A, 'search-acct-new-user', 'admin');
  await until(() => has(A, ['이미 쓰는 아이디']), 'AC1 예약 아이디는 이미 쓰는 아이디');
  await fill(A, 'search-acct-new-user', name);
  await until(() => has(A, ['사용할 수 있는 아이디']), 'AC1 사용할 수 있는 아이디');
  await fill(A, 'search-acct-new-name', '지우');
  await fill(A, 'search-acct-new-pass', pw);
  await fill(A, 'search-acct-new-pass2', pw);
  await A.shot(path.join(shots, 'account-sign-up.png'));
  assert.equal(await A.press('가입'), true);
  await until(() => has(A, ['지우', `아이디 ${name}`]), 'AC1 로그인 뒤 화면');
  await until(() => revOf() >= 1, 'AC1 첫 저장이 올라간다');
  await until(async () => (await indicator(A)).includes('저장됨'), 'AC1 헤더 저장 표시');
  await A.shot(path.join(shots, 'account-signed-in.png'));
  checks.push('AC1 가입 — 예약·중복 안내, 바로 로그인, 첫 저장, 헤더 저장 표시');

  // AC2 다른 PC 로그인 — 서버 저장이 있어 고른다. 먼저 켠 A 는 밀려난다
  await accountTab(B);
  await until(() => has(B, ['로그인하지 않아도 교환할 수 있어요']), 'AC2 B 로그인 화면');
  await fill(B, 'search-acct-user', name);
  await fill(B, 'search-acct-pass', 'wrong-password');
  assert.equal(await B.press('로그인'), true);
  await until(() => has(B, ['아이디 또는 비밀번호가 맞지 않아요']), 'AC2 틀린 비밀번호');
  await fill(B, 'search-acct-pass', pw);
  assert.equal(await B.press('로그인'), true);
  await until(() => has(B, ['어느 저장을 쓸까요?', '계정 저장', '이 PC 저장']), 'AC2 고르기 창');
  await B.shot(path.join(shots, 'account-choose.png'));
  assert.equal(await B.press('이 저장으로 계속'), true);
  await until(() => B.save().points.balance === 100, 'AC2 B 가 계정 저장(100P)을 받는다');
  assert.ok(fs.readdirSync(B.data).some((f) => f.startsWith('save.json.cloud-') && f.endsWith('.bak')), 'AC2 이 PC 저장은 백업');
  await until(() => has(A, ['다른 PC에서 로그인해 로그아웃됐어요']), 'AC2 A 에 밀려남 배너');
  await A.dom(`document.querySelector('#dialog .dialog-close')?.click()`); // 설정 모달을 닫아 배너가 보이게
  await A.shot(path.join(shots, 'account-kicked.png'));
  assert.equal(A.save().points.balance, 100, 'AC2 A 의 로컬 진행은 그대로');
  checks.push('AC2 다른 PC 로그인 — 틀린 비밀번호 안내, 고르기, 백업, 먼저 켠 PC 밀려남 배너');

  // AC3 자동 저장 — 저장이 바뀌면 올라간다
  const before = revOf();
  const played = await B.game('play', 'p1');
  assert.equal(played.ok, true, JSON.stringify(played));
  await until(() => revOf() > before, 'AC3 자동 저장');
  checks.push('AC3 게임 진행이 자동으로 올라간다');

  // AC4 오프라인 — 올리기에 실패하면 오프라인, 다시 연결되면 저장 필요, 저장 단추로 올린다
  proxy.setDown(true);
  await B.game('pet.set', 'p1', 'size=2'); // 늘 저장이 바뀌는 명령 — 쿨타임이 없다
  await until(async () => (await indicator(B)).includes('오프라인'), 'AC4 오프라인 표시');
  await B.game('pet.set', 'p1', 'size=3'); // 오프라인 동안의 진행
  const offlineRev = revOf();
  proxy.setDown(false);
  await until(async () => (await indicator(B)).includes('저장 필요'), 'AC4 다시 연결되면 저장 필요', 30_000);
  await B.shot(path.join(shots, 'account-save-needed.png'));
  await sleep(2500);
  assert.equal(revOf(), offlineRev, 'AC4 저장 필요 동안 자동으로 올리지 않는다');
  assert.equal(await B.press('저장'), true);
  await until(() => revOf() > offlineRev, 'AC4 저장 단추로 올린다');
  await until(async () => (await indicator(B)).includes('저장됨'), 'AC4 다시 저장됨');
  checks.push('AC4 오프라인 → 저장 필요(자동 저장 멈춤) → 저장 단추');

  // AC5 교환 중에는 계정을 바꿀 수 없다
  const link = await B.game('trade.create');
  assert.equal(link.ok, true, JSON.stringify(link));
  await until(() => has(B, ['교환 중에는 계정을 바꿀 수 없어요']), 'AC5 막힘 안내');
  assert.equal(await B.press('로그아웃'), false, 'AC5 로그아웃 단추 막힘');
  await B.game('trade.leave');
  checks.push('AC5 교환 중에는 로그아웃·삭제 막힘');

  // AC6 로그아웃 — 이 PC 만. 저장 표시가 사라진다
  await until(() => B.press('로그아웃'), 'AC6 로그아웃 누르기');
  await until(() => has(B, ['로그인하지 않아도 교환할 수 있어요']), 'AC6 로그인 화면으로');
  assert.equal(await indicator(B), '', 'AC6 저장 표시 없음');
  checks.push('AC6 로그아웃 — 로그인 화면, 저장 표시 사라짐');

  // AC6-1 GitHub 로그인을 마친 브라우저가 pokebuddy://account 를 열면 설정의 계정 탭이 열린다
  await B.dom(`document.querySelector('#dialog .dialog-close')?.click()`);
  await until(async () => !(await B.dom('document.getElementById("scrim").classList.contains("open")')), 'AC6-1 설정 닫힘');
  await B.ui('link', { url: 'pokebuddy://account' });
  await until(() => has(B, ['로그인하지 않아도 교환할 수 있어요', 'GitHub로 계속']), 'AC6-1 계정 탭이 열린다');
  checks.push('AC6-1 pokebuddy://account — 설정의 계정 탭이 열린다');

  // AC7 계정 삭제 — 로컬 함수 서버가 있을 때만
  const probe = await fetch(`${local.url}/functions/v1/delete-account`, { method: 'POST' }).then((r) => r.status, () => 0);
  if (probe === 404 || probe === 0) {
    checks.push('AC7 계정 삭제 — 건너뜀(npx supabase functions serve 없음)');
    return;
  }
  await fill(B, 'search-acct-user', name);
  await fill(B, 'search-acct-pass', pw);
  assert.equal(await B.press('로그인'), true);
  await until(() => has(B, ['어느 저장을 쓸까요?']), 'AC7 다시 로그인하면 고른다');
  assert.equal(await B.press('이 저장으로 계속'), true);
  await until(() => has(B, ['계정 삭제']), 'AC7 로그인 뒤 화면');
  assert.equal(await B.press('계정 삭제'), true);
  await until(() => has(B, ['계정을 삭제할까요?']), 'AC7 삭제 확인');
  await B.shot(path.join(shots, 'account-delete.png'));
  assert.equal(await B.press('삭제'), true);
  await until(() => has(B, ['로그인하지 않아도 교환할 수 있어요']), 'AC7 삭제 뒤 로그인 화면');
  await until(() => sql(`select count(*) from auth.users where email = '${name}@id.pokebuddy.invalid'`) === '0', 'AC7 서버에서 계정이 지워진다');
  assert.equal(revOf(), -1, 'AC7 클라우드 저장도 지워진다');
  checks.push('AC7 계정 삭제 — 확인 창, 서버 계정·클라우드 저장 삭제');
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
