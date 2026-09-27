// GitHub 로그인 — 데스크톱 PKCE. 설계는 worklog/records/trade/record.md "GitHub 로그인"
//
// Electron 을 모른다. 브라우저 열기(openExternal)를 받는다.
//   1. 127.0.0.1 의 고정 포트(세 개 중 빈 것)에 임시 HTTP 서버를 연다
//   2. signInWithOAuth(skipBrowserRedirect)로 로그인 주소를 받아 기본 브라우저로 연다
//   3. 브라우저가 http://127.0.0.1:<포트>/auth/callback?code=… 로 돌아오면 코드를 세션으로 바꾼다
//   4. 서버를 닫는다. 5분 안에 돌아오지 않으면 취소로 본다
// 세 주소는 Supabase 의 Redirect URLs 에 넣어 둬야 한다(사용자 설정). pokebuddy:// 딥링크는 쓰지 않는다 — 가로채기에 강하고 개발 실행에서도 된다
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authCodeOf, viewOf, type AccountResult } from "./account.js";

// 로컬 Supabase 기본 포트(54321~54324)와 겹치지 않는다
export const GITHUB_PORTS = [54380, 54381, 54382] as const;
export const callbackUrl = (port: number): string => `http://127.0.0.1:${port}/auth/callback`;

export interface GithubLoginOptions {
  client: SupabaseClient;
  openExternal: (url: string) => void | Promise<void>;
  blocked: () => boolean; // 걸린 교환이 있으면 세션을 바꾸지 않는다
  ports?: readonly number[];
  timeoutMs?: number;
  signal?: AbortSignal; // 사용자가 기다리다 취소했다
}

// 앱으로 돌아가는 딥링크 — 설치본이 pokebuddy:// 를 등록한다. 앱은 관리 창의 계정 탭을 연다 (src/main/app.ts)
export const APP_LINK = "pokebuddy://account";

// 브라우저에 보이는 마지막 쪽 — 교환 링크 페이지(site/trade)와 같은 색·카드. 외부 자원 없이 이 문자열만 쓴다.
// 성공하면 곧바로 앱 링크를 연다 — 브라우저가 "pokebuddy 열기" 알림을 띄운다. 알림을 닫았으면 단추로 다시 연다
// 문구는 고정 문자열이다. 요청에서 온 값은 넣지 않는다
export function callbackPage(ok: boolean): string {
  const title = ok ? "로그인했어요" : "로그인하지 못했어요";
  const body = ok ? "" : "pokebuddy 의 설정 → 계정 탭에서 다시 시도해 주세요."; // 성공 쪽은 설명 없이 제목과 단추만
  const note = ok ? "브라우저가 pokebuddy 를 열지 물으면 열기를 눌러 주세요. 이 창은 닫아도 돼요." : "이 창은 닫아도 돼요.";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>pokebuddy — ${title}</title>
<style>
  :root { --bg: #f1f2ee; --surface: #ffffff; --line: #dde1db; --ink: #1a3330; --muted: #4a6663; --primary: #0f766e; --primary-ink: #ffffff; --ok: #10b981; --bad: #dc2626; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141c1b; --surface: #1d2927; --line: #2f3d3b; --ink: #e6eeec; --muted: #9fb3b0; --primary: #2aa593; --primary-ink: #0b1413; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink);
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
  main { width: 100%; max-width: 460px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 32px 28px;
    display: flex; flex-direction: column; gap: 14px; }
  .brand { color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
  h1 { margin: 0; font-size: 22px; display: flex; align-items: center; gap: 10px; }
  h1 i { flex: none; width: 10px; height: 10px; border-radius: 50%; background: ${ok ? "var(--ok)" : "var(--bad)"}; }
  p { margin: 0; color: var(--muted); }
  .open { display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 20px; border-radius: 8px;
    background: var(--primary); color: var(--primary-ink); font-weight: 700; text-decoration: none; align-self: flex-start; }
  .note { font-size: 13px; }
</style>
</head>
<body>
<main>
  <div class="brand">pokebuddy</div>
  <h1><i></i>${title}</h1>
${body ? `  <p>${body}</p>
` : ""}  <a class="open" href="${APP_LINK}">pokebuddy 열기</a>
  <p class="note">${note}</p>
</main>
${ok ? `<script>setTimeout(function () { location.href = "${APP_LINK}"; }, 400);</script>` : ""}
</body>
</html>`;
}

// 빈 포트에 서버를 연다. 모두 쓰이고 있으면 null
async function listen(server: http.Server, ports: readonly number[]): Promise<number | null> {
  for (const port of ports) {
    const ok = await new Promise<boolean>((resolve) => {
      const fail = (): void => resolve(false);
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", fail);
        resolve(true);
      });
    });
    if (ok) return (server.address() as AddressInfo).port;
  }
  return null;
}

// 로그인 결과 — 성공이면 로그인한 계정 보기. 취소·시간 초과는 AUTH_CANCELLED(화면은 조용히 로그인 화면으로)
export type GithubResult = AccountResult | { ok: false; code: "AUTH_CANCELLED" | "AUTH_PORT_BUSY" };

export async function githubLogin({ client, openExternal, blocked, ports = GITHUB_PORTS, timeoutMs = 5 * 60_000, signal }: GithubLoginOptions): Promise<GithubResult> {
  if (blocked()) return { ok: false, code: "AUTH_TRADE_ACTIVE" };
  let settle: (code: string | null) => void = () => undefined;
  const got = new Promise<string | null>((resolve) => { settle = resolve; });
  let bound = 0;
  let waiting: http.ServerResponse | null = null; // 코드를 받은 브라우저 — 세션으로 바꾼 결과를 보고 답한다
  const answer = (ok: boolean): void => {
    if (!waiting) return;
    waiting.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    waiting.end(callbackPage(ok));
    waiting = null;
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // 브라우저가 이 주소로 돌아온 요청만 받는다 — 다른 이름(DNS 재바인딩 등)으로 온 요청은 로그인을 끝내지 못한다(R3-11)
    if (url.pathname !== "/auth/callback" || req.headers.host !== `127.0.0.1:${bound}`) {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    if (!code || waiting) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage(false));
      if (!code) settle(null);
      return;
    }
    waiting = res; // 성공 쪽은 세션으로 바꾼 뒤에 보인다 — 코드만 받고 로그인에 실패할 수 있다
    settle(code);
  });
  const port = await listen(server, ports);
  if (port == null) return { ok: false, code: "AUTH_PORT_BUSY" };
  bound = port;
  const timer = setTimeout(() => settle(null), timeoutMs);
  const abort = (): void => settle(null);
  signal?.addEventListener("abort", abort);
  try {
    const { data, error } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: callbackUrl(port), skipBrowserRedirect: true } });
    if (error || !data.url) return { ok: false, ...authCodeOf(error) };
    await openExternal(data.url);
    const code = await got;
    if (!code) return { ok: false, code: "AUTH_CANCELLED" };
    if (blocked()) return { ok: false, code: "AUTH_TRADE_ACTIVE" }; // 기다리는 동안 교환을 시작했다
    const exchanged = await client.auth.exchangeCodeForSession(code);
    if (exchanged.error) return { ok: false, ...authCodeOf(exchanged.error) };
    answer(true);
    return { ok: true, view: viewOf(exchanged.data.user) };
  } catch (e) {
    return { ok: false, ...authCodeOf({ message: e instanceof Error ? e.message : String(e) }) };
  } finally {
    answer(false); // 성공으로 답하지 못했으면 실패 쪽을 보인다
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.close();
  }
}
