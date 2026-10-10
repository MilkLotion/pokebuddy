// 설정창의 교환 — 교환 모달의 틀(머리·오류·닫힘 배너·화면 고르기)과 링크 만들기·링크로 참가·로그인 안내 (P10n). 상태와 진행 중 점은 trade-state.ts, 카드·제안·완료 그리기는 trade-cards.ts
// Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 모달 6화면 — Base `1036:23257`·Link Created `1036:22965`·Offer `1036:22673`·Blocked `1036:22381`·Done `1036:22089`·Error `1036:21797`.
// 값은 메인이 만든 TradeScreen(src/view/trade-screen.ts). 조작은 명령 trade.* 로 보내고, 결과와 실시간 변경은 같은 값으로 온다.
// 교환 흐름은 메인이 들고 있다. 여기서는 받은 값을 그리기만 한다.
// 그리는 곳은 교환 모달이다 — 박스 머리 메뉴의 `교환` 이 연다(2026-09-30·10-02 사용자 결정).
// 모달을 닫아도 교환은 이어진다. 진행 중이면 머리의 햄버거 단추에 점을 둔다
// 친구 교환은 탭이 아니다 — 박스 머리 메뉴의 `교환` 이 모달로 연다 (2026-10-02 사용자 결정 "교환도 메뉴로")
// (2026-09-30 사용자 결정 "교환 버튼을 만들고, 모달로 기존의 교환 창 띄우게." worklog/records/features-0930/features-0930.md 7)
import type { AccountScreen } from "../../shared/model/account.js";
import { api } from "./api.js";
import { liveInputEl } from "./search.js";
import { alertEl, dialogCloseEl } from "./widgets.js";
import type { TradeScreen } from "../../shared/model/trade.js";
import { el } from "../ui/dom.js";
import { actionButtonEl, closeDialog, dialogEl, openAnyDialog, openSubDialog } from "./dialog.js";
import { failTextOf } from "../../shared/fail-text.js";
import { loadTrade, redrawTrade, TRADE_LOCAL, tradeClosedText, tradeSend, tradeUi } from "./trade-state.js";
import { drawTradeDone, drawTradeOffer, leftText, tradeCardHead, tradeState } from "./trade-cards.js";

// manage.ts 에서 빌려 쓰는 것 — 다른 구역도 쓰므로 옮기지 않고 받는다 (P10 안내 4절)
export interface TradeHooks {
  account(): AccountScreen | null; // 계정 화면 값 — 익명·로그인 전이면 만들기·참가 대신 로그인 안내
}
let hooks: TradeHooks | null = null;
export function setTradeHooks(next: TradeHooks): void {
  hooks = next;
}
function hooksOf(): TradeHooks {
  if (!hooks) throw new Error("trade.ts 의 고리가 걸리지 않았다 — setTradeHooks 를 먼저 부른다");
  return hooks;
}

// 링크 만들기·참가 두 카드와 규칙 — Base·Link Created·Error
function drawTradeStart(t: TradeScreen, out: HTMLElement): void {
  const row = el("div", "trade-row");
  row.dataset.tut = "trade"; // 교환 튜토리얼이 밝히는 곳 — 링크 만들기·링크로 참가

  const host = el("div", "trade-card");
  if (t.phase === "hosting" && t.link) {
    host.appendChild(tradeCardHead("공유 채널", tradeState("친구 기다리는 중", "wait")));
    const left = el("div", "trade-desc");
    const time = el("strong", "trade-left", t.expiresAt ? leftText(t.expiresAt - Date.now()) : "");
    time.dataset.expires = String(t.expiresAt ?? "");
    left.append(document.createTextNode("참가 전 남은 시간 "), time);
    const acts = el("div", "trade-acts");
    const link = el("input", "trade-input trade-link");
    link.readOnly = true;
    link.value = `…#${t.link.slice(t.link.lastIndexOf("#") + 1, t.link.lastIndexOf("#") + 7)}`; // 앞 6자만 — 전체는 title 과 복사로 (Figma `Trade / Link Created` "…#Qm7xK2")
    link.title = t.link;
    link.setAttribute("aria-label", "내 교환 링크");
    const copy = actionButtonEl(tradeUi.copied ? "복사됨" : "링크 복사", true, false, () => {
      api.copyText(t.link ?? "");
      tradeUi.copied = true;
      redrawTrade();
      setTimeout(() => {
        tradeUi.copied = false;
        redrawTrade();
      }, 1500);
    });
    acts.append(link, copy, actionButtonEl("취소", false, t.busy, () => void tradeSend("trade.leave")));
    host.append(left, acts);
  } else {
    host.appendChild(tradeCardHead("공유 채널 만들기"));
    const acts = el("div", "trade-acts");
    acts.appendChild(actionButtonEl("링크 만들기", true, t.busy, () => void tradeSend("trade.create")));
    host.appendChild(acts);
  }

  const join = el("div", "trade-card");
  join.appendChild(tradeCardHead("링크로 참가"));
  const acts = el("div", "trade-acts");
  const input = liveInputEl("trade-link", tradeUi.input, "교환 링크 붙여넣기", (q) => {
    tradeUi.input = q;
  });
  input.type = "text";
  input.classList.add("trade-input");
  const go = actionButtonEl("참가", false, t.busy || t.phase === "hosting", () => {
    const link = tradeUi.input.trim();
    if (!link) return;
    void tradeSend("trade.join", undefined, { link }).then((reply) => {
      if (reply.ok) {
        tradeUi.input = "";
        redrawTrade();
      }
    });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go.click();
  });
  acts.append(input, go);
  join.appendChild(acts);

  row.append(host, join);
  out.appendChild(row);

  const rules = el("div", "trade-card");
  rules.appendChild(tradeCardHead("교환 규칙"));
  for (const line of ["한 번에 한 마리씩 맞바꿔요", "받은 포켓몬은 보낸 포켓몬이 있던 자리로 가요", "단일 포켓몬은 교환할 수 없어요"]) rules.appendChild(el("div", "trade-desc", line));
  out.appendChild(rules);
}

