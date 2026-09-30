// GitHub 로그인 확인 — 실제 GitHub 없이 가짜 클라이언트로 임시 서버·포트 고르기·코드 교환·취소·막힘을 본다
//   npm run build && node dist/tools/selftest-github.js
// 실제 GitHub 화면과 Supabase 리디렉션 허용 목록은 사용자 실기로 본다 (worklog/records/trade/record.md "로그인·클라우드 저장 구현 계획")
// P2(design-p2.md 2절): 세션 교체 훅 — 익명이면 교환 전에 티켓, 교환 뒤 이관. before 실패면 교환하지 않는다
import assert from "node:assert";
import http from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_LINK, callbackPage, callbackUrl, githubLogin, type GithubLoginOptions } from "../online/github";
import { createSessionGate } from "../online/session";
import type { SwitchHooks } from "../online/handoff";

// 시험마다 그 클라이언트의 세션 관문을 붙인다
const login = (o: Omit<GithubLoginOptions, "gate">): ReturnType<typeof githubLogin> => githubLogin({ ...o, gate: createSessionGate(o.client) });

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 가짜 인증 — 로그인 주소에 redirectTo 를 담아 돌려주고, 코드 교환을 기록한다
//   anon 을 주면 교환 전 세션이 그 익명 사용자다(교환하면 정식 계정으로 바뀐다)
function fakeClient(exchanged: string[], anon?: string): SupabaseClient {
  let session: { user: { id: string; is_anonymous: boolean } } | null = anon ? { user: { id: anon, is_anonymous: true } } : null;
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOAuth: async ({ options }: { options: { redirectTo: string } }) => ({ data: { url: `https://github.invalid/login?redirect=${encodeURIComponent(options.redirectTo)}` }, error: null }),
      exchangeCodeForSession: async (code: string) => {
        exchanged.push(code);
        const user = { id: "u1", is_anonymous: false, email: "someone@users.noreply.github.com", user_metadata: { user_name: "octo", full_name: "옥토" } };
        session = { user };
        return { data: { user }, error: null };
      },
    },
  } as unknown as SupabaseClient;
}

// 브라우저 흉내 — 로그인 주소의 redirect 로 돌아간다
const browser = (query: string) => async (url: string): Promise<void> => {
  const back = new URL(decodeURIComponent(new URL(url).searchParams.get("redirect") ?? ""));
  setTimeout(() => void fetch(`${back.origin}${back.pathname}${query}`).catch(() => undefined), 20);
};

