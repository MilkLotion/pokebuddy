// 랜덤 배틀 서버 호출 — 바로 랜덤 한 판(battle-start { random }), 상대 3개 받기(battle-offer)와 고른 한 판(battle-start). 서버는 supabase/functions/battle-*
// 판정·보상은 서버가 한다. 앱은 받은 판의 보상을 받을 판에 적고(battle.reward 거래) 판을 배틀 창으로 재생한다. 포인트는 창이 닫힐 때 받는다(battle.claim)
// 규칙은 docs/specs/adventure.md "바로 랜덤 상대", "상대 고르기", "서버", 설계는 worklog/records/battle-server/battle-server.md "E3 서버 설계"
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BattleCode } from "../shared/names/online-codes.js";
import { SERVER_BATTLE_CODES } from "../shared/names/online-codes.js";
import type { TxResult } from "../shared/command";
import type { BattleAction, BattleDetailData, BattleDetailView, BattleLook, BattleRecordData, BattleReply } from "../shared/model/battle-net.js";
import { callRpc, isNetworkMessage, isUnreachable, readFunctionError } from "./server-call.js";

// battle-offer 의 답 — 칸은 { species, form, types } 또는 null
export interface OfferData {
  offerId: string;
  picks: { slot: number; party: ({ species: string; form: string | null; types: string[]; shiny?: boolean } | null)[] }[];
  cooldownMs: number;
  rerollLeft?: number; // 남은 새로고침 — 옛 서버면 없다(제한 없음)
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
  foe?: { name: string | null }; // 바로 랜덤 판의 상대 이름 — 샘플 이름 또는 계정 표시 이름(없으면 null). 고른 판·옛 서버면 없다
}

export interface BattleNetDeps {
  client: SupabaseClient;
  signedIn: () => boolean; // 익명 계정도 된다 — 세션이 있는가
  run: (id: string, name: string, args: unknown) => TxResult; // 보상 거래 — writer 가 아니면 실패
  hasRewards: () => boolean; // 받을 판이 있는가 — 없으면 battle.claim 을 부르지 않는다
  onChanged: () => void; // 포인트가 바뀌었다 — 설정창을 다시 그린다
  offerView: (data: OfferData) => BattleReply["offer"]; // 칸 값에 이름·그림 열쇠를 더한다(view 층)
  detailView: (data: BattleDetailData) => BattleDetailView; // 배틀 상세 — 칸 값에 이름을 더하고 DPS 를 셈한다(view 층)
  show: (data: StartData, pick: number | null) => void; // 배틀 창을 연다 — pick 은 고른 줄, 바로 랜덤이면 null
  beforeSend?: () => Promise<void>; // 상대 받기·판 요청 직전 저장 올리기 — 서버가 서버 저장의 배틀 파티를 읽는다. 친선 배틀의 beforeReady 와 같다
  prepare?: () => void; // 판을 요청하기 직전 — 바탕화면 포켓몬을 숨기고 배틀 창을 준비 중으로 띄운다 (2026-10-10)
  cancel?: () => void; // 판을 받지 못했다 — 준비 중 창을 닫고 포켓몬을 되돌린다. 실패 문구는 배틀 고르기 모달이 보인다
}

type Call<T> = { ok: true; data: T } | { ok: false; code: BattleCode; detail?: string; remainMs?: number };
const KNOWN = new Set<string>([...SERVER_BATTLE_CODES, "CLOUD_ACCOUNT_HELD", "CLOUD_LOGIN_REQUIRED"]);

export interface BattleNet {
  act: (a: BattleAction) => Promise<BattleReply>;
}

export function createBattleNet(d: BattleNetDeps): BattleNet {
  let busy = false;

  async function record(): Promise<{ ok: true; data: BattleRecordData } | { ok: false; code: BattleCode; detail?: string }> {
    const r = await callRpc<BattleRecordData, BattleCode>(d.client, "battle_record_view", undefined, (e) => {
      const m = e?.message ?? "";
      if (m.includes("CLOUD_LOGIN_REQUIRED")) return { code: "CLOUD_LOGIN_REQUIRED" };
      return isNetworkMessage(m) ? { code: "NETWORK" } : { code: "UNKNOWN", detail: m };
    });
    return r;
  }

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

  async function act(a: BattleAction): Promise<BattleReply> {
    if (!d.signedIn()) return { ok: false, code: "CLOUD_LOGIN_REQUIRED" };
    if (a.action === "record") {
      // 읽기만 한다 — 상대 받기·판과 겹쳐도 된다
      const r = await record();
      return r.ok ? { ok: true, code: null, record: r.data } : fail(r);
    }
    if (a.action === "detail") {
      // 판 하나의 요약 — 읽기만 한다. 남의 판·없는 판은 null (supabase/migrations/20261012100000_battle_history.sql battle_detail)
      const r = await callRpc<BattleDetailData | null, BattleCode>(d.client, "battle_detail", { p_battle: a.id }, (e) => {
        const m = e?.message ?? "";
        if (m.includes("CLOUD_LOGIN_REQUIRED")) return { code: "CLOUD_LOGIN_REQUIRED" };
        return isNetworkMessage(m) ? { code: "NETWORK" } : { code: "UNKNOWN", detail: m };
      });
      return r.ok ? { ok: true, code: null, battle: r.data ? d.detailView(r.data) : null } : fail(r);
    }
    if (busy) return { ok: false, code: "BATTLE_TOO_FAST" };
    busy = true;
    try {
      if (a.action === "offer") {
        await d.beforeSend?.().catch(() => undefined); // 올리지 못해도 서버 저장의 배틀 파티로 판정한다
        const r = await call<OfferData>("battle-offer", a.reroll ? { reroll: true } : {}); // reroll 은 새로고침 — 판마다 1번
        if (!r.ok) return fail(r);
        return { ok: true, code: null, offer: d.offerView(r.data) };
      }
      if (d.hasRewards()) d.run(`battle-claim:${Date.now()}`, "battle.claim", {}); // 앞 판에서 받지 못한 포인트를 먼저 받는다
      d.prepare?.(); // call 은 예외를 실패 답으로 바꾼다 — 실패면 아래에서 닫는다
      await d.beforeSend?.().catch(() => undefined);
      const r = await call<StartData>("battle-start", a.action === "random" ? { random: true } : { offerId: a.offerId, pick: a.pick });
      if (!r.ok) {
        d.cancel?.();
        return fail(r);
      }
      // 보상을 받을 판에 적는다 — 포인트는 배틀 창이 닫힐 때 오른다(2026-10-18 사용자 "확인버튼 누를때"). 거래 id 가 판 id 라 같은 판은 한 번만 적는다. 적지 못해도 판은 보여 준다
      const put = d.run(`battle-reward:${r.data.battleId}`, "battle.reward", { battleId: r.data.battleId, reward: r.data.reward });
      if (put.ok) d.onChanged();
      d.show(r.data, a.action === "random" ? null : a.pick);
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
