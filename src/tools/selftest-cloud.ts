// 클라우드 저장 확인 — 로컬 Supabase 에서 두 PC(같은 계정)의 활성 기기·자동 저장·밀려남·오프라인·로그인 때 선택
//   npx supabase start 뒤: npm run build && node dist/tools/selftest-cloud.js
//   로컬 서버가 없으면 건너뛴다(종료 코드 0). 주소가 127.0.0.1·localhost 가 아니면 멈춘다
// 설계는 worklog/records/trade/record.md "클라우드 저장", "로그인·클라우드 저장 구현 계획"
import assert from "node:assert";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { memoryStorage } from "../online/client";
import { createAccount } from "../online/account";
import { createCloud, summaryOf, type Cloud, type CloudSyncState, type CloudView } from "../online/cloud";

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(test: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`대기 실패: ${label}`);
}

// 한 PC — 오프라인을 흉내 내는 클라이언트, 메모리 저장, cloud.json
function pc(url: string, key: string, points: number) {
  let offline = false;
  const client: SupabaseClient = createClient(url, key, {
    auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => (offline ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init)) },
  });
  let save: Record<string, unknown> = { v: 3, savedAt: Date.now(), pets: [{ id: "p1" }], points: { balance: points } };
  let stored: CloudSyncState | null = null;
  const backups: Record<string, unknown>[] = [];
  const views: CloudView[] = [];
  let kicked = 0;
  const make = (): Cloud => createCloud({
    client,
    io: {
      loadState: () => (stored ? { ...stored } : null),
      saveState: (s) => { stored = { ...s }; },
      readSave: () => structuredClone(save),
      replaceSave: (next) => { backups.push(structuredClone(save)); save = structuredClone(next); return true; },
      backupServer: (s) => void backups.push(structuredClone(s)),
    },
    appVersion: "0.4.0-test",
    deviceLabel: "시험 PC",
    onView: (v) => void views.push(v),
    onKicked: () => { kicked += 1; },
    uploadDelayMs: 200,
    retryMs: 300,
  });
  return {
    client, account: createAccount({ client, blocked: () => false }), make,
    setOffline: (v: boolean) => { offline = v; },
    points: () => (save.points as { balance: number }).balance,
    bump: (n: number) => { save = { ...save, points: { balance: n } }; },
    backups, views, kicked: () => kicked, state: () => stored,
  };
}

