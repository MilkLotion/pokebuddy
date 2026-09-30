// 클라우드 저장 올리기 — 서버 검증 P4a. 설계는 worklog/records/cloud-authority/record.md "P4 서버 검증"
//
// 앱은 upload_save RPC 대신 이 함수를 부른다(src/online/cloud.ts). 순서:
//   1. Authorization 의 사용자 토큰으로 본인을 확인한다. 익명 계정도 올린다(P2)
//   2. save_verify_context 로 직전 서버 저장·rev·서버 시각 기준 틈·받은 편지·끝난 교환·검증 설정을 읽는다
//   3. 같은 rev 위의 요청이면 규칙(../_shared/save-rules.ts)으로 비교한다. 틈은 72시간(verify_max_gap_hours)으로 자른다.
//      rev 가 다르면 비교하지 않는다 — 멱등 재전송(op 가 마지막 op)만 DB 로 넘기고, 나머지는 CLOUD_REV_CONFLICT.
//      DB 는 비교에 쓴 rev(p_checked_rev)가 지금 rev 와 같을 때만 쓴다 — 비교를 건너뛴 요청은 쓰지 못한다(검수 P4a C1)
//   4. 거부 모드(enforce)이고 위반이 있으면 적고 CLOUD_SAVE_REJECTED. 아니면 accept_save — rev CAS·활성 기기·교환 원장은 DB 가 본다
// 오류는 { error } 와 HTTP 상태로 돌려준다
//   CLOUD_*        DB·검증이 낸 코드 그대로. 앱이 코드별로 처리한다
//   AUTH_TOKEN     401 — 토큰이 무효·만료. 앱은 계정 분실로 보지 않는다(검수 P4a H3). 계정이 없을 때만 CLOUD_LOGIN_REQUIRED
//   SERVER_BUSY    503 — 인증·DB 가 잠깐 답하지 않는다. 앱은 다시 시도한다
//   SERVER_ERROR   500 — 그 밖. 앱은 오프라인으로 보지 않는다(검수 P4a M1)
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySave, type VerifyData, type Violation } from "../_shared/save-rules.ts";
import rulesData from "../_shared/verify-data.json" with { type: "json" };

const data = rulesData as unknown as VerifyData;
const MAX_BODY = 300_000; // 저장 상한(DB 256KB) + 여유 — 규칙을 돌리기 전에 자른다

const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const codeOf = (message: string): string | null => /(CLOUD_[A-Z_]+)/.exec(message)?.[1] ?? null;
const statusOf = (code: string): number =>
  code === "CLOUD_LOGIN_REQUIRED" ? 401 : code === "CLOUD_REV_CONFLICT" || code === "CLOUD_NOT_ACTIVE" || code === "CLOUD_SAVE_REJECTED" ? 409 : 400;
const fail = (code: string): Response => json({ error: code }, statusOf(code));
const serverError = (detail: string): Response => json({ error: "SERVER_ERROR", detail }, 500);

interface Body {
  device?: unknown;
  baseRev?: unknown;
  save?: unknown;
  saveV?: unknown;
  appVersion?: unknown;
  op?: unknown;
}

interface Context {
  found: boolean;
  rev: number | null;
  save: unknown;
  last_op: string | null;
  gap_ms: number | null;
  mode: string;
  margin: number;
  max_gap_ms: number;
  letters: Record<string, unknown[]> | null;
  trades: number | null;
  trades_before: string[] | null;
  seed: string | null; // 계정 시드(P4b) — 있으면 열린 알의 결과를 다시 계산해 대조한다
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_TOKEN" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return serverError("config");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: who, error: authError } = await admin.auth.getUser(token);
  const user = who?.user;
  if (authError || !user) {
    const status = (authError as { status?: number } | null)?.status ?? 0;
    const code = (authError as { code?: string } | null)?.code ?? "";
    if (code === "user_not_found") return fail("CLOUD_LOGIN_REQUIRED");
    if (status === 401 || status === 403) return json({ error: "AUTH_TOKEN" }, 401);
    return json({ error: "SERVER_BUSY" }, 503);
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return fail("CLOUD_TOO_LARGE");
  let body: Body;
  try {
    body = JSON.parse(text) as Body;
  } catch {
    return fail("CLOUD_BAD_ARGS");
  }
  const baseRev = typeof body.baseRev === "number" ? body.baseRev : null;
  const appVersion = typeof body.appVersion === "string" ? body.appVersion : "";

  const ctxRes = await admin.rpc("save_verify_context", { p_user: user.id });
  if (ctxRes.error) return json({ error: "SERVER_BUSY", detail: ctxRes.error.message }, 503);
  const ctx = ctxRes.data as Context;

  // 비교 — 같은 rev 위의 요청만. 비교에 쓴 rev 를 DB 에 넘긴다
  let violations: Violation[] = [];
  let checkedRev: number | null = null;
  if (ctx.found) {
    if (ctx.rev === baseRev) {
      checkedRev = ctx.rev;
      violations = verifySave(ctx.save, body.save, {
        gapMs: Math.min(ctx.gap_ms ?? 0, ctx.max_gap_ms),
        margin: ctx.margin,
        letters: ctx.letters ?? {},
        trades: ctx.trades ?? 0,
        tradesBefore: ctx.trades_before ?? [],
        seed: ctx.seed ?? null,
      }, data);
    } else if (body.op !== ctx.last_op) {
      return fail("CLOUD_REV_CONFLICT");
    }
  }

  if (violations.length > 0 && ctx.mode === "enforce") {
    await admin.rpc("reject_save", { p_user: user.id, p_violations: violations, p_app_version: appVersion });
    return fail("CLOUD_SAVE_REJECTED");
  }

  const res = await admin.rpc("accept_save", {
    p_user: user.id,
    p_device: body.device ?? null,
    p_base_rev: baseRev,
    p_checked_rev: checkedRev,
    p_save: body.save ?? null,
    p_save_v: typeof body.saveV === "number" ? body.saveV : 3,
    p_app_version: appVersion,
    p_op: body.op ?? null,
    p_violations: violations,
  });
  if (res.error) {
    const code = codeOf(res.error.message);
    // 모양이 틀린 인자(uuid 등)는 DB 가 CLOUD 코드 없이 거절한다
    if (!code) return /invalid input syntax/i.test(res.error.message) ? fail("CLOUD_BAD_ARGS") : serverError(res.error.message);
    return fail(code);
  }
  return json({ rev: Number(res.data), violations: violations.length });
});
