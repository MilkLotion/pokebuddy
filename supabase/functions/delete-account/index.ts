// 계정 삭제 — 요청한 사용자 본인만 지운다. 설계는 worklog/records/trade/record.md "로그아웃과 계정 삭제"
//
// 서비스 역할 키가 필요해 앱이 아니라 이 함수가 한다. 키는 함수 환경 변수(SUPABASE_SERVICE_ROLE_KEY)로만 쓴다.
//   1. Authorization 의 사용자 토큰으로 본인을 확인한다. 익명 계정은 지우지 않는다(정리 작업이 지운다)
//   2. 열린 교환(open·joined)이 있으면 거절한다 — 앱도 막지만 서버에서 다시 본다. 이용 정지 중이면 거절한다(P4c)
//   3. auth.admin.deleteUser. 교환 채널의 host·guest 는 null 이 되고(상대가 반영할 수 있게) 클라우드 저장은 함께 지워진다
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "SERVER_CONFIG" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return json({ error: "AUTH_REQUIRED" }, 401);
  if (user.is_anonymous) return json({ error: "AUTH_ANONYMOUS" }, 403);
  // 이용 정지 중에는 지우지 않는다 — 지우면 정지 기록이 함께 사라진다(검수 P4c M3). 운영자가 확인한 뒤 푼다
  const ctx = await admin.rpc("save_verify_context", { p_user: user.id });
  if (ctx.error) return json({ error: "UNKNOWN", detail: ctx.error.message }, 500);
  if ((ctx.data as { held?: boolean } | null)?.held) return json({ error: "CLOUD_ACCOUNT_HELD" }, 403);

  const active = await admin
    .from("trade_channels")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "joined"])
    .or(`host.eq.${user.id},guest.eq.${user.id}`);
  if (active.error) return json({ error: "UNKNOWN", detail: active.error.message }, 500);
  if ((active.count ?? 0) > 0) return json({ error: "AUTH_TRADE_ACTIVE" }, 409);

  const removed = await admin.auth.admin.deleteUser(user.id);
  if (removed.error) return json({ error: "UNKNOWN", detail: removed.error.message }, 500);
  return json({ ok: true });
});
