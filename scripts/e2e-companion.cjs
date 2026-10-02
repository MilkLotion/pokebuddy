// 실제 CLI → Electron 선택창 → 저장·mailbox → 종료·복원 흐름 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// 임시 폴더는 <임시 폴더>/pokebuddy/ 아래에 만들고 끝나면 지운다 (src/tools/tmp-dir.ts) — npm run build 뒤에 실행한다
const { makeTmp } = require(path.join(root, 'dist/tools/tmp-dir.js'));
const dir = makeTmp('companion-e2e');
const temp = path.join(dir, 'tmp');
fs.mkdirSync(temp);
const env = { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, 'appdata'), LOCALAPPDATA: path.join(dir, 'localappdata'), TEMP: temp, TMP: temp };
for (const key of Object.keys(env)) {
  if (key.startsWith('POKEBUDDY_') || key === 'NODE_OPTIONS' || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
}
env.PB_E2E_DIR = dir;
// mock-keychain — 임시 HOME 앱이 사용자 키체인에 닿지 않게 (e2e/mock-keychain.cjs)
env.NODE_OPTIONS = ['e2e/mock-keychain.cjs', 'e2e/companion-observer.cjs'].map((f) => `--require "${path.join(__dirname, f).split(path.sep).join('/')}"`).join(' ');
// 서버가 필요 없는 시험이다 — 온라인 기능을 꺼 운영 서버(data/online.json)에 닿지 않게. 개발 실행만 이 값을 받는다(src/trade/config.ts)
// 닿지 않았는지는 관측기(e2e/companion-observer.cjs)가 적은 fetch 주소로 끝에서 본다
env.POKEBUDDY_ONLINE = 'off';
// 저장을 직접 읽는다 — 평문으로 둔다. 개발 실행만 받는다(src/main/app.ts)
env.POKEBUDDY_SAVE_CRYPT = 'off';
// 세션용 환경이 남아 있어도 첫 선택창을 생략하면 안 됨.
env.POKEBUDDY_SLUG = 'pikachu';
const data = path.join(dir, '.claude', 'pokebuddy');
const saveFile = path.join(data, 'save.json');
const lock = path.join(data, 'companion.lock');
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const events = () => fs.existsSync(path.join(dir, 'events.jsonl')) ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

function cli(args) {
  const child = spawn(process.execPath, [path.join(root, 'bin/pokebuddy'), ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI 시간 초과: ${args.join(' ')}`)); }, 150000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fs.appendFileSync(path.join(dir, 'cli.jsonl'), `${JSON.stringify({ args, code, stdout, stderr })}\n`);
      resolve({ code, stdout, stderr });
    });
  });
  return { child, done };
}
async function until(test, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return;
    await sleep(100);
  }
  throw new Error(`대기 실패: ${label}`);
}
async function game(...args) {
  const value = await gameRaw(...args);
  assert.equal(value.ok, true, JSON.stringify(value));
  return value;
}
// 규칙에 걸리는 명령도 확인한다 — 실패 이유가 CLI 까지 그대로 와야 한다
async function gameRaw(...args) {
  const result = await cli(['game', ...args]).done;
  return JSON.parse(result.stdout);
}
async function run() {
  console.log(`E2E 임시 데이터: ${dir}`);
  try {
    const first = cli(['companion']);
    await until(() => events().some((e) => e.event === 'picker-ready'), '포켓몬 인자 없는 첫 선택창');
    assert.equal(events().find((e) => e.event === 'boot').slugEnv, null);
    assert.equal(events().find((e) => e.event === 'picker-ready').count, 29);
    checks.push('포켓몬 인자 없이 첫 선택창. 세션 환경변수로 선택 생략 없음');
    fs.writeFileSync(path.join(dir, 'action.json'), JSON.stringify({ kind: 'pick-eevee' }));
    const firstResult = await first.done;
    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.match(firstResult.stdout, /동반자를 띄움/);
    const saved = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    assert.equal(saved.v, 3, '저장은 v3 으로 쓴다');
    assert.equal(saved.pets.length, 1);
    assert.equal(saved.pets[0].species, 'eevee');
    assert.equal(saved.starterPetId, saved.pets[0].id, '첫 개체를 기억한다');
    assert.equal(saved.party.slots[0].petId, saved.pets[0].id, '첫 파티 칸에 꺼내 놓는다');
    const id = saved.pets[0].id;
    checks.push('선택창에서 이브이 선택 후 실제 앱 준비와 저장');
    const beforeLock = fs.readFileSync(lock, 'utf8');
    const duplicate = await cli(['companion']).done;
    assert.match(duplicate.stdout, /이미 떠 있음/);
    assert.equal(fs.readFileSync(lock, 'utf8'), beforeLock);
    await game('snapshot');
    checks.push('중복 실행은 기존 프로세스와 저장 유지. 실제 mailbox 조회');
    const sizeResult = await cli(['game', 'pet.set', id, 'size=3']).done;
    assert.equal(JSON.parse(sizeResult.stdout).reason, 'ok', sizeResult.stdout);
    assert.equal(JSON.parse(fs.readFileSync(saveFile, 'utf8')).pets[0].size, 2, '3단계는 배율 2 로 저장한다 (src/save/rules.ts SIZE_STEPS)');
    const badSize = await cli(['game', 'pet.set', id, 'size=9']).done;
    assert.equal(JSON.parse(badSize.stdout).reason, 'bad-value');
    assert.equal(JSON.parse(fs.readFileSync(saveFile, 'utf8')).pets[0].size, 2);
    checks.push('크기 변경 명령은 1~5 단계를 배율로 저장하고 범위 밖은 거부');
    await game('pet.set', id, JSON.stringify({ home: { dx: -40, dy: -70 } }));
    await game('party.hide', id);
    assert.equal(JSON.parse(fs.readFileSync(saveFile, 'utf8')).party.slots[0].hidden, true);
    await game('party.show', id);
    // 새 개체는 만복도가 가득 차 있어 밥을 받지 않는다. 규칙 실패가 CLI 까지 온다
    assert.equal((await gameRaw('feed', id)).reason, 'full');
    await game('play', id);
    assert.equal((await gameRaw('play', id)).reason, 'cooldown', '쿨타임도 그대로 전달');
    checks.push('위치·숨기기·다시 표시·돌봄과 규칙 실패를 CLI에서 앱으로 전달');
    const stopped = await cli(['companion', 'stop']).done;
    assert.equal(stopped.code, 0, stopped.stderr);
    await until(() => !fs.existsSync(lock), '종료 잠금 해제');
    const selectedCount = events().filter((e) => e.event === 'picker-ready').length;
    const restored = await cli(['companion']).done;
    assert.equal(restored.code, 0, restored.stderr);
    assert.equal(events().filter((e) => e.event === 'picker-ready').length, selectedCount);
    const restoredSave = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    assert.equal(restoredSave.pets[0].id, id);
    assert.equal(restoredSave.pets[0].size, 2, '바꾼 크기를 재실행 뒤에도 유지');
    assert.deepEqual(restoredSave.pets[0].home, { dx: -40, dy: -70 });
    assert.equal(restoredSave.party.slots[0].hidden, false);
    checks.push('종료 후 재실행에서 선택창 없이 같은 파티·크기 복원');
    await cli(['companion', 'stop']).done;
    await until(() => !fs.existsSync(lock), '복원 검사 후 종료');
    const emptySave = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    emptySave.pets = [];
    emptySave.starterPetId = null;
    emptySave.party.slots = emptySave.party.slots.map((slot) => (slot.state === 'pokemon' ? { state: 'empty' } : slot));
    fs.writeFileSync(saveFile, JSON.stringify(emptySave));
    const cancelled = cli(['companion']);
    await until(() => events().filter((e) => e.event === 'picker-ready').length === selectedCount + 1, '빈 파티의 선택창');
    fs.writeFileSync(path.join(dir, 'action.json'), JSON.stringify({ kind: 'cancel' }));
    const cancelResult = await cancelled.done;
    assert.equal(cancelResult.code, 0, cancelResult.stderr);
    assert.match(cancelResult.stdout, /첫 실행/);
    assert.doesNotMatch(cancelResult.stderr, /뜨지 못함/);
    assert.deepEqual(JSON.parse(fs.readFileSync(saveFile, 'utf8')), emptySave);
    const status = await cli(['status']).done;
    assert.doesNotMatch(status.stdout, /마지막 펫 실패/);
    checks.push('기존 저장의 빈 파티도 선택창 제공. 선택 취소는 정상 종료하며 저장 유지');
    const pending = cli(['companion']);
    await until(() => events().filter((e) => e.event === 'picker-ready').length === selectedCount + 2, '종료 검사 선택창');
    const stoppedPicker = await cli(['companion', 'stop']).done;
    assert.equal(stoppedPicker.code, 0, stoppedPicker.stderr);
    const pendingResult = await pending.done;
    assert.equal(pendingResult.code, 0, pendingResult.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(saveFile, 'utf8')), emptySave);
    checks.push('선택 중 companion stop은 정상 종료하며 저장 유지');
    const unsaved = cli(['companion']);
    await until(() => events().filter((e) => e.event === 'picker-ready').length === selectedCount + 3, '저장 실패 검사 선택창');
    // 이 검사가 만든 저장 경로를 빈 디렉터리로 바꿔 쓰기 실패 재현.
    fs.renameSync(saveFile, `${saveFile}.e2e-backup`);
    fs.mkdirSync(saveFile);
    try {
      fs.writeFileSync(path.join(dir, 'action.json'), JSON.stringify({ kind: 'pick-eevee' }));
      const unsavedResult = await unsaved.done;
      assert.equal(unsavedResult.code, 1, unsavedResult.stdout);
      assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'last-error.json'), 'utf8')).reason, 'save-failed');
      assert.doesNotMatch(unsavedResult.stdout, /동반자를 띄움/);
      checks.push('첫 포켓몬 저장 실패는 취소와 구분하며 실행 성공을 알리지 않음');
    } finally {
      fs.rmdirSync(saveFile);
      fs.renameSync(`${saveFile}.e2e-backup`, saveFile);
    }
    assert.equal(events().filter((e) => ['preload-error', 'observer-error'].includes(e.event)).length, 0);
    const hosts = [...new Set(events().filter((e) => e.event === 'fetch').map((e) => e.host))];
    assert.deepEqual(hosts.filter((h) => !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)), [], `외부 서버 요청: ${hosts.join(', ')}`);
    checks.push('온라인 기능을 꺼 외부 서버(운영 Supabase)에 요청하지 않음');
  } finally {
    await cli(['companion', 'stop']).done;
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ checks, dir }, null, 2));
  }
  console.log(JSON.stringify({ result: 'PASS', checks, dir }, null, 2));
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
