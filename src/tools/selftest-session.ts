// 세션 관문 확인 — 가짜 클라이언트로 익명 발급 한 번·세션 교체 직렬화·교착 없음·오류 코드를 본다 (네트워크 없음)
//   npm run build && node dist/tools/selftest-session.js
// 설계는 worklog-mac/records/cloud-authority/design-p1.md 4절, 7절 시험 13번 · design-p2.md 2절(부팅 판단 probe)
import assert from "node:assert";
import { AuthApiError, AuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createSessionGate, sessionCodeOf } from "../online/session";
import { createTradeNet } from "../trade/net";

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Fake {
  client: SupabaseClient;
  anonCount: () => number;
  log: string[];
  setUser: (user: User | null) => void;
  setSessionError: (error: unknown) => void; // 세션 없음과 함께 돌려줄 getSession 오류(갱신 실패 흉내)
}

// 가짜 인증 — 익명 발급은 지연을 두고 세션을 채운다. 몇 번 발급했는지 센다
function fakeClient(opts: { delayMs?: number; failWith?: { message: string; status?: number } } = {}): Fake {
  let session: { user: User } | null = null;
  let sessionError: unknown = null;
  let anon = 0;
  const log: string[] = [];
  const client = {
    auth: {
      getSession: async () => (session ? { data: { session }, error: null } : { data: { session: null }, error: sessionError }),
      signInAnonymously: async () => {
        anon += 1;
        log.push("anon");
        await sleepMs(opts.delayMs ?? 20);
        if (opts.failWith) return { data: { user: null, session: null }, error: opts.failWith };
        const user = { id: `anon-${anon}`, is_anonymous: true } as User;
        session = { user };
        return { data: { user, session }, error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { client, anonCount: () => anon, log, setUser: (user) => { session = user ? { user } : null; }, setSessionError: (e) => { sessionError = e; } };
}

// 시간 안에 끝나지 않으면 교착으로 본다
const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, sleepMs(ms).then(() => { throw new Error(`${what} — ${ms}ms 안에 끝나지 않았다(교착)`); })]);

async function main(): Promise<void> {
  // (1) 동시 ensure 다섯 번 — 익명 계정은 하나
  {
    const f = fakeClient();
    const gate = createSessionGate(f.client);
    const all = await Promise.all([gate.ensure(), gate.ensure(), gate.ensure(), gate.ensure(), gate.ensure()]);
    assert.equal(f.anonCount(), 1, "익명 발급 한 번");
    for (const r of all) assert.ok(r.ok && r.user.id === "anon-1", JSON.stringify(r));
    // 끝난 뒤 다시 불러도 세션이 있어 발급하지 않는다
    const again = await gate.ensure();
    assert.ok(again.ok && again.user.id === "anon-1");
    assert.equal(f.anonCount(), 1);
    assert.equal((await gate.current())?.id, "anon-1");
    process.stdout.write("(1) 동시 ensure 는 익명 계정 하나만 만든다  ok\n");
  }

  // (2) 교환(TradeNet)과 계정 쪽이 같은 관문을 쓰면 동시에 불려도 익명 계정 하나
  {
    const f = fakeClient();
    const gate = createSessionGate(f.client);
    const net = createTradeNet({ client: f.client, gate });
    const [a, b, c] = await Promise.all([net.ensureSession(), gate.ensure(), net.ensureSession()]);
    assert.equal(f.anonCount(), 1, "교환·계정 합쳐 발급 한 번");
    assert.ok(a.ok && b.ok && c.ok);
    assert.deepEqual(a.ok && a.data, { userId: "anon-1", anonymous: true });
    process.stdout.write("(2) 교환·계정이 관문을 나눠 쓰면 익명 계정 하나  ok\n");
  }

  // (3) exclusive 는 먼저 시작한 ensure 뒤에, 그 뒤의 ensure 는 exclusive 뒤에 돈다
  {
    const f = fakeClient({ delayMs: 30 });
    const gate = createSessionGate(f.client);
    const first = gate.ensure(); // 익명 발급 중
    const login = gate.exclusive(async () => {
      f.log.push("login-start");
      await sleepMs(30);
      f.setUser({ id: "member", is_anonymous: false } as User); // 비밀번호 로그인으로 세션을 바꿨다
      f.log.push("login-end");
      return "done";
    });
    const later = gate.ensure(); // 로그인 중에 교환이 세션을 찾는다 — 로그인이 끝나길 기다려 정식 계정을 본다
    assert.equal(await within(login, 1_000, "exclusive"), "done");
    const [r1, r2] = await Promise.all([first, later]);
    assert.deepEqual(f.log, ["anon", "login-start", "login-end"], "순서");
    assert.ok(r1.ok && r1.user.id === "anon-1");
    assert.ok(r2.ok && r2.user.id === "member", "로그인 뒤 ensure 는 새 익명을 만들지 않는다");
    assert.equal(f.anonCount(), 1);
    process.stdout.write("(3) ensure → exclusive → ensure 순서, 로그인 중 익명 발급 없음  ok\n");
  }

  // (4) exclusive 안의 scope.ensure 는 잠금을 기다리지 않는다 — 교착 없음. exclusive 끼리는 차례로
  {
    const f = fakeClient();
    const gate = createSessionGate(f.client);
    const order: string[] = [];
    const a = gate.exclusive(async (scope) => {
      order.push("a-start");
      const [s1, s2] = await Promise.all([scope.ensure(), scope.ensure()]);
      assert.ok(s1.ok && s2.ok);
      await sleepMs(10);
      order.push("a-end");
    });
    const b = gate.exclusive(async () => { order.push("b"); });
    await within(Promise.all([a, b]), 1_000, "scope.ensure");
    assert.deepEqual(order, ["a-start", "a-end", "b"]);
    assert.equal(f.anonCount(), 1, "잠금 안에서도 발급 한 번");
    process.stdout.write("(4) exclusive 안 scope.ensure 교착 없음, exclusive 직렬화  ok\n");
  }

  // (5) exclusive 가 실패해도 잠금이 풀린다
  {
    const f = fakeClient();
    const gate = createSessionGate(f.client);
    await assert.rejects(gate.exclusive(async () => { throw new Error("boom"); }), /boom/);
    const r = await within(gate.ensure(), 1_000, "실패 뒤 ensure");
    assert.ok(r.ok);
    process.stdout.write("(5) 실패한 exclusive 뒤에도 ensure 가 돈다  ok\n");
  }

  // (6) 오류 코드 — NETWORK / AUTH_RATE_LIMITED / UNKNOWN. 실패하면 진행 중 확인을 비워 다음 호출이 다시 시도한다
  {
    const net = fakeClient({ failWith: { message: "TypeError: fetch failed" } });
    const g1 = createSessionGate(net.client);
    assert.deepEqual(await g1.ensure(), { ok: false, code: "NETWORK" });
    await g1.ensure();
    assert.equal(net.anonCount(), 2, "실패는 나눠 쓰지 않고 다시 시도");
    const limited = fakeClient({ failWith: { message: "Request rate limit reached", status: 429 } });
    assert.deepEqual(await createSessionGate(limited.client).ensure(), { ok: false, code: "AUTH_RATE_LIMITED" });
    const tradeLimited = await createTradeNet({ client: limited.client }).ensureSession();
    assert.deepEqual(tradeLimited, { ok: false, code: "UNKNOWN", detail: "AUTH_RATE_LIMITED" });
    assert.deepEqual(sessionCodeOf({ message: "anonymous sign-ins are disabled" }), { code: "UNKNOWN", detail: "anonymous sign-ins are disabled" });
    assert.deepEqual(sessionCodeOf({ code: "invalid_credentials", message: "x" }), { code: "UNKNOWN", detail: "AUTH_INVALID_LOGIN" });
    process.stdout.write("(6) 오류 코드 NETWORK·AUTH_RATE_LIMITED·UNKNOWN  ok\n");
  }

  // (7) probe — 세션 있음·없음·모름. 갱신이 망 오류로 실패하면(저장소 세션은 남음) 모름이고, ensure 는 익명을 만들지 않는다
  {
    const f = fakeClient();
    const gate = createSessionGate(f.client);
    assert.deepEqual(await gate.probe(), { state: "none" }, "빈 저장소");
    f.setSessionError(new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found"));
    assert.deepEqual(await gate.probe(), { state: "none" }, "갱신 토큰 거절 — 세션이 지워졌다");
    f.setSessionError(new AuthRetryableFetchError("fetch failed", 0));
    assert.deepEqual(await gate.probe(), { state: "unknown", code: "NETWORK" }, "망 오류 — 모름");
    assert.deepEqual(await gate.ensure(), { ok: false, code: "NETWORK" }, "로그인 세션을 익명으로 덮지 않는다");
    assert.equal(f.anonCount(), 0);
    f.setSessionError(null);
    f.setUser({ id: "member", is_anonymous: false } as User);
    const p = await gate.probe();
    assert.ok(p.state === "present" && p.user.id === "member");
    process.stdout.write("(7) probe 있음·없음·모름, 망 오류면 ensure 가 익명을 만들지 않는다  ok\n");
  }

  process.stdout.write("selftest-session 모두 통과\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
