// 친선 배틀 세션 — 서버 함수 friendly-battle 을 부르고, 채널 신호(friendly:<id>)와 30초 다시 읽기로 화면 값을 만든다
// 규칙 docs/specs/adventure.md "친선 배틀", 서버 supabase/functions/friendly-battle · supabase/migrations/20261010120000_friendly_battle.sql
// 교환 세션(src/online/trade-session.ts)과 같은 꼴이다 — 링크·참가·나가기·신호·다시 읽기. 판정은 서버가 하고, 새 판이 오면 onBattle 로 넘긴다
// Electron 을 모른다. 공유 클라이언트를 받는다
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BattlePickSlotView } from "../shared/model/battle-net.js";
import type { FriendlyAction, FriendlyScreen } from "../shared/model/friendly.js";
import { linkOf, tokenOf } from "../trade/link.js";
import { isUnreachable, readFunctionError } from "./server-call.js";

const FRIENDLY_PROTOCOL = 1; // 채널 판 — supabase/functions/friendly-battle PROTOCOL 과 같다

type Slot = { species: string; form: string | null; types: string[]; shiny?: boolean } | null;

// 서버가 준 판 — 방장 쪽이 0번이다 (friendly-battle)
export interface FriendlyBattle {
  round: number;
  startAt: string; // 두 앱이 함께 재생을 시작할 서버 시각
  result: { winner: 0 | 1 | null; timeout: boolean; endMs: number; hp: [number[], number[]]; maxHp: [number[], number[]]; obstacles: unknown[] };
  events: unknown[];
  sides: [unknown[], unknown[]];
  looks?: [unknown[], unknown[]];
  dataHash: string;
}

interface ChannelView {
  id: string;
  role: "host" | "guest";
  status: "open" | "joined" | "closed";
  closedReason: string | null;
  friendJoined: boolean;
  friendName: string | null;
  myReady: boolean;
  friendReady: boolean;
  running: boolean;
  round: number;
  battle: FriendlyBattle | null;
  expiresAt: string;
  serverNow: string;
  token?: string;
}

interface Reply {
  channel: ChannelView | null;
  parties: { mine: Slot[]; myBlocked: boolean; friend: Slot[] | null } | null;
}

export interface FriendlySessionDeps {
  client: SupabaseClient;
  signedIn: () => boolean; // 로그인한 정식 계정인가 — 익명이면 서버에 보내지 않고 로그인 안내
  beforeReady: () => Promise<void>; // `준비` 직전 저장 올리기 — 서버 저장의 배틀 파티로 싸운다
  linkBase: string; // 친선 배틀 공유 주소 앞부분 (src/trade/link.ts friendlyLinkBase)
  slotView: (s: Slot) => BattlePickSlotView | null; // 칸에 이름·그림 열쇠를 더한다(view 층)
  onScreen: (screen: FriendlyScreen) => void;
  // 새 판 — delayMs 뒤에 배틀 창을 연다(서버가 정한 시작 시각까지). 음수면 이미 지났다
  onBattle: (battle: FriendlyBattle, role: "host" | "guest", friendName: string | null, delayMs: number) => void;
  pollMs?: number;
  now?: () => number;
}

export interface FriendlySession {
  act: (a: FriendlyAction) => Promise<FriendlyScreen>;
  start: () => Promise<void>; // 앱을 켰을 때 — 열린 채널이 있으면 이어 붙는다. 로그인 전이면 아무것도 하지 않고, 한 번 읽을 때까지 다시 불러도 된다(15초 틱)
  openLink: (link: string) => Promise<FriendlyScreen>; // 딥링크로 참가
  screen: () => FriendlyScreen;
  stop: () => void;
}