// 교환 모달 — 머리 "친구 교환" 과 오른쪽 위 ✕, 스크롤 본문. ✕·Esc·바깥 누르기로 닫는다(모달 공통)
export function drawTradeDialog(): void {
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "친구 교환"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  top.append(titles, x);
  const out = el("div", "scroll");
  dialogEl.append(top, out);
  const t = tradeUi.screen;
  if (!t) {
    out.appendChild(el("div", "empty-note", "교환 상태를 읽는 중이에요."));
    void loadTrade();
    return;
  }
  if (!t.available) {
    out.appendChild(el("div", "empty-note", "교환을 쓸 수 없어요."));
    return;
  }
  // 오류 배너 — 시작·완료 화면은 모달 아래쪽에 떠 있다(자리를 밀지 않는다, 2026-10-10 조작 점검 공통 원인 1). 제안·확정 화면은 바닥 줄에 한 줄로 보인다.
  // 닫힘 배너는 그 상태인 동안 늘 보이는 안내라 본문 맨 위에 둔다
  const err = t.error;
  const fail: [string, string] | null = !err
    ? null
    : err.code === "LOCAL"
      ? [TRADE_LOCAL[err.detail ?? ""] ?? "교환을 진행하지 못했어요", err.detail === "locked" ? "" : "다른 포켓몬을 골라 주세요"]
      : ((f) => [f.text, f.detail ?? ""] as [string, string])(failTextOf(err.code, "trade"));
  if (fail && t.phase !== "trading") {
    const banner = alertEl("bad", fail[0], fail[1]);
    banner.classList.add("float");
    out.appendChild(banner);
  }
  else if (!fail && t.phase === "closed") {
    const text = tradeClosedText(t.closedReason) ?? ["교환이 닫혔어요", "새 링크로 다시 시작해 주세요"];
    out.appendChild(alertEl("bad", text[0], text[1]));
  }
  if (t.phase === "trading") drawTradeOffer(t, out, fail);
  else if (t.phase === "done") drawTradeDone(t, out);
  else if (hooksOf().account()?.available && !hooksOf().account()?.signedIn) drawTradeLogin(out);
  else drawTradeStart(t, out);
}

// 로그인 전(익명·분실) — 만들기·참가 대신 로그인 안내. 진행 중인 교환은 끝까지 보인다 (design-p2.md 5절)
function drawTradeLogin(out: HTMLElement): void {
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("교환은 로그인해야 할 수 있어요"));
  const acts = el("div", "trade-acts");
  acts.appendChild(actionButtonEl("로그인", true, false, () => openSubDialog({ kind: "user", tab: "account" }))); // 로그인하러 잠깐 간다 — 사용자 모달을 닫으면 교환으로 돌아온다
  card.appendChild(acts);
  out.appendChild(card);
}

// 참가 전 남은 시간 — 글자만 1초마다 바꾼다. 본문을 다시 그리지 않는다
setInterval(() => {
  for (const node of document.querySelectorAll<HTMLElement>(".trade-left")) {
    const at = Number(node.dataset.expires);
    if (at) node.textContent = leftText(at - Date.now());
  }
}, 1000);
