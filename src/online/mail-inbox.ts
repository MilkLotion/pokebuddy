// 우편함의 받은편지 — 서버 편지 목록과 받기(supabase/migrations/20260929100000_mail.sql)를 로컬 저장(src/mail/gifts.ts)에 잇는다.
// 설계는 worklog/records/post-box/record.md "구현 설계" (2026-09-28 사용자 "a안으로 진행", 2026-09-29 "개발진행")
// 우편함의 코드 이름은 mail 이다 — CLI 명령 통로 mailbox 와 다르다 (docs/terms.md)
//
// Electron 을 모른다 — 서버 호출(rpc)과 실행기(run)를 받는다. 앱은 공유 Supabase 클라이언트를, 자체 검사는 가짜를 넘긴다.
// 화면 모양은 화면 값이 만든다 — 상태(MailState)를 screen 으로 넘긴다. 앱은 src/view/mail.ts 의 mailScreenOf 를 넘긴다
// 렌더러는 편지 id 만 보낸다. 저장에 넣는 선물은 서버가 돌려준 값만 쓴다.
//   받기   claim_mail → mail.apply. 서버가 받은 기록을 남긴 뒤 넣는다
//   복구   목록에 받은 시각이 있는데 이 저장에 넣지 않은 편지는 목록의 선물로 넣는다 — 받은 뒤 넣기 전에 끊긴 경우
// (예전 src/main/mail.ts 의 createMainMail. 메인 레인 M8-6 에서 온라인 층으로 옮겼다)
import { boxRoom } from "../box/slots.js";
import { neededBoxRoom, parseGifts } from "../mail/gifts.js";
import { isApplied, isRead } from "../mail/letters.js";
import type { SaveV3 } from "../shared/save-v3";
import type { MailAction, MailReply, MailScreen } from "../shared/model/mail";
import type { TxResult } from "../shared/command";
import type { MailCode, MailReplyCode, TradeCode } from "../shared/names/online-codes.js";

export interface ServerLetter {
  id: string;
  title: string;
  body: string;
  sender: string;
  gifts: unknown;
  starts_at: string;
  ends_at: string | null;
  claimed_at: string | null;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; code: MailCode | TradeCode };

// 화면 값에 넘길 상태 — 편지 목록과 이 저장, 지금 시각, 목록 읽기 상태, 받는 중인 편지, 마지막 실패
export interface MailState {
  letters: ServerLetter[];
  save: SaveV3 | null;
  now: number;
  status: MailScreen["status"];
  signedIn: boolean;
  busy: string | null;
  error: MailReplyCode | null;
}

export interface MailInboxOptions {
  rpc: <T>(fn: "list_mail" | "claim_mail", args: Record<string, unknown>) => Promise<RpcResult<T>>;
  run: (id: string, name: string, args: unknown) => TxResult;
  read: () => SaveV3 | null;
  signedIn: () => boolean; // 정식 계정 — 익명·로그아웃이면 받지 못한다
  // 선물 받기를 막아야 하는가 — 클라우드 저장이 올릴 수 있는 상태가 아니다. 나중에 서버 저장을 받으면 받은 선물이 덮인다
  hold?: () => boolean | Promise<boolean>;
  onChanged: () => void; // 저장에 선물을 넣었다 — 앱은 파티·트레이를 다시 읽는다
  screen: (state: MailState) => MailScreen; // 화면 모양 — 앱은 src/view/mail.ts 의 mailScreenOf
  now?: () => number;
}

export interface MailInbox {
  act: (req: MailAction) => Promise<MailReply>;
  screen: () => MailScreen;
  refresh: () => Promise<void>;
  userChanged: () => void; // 로그인·로그아웃 — 지난 계정의 목록과 늦게 온 답을 버린다
  onScreen: (fn: (screen: MailScreen) => void) => () => void;
}

const isLetter = (v: unknown): v is ServerLetter => {
  const l = v as ServerLetter | null;
  return !!l && typeof l.id === "string" && typeof l.title === "string" && typeof l.starts_at === "string";
};

