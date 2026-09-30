// 계정 확인 — 규칙 함수와 로컬 Supabase 에서의 가입·로그인·로그아웃·이름 바꾸기
//   npx supabase start 뒤: npm run build && node dist/tools/selftest-account.js
//   로컬 서버가 없으면 서버 부분을 건너뛴다(종료 코드 0). 주소가 127.0.0.1·localhost 가 아니면 멈춘다
// 설계는 worklog/records/trade/record.md "계정과 로그인", "로그인·클라우드 저장 구현 계획"
//   P2(design-p2.md 2절): 익명 userId·AccountView.anonymous, 세션 교체 훅(switchHooks) — 이관 결과 전달·before 실패 시 로그인 중단
import assert from "node:assert";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createOnlineClient, memoryStorage } from "../online/client";
import { authCodeOf, createAccount, normalizeDisplayName, normalizeUsername, viewOf, type Account } from "../online/account";
import { createTradeNet } from "../trade/net";
import { createSessionGate } from "../online/session";
import { handoffHooks, type HandoffReport, type SwitchHooks } from "../online/handoff";
import { dataVersion, onlineConfig } from "../trade/config";

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

function rules(): void {
  assert.equal(normalizeUsername("Jiwoo_01"), "jiwoo_01", "대문자는 소문자로");
  assert.equal(normalizeUsername("  ash_k "), "ash_k", "앞뒤 공백");
  for (const bad of ["abc", "1abc", "_abc", "a".repeat(17), "지우abc", "ab-cd", ""]) assert.equal(normalizeUsername(bad), null, `규칙 밖: ${bad}`);
  assert.equal(normalizeUsername("abcd"), "abcd", "4자");
  assert.equal(normalizeUsername("a".repeat(16)), "a".repeat(16), "16자");
  assert.equal(normalizeDisplayName(" 지우 "), "지우", "이름 앞뒤 공백");
  assert.equal(normalizeDisplayName("가".repeat(12)), "가".repeat(12), "12자");
  assert.equal(normalizeDisplayName("가".repeat(13)), null, "13자");
  assert.equal(normalizeDisplayName("   "), null, "빈 이름");
  assert.equal(normalizeDisplayName("a\nb"), null, "줄바꿈");
  assert.deepEqual(authCodeOf({ code: "invalid_credentials", message: "Invalid login credentials" }), { code: "AUTH_INVALID_LOGIN" });
  assert.deepEqual(authCodeOf({ code: "user_already_exists", message: "User already registered" }), { code: "AUTH_USERNAME_TAKEN" });
  assert.deepEqual(authCodeOf({ message: "AUTH_USERNAME_RESERVED" }), { code: "AUTH_USERNAME_TAKEN" });
  assert.deepEqual(authCodeOf({ message: "TypeError: fetch failed" }), { code: "NETWORK" });
  assert.deepEqual(viewOf(null), { signedIn: false, anonymous: false, method: null, username: null, displayName: null });
  assert.deepEqual(viewOf({ id: "a", is_anonymous: true } as never), { signedIn: false, anonymous: true, method: null, username: null, displayName: null });
  process.stdout.write("(1) 아이디·이름 규칙, 오류 코드  ok\n");
}

