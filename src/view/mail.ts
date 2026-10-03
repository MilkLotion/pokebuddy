// 우편함 모달의 화면 값 — 서버 편지 목록과 저장(받음·읽음)으로 편지 줄·선물 줄·헤더 점 수를 만든다 (src/shared/model/mail.ts MailScreen)
// 편지 목록·받기 흐름은 온라인 층이 가진다 (src/online/mail-inbox.ts). 이 파일은 그 상태를 그릴 모양으로 바꾸기만 한다
// (예전 src/main/mail.ts 안에 있었다. 메인 레인 M8-6 에서 화면 값으로 옮겼다)
import { parseGifts, type Gift } from "../mail/gifts.js";
import { isApplied, isRead } from "../mail/letters.js";
import type { MailState, ServerLetter } from "../online/mail-inbox.js";
import type { SaveV3 } from "../shared/save-v3";
import type { MailGiftView, MailLetterView, MailScreen } from "../shared/model/mail";
import { itemName, petName } from "./text.js";

const time = (v: string | null): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function giftView(g: Gift): MailGiftView {
  if (g.kind === "item") return { kind: "item", id: g.id, name: itemName(g.id), count: g.count };
  if (g.kind === "pokemon") return { kind: "pokemon", id: g.species, name: petName(g.species), count: g.count };
  return { kind: "points", id: null, name: "포인트", count: g.count };
}

function giftViews(raw: unknown): { gifts: MailGiftView[]; unsupported: boolean } {
  const gifts = parseGifts(raw);
  if (gifts) return { gifts: gifts.map(giftView), unsupported: false };
  // 모르는 선물 — 아는 것만 보이고 받기를 막는다
  const list = Array.isArray(raw) ? raw : [];
  return { gifts: [], unsupported: list.length > 0 };
}

// 편지 한 통 — 받음·읽음은 이 저장의 기록이다
export function letterViewOf(l: ServerLetter, save: SaveV3 | null): MailLetterView {
  const { gifts, unsupported } = giftViews(l.gifts);
  return {
    id: l.id,
    title: l.title,
    body: l.body ?? "",
    sender: l.sender || "PokeBuddy",
    startsAt: time(l.starts_at) ?? 0,
    endsAt: time(l.ends_at),
    gifts,
    claimedAt: time(l.claimed_at),
    applied: save ? isApplied(save, l.id) : false,
    read: save ? isRead(save, l.id) : false,
    unsupported,
  };
}

// 우편함 화면 — 헤더 점은 읽지 않은 편지, 또는 기간 안에 받을 선물이 남은 편지의 수
export function mailScreenOf(s: MailState): MailScreen {
  const list = s.letters.map((l) => letterViewOf(l, s.save));
  const open = (l: MailLetterView): boolean => l.gifts.length > 0 && !l.applied && (l.endsAt == null || l.endsAt > s.now);
  return { available: true, status: s.status, signedIn: s.signedIn, letters: list, unread: list.filter((l) => !l.read || open(l)).length, busy: s.busy, error: s.error };
}
