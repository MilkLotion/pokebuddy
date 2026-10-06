// 설정창의 우편함 — 편지 목록과 편지 한 통, 선물 받기 단추와 헤더 봉투 단추·안 읽음 점 (P10l)
// Figma 05 Screens 섹션 `10 우편함` `932:22859` — 목록 `908:5779` · 편지 로그인 전 `932:22703` · 받기 전 `908:6022` · 받은 뒤(일반 편지) `908:6232`.
// 편지는 받은 뒤에도 남는다. 선물은 로그인해야 받는다. 받기 단추와 상태 글자는 편지 바닥 단추 줄에 둔다. 서버 호출과 저장은 메인이 한다(src/online/mail-inbox.ts) — 여기서는 편지 id 만 보낸다
// (2026-09-28 사용자 "a안으로 진행", 2026-09-29 "개발진행", worklog/records/post-box/post-box.md)
import type { MailGiftView, MailLetterView, MailScreen } from "../../shared/model/mail.js";
import { numberText } from "../../shared/count-text.js";
import { failTextOf } from "../../shared/fail-text.js";
import { josa } from "../../shared/josa.js";
import { buttonEl, el, needEl } from "../ui/dom.js";
import { api } from "./api.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, drawDialog, openDialog } from "./dialog.js";
import { refreshView } from "./live.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

let mailView: MailScreen | null = null;
const mailBtn = needEl("open-mail", HTMLButtonElement, "manage");
const mailDotEl = needEl("mail-dot", HTMLElement, "manage");

function setMail(screen: MailScreen): void {
  mailView = screen;
  mailBtn.hidden = !screen.available;
  mailDotEl.hidden = screen.unread === 0;
  if (ui.dialog?.kind === "mail" || ui.dialog?.kind === "letter") drawDialog();
}

async function refreshMail(): Promise<void> {
  try {
    const r = await api.mail({ action: "refresh" });
    if (r) setMail(r.screen);
  } catch (e) {
    console.error(e); // 메인이 답하지 못했다 — 봉투 단추는 지난 상태 그대로
  }
}


const monthDay = (at: number): string => {
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
// 남은 기간 — 하루 이상이면 날, 아래면 시간
function mailLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "기간 지남";
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `${days}일 남음` : `${Math.max(1, Math.ceil(ms / 3_600_000))}시간 남음`;
}
const mailExpired = (l: MailLetterView): boolean => l.endsAt != null && l.endsAt <= Date.now();
// 받을 선물이 남았다 — 기간 안이고 이 저장에 넣지 않았다
const mailOpen = (l: MailLetterView): boolean => l.gifts.length > 0 && !l.applied && !mailExpired(l);
// 보낸 이 · 날짜, 받을 선물이 남은 편지는 남은 기간까지 — Figma "PokeBuddy · 9월 28일 · 7일 남음"
function mailMeta(l: MailLetterView): string {
  const parts = [l.sender, monthDay(l.startsAt)];
  if (mailOpen(l) && l.endsAt != null) parts.push(mailLeft(l.endsAt));
  return parts.join(" · ");
}
const giftIcon = (g: MailGiftView, cls: string): HTMLElement =>
  g.kind === "item" ? iconOf(`item:${g.id}`, cls) : g.kind === "pokemon" && g.id ? portraitOf(g.id, false, cls) : el("span", `${cls} gift-point`, "P");
// 받은 선물이 들어간 곳 — 가방(도구)·박스(포켓몬)·포인트
function giftWhere(gifts: readonly MailGiftView[]): string {
  const places = [gifts.some((g) => g.kind === "item") && "가방", gifts.some((g) => g.kind === "pokemon") && "박스", gifts.some((g) => g.kind === "points") && "포인트"].filter((p): p is string => !!p);
  if (places.length === 1 && places[0] === "포인트") return "포인트에 더해졌어요";
  // 앞 단어에 받침이 있으면 "과"(가방과), 없으면 "와"(박스와)
  const and = (w: string): string => `${w}${josa(w, "과/와")}`;
  return `${places.map((p, i) => (i < places.length - 1 ? and(p) : p)).join(" ")}에 들어갔어요`;
}