async function server(url: string, key: string): Promise<void> {
  let tradeBlocked = false;
  const changes: string[] = [];
  const make = (): { account: Account; client: ReturnType<typeof createOnlineClient> } => {
    const client = createOnlineClient({ url, key, storage: memoryStorage() });
    const account = createAccount({ client, gate: createSessionGate(client), blocked: () => tradeBlocked, onUserChanged: (v) => void changes.push(v.signedIn ? `in:${v.username ?? v.displayName}` : "out") });
    return { account, client };
  };
  const a = make(), b = make(), c = make();
  const name = `t${randomBytes(5).toString("hex")}`; // 시험마다 새 아이디
  const pw = "correct-horse-8";

  // 중복검사
  assert.equal(await a.account.checkUsername(name), "available", "새 아이디");
  assert.equal(await a.account.checkUsername("admin"), "taken", "예약 아이디는 쓸 수 없다");
  assert.equal(await a.account.checkUsername("x"), "invalid", "규칙 밖은 서버에 묻지 않는다");
  process.stdout.write("(2) 입력 중 중복검사·예약 아이디  ok\n");

  // 가입 — 바로 로그인된다
  const up = await a.account.signUp(name.toUpperCase(), " 지우 ", pw);
  assert.ok(up.ok, JSON.stringify(up));
  assert.deepEqual(up.view, { signedIn: true, anonymous: false, method: "password", username: name, displayName: "지우" });
  assert.equal("handoff" in up, false, "훅이 없으면 이관 결과도 없다");
  assert.equal(await b.account.checkUsername(name), "taken", "가입 뒤에는 이미 쓰는 아이디");
  assert.deepEqual(await b.account.signUp(name, "다른 사람", pw), { ok: false, code: "AUTH_USERNAME_TAKEN" });
  assert.deepEqual(await b.account.signUp("admin", "관리자", pw), { ok: false, code: "AUTH_USERNAME_TAKEN" }, "예약 아이디 가입");
  assert.deepEqual(await b.account.signUp(`${name}x`, "지우", "short"), { ok: false, code: "AUTH_PASSWORD_WEAK" });
  process.stdout.write("(3) 가입·이미 쓰는 아이디·예약·짧은 비밀번호  ok\n");

  // 동시 가입 — 하나만 된다
  const race = `r${randomBytes(5).toString("hex")}`;
  const [r1, r2] = await Promise.all([b.account.signUp(race, "하나", pw), c.account.signUp(race, "둘", pw)]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1, `동시 가입: ${JSON.stringify([r1, r2])}`);
  const lost = [r1, r2].find((r) => !r.ok);
  assert.equal(lost && !lost.ok && lost.code, "AUTH_USERNAME_TAKEN", "진 쪽은 이미 쓰는 아이디");
  process.stdout.write("(4) 동시 가입은 하나만  ok\n");

  // 다른 PC 로그인, 틀린 비밀번호
  const d = make();
  assert.deepEqual(await d.account.signIn(name, "wrong-password"), { ok: false, code: "AUTH_INVALID_LOGIN" });
  assert.deepEqual(await d.account.signIn("없는아이디", pw), { ok: false, code: "AUTH_INVALID_LOGIN" });
  const inD = await d.account.signIn(name, pw);
  assert.ok(inD.ok && inD.view.displayName === "지우", JSON.stringify(inD));
  process.stdout.write("(5) 다른 PC 로그인·틀린 비밀번호  ok\n");

  // 이름 바꾸기 — 다른 PC 에서도 보인다
  assert.deepEqual(await a.account.rename("가".repeat(13)), { ok: false, code: "AUTH_NAME_INVALID" });
  const renamed = await a.account.rename("지우2");
  assert.ok(renamed.ok && renamed.view.displayName === "지우2");
  assert.equal((await d.account.view()).displayName, "지우2", "다른 PC 에서 바뀐 이름");
  process.stdout.write("(6) 이름 바꾸기가 다른 PC 에 보인다  ok\n");

  // 교환 중이면 막힌다
  tradeBlocked = true;
  assert.deepEqual(await d.account.signOut(), { ok: false, code: "AUTH_TRADE_ACTIVE" });
  assert.deepEqual(await c.account.signIn(name, pw), { ok: false, code: "AUTH_TRADE_ACTIVE" });
  tradeBlocked = false;
  process.stdout.write("(7) 걸린 교환이 있으면 로그인·로그아웃 막힘  ok\n");

  // 교환 상대의 이름 — 로그인한 두 사람이 채널을 열면 get_channel 이 이름을 준다
  const hostNet = createTradeNet({ client: a.client });
  const guest = make();
  const gName = `g${randomBytes(5).toString("hex")}`;
  assert.ok((await guest.account.signUp(gName, "웅이", pw)).ok);
  const guestNet = createTradeNet({ client: guest.client });
  const protocol = onlineConfig().protocol; // 서버 규약(P2 는 2) — 규약 1 은 TRADE_VERSION_MISMATCH
  const made = await hostNet.createChannel(protocol, dataVersion());
  assert.ok(made.ok, JSON.stringify(made));
  const joined = made.ok ? await guestNet.joinChannel(made.data.token, protocol, dataVersion()) : null;
  assert.ok(joined?.ok, JSON.stringify(joined));
  const seen = made.ok ? await hostNet.getChannel(made.data.channelId) : null;
  assert.equal(seen?.ok && seen.data.friend_name, "웅이", "호스트가 친구 이름을 본다");
  if (made.ok) await hostNet.cancelChannel(made.data.channelId);
  process.stdout.write("(8) 로그인한 계정의 교환 — 상대 이름  ok\n");

  // 로그아웃 — 이 PC 만. 다음 교환은 새 익명 계정으로
  const out = await d.account.signOut();
  assert.ok(out.ok && !out.view.signedIn);
  assert.equal((await a.account.view()).signedIn, true, "다른 PC 는 그대로");
  const dNet = createTradeNet({ client: d.client });
  const anon = await dNet.ensureSession();
  assert.ok(anon.ok && anon.data.anonymous, "로그아웃 뒤 교환은 익명");
  assert.ok(changes.includes(`in:${name}`) && changes.includes("out"), `사용자 바뀜 알림: ${changes.join(",")}`);
  process.stdout.write("(9) 로그아웃은 이 PC 만, 이후 교환은 익명  ok\n");

  await hooks(url, key);

  // 계정 삭제 — Edge Function delete-account. 로컬에서 `npx supabase functions serve` 가 떠 있을 때만 본다
  const probe = await fetch(`${url}/functions/v1/delete-account`, { method: "POST" }).then((r) => r.status, () => 0);
  if (probe === 404 || probe === 0) {
    process.stdout.write("(10) 계정 삭제  건너뜀 — 로컬 함수 서버가 없다(npx supabase functions serve)\n");
    return;
  }
  const open = await hostNet.createChannel(protocol, dataVersion());
  assert.ok(open.ok);
  assert.deepEqual(await a.account.deleteAccount(), { ok: false, code: "AUTH_TRADE_ACTIVE" }, "열린 교환이 있으면 서버가 거절");
  if (open.ok) await hostNet.cancelChannel(open.data.channelId);
  const gone = await a.account.deleteAccount();
  assert.ok(gone.ok && !gone.view.signedIn, JSON.stringify(gone));
  assert.deepEqual(await make().account.signIn(name, pw), { ok: false, code: "AUTH_INVALID_LOGIN" }, "지운 계정으로는 로그인할 수 없다");
  assert.equal(await b.account.checkUsername(name), "available", "지운 아이디는 다시 쓸 수 있다");
  process.stdout.write("(10) 계정 삭제 — 교환 중 거절, 삭제 뒤 로그인 불가·아이디 재사용  ok\n");
}

