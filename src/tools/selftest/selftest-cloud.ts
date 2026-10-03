// 클라우드 저장 확인 — 로컬 Supabase 에서 두 PC(같은 계정)의 두 PC 규칙 상태기계를 본다
//   npx supabase start 뒤: npm run build && node dist/tools/selftest/selftest-cloud.js
//   로컬 서버가 없으면 건너뛴다(종료 코드 0). 주소가 127.0.0.1·localhost 가 아니면 멈춘다
//   last_seen 조작·교환 채널 넣기는 서비스 키로 한다(로컬 전용)
// 설계는 worklog-mac/records/cloud-authority/design-p1.md 2절(전이표), 7절(시험 1~14), 11절(서버 계약)
//   13번(동시 ensure 익명 하나)은 selftest-session 이 본다
//   19~27 은 P2 익명 계정 저장 — design-p2.md 2절·8절·13절 (익명 새 설치·PET_TRADED_OUT·이관 세 결과·재시도·분실·reset·업데이트 필요 재확인)
//   (0) 부팅 판단·(20) PET_TRADED_OUT·(27) 은 P2 코드 검수(H1·M1·W5) 뒤 더했다
import assert from "node:assert";
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { memoryStorage } from "../../online/client";
import { createAccount } from "../../online/account";
import { createSessionGate } from "../../online/session";
import { handoffHooks } from "../../online/handoff";
import { createCloud } from "../../online/cloud";
import { normalizeCloudState, strayAnonymous, type Cloud, type CloudSyncState, type HaltInfo, type HaltReason, type OwnerKind } from "../../online/cloud-state";

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
//   계정은 이관 훅(handoffHooks)을 단다 — 세션이 익명일 때만 이관하므로 P1 시험(1~18)에는 영향이 없다
function pc(url: string, key: string, label: string, points: number, pets: unknown[] = [{ id: "p1" }]) {
  let net: Net = "up";
  let rejectUploads = 0; // 서버에 보내지 않고 CLOUD_PET_TRADED_OUT 으로 거절할 올리기 수
  let rejectDelay = 0; // 그 거절을 돌려주기 전에 기다리는 시간(ms) — 보내는 사이 로컬이 바뀌는 경우(검수 M1)
  let versionBlock = 0; // 서버에 보내지 않고 CLOUD_UPDATE_REQUIRED 로 거절할 claim·touch 수
  let failAdopt = 0; // 망 오류로 실패시킬 adopt_anonymous 수
  // claim_device 붙잡기 — before: 서버에 보내기 전에, after: 서버가 처리한 뒤 응답을 돌려주기 전에 기다린다
  let claimHold: { at: "before" | "after"; gate: Promise<void> } | null = null;
  const uploads: { op: string; rev: number | null }[] = []; // 올리기(Edge Function upload-save) 요청의 멱등 키와 받은 rev(응답을 잃으면 null)
  const client: SupabaseClient = createClient(url, key, {
    auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        if (net === "down") throw new TypeError("fetch failed");
        const target = String(input instanceof Request ? input.url : input);
        if (versionBlock > 0 && (target.includes("/rpc/claim_device") || target.includes("/rpc/touch_device"))) {
          versionBlock -= 1;
          const body = JSON.stringify({ code: "P0001", message: "CLOUD_UPDATE_REQUIRED", details: null, hint: null });
          return new Response(body, { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (rejectUploads > 0 && target.includes("/functions/v1/upload-save")) {
          rejectUploads -= 1;
          uploads.push({ op: "rejected", rev: null });
          if (rejectDelay > 0) await sleep(rejectDelay);
          const body = JSON.stringify({ error: "CLOUD_PET_TRADED_OUT" });
          return new Response(body, { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (failAdopt > 0 && target.includes("/rpc/adopt_anonymous")) {
          failAdopt -= 1;
          throw new TypeError("fetch failed");
        }
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
        const isUpload = target.includes("/functions/v1/upload-save");
        if (!isUpload) return fetch(input, init);
        const op = (JSON.parse(String(init?.body ?? "{}")) as { op?: string }).op ?? "";
        const res = await fetch(input, init);
        if (net === "drop-upload") {
          uploads.push({ op, rev: null });
          net = "down";
          throw new TypeError("fetch failed");
        }
        const body = await res.clone().json().catch(() => null) as unknown;
        const got = body && typeof body === "object" ? (body as { rev?: unknown }).rev : null;
        uploads.push({ op, rev: typeof got === "number" ? got : null });
        return res;
      },
    },
  });
  let save: Record<string, unknown> = { v: 3, savedAt: Date.now(), pets, points: { balance: points } };
  let stored: CloudSyncState | null = null;
  const backups: Record<string, unknown>[] = [];
  const halts: { reason: HaltReason; info: HaltInfo }[] = [];
  const lost: OwnerKind[] = [];
  const handoffs: string[] = []; // start 가 늦게 옮긴 이관 결과(onHandoff)
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
      onLost: (kind) => void lost.push(kind),
      onHandoff: (outcome) => void handoffs.push(outcome),
      heartbeatMs: 500,
      throttleMs: 1_500,
      eventDelayMs: 150,
      retryMs: 300,
    });
    clouds.push(c);
    return c;
  };
  const gate = createSessionGate(client);
  return {
    client, gate, make, uploads, backups, halts, lost, handoffs, clouds,
    account: createAccount({ client, gate, blocked: () => false, switchHooks: handoffHooks(client) }),
    setNet: (v: Net) => { net = v; },
    rejectUploads: (n: number, delayMs = 0) => { rejectUploads = n; rejectDelay = delayMs; },
    versionBlock: (n: number) => { versionBlock = n; },
    failAdopt: (n: number) => { failAdopt = n; },
    setPets: (next: unknown[]) => { save = { ...save, pets: next }; },
    // 익명 세션을 만든다(부팅 때 gate.ensure 와 같다)
    anon: async (): Promise<string> => {
      const r = await gate.ensure();
      if (!r.ok || !r.user.is_anonymous) throw new Error(`익명 세션을 만들지 못했다: ${JSON.stringify(r)}`);
      return r.user.id;
    },
    // 다음 claim_device 를 붙잡는다. 돌려준 함수로 놓는다
    holdClaim: (at: "before" | "after"): (() => void) => {
      let open = (): void => undefined;
      claimHold = { at, gate: new Promise<void>((r) => { open = r; }) };
      return () => open();
    },
    points: () => (save.points as { balance: number }).balance,
    bump: (n: number) => { save = { ...save, points: { balance: n } }; },
    state: () => stored,
    // 로컬 저장을 격리했다 — src/main/online.ts loadState 가 격리 표시를 보고 맞춘 rev 를 잊는 것과 같다
    forget: () => { if (stored) stored = { ...stored, syncedRev: -1, pendingOp: null }; },
    lastHalt: () => halts.at(-1),
  };
}

type PC = ReturnType<typeof pc>;

// P2 익명 계정 저장 (design-p2.md 2절·8절) — 새 PC 들만 쓴다. 앞 시험의 계정과 엇갈리지 않게
async function p2(url: string, key: string, admin: SupabaseClient, extra: PC[]): Promise<void> {
  const make = (label: string, points: number, pets?: unknown[]): PC => {
    const p = pc(url, key, label, points, pets);
    extra.push(p);
    return p;
  };
  const saveRow = async (userId: string): Promise<{ rev: number; save: { points?: { balance: number } } | null; active_device: string | null } | null> => {
    const { data, error } = await admin.from("cloud_saves").select("rev, save, active_device").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? ({ ...data, rev: Number(data.rev) } as never) : null;
  };
  const userExists = async (id: string): Promise<boolean> => {
    const { data, error } = await admin.auth.admin.getUserById(id);
    return !error && !!data.user;
  };
  const pw = "correct-horse-8";
  const newName = (): string => `h${randomBytes(5).toString("hex")}`;
  const pet = { id: "p1", since: 1_700_000_000_000 };

  // (19) 익명 새 설치 — 스타터 고르기 전(개체 0)에는 올리지 않고 서버 행도 없다. 고른 뒤 첫 올리기가 행을 만든다(base_rev 0)
  const X = make("시험 PC X", 30, []);
  const anonX = await X.anon();
  const cloudX = X.make();
  await cloudX.start(anonX, "boot", "anonymous");
  assert.equal(cloudX.view().status, "online", "익명도 온라인");
  cloudX.noteSaved("event");
  await sleep(400);
  assert.equal(X.uploads.length, 0, "개체 0 이면 올리지 않는다");
  assert.equal(await saveRow(anonX), null, "고르기 전에는 서버 행이 없다");
  assert.equal(cloudX.unsaved(), "dirty", "올리지 못한 진행은 dirty 로 남는다");
  X.setPets([pet]);
  cloudX.noteSaved("event");
  await until(async () => (await saveRow(anonX))?.rev === 1, "스타터를 고른 뒤 첫 올리기");
  assert.equal(X.state()?.syncedRev, 1);
  assert.deepEqual(cloudX.owner(), { id: anonX, kind: "anonymous" }, "주인은 익명 계정");
  assert.equal((await saveRow(anonX))?.active_device, X.state()?.deviceId, "첫 올리기 PC 가 활성");
  process.stdout.write("(19) 익명 새 설치 — 고르기 전 올리지 않음, 고른 뒤 행 생성(rev 1)  ok\n");

  // (20) CLOUD_PET_TRADED_OUT (검수 M1)
  //   a. 서버 저장이 받아지면 그 저장으로 바꾼다(로컬 백업) — 덮기 전에 서버 저장을 다시 올려 본다
  X.bump(31);
  cloudX.noteSaved("event");
  await until(async () => (await saveRow(anonX))?.save?.points?.balance === 31, "익명 올리기");
  const rev31 = (await saveRow(anonX))!.rev;
  X.rejectUploads(1);
  X.bump(32);
  let backupsBefore = X.backups.length;
  cloudX.noteSaved("event");
  await until(() => X.backups.length === backupsBefore + 1, "거부 → 서버 저장을 다시 올려 본 뒤 받기");
  assert.equal(X.points(), 31, "서버 저장(31)을 받았다 — 거부된 로컬(32)은 백업");
  assert.equal((X.backups.at(-1)?.points as { balance: number }).balance, 32);
  assert.equal((await saveRow(anonX))?.rev, rev31 + 1, "다시 올려 본 서버 저장은 내용 같고 rev 만 오른다");
  assert.equal(X.state()?.syncedRev, rev31 + 1);
  assert.equal(cloudX.view().error, null);
  //   b. 서버 저장도 거부되면 로컬을 덮지 않고 막는다(held). 로컬이 바뀌면 한 번 다시 올리고, 또 거부되면 다시 막는다
  X.bump(33);
  backupsBefore = X.backups.length;
  X.rejectUploads(3);
  cloudX.noteSaved("event");
  await until(() => cloudX.view().error === "CLOUD_PET_TRADED_OUT", "서버 저장도 거부되면 held");
  assert.equal(X.points(), 33, "옛 서버 저장으로 덮지 않는다 — 받은 포켓몬을 잃지 않게");
  assert.equal(X.backups.length, backupsBefore, "덮지 않았으니 백업도 없다");
  assert.equal(cloudX.unsaved(), "none", "held 는 끄기 확인에서 dirty 로 묻지 않는다");
  let sentHeld = X.uploads.length;
  await sleep(400);
  assert.equal(X.uploads.length, sentHeld, "held 면 저장이 바뀌기 전에는 더 올리지 않는다");
  X.bump(34);
  cloudX.noteSaved("event");
  await until(() => X.uploads.length === sentHeld + 1, "저장이 바뀌면 한 번 다시 올린다");
  await until(() => cloudX.view().error === "CLOUD_PET_TRADED_OUT", "또 거부되면 다시 held");
  sentHeld = X.uploads.length;
  await sleep(400);
  assert.equal(X.uploads.length, sentHeld, "받지 않고 다시 막는다(서버 저장 다시 받기 없음)");
  assert.equal(cloudX.view().status, "online", "게임·하트비트는 계속");
  X.bump(35);
  cloudX.noteSaved("event");
  await until(async () => (await saveRow(anonX))?.save?.points?.balance === 35, "거부가 풀리면 다음 변경이 올라간다");
  assert.equal(cloudX.view().error, null);
  //   c. 보내는 사이 로컬이 바뀌었다(교환 반영) — 받지 않고 지금 저장으로 다시 올린다
  backupsBefore = X.backups.length;
  X.rejectUploads(1, 300);
  X.bump(36);
  cloudX.noteSaved("event");
  await until(() => X.uploads.at(-1)?.op === "rejected", "옛 사본 올리기가 거부를 기다린다");
  X.bump(37);
  cloudX.noteSaved("event");
  await until(async () => (await saveRow(anonX))?.save?.points?.balance === 37, "지금 저장으로 다시 올린다");
  assert.equal(X.backups.length, backupsBefore, "서버 저장을 받지 않았다");
  assert.equal(X.points(), 37);
  // 다시 켜도 그대로 이어 쓴다
  const cloudX2 = X.make();
  await cloudX2.start(anonX, "boot", "anonymous");
  X.bump(38);
  cloudX2.noteSaved("event");
  await until(async () => (await saveRow(anonX))?.save?.points?.balance === 38, "다시 켜면 이어 올린다");
  process.stdout.write("(20) PET_TRADED_OUT — 다시 올려 보고 받기, 또 거부면 덮지 않고 held, 바뀌면 한 번 다시, 옛 사본 거부는 다시 올림  ok\n");

  // (21) 가입 이관 moved — 익명 저장이 새 계정으로 옮겨지고 익명 계정은 지워진다
  await cloudX2.flush();
  cloudX2.stop();
  const up = await X.account.signUp(newName(), "이관", pw);
  assert.ok(up.ok, JSON.stringify(up));
  assert.equal(up.ok && up.handoff?.kind, "adopted");
  assert.equal(up.ok && up.handoff?.kind === "adopted" && up.handoff.outcome, "moved");
  assert.equal(up.ok && up.view.anonymous, false);
  const memberX = (await X.account.userId())!;
  assert.notEqual(memberX, anonX);
  assert.equal(await userExists(anonX), false, "익명 계정은 지워졌다");
  assert.equal((await saveRow(memberX))?.save?.points?.balance, 38, "서버에서 옮겨졌다");
  if (up.ok && up.handoff) cloudX2.applyHandoff(up.handoff, memberX);
  const cloudX3 = X.make();
  await cloudX3.start(memberX, "boot", "member");
  assert.equal(cloudX3.view().status, "online");
  assert.deepEqual(cloudX3.owner(), { id: memberX, kind: "member" }, "주인은 정식 계정");
  assert.equal(X.points(), 38, "옮겨진 서버 저장을 받았다");
  X.bump(35);
  cloudX3.noteSaved("event");
  await until(async () => (await saveRow(memberX))?.save?.points?.balance === 35, "정식 계정으로 이어 올린다");
  process.stdout.write("(21) 이관 moved — 서버에서 옮김, 익명 삭제, 정식 계정으로 이어 쓰기  ok\n");

  // (22) 로그인 이관 discarded — 로그인 계정에 저장이 있으면 익명 저장을 버리고 서버 저장을 받는다(D7, 로컬 백업)
  const Z = make("시험 PC Z", 42);
  const nameZ = newName();
  assert.ok((await Z.account.signUp(nameZ, "제트", pw)).ok);
  const memberZ = (await Z.account.userId())!;
  const cloudZ = Z.make();
  await cloudZ.start(memberZ, "boot");
  assert.equal((await saveRow(memberZ))?.save?.points?.balance, 42);
  await cloudZ.release(3_000);
  const Y = make("시험 PC Y", 7, [pet]);
  const anonY = await Y.anon();
  const cloudY = Y.make();
  await cloudY.start(anonY, "boot", "anonymous");
  await until(async () => (await saveRow(anonY))?.rev === 1, "Y 익명 첫 올리기");
  cloudY.stop();
  const inY = await Y.account.signIn(nameZ, pw);
  assert.ok(inY.ok && inY.handoff?.kind === "adopted" && inY.handoff.outcome === "discarded", JSON.stringify(inY));
  assert.equal(await userExists(anonY), false, "버려도 익명 계정은 지운다");
  if (inY.ok && inY.handoff) cloudY.applyHandoff(inY.handoff, memberZ);
  assert.deepEqual(cloudY.owner(), { id: anonY, kind: "anonymous" }, "discarded 는 주인을 바꾸지 않는다");
  const cloudY2 = Y.make();
  await cloudY2.start(memberZ, "boot", "member");
  assert.equal(cloudY2.view().status, "online");
  assert.equal(Y.points(), 42, "로그인 계정 저장을 받았다");
  assert.equal((Y.backups.at(-1)?.points as { balance: number }).balance, 7, "익명 진행은 백업");
  assert.deepEqual(cloudY2.owner(), { id: memberZ, kind: "member" });
  cloudY2.stop();
  process.stdout.write("(22) 이관 discarded — 로그인 계정 저장 받기, 익명 진행 백업  ok\n");

  // (23) 이관 empty + rebind — 서버에 익명 저장이 없으면(고르기 전 가입) 이 PC 저장을 새 계정 첫 저장으로
  const W = make("시험 PC W", 11, []);
  const anonW = await W.anon();
  const cloudW = W.make();
  await cloudW.start(anonW, "boot", "anonymous");
  assert.equal(cloudW.rebind(anonW, "x"), false, "돌고 있으면 rebind 하지 않는다");
  cloudW.stop();
  assert.equal(cloudW.rebind("someone-else", "x"), false, "주인이 from 이 아니면 rebind 하지 않는다");
  W.setPets([pet]); // 오프라인에서 고른 셈 — 서버에는 아직 없다
  const upW = await W.account.signUp(newName(), "더블유", pw);
  assert.ok(upW.ok && upW.handoff?.kind === "adopted" && upW.handoff.outcome === "empty", JSON.stringify(upW));
  const memberW = (await W.account.userId())!;
  if (upW.ok && upW.handoff) cloudW.applyHandoff(upW.handoff, memberW);
  assert.deepEqual(cloudW.owner(), { id: memberW, kind: "member" }, "empty 는 새 계정으로 rebind");
  assert.equal(W.state()?.syncedRev, 0);
  const cloudW2 = W.make();
  await cloudW2.start(memberW, "boot", "member");
  await until(async () => (await saveRow(memberW))?.save?.points?.balance === 11, "이 PC 저장을 첫 저장으로");
  assert.equal(W.backups.length, 0, "받지 않았다");
  cloudW2.stop();
  process.stdout.write("(23) 이관 empty — rebind 뒤 이 PC 저장을 첫 저장으로  ok\n");

  // (24) 이관 실패 보관·재시도 — 교체 직후 adopt 가 망 오류면 티켓을 cloud.json 에 남기고, start 가 claim 전에 다시 옮긴다
  const V = make("시험 PC V", 55, [pet]);
  const anonV = await V.anon();
  const cloudV = V.make();
  await cloudV.start(anonV, "boot", "anonymous");
  await until(async () => (await saveRow(anonV))?.rev === 1, "V 익명 첫 올리기");
  cloudV.stop();
  V.failAdopt(2); // 교체 직후 한 번, start 첫 시도 한 번
  const upV = await V.account.signUp(newName(), "브이", pw);
  assert.ok(upV.ok && upV.handoff?.kind === "pending" && upV.handoff.code === "NETWORK", JSON.stringify(upV));
  const memberV = (await V.account.userId())!;
  if (upV.ok && upV.handoff) cloudV.applyHandoff(upV.handoff, memberV);
  assert.equal(cloudV.pendingHandoff()?.anon, anonV, "티켓 보관");
  assert.equal(V.state()?.handoff?.anon, anonV, "cloud.json 에 남는다");
  assert.equal(await userExists(anonV), true, "아직 옮기지 않았다");
  const cloudV2 = V.make();
  await cloudV2.start(memberV, "boot", "member");
  assert.equal(cloudV2.view().status, "offline", "다시 시도도 실패하면 오프라인");
  assert.ok(V.state()?.handoff, "티켓은 그대로");
  await until(() => cloudV2.view().status === "online", "재시도로 옮기고 연결");
  assert.equal(V.state()?.handoff, null, "옮긴 뒤 티켓을 지운다");
  assert.equal(await userExists(anonV), false);
  assert.equal((await saveRow(memberV))?.save?.points?.balance, 55);
  assert.deepEqual(V.handoffs, ["moved"], "늦게 옮긴 결과를 앱에 알린다 — discarded 면 앱이 알림을 띄운다");
  assert.deepEqual(cloudV2.owner(), { id: memberV, kind: "member" });
  cloudV2.stop();
  // 만료된 티켓은 부르지 않고 버린다
  cloudV2.applyHandoff({ kind: "pending", handoff: { ticket: "old", anon: "gone", expiresAt: Date.now() - 1 }, code: "NETWORK" }, memberV);
  const cloudV3 = V.make();
  await cloudV3.start(memberV, "boot", "member");
  assert.equal(cloudV3.view().status, "online");
  assert.equal(V.state()?.handoff, null, "만료 티켓은 버린다");
  cloudV3.stop();
  process.stdout.write("(24) 이관 실패 — 티켓 보관, start 가 다시 옮김, 만료는 버림  ok\n");

  // (25) 분실 — 익명 계정이 서버에서 지워지면(정리) onLost("anonymous"), 클라우드는 off. 주인은 남는다(부팅 판단용)
  const U = make("시험 PC U", 9, [pet]);
  const anonU = await U.anon();
  const cloudU = U.make();
  await cloudU.start(anonU, "boot", "anonymous");
  await until(async () => (await saveRow(anonU))?.rev === 1, "U 익명 첫 올리기");
  {
    const { error } = await admin.auth.admin.deleteUser(anonU);
    if (error) throw new Error(error.message);
  }
  await until(() => U.lost.length > 0, "하트비트가 분실을 안다");
  assert.deepEqual(U.lost, ["anonymous"]);
  assert.equal(cloudU.view().status, "off");
  assert.equal(cloudU.view().error, "CLOUD_LOGIN_REQUIRED");
  assert.equal(U.halts.length, 0, "게임은 멈추지 않는다(onHalt 없음)");
  // 다시 켠 앱 — 세션이 없고 주인이 있다 → 앱이 분실 창(D29)을 띄운다. 판단 재료는 probe·owner
  const fresh = createClient(url, key, { auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  assert.deepEqual(await createSessionGate(fresh).probe(), { state: "none" }, "세션 없음");
  assert.deepEqual(U.make().owner(), { id: anonU, kind: "anonymous" }, "cloud.json 의 주인");
  process.stdout.write("(25) 익명 분실 — onLost, off, 주인 유지  ok\n");

  // (26) reset — 로그아웃·삭제 뒤. 기기 ID 만 남기고 새 설치처럼
  const device = U.state()?.deviceId;
  cloudU.reset();
  assert.deepEqual(U.state(), { deviceId: device, userId: null, owner: null, syncedRev: 0, dirty: false, lastSavedAt: null, superseded: false, pendingOp: null, ownerKind: null, handoff: null, seed: null, seedOwner: null, accountHeld: false });
  assert.equal(cloudU.owner(), null);
  assert.equal(cloudU.view().status, "off");
  process.stdout.write("(26) reset — 새 설치 상태, 기기 ID 유지  ok\n");

  // (27) 업데이트 필요는 다시 연결 간격마다 다시 확인한다 — 서버가 받게 되면 풀린다
  {
    const W = make("시험 PC W", 12, [pet]);
    const anonW = await W.anon();
    const cloudW = W.make();
    W.versionBlock(2);
    await cloudW.start(anonW, "boot", "anonymous");
    assert.equal(cloudW.view().status, "update-required");
    await until(() => cloudW.view().status === "online", "다시 확인해 풀린다", 5_000);
    await until(async () => (await saveRow(anonW))?.rev === 1, "풀린 뒤 올린다");
    cloudW.stop();
  }
  process.stdout.write("(27) 업데이트 필요 — 재시도 때 다시 확인해 풀림  ok\n");

  // (28) 로컬 저장 격리(P3) — 맞춘 rev 를 잊고 켜면 rev 가 같아도 서버 저장을 받는다. 격리 뒤 새로 고른 스타터가 서버 저장을 덮지 않는다
  {
    const V = make("시험 PC V", 40, [pet]);
    const anonV = await V.anon();
    const cloudV = V.make();
    await cloudV.start(anonV, "boot", "anonymous");
    cloudV.noteSaved("event");
    await until(async () => (await saveRow(anonV))?.save?.points?.balance === 40, "첫 올리기");
    const rev = (await saveRow(anonV))?.rev;
    cloudV.stop();
    V.forget();
    V.bump(1); // 격리 뒤 새로 고른 스타터 저장
    const cloudV2 = V.make();
    await cloudV2.start(anonV, "boot", "anonymous");
    assert.equal(cloudV2.view().status, "online");
    assert.equal(V.points(), 40, "서버 저장을 받았다");
    assert.equal(V.backups.length, 1, "새 저장은 백업");
    await sleep(400);
    assert.equal((await saveRow(anonV))?.save?.points?.balance, 40, "서버 저장을 덮지 않았다");
    assert.equal(V.state()?.syncedRev, rev, "맞춘 rev 를 되찾았다");
    cloudV2.stop();
  }
  process.stdout.write("(28) 로컬 저장 격리 — 맞춘 rev 를 잊으면 서버 저장을 받는다  ok\n");

  // (29) 서버 검증 P4a — 올리기는 Edge Function 을 거친다. RPC 직접 호출은 닫혔고, 관찰 모드는 조작 저장을 받되 unverified 로 둔다
  {
    const Q = make("시험 PC Q", 40, [pet]);
    const anonQ = await Q.anon();
    const direct = await Q.client.rpc("upload_save", { p_device: randomUUID(), p_base_rev: 0, p_save: { v: 3, pets: [pet] }, p_save_v: 3, p_app_version: APP_VERSION, p_op: randomUUID() });
    assert.match(direct.error?.message ?? "", /CLOUD_UPDATE_REQUIRED/, "앱이 upload_save 를 직접 부르면 업데이트 안내");
    const cloudQ = Q.make();
    await cloudQ.start(anonQ, "boot", "anonymous");
    cloudQ.noteSaved("event");
    await until(async () => (await saveRow(anonQ))?.save?.points?.balance === 40, "첫 올리기");
    Q.bump(99_999);
    cloudQ.noteSaved("event");
    await until(async () => (await saveRow(anonQ))?.save?.points?.balance === 99_999, "관찰 모드는 받는다");
    const { data: trustRow } = await admin.from("cloud_saves").select("trust").eq("user_id", anonQ).single();
    assert.equal((trustRow as { trust: string }).trust, "unverified", "위반 저장은 unverified");
    assert.equal(cloudQ.view().status, "online", "앱은 그대로 온라인");
    cloudQ.stop();
  }
  process.stdout.write("(29) 서버 검증 — RPC 직접 호출 닫힘, 관찰 모드는 받고 unverified  ok\n");

  // (30) 계정 시드(P4b) — 온라인이 되면 받아 cloud.json 에 둔다. 계정마다 다르고, 주인이 바뀌면 쓰지 않는다
  {
    const R = make("시험 PC R", 10, [pet]);
    const anonR = await R.anon();
    const cloudR = R.make();
    assert.equal(cloudR.seed(), null, "받기 전");
    await cloudR.start(anonR, "boot", "anonymous");
    await until(() => cloudR.seed() != null, "시드 받기");
    const seedR = cloudR.seed();
    assert.equal(R.state()?.seed, seedR, "cloud.json 에 적었다");
    assert.equal(R.state()?.seedOwner, anonR, "시드 주인");
    const { data: ctxRow } = await admin.rpc("save_verify_context", { p_user: anonR });
    assert.equal((ctxRow as { seed: string }).seed, seedR, "서버 문맥의 시드와 같다");
    cloudR.stop();
    const cloudR2 = R.make();
    assert.equal(cloudR2.seed(), seedR, "다시 켜면 cloud.json 에서 — 오프라인에서도 쓴다");
    cloudR2.stop();
    const O = make("시험 PC O", 10, [pet]);
    const anonO = await O.anon();
    const cloudO = O.make();
    await cloudO.start(anonO, "boot", "anonymous");
    await until(() => cloudO.seed() != null, "다른 계정 시드");
    assert.notEqual(cloudO.seed(), seedR, "계정마다 다르다");
    cloudO.stop();
  }
  process.stdout.write("(30) 계정 시드 — 받기·보관·계정마다 다름  ok\n");

  // (31) 이용 정지(P4c, D35) — 관리자가 정지하면 멈추고, 오프라인으로 켜도 멈춘다. 풀면 다시 온라인. 거부 모드의 거부도 정지다
  {
    const H = make("시험 PC H", 10, [pet]);
    const anonH = await H.anon();
    const cloudH = H.make();
    await cloudH.start(anonH, "boot", "anonymous");
    cloudH.noteSaved("event");
    await until(async () => (await saveRow(anonH))?.rev === 1, "첫 올리기");
    cloudH.stop();
    const hold = await admin.rpc("admin_hold_set", { p_user: anonH, p_hold: true, p_note: "시험" });
    assert.equal((hold.data as { held: boolean }).held, true, "관리자가 정지");
    const cloudH2 = H.make();
    await cloudH2.start(anonH, "boot", "anonymous");
    await until(() => cloudH2.view().status === "held", "정지 — 멈춘다");
    assert.equal(H.lastHalt()?.reason, "held", "앱에 정지로 알린다");
    assert.equal(H.state()?.accountHeld, true, "cloud.json 에 정지");
    cloudH2.stop();
    H.setNet("down");
    const cloudH3 = H.make();
    await cloudH3.start(anonH, "boot", "anonymous");
    await until(() => cloudH3.view().status === "held", "오프라인으로 켜도 멈춘다");
    cloudH3.stop();
    H.setNet("up");
    await admin.rpc("admin_hold_set", { p_user: anonH, p_hold: false, p_note: "확인함" });
    const cloudH4 = H.make();
    await cloudH4.start(anonH, "boot", "anonymous");
    await until(() => cloudH4.view().status === "online", "풀면 다시 온라인");
    assert.equal(H.state()?.accountHeld, false, "정지 표시를 지웠다");
    // 거부 모드 — 조작 저장이 거부되면 그 계정이 정지된다
    await admin.rpc("admin_verify_settings", { p_mode: "enforce" });
    try {
      H.bump(99_999);
      cloudH4.noteSaved("event");
      await until(() => cloudH4.view().status === "held", "거부 → 정지");
      assert.notEqual((await saveRow(anonH))?.save?.points?.balance, 99_999, "거부된 저장은 서버에 없다");
      const { data: holds } = await admin.rpc("admin_holds", {});
      assert.ok((holds as { user_id: string; reason: string }[]).some((x) => x.user_id === anonH && x.reason === "save-rejected"), "거부로 정지");
      // 풀면 거부된 로컬 진행을 다시 올리지 않고 서버 저장(마지막 정상 저장)을 받는다(검수 P4c H1)
      cloudH4.stop();
      await admin.rpc("admin_hold_set", { p_user: anonH, p_hold: false, p_note: "확인함" });
      const cloudH5 = H.make();
      await cloudH5.start(anonH, "boot", "anonymous");
      await until(() => cloudH5.view().status === "online", "풀린 뒤 온라인");
      assert.notEqual(H.points(), 99_999, "서버 저장을 받았다 — 거부된 진행은 버렸다");
      await sleep(400);
      assert.equal(cloudH5.view().status, "online", "다시 정지되지 않는다");
      const { data: still } = await admin.rpc("admin_holds", {});
      assert.ok(!(still as { user_id: string }[]).some((x) => x.user_id === anonH), "정지 없음");
      cloudH5.stop();
    } finally {
      await admin.rpc("admin_verify_settings", { p_mode: "observe" });
    }
    cloudH4.stop();
  }
  process.stdout.write("(31) 이용 정지 — 관리자 정지·오프라인·풀기·거부 모드 정지  ok\n");
}

async function main(): Promise<void> {
  // 옛 cloud.json — owner 는 올리던 계정, 새 칸은 기본값
  assert.deepEqual(normalizeCloudState({ deviceId: "d", userId: "u", syncedRev: 3, dirty: true, offlineDirty: true, lastSavedAt: 7 }), {
    deviceId: "d", userId: "u", owner: "u", syncedRev: 3, dirty: true, lastSavedAt: 7, superseded: false, pendingOp: null, ownerKind: "member", handoff: null, seed: null, seedOwner: null, accountHeld: false,
  });
  // P2 형식 — ownerKind·handoff 를 그대로 읽는다. 모양이 틀린 handoff 는 버린다
  const p2State = { deviceId: "d", userId: "a", owner: "a", syncedRev: 1, dirty: false, lastSavedAt: null, superseded: false, pendingOp: null, ownerKind: "anonymous", handoff: { ticket: "t", anon: "a", expiresAt: 9 }, seed: "s", seedOwner: "a", accountHeld: false };
  assert.deepEqual(normalizeCloudState(p2State), p2State);
  assert.equal(normalizeCloudState({ ...p2State, handoff: { ticket: 1 } })?.handoff, null);
  assert.equal(normalizeCloudState({ ...p2State, owner: null })?.ownerKind, null, "주인이 없으면 종류도 없다");
  assert.equal(normalizeCloudState({ deviceId: "d", userId: null, syncedRev: 0, dirty: false, offlineDirty: false, lastSavedAt: null })?.owner, null);
  assert.equal(normalizeCloudState({ deviceId: 1 }), null);

  // 부팅 판단(검수 H1) — 익명 세션인데 저장 주인이 다른 계정이고 이관 티켓이 없으면 분실. 잃은 계정의 종류를 돌려준다
  const anonUser = { id: "n", is_anonymous: true };
  assert.equal(strayAnonymous(anonUser, { id: "o", kind: "anonymous" }, null), "anonymous", "분실 부팅 때 새로 생긴 익명");
  assert.equal(strayAnonymous(anonUser, { id: "o", kind: "member" }, null), "member", "P1 로그아웃 뒤 교환 탭이 만든 익명");
  assert.equal(strayAnonymous(anonUser, { id: "o", kind: null }, null), "member", "종류 모름은 정식 계정으로");
  assert.equal(strayAnonymous(anonUser, { id: "n", kind: "anonymous" }, null), null, "주인과 같은 익명");
  assert.equal(strayAnonymous(anonUser, null, null), null, "주인 없음(새 설치)");
  assert.equal(strayAnonymous(anonUser, { id: "o", kind: "anonymous" }, { ticket: "t", anon: "o", expiresAt: 9 }), null, "남은 이관 티켓이 있으면 분실로 보지 않는다");
  assert.equal(strayAnonymous({ id: "m", is_anonymous: false }, { id: "o", kind: "anonymous" }, null), null, "정식 계정은 G-b 가 푼다");
  process.stdout.write("(0) 부팅 판단 — 주인과 다른 익명 세션은 분실  ok\n");

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
  const extra: PC[] = []; // P2 시험 PC — 끝나면 함께 멈춘다

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
    const cloudW = A.make("0.12.9");
    await cloudW.start(uid, "boot");
    assert.equal(cloudW.view().status, "update-required");
    assert.equal(cloudW.view().error, "CLOUD_UPDATE_REQUIRED");
    cloudW.noteSaved("event");
    await sleep(300);
    assert.equal(cloudW.view().status, "update-required", "올리지 않고 그대로");
    const oldClaim = await A.client.rpc("claim_device", { p_device: A.state()?.deviceId, p_label: "옛 앱" });
    assert.match(oldClaim.error?.message ?? "", /CLOUD_UPDATE_REQUIRED/, "옛 2인자 claim_device");
    const oldUpload = await A.client.rpc("upload_save", { p_device: A.state()?.deviceId, p_base_rev: 0, p_save: {}, p_save_v: 3, p_app_version: "0.4.0" });
    assert.match(oldUpload.error?.message ?? "", /CLOUD_UPDATE_REQUIRED/, "옛 5인자 upload_save");
    assert.equal((await row(uid)).active_device, B.state()?.deviceId, "버전 거부는 넘겨받지 않는다");
    cloudW.stop();
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

    await p2(cfg.url, cfg.key, admin, extra);
    process.stdout.write("selftest-cloud: 통과 (0·1~12·14~31, 13 은 selftest-session)\n");
  } finally {
    for (const p of [A, B, ...extra]) {
      for (const c of p.clouds) c.stop();
      void p.client.removeAllChannels();
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
