// 랜덤 배틀 서버 호출 — 상대 3개 받기(battle-offer)와 한 판(battle-start). 서버는 supabase/functions/battle-*
// 판정·보상은 서버가 한다. 앱은 받은 판의 보상을 저장에 넣고(battle.reward 거래) 판을 배틀 창으로 재생한다
// 규칙은 docs/specs/adventure.md "상대 고르기", "서버", 설계는 worklog/records/battle-server/battle-server.md "E3 서버 설계"
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BattleCode } from "../shared/names/online-codes.js";
import { SERVER_BATTLE_CODES } from "../shared/names/online-codes.js";
import type { TxResult } from "../shared/command";
import type { BattleLook, BattleReply } from "../shared/model/battle-net.js";
import { isUnreachable, readFunctionError } from "./server-call.js";

// battle-offer 의 답 — 칸은 { species, form, types } 또는 null
export interface OfferData {
  offerId: string;
  picks: { slot: number; party: ({ species: string; form: string | null; types: string[]; shiny?: boolean } | null)[] }[];
  cooldownMs: number;
}
// battle-start 의 답 — 엔진 결과·이벤트·두 쪽 전투 개체(모양은 src/battle/engine.ts)
export interface StartData {
  battleId: string;
  reward: number;
  result: { winner: 0 | 1 | null; timeout: boolean; endMs: number; hp: [number[], number[]]; maxHp: [number[], number[]]; obstacles: unknown[] };
  events: unknown[];
  sides: [unknown[], unknown[]];
  looks?: [(BattleLook | null)[], (BattleLook | null)[]]; // 칸마다 이로치·성별 — 옛 서버면 없다
  dataHash: string;
}

export interface BattleNetDeps {
  client: SupabaseClient;
  signedIn: () => boolean; // 익명 계정도 된다 — 세션이 있는가
  run: (id: string, name: string, args: unknown) => TxResult; // 보상 거래 — writer 가 아니면 실패
  onChanged: () => void; // 포인트가 바뀌었다 — 설정창을 다시 그린다
  offerView: (data: OfferData) => BattleReply["offer"]; // 칸 값에 이름·그림 열쇠를 더한다(view 층)
  show: (data: StartData, pick: number) => void; // 배틀 창을 연다
}

type Call<T> = { ok: true; data: T } | { ok: false; code: BattleCode; detail?: string; remainMs?: number };
const KNOWN = new Set<string>([...SERVER_BATTLE_CODES, "CLOUD_ACCOUNT_HELD", "CLOUD_LOGIN_REQUIRED"]);

export function createBattleNet(d: BattleNetDeps): { act: (a: { action: "offer" } | { action: "start"; offerId: string; pick: number }) => Promise<BattleReply> } {
  let busy = false;

  async function call<T>(fn: string, body: Record<string, unknown>): Promise<Call<T>> {
    try {
      const { data, error } = await d.client.functions.invoke(fn, { body });
      if (!error) return { ok: true, data: data as T };
      const f = await readFunctionError(error);
      if (isUnreachable(f)) return { ok: false, code: "NETWORK" };
      const remain = await remainOf(error);
      if (f.bodyCode && KNOWN.has(f.bodyCode)) return { ok: false, code: f.bodyCode as BattleCode, ...(remain !== null ? { remainMs: remain } : {}) };
      return { ok: false, code: "UNKNOWN", detail: f.bodyCode ?? f.message };
    } catch (e) {
      return { ok: false, code: "UNKNOWN", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async function act(a: { action: "offer" } | { action: "start"; offerId: string; pick: number }): Promise<BattleReply> {
    if (!d.signedIn()) return { ok: false, code: "CLOUD_LOGIN_REQUIRED" };
    if (busy) return { ok: false, code: "BATTLE_TOO_FAST" };
    busy = true;
    try {
      if (a.action === "offer") {
        const r = await call<OfferData>("battle-offer", {});
        if (!r.ok) return fail(r);
        return { ok: true, code: null, offer: d.offerView(r.data) };
      }
      const r = await call<StartData>("battle-start", { offerId: a.offerId, pick: a.pick });
      if (!r.ok) return fail(r);
      // 보상을 넣는다 — 거래 id 가 판 id 라 같은 판은 한 번만 들어간다. 넣지 못해도 판은 보여 준다
      const put = d.run(`battle-reward:${r.data.battleId}`, "battle.reward", { battleId: r.data.battleId, reward: r.data.reward });
      if (put.ok) d.onChanged();
      d.show(r.data, a.pick);
      return put.ok ? { ok: true, code: null, reward: r.data.reward } : { ok: false, code: "LOCAL", reward: r.data.reward };
    } finally {
      busy = false;
    }
  }

  return { act };
}

const fail = (r: { code: BattleCode; detail?: string; remainMs?: number }): BattleReply => ({
  ok: false,
  code: r.code,
  ...(r.detail ? { detail: r.detail } : {}),
  ...(r.remainMs !== undefined ? { remainMs: r.remainMs } : {}),
});

// 쿨타임 오류의 남은 시간 — 본문 { remainMs } (supabase/functions/_shared/battle-common.ts fail)
async function remainOf(error: unknown): Promise<number | null> {
  const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  const body = (await ctx.clone().json().catch(() => null)) as { remainMs?: unknown } | null;
  return typeof body?.remainMs === "number" ? body.remainMs : null;
}
