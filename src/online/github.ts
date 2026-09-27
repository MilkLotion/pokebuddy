// GitHub 로그인 — 데스크톱 PKCE. 설계는 docs/work/trade/record.md "GitHub 로그인"
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

// 브라우저에 보이는 마지막 쪽 — 외부 자원 없이 글자만
const page = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>pokebuddy</title></head>` +
  `<body style="font-family:system-ui,'Malgun Gothic',sans-serif;padding:40px;color:#1a3330"><h1 style="font-size:20px">${title}</h1><p>${body}</p></body></html>`;

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
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // 브라우저가 이 주소로 돌아온 요청만 받는다 — 다른 이름(DNS 재바인딩 등)으로 온 요청은 로그인을 끝내지 못한다(R3-11)
    if (url.pathname !== "/auth/callback" || req.headers.host !== `127.0.0.1:${bound}`) {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(code ? page("로그인했어요", "pokebuddy 로 돌아가세요. 이 창은 닫아도 돼요.") : page("로그인하지 못했어요", "pokebuddy 에서 다시 시도해 주세요."));
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
    return { ok: true, view: viewOf(exchanged.data.user) };
  } catch (e) {
    return { ok: false, ...authCodeOf({ message: e instanceof Error ? e.message : String(e) }) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.close();
  }
}
