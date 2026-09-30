// 클라우드 저장 확인 — 로컬 Supabase 에서 두 PC(같은 계정)의 두 PC 규칙 상태기계를 본다
//   npx supabase start 뒤: npm run build && node dist/tools/selftest-cloud.js
//   로컬 서버가 없으면 건너뛴다(종료 코드 0). 주소가 127.0.0.1·localhost 가 아니면 멈춘다
//   last_seen 조작·교환 채널 넣기는 서비스 키로 한다(로컬 전용)
// 설계는 worklog-mac/records/cloud-authority/design-p1.md 2절(전이표), 7절(시험 1~14), 11절(서버 계약)
//   13번(동시 ensure 익명 하나)은 selftest-session 이 본다
import assert from "node:assert";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { memoryStorage } from "../online/client";
import { createAccount } from "../online/account";
import { createSessionGate } from "../online/session";
import { createCloud, readCloudState, type Cloud, type CloudSyncState, type HaltInfo, type HaltReason } from "../online/cloud";

const APP_VERSION = "0.13.0"; // 서버 최소 버전(cloud_private.settings) 이상

function local(): { url: string; key: string; service: string | null } | null {
  if (process.env.POKEBUDDY_SUPABASE_URL && process.env.POKEBUDDY_SUPABASE_KEY) {
    return { url: process.env.POKEBUDDY_SUPABASE_URL, key: process.env.POKEBUDDY_SUPABASE_KEY, service: process.env.POKEBUDDY_SUPABASE_SERVICE_KEY ?? null };
  }
  try {
    const raw = execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).toString();
    const j = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
    const url = j.API_URL, key = j.PUBLISHABLE_KEY ?? j.ANON_KEY;
    return url && key ? { url, key, service: j.SERVICE_ROLE_KEY ?? j.SECRET_KEY ?? null } : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(test: () => boolean | Promise<boolean>, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(50);
  }
  throw new Error(`대기 실패: ${label}`);
}

// 망 흉내 — up: 그대로. down: 모든 요청 실패. drop-upload: 올리기 한 번은 서버에 닿지만 응답을 잃는다(그 뒤 down)
//   fail-download: 받기 한 번만 실패한다(그 뒤 up)
type Net = "up" | "down" | "drop-upload" | "fail-download";

// 한 PC — 흉내 망 클라이언트, 메모리 저장, cloud.json
function pc(url: string, key: string, label: string, points: number) {
  let net: Net = "up";
  // claim_device 붙잡기 — before: 서버에 보내기 전에, after: 서버가 처리한 뒤 응답을 돌려주기 전에 기다린다
  let claimHold: { at: "before" | "after"; gate: Promise<void> } | null = null;
  const uploads: { op: string; rev: number | null }[] = []; // upload_save 요청의 멱등 키와 받은 rev(응답을 잃으면 null)
  const client: SupabaseClient = createClient(url, key, {
    auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        if (net === "down") throw new TypeError("fetch failed");
        const target = String(input instanceof Request ? input.url : input);
        if (net === "fail-download" && target.includes("/rpc/download_save")) {
          net = "up";
          throw new TypeError("fetch failed");
        }
        if (claimHold && target.includes("/rpc/claim_device")) {
          const hold = claimHold;
          claimHold = null;
          if (hold.at === "before") await hold.gate;
          const res = await fetch(input, init);
          if (hold.at === "after") await hold.gate;
          return res;
        }
        const isUpload = target.includes("/rpc/upload_save");
        if (!isUpload) return fetch(input, init);
        const op = (JSON.parse(String(init?.body ?? "{}")) as { p_op?: string }).p_op ?? "";
        const res = await fetch(input, init);
        if (net === "drop-upload") {
          uploads.push({ op, rev: null });
          net = "down";
          throw new TypeError("fetch failed");
        }
        const body = await res.clone().json().catch(() => null) as unknown;
        uploads.push({ op, rev: typeof body === "number" ? body : null });
        return res;
      },
    },
  });
  let save: Record<string, unknown> = { v: 3, savedAt: Date.now(), pets: [{ id: "p1" }], points: { balance: points } };
  let stored: CloudSyncState | null = null;
  const backups: Record<string, unknown>[] = [];
  const halts: { reason: HaltReason; info: HaltInfo }[] = [];
  const clouds: Cloud[] = [];
  const make = (appVersion = APP_VERSION): Cloud => {
    const c = createCloud({
      client,
      io: {
        loadState: () => (stored ? { ...stored } : null),
        saveState: (s) => { stored = { ...s }; },
        readSave: () => structuredClone(save),
        replaceSave: (next) => { backups.push(structuredClone(save)); save = structuredClone(next); return true; },
      },
      appVersion,
      deviceLabel: label,
      onView: () => undefined,
      onHalt: (reason, info) => void halts.push({ reason, info }),
      heartbeatMs: 500,
      throttleMs: 1_500,
      eventDelayMs: 150,
      retryMs: 300,
    });
    clouds.push(c);
    return c;
  };
  return {
    client, make, uploads, backups, halts, clouds,
    account: createAccount({ client, gate: createSessionGate(client), blocked: () => false }),
    setNet: (v: Net) => { net = v; },
    // 다음 claim_device 를 붙잡는다. 돌려준 함수로 놓는다
    holdClaim: (at: "before" | "after"): (() => void) => {
      let open = (): void => undefined;
      claimHold = { at, gate: new Promise<void>((r) => { open = r; }) };
      return () => open();
    },
    points: () => (save.points as { balance: number }).balance,
    bump: (n: number) => { save = { ...save, points: { balance: n } }; },
    state: () => stored,
    lastHalt: () => halts.at(-1),
  };
}