export function createFriendlySession(d: FriendlySessionDeps): FriendlySession {
  const now = d.now ?? Date.now;
  let channel: ChannelView | null = null;
  let parties: Reply["parties"] = null;
  let link: string | null = null;
  let error: FriendlyScreen["error"] = null;
  let closed: { reason: string | null } | null = null;
  let busy = false;
  let started = false; // 열린 채널을 한 번 읽었다
  let lastRound = -1; // 이미 본 판 — 이어 붙을 때의 판은 다시 틀지 않는다
  let skew = 0; // 서버 시각 − 이 PC 시각
  let unsubscribe: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  function screen(): FriendlyScreen {
    const phase: FriendlyScreen["phase"] = channel?.status === "open" ? "hosting" : channel?.status === "joined" ? "meet" : closed ? "closed" : "idle";
    return {
      available: true,
      signedIn: d.signedIn(),
      phase,
      busy,
      link: phase === "hosting" ? link : null,
      expiresAt: channel && phase === "hosting" ? Date.parse(channel.expiresAt) - skew : null,
      friendName: channel?.friendName ?? null,
      myReady: channel?.myReady ?? false,
      friendReady: channel?.friendReady ?? false,
      running: channel?.running ?? false,
      mine: parties ? parties.mine.map(d.slotView) : null,
      friend: parties?.friend ? parties.friend.map(d.slotView) : null,
      myBlocked: parties?.myBlocked ?? false,
      closedReason: closed?.reason ?? null,
      error,
    };
  }
  const emit = (): FriendlyScreen => {
    const s = screen();
    d.onScreen(s);
    return s;
  };

  function detach(): void {
    unsubscribe?.();
    unsubscribe = null;
    if (poll) clearInterval(poll);
    poll = null;
  }

  // 채널 신호 — 내용 없이 온다. 받으면 다시 읽는다
  async function attach(id: string): Promise<void> {
    if (unsubscribe) return;
    try {
      await d.client.realtime.setAuth();
      const ch = d.client
        .channel(`friendly:${id}`, { config: { private: true } })
        .on("broadcast", { event: "changed" }, () => void refresh())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void refresh();
        });
      unsubscribe = () => void d.client.removeChannel(ch);
    } catch {
      unsubscribe = () => undefined; // 신호를 못 받아도 다시 읽기로 이어 간다
    }
    poll = setInterval(() => void refresh(), d.pollMs ?? 30_000);
  }

  async function call(body: Record<string, unknown>): Promise<{ ok: true; data: Reply } | { ok: false; code: string; detail?: string }> {
    try {
      const { data, error: err } = await d.client.functions.invoke("friendly-battle", { body });
      if (!err) return { ok: true, data: data as Reply };
      const f = await readFunctionError(err);
      if (isUnreachable(f)) return { ok: false, code: "NETWORK" };
      return f.bodyCode ? { ok: false, code: f.bodyCode } : { ok: false, code: "UNKNOWN", detail: f.message };
    } catch (e) {
      return { ok: false, code: "UNKNOWN", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // 답을 받아 들인다 — 닫혔으면 신호를 끊고 닫힘 배너, 새 판이면 onBattle
  function take(r: Reply, opts: { first?: boolean } = {}): void {
    parties = r.parties;
    const v = r.channel;
    if (!v) {
      channel = null;
      detach();
      return;
    }
    skew = Date.parse(v.serverNow) - now();
    if (v.token) link = linkOf(d.linkBase, v.token);
    if (v.status === "closed") {
      closed = { reason: v.closedReason };
      channel = null;
      link = null;
      detach();
      return;
    }
    closed = null;
    channel = v;
    void attach(v.id);
    if (opts.first) lastRound = v.round;
    if (v.battle && v.round > lastRound) {
      lastRound = v.round;
      d.onBattle(v.battle, v.role, v.friendName, Date.parse(v.battle.startAt) - Date.parse(v.serverNow));
    }
  }

  let refreshing: Promise<void> | null = null;
  async function refresh(): Promise<void> {
    if (!channel) return;
    if (refreshing) return refreshing;
    const id = channel.id;
    refreshing = (async () => {
      const r = await call({ action: "get", channel: id });
      if (r.ok) take(r.data);
      else if (r.code === "FRIENDLY_NOT_FOUND") take({ channel: null, parties });
      emit();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function run(fn: () => Promise<{ ok: true; data: Reply } | { ok: false; code: string; detail?: string }>, first = false): Promise<FriendlyScreen> {
    if (busy) return screen();
    busy = true;
    error = null;
    emit();
    const r = await fn();
    busy = false;
    if (r.ok) take(r.data, { first });
    else error = { code: r.code, ...(r.detail ? { detail: r.detail } : {}) };
    return emit();
  }

  const loginFirst = (): FriendlyScreen | null => {
    if (d.signedIn()) return null;
    error = { code: "FRIENDLY_LOGIN_REQUIRED" };
    return emit();
  };

  async function act(a: FriendlyAction): Promise<FriendlyScreen> {
    if (a.action === "view") return screen();
    if (a.action === "create") {
      const no = loginFirst();
      if (no) return no;
      closed = null;
      return run(() => call({ action: "create", protocol: FRIENDLY_PROTOCOL }), true);
    }
    if (a.action === "join") {
      const no = loginFirst();
      if (no) return no;
      const token = tokenOf(a.link, "battle");
      if (!token) {
        error = { code: "FRIENDLY_LINK_INVALID" };
        return emit();
      }
      closed = null;
      return run(() => call({ action: "join", token, protocol: FRIENDLY_PROTOCOL }), true);
    }
    const id = channel?.id;
    if (!id) return screen();
    if (a.action === "leave") {
      const s = await run(() => call({ action: "leave", channel: id }));
      closed = null; // 내가 나갔다 — 닫힘 배너 없이 시작 화면
      return s.phase === "closed" ? emit() : s;
    }
    if (a.ready) await d.beforeReady().catch(() => undefined); // 올리지 못해도 서버 저장의 배틀 파티로 판정한다
    return run(() => call({ action: "ready", channel: id, ready: a.ready }));
  }

  return {
    act,
    async start() {
      if (started || !d.signedIn() || channel) return;
      const r = await call({ action: "mine" });
      if (!r.ok) return;
      started = true;
      take(r.data, { first: true });
      emit();
    },
    async openLink(l) {
      return act({ action: "join", link: l });
    },
    screen,
    stop() {
      detach();
      channel = null;
    },
  };
}