async function main(): Promise<void> {
  const ports = [54391, 54392, 54393];
  // (1) 돌아온 코드를 세션으로 바꾼다
  const exchanged: string[] = [];
  const ok = await login({ client: fakeClient(exchanged), openExternal: browser("?code=abc123"), blocked: () => false, ports });
  assert.deepEqual(ok, { ok: true, view: { signedIn: true, anonymous: false, method: "github", username: null, displayName: "옥토" } });
  assert.deepEqual(exchanged, ["abc123"]);
  process.stdout.write("(1) 브라우저에서 돌아온 코드로 로그인  ok\n");

  // (2) 첫 포트가 쓰이고 있으면 다음 포트
  const busy = http.createServer();
  await new Promise<void>((r) => busy.listen(ports[0], "127.0.0.1", r));
  let used = "";
  const second = await login({
    client: fakeClient([]), blocked: () => false, ports,
    openExternal: async (url) => {
      used = decodeURIComponent(new URL(url).searchParams.get("redirect") ?? "");
      await browser("?code=x")(url);
    },
  });
  assert.ok(second.ok);
  assert.equal(used, callbackUrl(ports[1]!), "다음 포트");
  process.stdout.write("(2) 쓰이는 포트는 건너뛴다  ok\n");

  // (3) 세 포트가 모두 쓰이면 거절
  const more = await Promise.all(ports.slice(1).map((p) => new Promise<http.Server>((r) => { const s = http.createServer(); s.listen(p, "127.0.0.1", () => r(s)); })));
  assert.deepEqual(await login({ client: fakeClient([]), openExternal: () => undefined, blocked: () => false, ports }), { ok: false, code: "AUTH_PORT_BUSY" });
  for (const s of [busy, ...more]) s.close();
  process.stdout.write("(3) 포트가 모두 쓰이면 AUTH_PORT_BUSY  ok\n");

  // (4) 코드 없이 돌아오거나 시간이 지나면 취소
  assert.deepEqual(await login({ client: fakeClient([]), openExternal: browser("?error=access_denied"), blocked: () => false, ports }), { ok: false, code: "AUTH_CANCELLED" });
  assert.deepEqual(await login({ client: fakeClient([]), openExternal: () => undefined, blocked: () => false, ports, timeoutMs: 100 }), { ok: false, code: "AUTH_CANCELLED" });
  process.stdout.write("(4) 거절·시간 초과는 취소  ok\n");

  // (5) 교환이 걸려 있으면 시작하지 않는다
  const none: string[] = [];
  assert.deepEqual(await login({ client: fakeClient(none), openExternal: browser("?code=y"), blocked: () => true, ports }), { ok: false, code: "AUTH_TRADE_ACTIVE" });
  assert.equal(none.length, 0);
  process.stdout.write("(5) 걸린 교환이 있으면 막힘  ok\n");

  // (5-1) 기다리다 취소 — 5분을 기다리지 않는다
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 50);
  assert.deepEqual(await login({ client: fakeClient([]), openExternal: () => undefined, blocked: () => false, ports, signal: abort.signal }), { ok: false, code: "AUTH_CANCELLED" });
  process.stdout.write("(5-1) 기다리다 취소  ok\n");

  // (5-2) 다른 이름(Host)으로 온 요청은 로그인을 끝내지 못한다
  const hosts: string[] = [];
  const hostTest = await login({
    client: fakeClient(hosts), blocked: () => false, ports,
    openExternal: async (url) => {
      const back = new URL(decodeURIComponent(new URL(url).searchParams.get("redirect") ?? ""));
      const port = Number(back.port);
      // 다른 이름으로 먼저 온다 — 무시돼야 한다
      await new Promise<void>((r) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/auth/callback?code=evil", headers: { Host: `evil.example:${port}` } }, (res) => { res.resume(); res.on("end", () => r()); });
        req.on("error", () => r());
        req.end();
      });
      await browser("?code=good")(url);
    },
  });
  assert.ok(hostTest.ok);
  assert.deepEqual(hosts, ["good"], "다른 Host 의 코드는 쓰지 않는다");
  process.stdout.write("(5-2) 다른 Host 로 온 콜백은 무시  ok\n");

  // (5-3) 브라우저 쪽 — 세션으로 바꾼 결과를 보고 답한다. 성공이면 앱 링크를 곧바로 연다(브라우저의 "pokebuddy 열기" 알림)
  const ok1 = callbackPage(true), bad1 = callbackPage(false);
  assert.ok(ok1.includes("로그인했어요") && ok1.includes(`href="${APP_LINK}"`) && ok1.includes(`location.href = "${APP_LINK}"`), "성공 쪽은 앱 링크를 연다");
  assert.ok(bad1.includes("로그인하지 못했어요") && !bad1.includes("location.href"), "실패 쪽은 자동으로 열지 않는다");
  let seen = "";
  const failing = {
    auth: {
      signInWithOAuth: async ({ options }: { options: { redirectTo: string } }) => ({ data: { url: `https://github.invalid/login?redirect=${encodeURIComponent(options.redirectTo)}` }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: null }, error: { message: "invalid flow state" } }),
    },
  } as unknown as SupabaseClient;
  const failed = await login({
    client: failing, blocked: () => false, ports,
    openExternal: (url) => {
      const back = new URL(decodeURIComponent(new URL(url).searchParams.get("redirect") ?? ""));
      setTimeout(() => void fetch(`${back.origin}${back.pathname}?code=z`).then((r) => r.text()).then((t) => { seen = t; }), 20);
    },
  });
  assert.equal(failed.ok, false);
  await sleepMs(100);
  assert.ok(seen.includes("로그인하지 못했어요"), "코드를 받았어도 세션으로 못 바꾸면 실패 쪽을 보인다");
  process.stdout.write("(5-3) 브라우저 쪽 — 결과를 보고 답하고, 성공이면 앱 링크를 연다  ok\n");

  // (5-4) 세션 교체 훅 — 익명이면 교환 전에 before(티켓), 교환 뒤 after(이관). 결과는 handoff 로 돌려준다
  {
    const order: string[] = [];
    const hooks = (failBefore: boolean): SwitchHooks => ({
      before: async (cur) => {
        order.push(`before:${cur?.id ?? "none"}:${cur?.is_anonymous ? "anon" : "-"}`);
        return failBefore ? { ok: false, code: "NETWORK" } : { ok: true, handoff: cur?.is_anonymous ? { ticket: "tk", anon: cur.id, expiresAt: Date.now() + 60_000 } : null };
      },
      after: async (h, next) => {
        order.push(`after:${h?.ticket ?? "-"}:${next?.id}`);
        return h ? { kind: "adopted", anon: h.anon, outcome: "moved", rev: 3 } : { kind: "none" };
      },
    });
    const ex: string[] = [];
    const client = fakeClient(ex, "anon-9");
    const moved = await githubLogin({ client, gate: createSessionGate(client), openExternal: browser("?code=h1"), blocked: () => false, ports, switchHooks: hooks(false) });
    assert.deepEqual(moved, { ok: true, view: { signedIn: true, anonymous: false, method: "github", username: null, displayName: "옥토" }, handoff: { kind: "adopted", anon: "anon-9", outcome: "moved", rev: 3 } });
    assert.deepEqual(order, ["before:anon-9:anon", "after:tk:u1"], "티켓은 교환 전, 이관은 교환 뒤");
    assert.deepEqual(ex, ["h1"]);
    order.length = 0;
    const ex2: string[] = [];
    const c2 = fakeClient(ex2, "anon-10");
    const stopped = await githubLogin({ client: c2, gate: createSessionGate(c2), openExternal: browser("?code=h2"), blocked: () => false, ports, switchHooks: hooks(true) });
    assert.deepEqual(stopped, { ok: false, code: "NETWORK" }, "before 실패면 로그인 중단");
    assert.deepEqual(ex2, [], "교환하지 않았다 — 익명 세션 그대로");
    assert.deepEqual(order, ["before:anon-10:anon"]);
    process.stdout.write("(5-4) 교환 전 티켓·교환 뒤 이관, before 실패면 교환 안 함  ok\n");
  }

  // (6) 끝나면 포트를 닫는다 — 같은 포트로 다시 열 수 있다
  const again = http.createServer();
  await new Promise<void>((resolve, reject) => { again.once("error", reject); again.listen(ports[0], "127.0.0.1", () => resolve()); });
  again.close();
  process.stdout.write("(6) 끝나면 임시 서버를 닫는다  ok\n");
  process.stdout.write("selftest-github: 통과 (코드 교환·포트 고르기·포트 없음·취소·막힘·교체 훅·닫기)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