async function main(): Promise<void> {
  // 옛 cloud.json — owner 는 올리던 계정, 새 칸은 기본값
  assert.deepEqual(readCloudState({ deviceId: "d", userId: "u", syncedRev: 3, dirty: true, offlineDirty: true, lastSavedAt: 7 }), {
    deviceId: "d", userId: "u", owner: "u", syncedRev: 3, dirty: true, lastSavedAt: 7, superseded: false, pendingOp: null,
  });
  assert.equal(readCloudState({ deviceId: "d", userId: null, syncedRev: 0, dirty: false, offlineDirty: false, lastSavedAt: null })?.owner, null);
  assert.equal(readCloudState({ deviceId: 1 }), null);

  const cfg = local();
  if (!cfg) {
    process.stdout.write("selftest-cloud: 로컬 Supabase 가 없어 건너뜀\n");
    return;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");
  if (!cfg.service) throw new Error("서비스 키가 없다 — npx supabase status 를 확인");
  const admin = createClient(cfg.url, cfg.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const row = async (userId: string): Promise<{ rev: number; save: { points?: { balance: number } } | null; active_device: string | null; presence: string; last_seen: string | null }> => {
    const { data, error } = await admin.from("cloud_saves").select("rev, save, active_device, presence, last_seen").eq("user_id", userId).single();
    if (error) throw new Error(error.message);
    return { ...data, rev: Number(data.rev) } as never;
  };
  // 연결 끊긴 PC 흉내 — 활성인데 150초 넘게 소식 없음
  const age = async (userId: string): Promise<void> => {
    const { error } = await admin.from("cloud_saves").update({ last_seen: new Date(Date.now() - 200_000).toISOString() }).eq("user_id", userId);
    if (error) throw new Error(error.message);
  };

  const name = `c${randomBytes(5).toString("hex")}`;
  const pw = "correct-horse-8";
  const A = pc(cfg.url, cfg.key, "시험 PC A", 100);
  const B = pc(cfg.url, cfg.key, "시험 PC B", 5);

  try {
    // (1) 첫 로그인 — 서버 저장이 없으면 이 PC 저장을 첫 저장으로 올리고 owner 를 적는다
    const up = await A.account.signUp(name, "지우", pw);
    assert.ok(up.ok, JSON.stringify(up));
    const uid = (await A.account.userId())!;
    const cloudA = A.make();
    await cloudA.start(uid, "boot");
    assert.equal(cloudA.view().status, "online");
    assert.equal(A.state()?.syncedRev, 1, "첫 저장 rev 1");
    assert.equal(A.state()?.userId, uid);
    assert.equal(A.state()?.owner, uid);
    assert.equal((await row(uid)).save?.points?.balance, 100);
    process.stdout.write("(1) 첫 로그인 — 이 PC 저장을 첫 저장으로, owner 기록  ok\n");

    // (2) 주기 저장은 2분(시험 1.5초) 스로틀, 사건은 바로
    A.bump(110);
    cloudA.noteSaved("tick");
    assert.equal(cloudA.unsaved(), "dirty");
    await sleep(500);
    assert.equal(A.state()?.syncedRev, 1, "스로틀 안에서는 올리지 않는다");
    A.bump(120);
    cloudA.noteSaved("event");
    await until(() => A.state()?.syncedRev === 2, "사건은 바로 올린다", 1_000);
    assert.equal((await row(uid)).save?.points?.balance, 120);
    A.bump(125);
    cloudA.noteSaved("tick");
    await sleep(500);
    assert.equal(A.state()?.syncedRev, 2, "막 올린 뒤의 주기 저장은 기다린다");
    await until(() => A.state()?.syncedRev === 3, "스로틀이 지나면 올린다", 3_000);
    assert.equal(cloudA.unsaved(), "none");
    process.stdout.write("(2) 주기 저장 스로틀·사건 즉시  ok\n");

    // (3) B 가 같은 계정으로 로그인 — 고르기 없이 서버 저장을 받는다. A 는 밀려나지만 세션은 그대로
    assert.ok((await B.account.signIn(name, pw)).ok);
    const cloudB = B.make();
    await cloudB.start(uid, "boot");
    assert.equal(cloudB.view().status, "online");
    assert.equal(B.points(), 125, "서버 저장을 받았다");
    assert.equal((B.backups[0]?.points as { balance: number }).balance, 5, "이 PC 저장은 백업");
    await until(() => cloudA.view().status === "superseded", "A 밀려남");
    assert.equal(A.lastHalt()?.reason, "superseded");
    assert.equal(A.state()?.superseded, true);
    assert.equal(A.state()?.userId, uid, "밀려나도 계정 연결 유지(D19)");
    assert.equal(A.state()?.owner, uid);
    assert.equal(await A.account.userId(), uid, "밀려나도 로그아웃하지 않는다(F1)");
    const revAtKick = (await row(uid)).rev;
    A.bump(777);
    cloudA.noteSaved("event");
    await sleep(400);
    assert.equal((await row(uid)).rev, revAtKick, "밀려난 A 는 올리지 않는다");
    process.stdout.write("(3) 다른 PC 로그인 — 서버 저장 자동 받기, 앞 PC superseded·세션 유지  ok\n");

    // B 가 진행한다
    B.bump(130);
    cloudB.noteSaved("event");
    await until(async () => (await row(uid)).save?.points?.balance === 130, "B 올리기");

    // (4) A 를 다시 켠다(boot) — 온라인인 B 를 넘겨받고, 밀려났었으니 rev 와 무관하게 서버 저장을 받는다
    const cloudA2 = A.make();
    await cloudA2.start(uid, "boot");
    assert.equal(cloudA2.view().status, "online");
    assert.equal(A.points(), 130, "서버 저장을 받았다 — 밀려난 뒤의 진행(777)은 버린다");
    assert.equal(A.state()?.superseded, false);
    await until(() => cloudB.view().status === "superseded", "B 밀려남");
    process.stdout.write("(4) 밀려난 PC 다시 켜기(boot) — 넘겨받고 서버 저장 받기  ok\n");

    // (5) 오프라인 진행 — 다시 연결되면 저장 버튼 없이 자동으로 올린다
    A.setNet("down");
    A.bump(140);
    cloudA2.noteSaved("event");
    await until(() => cloudA2.view().status === "offline", "A 오프라인");
    A.bump(150);
    cloudA2.noteSaved("tick");
    A.setNet("up");
    await until(async () => (await row(uid)).save?.points?.balance === 150, "다시 연결되면 자동으로 올린다");
    assert.equal(cloudA2.view().status, "online");
    process.stdout.write("(5) 오프라인 진행 — 다시 연결되면 자동 업로드  ok\n");

    // (6) D20 — 오프라인으로 켠 B 가 나중에 닿았을 때 A 가 온라인이면 B 가 물러난다
    const haltsA6 = A.halts.length;
    B.setNet("down");
    const cloudB2 = B.make();
    await cloudB2.start(uid, "boot");
    assert.equal(cloudB2.view().status, "offline");
    B.setNet("up");
    await until(() => cloudB2.view().status === "superseded", "B 양보(yield)");
    assert.equal(B.lastHalt()?.reason, "superseded");
    assert.equal(B.lastHalt()?.info.other?.label, "시험 PC A", "양보한 상대");
    await sleep(700);
    assert.equal(cloudA2.view().status, "online", "A 는 그대로");
    assert.equal(A.halts.length, haltsA6);
    assert.equal((await row(uid)).active_device, A.state()?.deviceId);
    process.stdout.write("(6) 오프라인으로 켠 PC 는 늦게 닿으면 양보(D20)  ok\n");

    // (7) A 정상 종료(released) 뒤 — 오프라인으로 켠 B 가 닿으면 확인 없이 넘겨받는다
    await cloudA2.release(3_000);
    assert.equal(cloudA2.view().status, "off");
    assert.equal((await row(uid)).presence, "released");
    B.setNet("down");
    const cloudB3 = B.make();
    await cloudB3.start(uid, "boot");
    B.setNet("up");
    await until(() => cloudB3.view().status === "online", "B late 넘겨받기");
    assert.equal(B.points(), 150, "밀려났던 B 는 서버 저장을 받는다");
    assert.equal((await row(uid)).active_device, B.state()?.deviceId);
    process.stdout.write("(7) released 뒤 late 넘겨받기 — 확인 없음  ok\n");

    // (8) G2 — 연결 끊긴 PC 를 넘겨받을 때 확인. 취소는 멈춤, 승인은 force
    cloudB3.stop(); // B 가 갑자기 꺼졌다(released 알림 없음)
    await age(uid);
    const cloudA3 = A.make();
    await cloudA3.start(uid, "boot");
    assert.equal(cloudA3.view().status, "confirm");
    assert.equal(A.lastHalt()?.reason, "confirm");
    assert.equal(A.lastHalt()?.info.other?.label, "시험 PC B");
    assert.ok(A.lastHalt()?.info.other?.seen, "상대 마지막 시각");
    await cloudA3.confirm(false);
    assert.equal(cloudA3.view().status, "off", "취소하면 멈춘다(앱 종료)");
    assert.equal((await row(uid)).active_device, B.state()?.deviceId, "취소하면 넘겨받지 않는다");
    const cloudA4 = A.make();
    await cloudA4.start(uid, "boot");
    assert.equal(cloudA4.view().status, "confirm");
    await cloudA4.confirm(true);
    assert.equal(cloudA4.view().status, "online", "승인하면 넘겨받는다");
    assert.equal((await row(uid)).active_device, A.state()?.deviceId);
    process.stdout.write("(8) G2 확인 — 취소·force  ok\n");

    // (9) 잠든 PC 는 오래돼도 확인 없이 넘겨받는다. 깨어나면 밀려난 것을 안다
    await cloudA4.sleep();
    assert.equal((await row(uid)).presence, "asleep");
    await age(uid);
    A.client.realtime.disconnect(); // 잠든 동안 온 밀려남 신호를 놓친다
    const cloudB4 = B.make();
    await cloudB4.start(uid, "boot");
    assert.equal(cloudB4.view().status, "online", "잠든 PC 는 확인 없이 넘겨받는다");
    assert.equal(cloudA4.view().status, "online", "A 는 아직 모른다");
    await cloudA4.wake();
    assert.equal(cloudA4.view().status, "superseded", "깨어나 하트비트로 안다");
    process.stdout.write("(9) 잠듦이면 확인 없음, 깨어나면 밀려남  ok\n");

    // (10) 최소 버전보다 낮은 앱 — 업데이트 필요. 옛 함수 시그니처도 업데이트 필요만 낸다
    const cloudV = A.make("0.12.9");
    await cloudV.start(uid, "boot");
    assert.equal(cloudV.view().status, "update-required");
    assert.equal(cloudV.view().error, "CLOUD_UPDATE_REQUIRED");
    cloudV.noteSaved("event");
    await sleep(300);
    assert.equal(cloudV.view().status, "update-required", "올리지 않고 그대로");
    const oldClaim = await A.client.rpc("claim_device", { p_device: A.state()?.deviceId, p_label: "옛 앱" });
    assert.match(oldClaim.error?.message ?? "", /CLOUD_UPDATE_REQUIRED/, "옛 2인자 claim_device");
    const oldUpload = await A.client.rpc("upload_save", { p_device: A.state()?.deviceId, p_base_rev: 0, p_save: {}, p_save_v: 3, p_app_version: "0.4.0" });
    assert.match(oldUpload.error?.message ?? "", /CLOUD_UPDATE_REQUIRED/, "옛 5인자 upload_save");
    assert.equal((await row(uid)).active_device, B.state()?.deviceId, "버전 거부는 넘겨받지 않는다");
    cloudV.stop();
    process.stdout.write("(10) 버전 거부·옛 시그니처 — 업데이트 필요  ok\n");

    // (11) 서버 저장에 반영되지 않은 교환 — 넘겨받지 않고 blocked. 풀린 뒤 다시 시도하면 넘겨받는다
    const channel = randomBytes(16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    {
      const { error } = await admin.from("trade_channels").insert({
        id: channel, token_hash: `\\x${randomBytes(32).toString("hex")}`, host: uid, guest: null, protocol: 1, data_version: "t",
        expires_at: new Date(Date.now() + 600_000).toISOString(), status: "done", done_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    }
    const cloudT = A.make();
    await cloudT.start(uid, "boot");
    assert.equal(cloudT.view().status, "blocked");
    assert.equal(A.lastHalt()?.reason, "blocked");
    assert.equal(A.lastHalt()?.info.code, "CLOUD_TRADE_UNSYNCED");
    {
      const { error } = await admin.from("trade_channels").delete().eq("id", channel);
      if (error) throw new Error(error.message);
    }
    await cloudT.confirm(true);
    assert.equal(cloudT.view().status, "online", "다시 시도하면 넘겨받는다");
    await until(() => cloudB4.view().status === "superseded", "B 밀려남");
    process.stdout.write("(11) 교환 미반영 차단 — blocked, 다시 시도  ok\n");

    // (12) 멱등 키 — 응답을 잃은 올리기는 같은 키로 다시 보내 rev 가 두 번 오르지 않는다
    const base = (await row(uid)).rev;
    const sent = A.uploads.length;
    A.setNet("drop-upload");
    A.bump(200);
    cloudT.noteSaved("event");
    await until(() => cloudT.view().status === "offline", "응답을 잃고 오프라인");
    const op = A.state()?.pendingOp;
    assert.ok(op, "보낸 키를 남긴다");
    assert.equal(A.uploads[sent]?.op, op);
    assert.equal((await row(uid)).rev, base + 1, "서버는 이미 썼다");
    A.setNet("up");
    await until(() => A.uploads.length >= sent + 3 && A.state()?.pendingOp == null && !A.state()?.dirty, "다시 보내기", 5_000);
    assert.equal(A.uploads[sent + 1]?.op, op, "같은 키로 다시 보낸다");
    assert.equal(A.uploads[sent + 1]?.rev, base + 1, "같은 키는 그때의 rev");
    assert.notEqual(A.uploads[sent + 2]?.op, op, "다시 쓴 키 뒤에는 새 키로 한 번 더");
    assert.equal((await row(uid)).rev, base + 2);
    assert.equal((await row(uid)).save?.points?.balance, 200);
    process.stdout.write("(12) 멱등 키 — 응답 잃은 올리기 재전송  ok\n");

    // (14) owner 가 다른 계정 — 이 계정 서버 저장이 없으면 이 PC 저장을 올리지 않는다(10절 Q1)
    await cloudT.release(3_000);
    assert.ok((await A.account.signOut()).ok);
    cloudT.stop(true);
    assert.equal(A.state()?.userId, null);
    assert.equal(A.state()?.owner, uid, "로그아웃해도 owner 유지");
    const up2 = await A.account.signUp(`${name}x`, "웅이", pw);
    assert.ok(up2.ok, JSON.stringify(up2));
    const uid2 = (await A.account.userId())!;
    const cloudO = A.make();
    await cloudO.start(uid2, "boot");
    assert.equal(cloudO.view().status, "online");
    assert.equal(cloudO.view().error, "CLOUD_OWNER_OTHER");
    A.bump(300);
    cloudO.noteSaved("event");
    await sleep(500);
    assert.equal((await row(uid2)).save, null, "다른 계정 저장을 올리지 않는다");
    assert.equal(A.state()?.owner, uid);
    process.stdout.write("(14) owner 다른 계정 — 올리지 않고 상태로 알림  ok\n");

    // (15) 세션 종료 알림 — 올리고 released 를 알리되 멈추지 않는다. 끄기가 취소되어 계속 돌면 다음 하트비트가 active 로 되돌린다
    await cloudO.announceRelease(3_000);
    assert.equal(cloudO.view().status, "online", "세션 종료 알림은 클라우드를 멈추지 않는다");
    assert.equal(cloudO.released(), true);
    assert.equal((await row(uid2)).presence, "released");
    await until(async () => (await row(uid2)).presence === "active" && !cloudO.released(), "다음 하트비트가 active 로 되돌린다", 3_000);
    assert.equal(cloudO.view().status, "online");
    cloudO.stop();
    process.stdout.write("(15) 세션 종료 알림 뒤 계속 돌면 active 복귀  ok\n");

    // (16) 밀려났던 PC 가 넘겨받은 뒤 서버 저장 받기가 망 실패 — 다시 연결되면 다시 받고, 로컬을 올리지 않는다
    const serverBalance = (await row(uid)).save?.points?.balance;
    assert.equal(B.state()?.superseded, true, "B 는 (11)에서 밀려났다");
    // 밀려난 뒤 서버 rev 가 그대로인 경우 — rev 충돌로는 막히지 않아 받기를 끝내지 않으면 로컬이 그대로 올라간다
    B.state()!.syncedRev = (await row(uid)).rev;
    B.setNet("fail-download");
    const cloudB5 = B.make();
    await cloudB5.start(uid, "boot");
    assert.equal(cloudB5.view().status, "offline", "받기 실패는 오프라인");
    assert.equal((await row(uid)).active_device, B.state()?.deviceId, "넘겨받기는 됐다");
    B.bump(999);
    cloudB5.noteSaved("event");
    await until(() => cloudB5.view().status === "online", "다시 연결");
    assert.equal(B.points(), serverBalance, "다시 연결되면 서버 저장을 받는다");
    assert.equal((await row(uid)).save?.points?.balance, serverBalance, "로컬(999)을 올리지 않았다");
    assert.equal(B.state()?.superseded, false);
    process.stdout.write("(16) 넘겨받은 뒤 받기 실패 — 다시 연결 때 다시 받기, 로컬 올리지 않음  ok\n");

    // (17) 넘겨받는 중에 받은 밀려남 신호 — claim 뒤에도 활성이면 무시한다(동시 부팅에서 둘 다 꺼지지 않게)
    const C = pc(cfg.url, cfg.key, "시험 PC C", 1);
    assert.ok((await C.account.signIn(name, pw)).ok);
    assert.ok((await A.account.signOut()).ok);
    assert.ok((await A.account.signIn(name, pw)).ok);
    const releaseC = C.holdClaim("before");
    const cloudC = C.make();
    const startC = cloudC.start(uid, "boot");
    await until(() => cloudC.view().status === "connecting", "C 넘겨받는 중");
    const cloudA5 = A.make();
    await cloudA5.start(uid, "boot"); // A 가 B 를 넘겨받으며 밀려남 신호를 보낸다 — C 는 claim 중이라 기록만 한다
    assert.equal(cloudA5.view().status, "online");
    await sleep(700);
    releaseC();
    await startC;
    assert.equal(cloudC.view().status, "online", "claim 뒤에도 활성이면 신호를 무시한다");
    assert.equal(C.halts.length, 0);
    await until(() => cloudA5.view().status === "superseded", "A 는 C 에 밀려난다");
    process.stdout.write("(17) claim 중 받은 신호 — 활성이면 무시  ok\n");

    // (18) claim 이 서버에 닿은 뒤 응답을 기다리는 사이 다른 PC 가 넘겨받았다 — claim 뒤 활성이 아니면 밀려난다
    const releaseB = B.holdClaim("after");
    const cloudB6 = B.make();
    const startB = cloudB6.start(uid, "boot");
    await until(async () => (await row(uid)).active_device === B.state()?.deviceId, "B claim 이 서버에 닿았다");
    await until(() => cloudC.view().status === "superseded", "C 는 B 에 밀려난다");
    const cloudA6 = A.make();
    await cloudA6.start(uid, "boot"); // B 의 응답이 오기 전에 A 가 넘겨받는다
    assert.equal(cloudA6.view().status, "online");
    await sleep(700);
    releaseB();
    await startB;
    assert.equal(cloudB6.view().status, "superseded", "claim 뒤 활성이 아니면 밀려난다");
    assert.equal(B.lastHalt()?.info.other?.label, "시험 PC A");
    assert.equal(cloudA6.view().status, "online", "나중에 넘겨받은 A 는 그대로");
    C.clouds.forEach((c) => c.stop());
    void C.client.removeAllChannels();
    process.stdout.write("(18) claim 응답 전에 넘겨받혔으면 밀려남  ok\n");

    process.stdout.write("selftest-cloud: 통과 (1~12·14~18, 13 은 selftest-session)\n");
  } finally {
    for (const c of [...A.clouds, ...B.clouds]) c.stop();
    void A.client.removeAllChannels();
    void B.client.removeAllChannels();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