async function main(): Promise<void> {
  assert.deepEqual(summaryOf({ pets: [1, 2], points: { balance: 7 }, savedAt: 5 }), { pets: 2, points: 7, savedAt: 5 });
  const cfg = local();
  if (!cfg) {
    process.stdout.write("selftest-cloud: 로컬 Supabase 가 없어 건너뜀\n");
    return;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");

  const name = `c${randomBytes(5).toString("hex")}`;
  const pw = "correct-horse-8";
  const A = pc(cfg.url, cfg.key, 100);
  const B = pc(cfg.url, cfg.key, 5);

  // (1) A 가입 — 서버 저장이 없으면 이 PC 저장을 첫 저장으로 올린다
  const up = await A.account.signUp(name, "지우", pw);
  assert.ok(up.ok, JSON.stringify(up));
  const uid = (await A.account.userId())!;
  const cloudA = A.make();
  await cloudA.start(uid);
  assert.equal(cloudA.view().status, "online");
  assert.equal(A.state()?.syncedRev, 1, "첫 저장 rev 1");
  assert.equal(A.state()?.userId, uid);
  process.stdout.write("(1) 첫 로그인 — 서버 저장이 없으면 이 PC 저장을 올린다  ok\n");

  // (2) 바뀌면 잠시 뒤 자동으로 올린다
  A.bump(120);
  cloudA.noteSaved();
  assert.equal(cloudA.unsaved(), "dirty");
  await until(() => A.state()?.syncedRev === 2, "자동 저장");
  assert.equal(cloudA.unsaved(), "none");
  process.stdout.write("(2) 저장이 바뀌면 자동으로 올린다  ok\n");

  // (3) B 가 같은 계정으로 로그인 — 서버 저장이 있어 고른다. A 는 밀려난다
  assert.ok((await B.account.signIn(name, pw)).ok);
  const cloudB = B.make();
  await cloudB.start(uid);
  assert.equal(cloudB.view().status, "choose");
  assert.deepEqual({ pets: cloudB.view().choice?.server.pets, points: cloudB.view().choice?.server.points }, { pets: 1, points: 120 });
  assert.equal(cloudB.view().choice?.local?.points, 5, "이 PC 저장 요약");
  await until(() => A.kicked() === 1, "A 가 kicked 신호를 받는다");
  assert.equal(cloudA.view().status, "off", "밀려난 A 는 멈춘다");
  assert.equal(A.state()?.userId, null, "밀려난 A 는 계정과의 연결을 끊는다");
  assert.equal(await cloudA.saveNow(), false, "밀려난 A 는 올리지 않는다");
  process.stdout.write("(3) 다른 PC 로그인 — 고르기 대화, 먼저 켠 PC 는 밀려난다  ok\n");

  // (4) B 가 서버 저장을 고른다 — 로컬 저장을 백업하고 바꾼다
  assert.equal(await cloudB.choose("server"), true);
  assert.equal(B.points(), 120, "서버 저장을 받았다");
  assert.equal((B.backups[0]?.points as { balance: number }).balance, 5, "이 PC 저장은 백업");
  assert.equal(cloudB.view().status, "online");
  assert.equal(B.state()?.syncedRev, 2);
  process.stdout.write("(4) 서버 저장 고르기 — 받고 이 PC 저장은 백업  ok\n");

  // (5) 오프라인 — 올리기에 실패하면 오프라인, 그동안의 진행은 저장 필요, 저장 버튼으로 올린다
  B.setOffline(true);
  B.bump(130);
  cloudB.noteSaved();
  await until(() => cloudB.view().status === "offline", "오프라인으로");
  B.bump(140);
  cloudB.noteSaved();
  assert.equal(B.state()?.offlineDirty, true, "오프라인 진행");
  B.setOffline(false);
  await until(() => cloudB.view().status === "save-needed", "다시 연결되면 저장 필요");
  await sleep(500);
  assert.equal(B.state()?.syncedRev, 2, "저장 필요 동안 자동으로 올리지 않는다");
  assert.equal(await cloudB.saveNow(), true, "저장 버튼");
  assert.equal(cloudB.view().status, "online");
  assert.equal(B.state()?.syncedRev, 3);
  process.stdout.write("(5) 오프라인 → 저장 필요 → 저장 버튼  ok\n");

  // (6) 다시 켜기 — 같은 계정이면 고르지 않는다
  cloudB.stop();
  const cloudB2 = B.make();
  await cloudB2.start(uid);
  assert.equal(cloudB2.view().status, "online", "다시 켜면 바로 온라인");
  process.stdout.write("(6) 다시 켜기 — 선택 없이 이어 간다  ok\n");

  // (7) A 가 다시 로그인해 이 PC 저장을 고른다 — 서버 저장은 백업으로, 이 PC 저장을 올린다. B 가 밀려난다
  const cloudA2 = A.make();
  await cloudA2.start(uid);
  assert.equal(cloudA2.view().status, "choose", "밀려났던 PC 는 다시 로그인하면 고른다");
  assert.equal(await cloudA2.choose("local"), true);
  assert.equal((A.backups.at(-1)?.points as { balance: number }).balance, 140, "서버 저장은 백업");
  assert.equal(A.state()?.syncedRev, 4);
  await until(() => B.kicked() === 1, "B 가 밀려난다");
  process.stdout.write("(7) 이 PC 저장 고르기 — 서버 저장 백업 뒤 올리기, 앞 PC 밀려남  ok\n");

  // (8) 겹친 올리기 — 저장 버튼·끄기 전 올리기·자동 저장이 겹쳐도 로컬 저장을 옛 사본으로 바꾸지 않는다(검수 R3-03)
  const backupsBefore = A.backups.length;
  const revBefore = A.state()!.syncedRev;
  A.bump(150);
  cloudA2.noteSaved();
  const results = await Promise.all([cloudA2.saveNow(), cloudA2.flush(), cloudA2.saveNow()]);
  assert.ok(results[0], "첫 올리기 성공");
  await sleep(700); // 자동 저장 타이머가 돌 시간
  assert.equal(A.backups.length, backupsBefore, "로컬 저장을 바꾸지 않았다");
  assert.equal(A.points(), 150);
  assert.ok(A.state()!.syncedRev > revBefore && cloudA2.view().status === "online", JSON.stringify(cloudA2.view()));
  process.stdout.write("(8) 겹친 올리기 — 한 번에 하나, 로컬 저장 그대로  ok\n");

  // (9) 켤 때 연결하는 동안의 저장은 오프라인 진행이 아니다(검수 R3-01)
  cloudA2.stop();
  const cloudA3 = A.make();
  const starting = cloudA3.start(uid);
  cloudA3.noteSaved(); // 연결 중
  await starting;
  assert.equal(cloudA3.view().status, "online", "저장 필요로 빠지지 않는다");
  process.stdout.write("(9) 연결 중의 저장은 저장 필요로 만들지 않는다  ok\n");

  // (10) 다시 연결은 넘겨받지 않는다 — 끊긴 사이 다른 PC 가 활성이 되면 이 PC 가 물러난다(검수 R3-02)
  A.setOffline(true);
  A.bump(160);
  cloudA3.noteSaved();
  await until(() => cloudA3.view().status === "offline", "A 오프라인");
  A.client.realtime.disconnect(); // 끊긴 동안 온 밀려남 신호를 놓친다 — 실제 네트워크 끊김과 같게
  const kickedBefore = B.kicked();
  const cloudB3 = B.make();
  await cloudB3.start(uid); // B 는 로그인 상태(이전에 밀려나 계정 연결이 끊겼다) → 고르기
  if (cloudB3.view().status === "choose") await cloudB3.choose("server");
  A.setOffline(false);
  await until(() => A.kicked() === 2, "다시 연결한 A 가 물러난다", 15_000);
  await sleep(500);
  assert.equal(B.kicked(), kickedBefore, "B 는 밀려나지 않는다");
  assert.equal(cloudB3.view().status, "online");
  cloudB3.stop(true);
  process.stdout.write("(10) 다시 연결은 넘겨받지 않는다 — 옮겨 간 PC 를 밀어내지 않는다  ok\n");

  process.stdout.write("selftest-cloud: 통과 (첫 저장·자동 저장·고르기·밀려남·오프라인·저장 필요·다시 켜기)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