// 봉투 — Figma `Icon / Mail` `907:578`. 헤더 단추와 같은 선 그림
function envelope(cls: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  for (const d of ["M3.5 5.5h13v9h-13z", "M3.5 5.5l6.5 5 6.5-5"]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// 모달 머리 — 제목(편지면 ‹ 돌아가기)과 오른쪽 위 닫기
function mailHead(title: string, back: boolean): void {
  const head = el("div", "settings-head");
  const titles = el("div", "titles mail-titles");
  if (back) {
    const b = buttonEl("back", "‹");
    b.setAttribute("aria-label", "우편함으로");
    b.addEventListener("click", () => openDialog({ kind: "mail" }));
    titles.appendChild(b);
  }
  titles.appendChild(el("h2", undefined, title));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  head.append(titles, x);
  dialogEl.appendChild(head);
}

function mailRow(l: MailLetterView): HTMLElement {
  const row = buttonEl("mail-row");
  const dot = el("span", "mail-unread");
  dot.hidden = l.read && !mailOpen(l); // 안 읽음 점 — 받을 선물이 남아도 둔다
  const text = el("div", "mail-text");
  text.append(el("div", "mail-title", l.title), el("div", "mail-meta", mailMeta(l)));
  row.append(dot, envelope("mail-icon"), text);
  const first = l.gifts[0];
  if (l.applied) row.appendChild(el("span", "mail-chip done", "받음"));
  else if (first) {
    const chip = el("span", "mail-chip");
    const more = l.gifts.length > 1 ? ` 외 ${l.gifts.length - 1}` : "";
    chip.append(giftIcon(first, "mail-chip-icon"), document.createTextNode(`${first.name} ×${numberText(first.count)}${more}`));
    row.appendChild(chip);
  }
  row.appendChild(el("span", "mail-more", "›"));
  row.addEventListener("click", () => openLetter(l.id));
  return row;
}

function openLetter(id: string): void {
  openDialog({ kind: "letter", id });
  const l = mailView?.letters.find((x) => x.id === id);
  if (l && !l.read)
    void api
      .mail({ action: "read", id })
      .then((r) => r && setMail(r.screen))
      .catch((e: unknown) => console.error(e));
}

export function drawMail(): void {
  mailHead("우편함", false);
  const scroll = el("div", "scroll mail-list");
  const letters = mailView?.letters ?? [];
  if (!letters.length) {
    const word = !mailView || mailView.status === "loading" ? "우편함을 읽는 중입니다." : mailView.status === "offline" ? "우편함을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." : "받은 편지가 없어요.";
    scroll.appendChild(el("div", "empty-note", word));
  } else {
    for (const l of letters) scroll.appendChild(mailRow(l));
    scroll.appendChild(el("div", "mail-note", "선물이 든 편지는 열어서 받아요. 기간이 지나면 받을 수 없어요."));
  }
  dialogEl.appendChild(scroll);
}

// 선물 카드 — 제목(`선물 N`, 받은 뒤 `받은 선물`)과 2열 선물 줄. 받기 전과 받은 뒤의 높이가 같다. 받은 뒤는 선물 줄을 흐리게 둔다
// (2026-10-03 사용자 "이정도면 괜찮은거같은데", "받으면 상품을 disable처럼 흐리게", worklog/records/post-box/post-box.md)
function giftCard(l: MailLetterView): HTMLElement {
  const card = el("div", l.applied ? "gift-card done" : "gift-card");
  card.appendChild(el("strong", "gift-head", l.applied ? "받은 선물" : `선물 ${l.gifts.length}`));
  if (l.gifts.length) {
    const grid = el("div", "gift-grid");
    for (const g of l.gifts) {
      const row = el("div", "gift-row");
      const name = el("strong", "gift-name", g.name);
      name.title = g.name; // 칸보다 긴 이름은 말줄임
      row.append(giftIcon(g, "gift-icon"), name, el("span", "gift-count", `×${numberText(g.count)}`));
      grid.appendChild(row);
    }
    card.appendChild(grid);
  }
  return card;
}

// 편지 바닥 단추 줄 — 왼쪽은 상태 글자, 오른쪽은 `받기`(받은 뒤 잠긴 `받음`). 로그인 전은 `로그인` 을 앞에 둔다.
// 상태가 바뀌어도 글자와 단추의 자리는 그대로다
function giftFoot(l: MailLetterView): HTMLElement {
  const done = l.applied;
  const busy = mailView?.busy === l.id;
  const signedIn = !!mailView?.signedIn;
  const needLogin = !done && !l.unsupported && !mailExpired(l) && !signedIn;
  let note = "";
  if (done) note = `${l.claimedAt ? `${monthDay(l.claimedAt)}에 받았어요 · ` : ""}${giftWhere(l.gifts)}`;
  else if (l.unsupported) note = failTextOf("bad-gift", "mail").text;
  else if (mailExpired(l)) note = failTextOf("MAIL_EXPIRED", "mail").text;
  else if (needLogin) note = failTextOf("MAIL_LOGIN_REQUIRED", "mail").text;
  else if (mailView?.error && !busy) note = failTextOf(mailView.error, "mail").text;
  const left = el("span", "spacer gift-note", note);
  left.title = note;
  const items: HTMLElement[] = [left];
  if (needLogin) items.push(actionButtonEl("로그인", false, false, () => openDialog({ kind: "user", tab: "account" })));
  const blocked = done || !signedIn || mailExpired(l) || l.unsupported || busy;
  items.push(
    actionButtonEl(done ? "받음" : busy ? "받는 중" : "받기", true, blocked, () => {
      void api
        .mail({ action: "claim", id: l.id })
        .then(async (r) => {
          if (!r) return;
          setMail(r.screen);
          if (r.ok) await refreshView(); // 가방·포인트가 바뀌었다
        })
        .catch((e: unknown) => console.error(e));
    }),
  );
  return actionsRowEl(...items);
}

export function drawLetter(id: string): void {
  const l = mailView?.letters.find((x) => x.id === id);
  if (!l) {
    openDialog({ kind: "mail" });
    return;
  }
  mailHead(l.title, true);
  const scroll = el("div", "scroll mail-letter");
  scroll.append(el("div", "mail-meta", mailMeta(l)), el("div", "mail-body", l.body));
  const gift = l.gifts.length > 0 || l.unsupported;
  if (gift) scroll.appendChild(giftCard(l));
  dialogEl.appendChild(scroll);
  if (gift) dialogEl.appendChild(giftFoot(l)); // 공지 편지는 단추 줄이 없다
}

mailBtn.addEventListener("click", () => {
  openDialog({ kind: "mail" });
  void refreshMail();
});
api.onMail(setMail);
void refreshMail();