// 익명 userId·anonymous, 세션 교체 훅 — 이관 결과가 AccountResult 와 onUserChanged 로 온다. before 실패는 로그인 중단
async function hooks(url: string, key: string): Promise<void> {
  const pw = "correct-horse-8";
  // 이관 훅 — 실제 RPC. 익명 세션에 서버 저장이 없으면 empty
  {
    const client = createOnlineClient({ url, key, storage: memoryStorage() });
    const gate = createSessionGate(client);
    const seen: (HandoffReport | undefined)[] = [];
    const account = createAccount({ client, gate, blocked: () => false, switchHooks: handoffHooks(client), onUserChanged: (_v, h) => void seen.push(h) });
    const r = await gate.ensure();
    assert.ok(r.ok && r.user.is_anonymous);
    const anon = r.ok ? r.user.id : "";
    assert.equal(await account.userId(), anon, "익명도 userId 를 돌려준다");
    const v = await account.view();
    assert.ok(v.anonymous && !v.signedIn, "익명 보기");
    const up = await account.signUp(`e${randomBytes(5).toString("hex")}`, "이엠티", pw);
    assert.ok(up.ok, JSON.stringify(up));
    assert.deepEqual(up.ok && up.handoff, { kind: "adopted", anon, outcome: "empty", rev: 0 }, "서버 저장이 없으면 empty");
    assert.deepEqual(seen, [up.ok ? up.handoff : null], "onUserChanged 두 번째 인자로도 온다");
    const member = await account.userId();
    assert.ok(member && member !== anon && !(await account.view()).anonymous);
    // 정식 계정에서 다른 계정으로 로그인 — 익명이 아니니 이관하지 않는다
    const other = `o${randomBytes(5).toString("hex")}`;
    const b = createOnlineClient({ url, key, storage: memoryStorage() });
    assert.ok((await createAccount({ client: b, gate: createSessionGate(b), blocked: () => false }).signUp(other, "다른", pw)).ok);
    const inOther = await account.signIn(other, pw);
    assert.ok(inOther.ok && inOther.handoff?.kind === "none", JSON.stringify(inOther));
    process.stdout.write("(11) 익명 userId·anonymous, 이관 훅 empty·none, onUserChanged 로 전달  ok\n");
  }
  // before 실패 — 세션을 바꾸지 않는다. after 는 교체한 새 사용자를 받는다
  {
    const client = createOnlineClient({ url, key, storage: memoryStorage() });
    const gate = createSessionGate(client);
    const calls: string[] = [];
    let failBefore = true;
    const fake: SwitchHooks = {
      before: async (cur) => {
        calls.push(`before:${cur?.is_anonymous ? "anon" : "none"}`);
        return failBefore ? { ok: false, code: "NETWORK" } : { ok: true, handoff: { ticket: "t", anon: cur?.id ?? "", expiresAt: Date.now() + 60_000 } };
      },
      after: async (h, next) => {
        calls.push(`after:${h?.ticket}:${next?.is_anonymous === false ? "member" : "?"}`);
        return h ? { kind: "pending", handoff: h, code: "NETWORK" } : { kind: "none" };
      },
    };
    const account = createAccount({ client, gate, blocked: () => false, switchHooks: fake });
    const anon = await gate.ensure();
    assert.ok(anon.ok);
    const name = `f${randomBytes(5).toString("hex")}`;
    assert.deepEqual(await account.signUp(name, "에프", pw), { ok: false, code: "NETWORK" }, "before 실패면 가입하지 않는다");
    assert.equal(await account.checkUsername(name), "available", "계정이 만들어지지 않았다");
    assert.equal(await account.userId(), anon.ok ? anon.user.id : "", "세션은 익명 그대로");
    failBefore = false;
    const up = await account.signUp(name, "에프", pw);
    assert.ok(up.ok && up.handoff?.kind === "pending", JSON.stringify(up));
    assert.deepEqual(calls, ["before:anon", "before:anon", "after:t:member"]);
    assert.deepEqual(await account.signIn(name, "wrong-password"), { ok: false, code: "AUTH_INVALID_LOGIN" });
    assert.equal(calls.at(-1), "before:none", "틀린 비밀번호면 after 를 부르지 않는다");
    process.stdout.write("(12) before 실패는 로그인 중단, after 는 성공한 교체 뒤에만  ok\n");
  }
}

async function main(): Promise<void> {
  rules();
  const cfg = local();
  if (!cfg) {
    process.stdout.write("selftest-account: 로컬 Supabase 가 없어 서버 부분을 건너뜀\n");
    return;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");
  await server(cfg.url, cfg.key);
  process.stdout.write("selftest-account: 통과 (규칙·중복검사·가입·동시 가입·로그인·이름·막힘·상대 이름·로그아웃·익명·이관 훅)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
