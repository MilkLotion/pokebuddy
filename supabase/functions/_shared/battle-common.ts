// 배틀 함수(battle-offer·battle-start) 공통 — 본인 확인, 응답, 전투 데이터
// 설계는 worklog/records/battle-server/battle-server.md "E3 서버 설계", 규칙은 docs/specs/adventure.md "서버"
// 오류는 { error } 와 HTTP 상태로 돌려준다
//   BATTLE_PARTY_INVALID  400 — 배틀 파티가 비었거나 출전 불가가 있다
//   BATTLE_COOLDOWN       409 — 쿨타임이 남았다. remainMs 를 함께 준다
//   BATTLE_OFFER_GONE     409 — 보인 3개가 바뀌었거나 이미 썼다. 앱은 새로 받는다
//   BATTLE_TOO_FAST       429 — 새로고침이 1초에 두 번
//   BATTLE_BAD_ARGS       400 — 요청 모양이 틀렸다
//   CLOUD_ACCOUNT_HELD    403 — 이용 정지
//   AUTH_TOKEN 401 · CLOUD_LOGIN_REQUIRED 401 · SERVER_BUSY 503 · SERVER_ERROR 500 — upload-save 와 같다
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BattleData } from "./battle/fighter-core.ts";
import battleJson from "./battle/battle-data.json" with { type: "json" };

export const battle = battleJson as unknown as { hash: string; data: BattleData };

export const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const STATUS: Readonly<Record<string, number>> = {
  BATTLE_PARTY_INVALID: 400,
  BATTLE_BAD_ARGS: 400,
  BATTLE_COOLDOWN: 409,
  BATTLE_OFFER_GONE: 409,
  BATTLE_TOO_FAST: 429,
  CLOUD_ACCOUNT_HELD: 403,
  CLOUD_LOGIN_REQUIRED: 401,
};
export const fail = (code: string, extra: Record<string, unknown> = {}): Response => json({ error: code, ...extra }, STATUS[code] ?? 400);
export const codeOf = (message: string): string | null => /((?:BATTLE|CLOUD)_[A-Z_]+)/.exec(message)?.[1] ?? null;

// 본인 확인 — 서비스 롤 클라이언트와 사용자 id. 실패면 응답
export async function whoAmI(req: Request): Promise<{ admin: SupabaseClient; user: string } | Response> {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_TOKEN" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "SERVER_ERROR", detail: "config" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await admin.auth.getUser(token);
  if (error || !who?.user) {
    const status = (error as { status?: number } | null)?.status ?? 0;
    const code = (error as { code?: string } | null)?.code ?? "";
    if (code === "user_not_found") return fail("CLOUD_LOGIN_REQUIRED");
    if (status === 401 || status === 403) return json({ error: "AUTH_TOKEN" }, 401);
    return json({ error: "SERVER_BUSY" }, 503);
  }
  return { admin, user: who.user.id };
}

export interface BattleContext {
  held: boolean;
  save: unknown;
  cooldown_ms: number;
}

// 화면에 보일 칸 — 종·모습·타입. 상대의 다른 정보는 주지 않는다
export interface SlotView {
  species: string;
  form: string | null;
  types: string[];
}
export function slotView(src: { species: string; form?: string | null } | null): SlotView | null {
  if (!src) return null;
  const mega = src.form ? battle.data.mega[src.form] : undefined;
  const sp = battle.data.species[src.species];
  if (!sp) return null;
  return { species: src.species, form: mega ? src.form! : null, types: mega ? mega.types : sp.types };
}