export function createMailInbox(o: MailInboxOptions): MailInbox {
  const now = o.now ?? Date.now;
  const listeners = new Set<(screen: MailScreen) => void>();
  let letters: ServerLetter[] = [];
  let status: MailScreen["status"] = "idle";
  let busy: string | null = null;
  let error: MailReplyCode | null = null;
  let gen = 0; // 계정이 바뀔 때마다 올린다 — 바뀌기 전에 보낸 목록 요청의 답은 버린다(받은 시각은 계정마다 다르다)

  const screen = (): MailScreen => o.screen({ letters, save: o.read(), now: now(), status, signedIn: o.signedIn(), busy, error });

  const push = (): void => {
    const s = screen();
    for (const fn of listeners) fn(s);
  };

  // 선물을 저장에 넣는다. 이미 넣었으면 실행기가 아무것도 하지 않는다
  const apply = (letterId: string, gifts: unknown): TxResult => {
    const res = o.run(`mail-apply:${letterId}`, "mail.apply", { letterId, gifts });
    if (res.ok) o.onChanged();
    return res;
  };

  const refresh = async (): Promise<void> => {
    status = "loading";
    push();
    const asked = gen;
    const r = await o.rpc<unknown[]>("list_mail", {}).catch(() => ({ ok: false as const, code: "NETWORK" }));
    if (asked !== gen) return; // 그사이 계정이 바뀌었다 — 새 계정의 목록 요청이 따로 온다
    if (!r.ok) {
      status = "offline"; // 지난 목록은 그대로 보인다
      push();
      return;
    }
    letters = (Array.isArray(r.data) ? r.data : []).filter(isLetter);
    status = "ok";
    // 끊김 복구 — 서버가 받은 기록을 가졌는데 이 저장에 없다. 로그인한 계정의 목록일 때만(받은 시각은 그 계정 것이다)
    const save = o.read();
    if (save && o.signedIn()) {
      for (const l of letters) if (l.claimed_at && !isApplied(save, l.id) && parseGifts(l.gifts)?.length) apply(l.id, l.gifts);
    }
    push();
  };

  const reply = (ok: boolean, code: MailReplyCode | null): MailReply => ({ ok, code, screen: screen() });

  const act: MailInbox["act"] = async (req) => {
    if (req.action === "refresh") {
      await refresh();
      return reply(status === "ok", status === "ok" ? null : "NETWORK");
    }
    const letter = letters.find((l) => l.id === req.id);
    if (!letter) return reply(false, "MAIL_NOT_FOUND");
    if (req.action === "read") {
      const save = o.read();
      if (save && !isRead(save, letter.id)) o.run(`mail-read:${letter.id}`, "mail.read", { letterId: letter.id });
      push();
      return reply(true, null);
    }
    // 받기
    if (busy) return reply(false, "busy");
    if (!o.signedIn()) return reply(false, "MAIL_LOGIN_REQUIRED");
    const gifts = parseGifts(letter.gifts);
    if (!gifts) return reply(false, "bad-gift"); // 모르는 선물 — 서버에 받은 기록을 남기지 않는다
    // 포켓몬 선물이 들어갈 박스 빈 칸이 모자라다 — 서버에 받은 기록을 남기지 않는다. 자리를 만든 뒤 다시 받는다. 이미 얻은 단일 포켓몬은 세지 않는다 (src/mail/gifts.ts neededBoxRoom)
    const mine = o.read();
    if (mine && neededBoxRoom(mine, gifts) > boxRoom(mine.boxes)) {
      error = "box-full";
      push();
      return reply(false, "box-full");
    }
    if (await o.hold?.()) {
      error = "cloud-wait"; // 편지 아래에 거절 사유를 보인다
      push();
      return reply(false, "cloud-wait");
    }
    if (busy) return reply(false, "busy"); // 확인을 기다리는 사이 다른 받기가 시작됐다
    busy = letter.id;
    error = null;
    push();
    try {
      error = await claim(letter);
    } catch (e) {
      console.error(e); // 저장·새로 그리기가 던져도 받는 중 표시는 푼다 — 다시 받으면 같은 거래 id 로 한 번만 넣는다
      error = "UNKNOWN";
    } finally {
      busy = null;
    }
    push();
    return reply(error == null, error);
  };

  // 서버에 받은 기록을 남기고 선물을 넣는다. 실패 코드를 돌려준다
  const claim = async (letter: ServerLetter): Promise<MailReplyCode | null> => {
    const r = await o.rpc<{ gifts: unknown; claimed_at: string }[]>("claim_mail", { p_letter: letter.id }).catch(() => ({ ok: false as const, code: "NETWORK" as const }));
    if (!r.ok) return r.code;
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row) return "UNKNOWN";
    letter.claimed_at = row.claimed_at ?? new Date(now()).toISOString();
    const res = apply(letter.id, row.gifts);
    return res.ok ? null : res.reason;
  };

  return {
    act,
    screen,
    refresh,
    userChanged: () => {
      gen += 1;
      letters = [];
      error = null;
      status = "idle";
      push();
    },
    onScreen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
