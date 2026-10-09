// 친선 배틀 모달 — 교환 모달의 틀(링크 만들기·링크로 참가 카드, 규칙 상자, 오류·닫힘 배너, 로그인 안내)과 만남 화면(양쪽 배틀 파티·준비)
// 규칙 docs/specs/adventure.md "친선 배틀"(2026-10-10 사용자 확정 "진행"). Figma 05 `15 모험` 줄 4 — 시작 1879:5768, 친구 기다림 1879:6474,
//   로그인 필요 1879:7191, 오류 1879:7874, 만남 1879:12592, 만남·내가 준비 1879:9281, 만남·출전 불가 1879:9964. 줄은 02 `Friendly Battle Side` 1879:4771, 준비 표시는 01 `Ready Mark` 1879:4594
// 값은 메인이 만든 FriendlyScreen(src/online/friendly-session.ts). 조작은 api.friendly 로 보내고 결과와 실시간 변경은 같은 값으로 온다.
// 둘 다 준비하면 서버가 판을 돌리고, 메인이 같은 시각에 배틀 창을 연다. 모달을 닫아도 채널은 이어진다
import { failTextOf } from "../../shared/fail-text.js";
import type { BattlePickSlotView } from "../../shared/model/battle-net.js";
import type { FriendlyAction, FriendlyScreen } from "../../shared/model/friendly.js";
import { el } from "../ui/dom.js";
import { api } from "./api.js";
import { pickCell } from "./battle-opponent.js";
import { actionButtonEl, dialogEl, dismissDialog, drawDialog, openSubDialog } from "./dialog.js";
import { liveInputEl } from "./search.js";
import { ui } from "./state.js";
import { leftText, tradeCardHead, tradeState } from "./trade-cards.js";
import { alertEl, dialogCloseEl } from "./widgets.js";

const RULES = ["보상과 쿨타임이 없어요", "둘 다 준비하면 바로 한 판 싸워요", "결과는 내 전적에 넣지 않아요"];
const CLOSED: Record<string, [string, string]> = {
  host_left: ["친구가 친선 배틀을 닫았어요", "새 링크로 다시 시작해 주세요"],
  guest_left: ["친구가 친선 배틀을 닫았어요", "새 링크로 다시 시작해 주세요"],
  expired: ["친선 배틀 시간이 끝났어요", "새 링크로 다시 시작해 주세요"],
};

const st: { screen: FriendlyScreen | null; input: string; copied: boolean } = { screen: null, input: "", copied: false };

const redraw = (): void => {
  if (ui.dialog?.kind === "friendly") drawDialog();
};

function set(screen: FriendlyScreen | null): void {
  if (screen) st.screen = screen;
  redraw();
}
api.onFriendly(set);

async function send(a: FriendlyAction): Promise<FriendlyScreen | null> {
  const s = await api.friendly(a).catch(() => null);
  set(s);
  return s;
}

// 모달을 열 때 — 지금 상태를 읽는다
export function loadFriendly(): void {
  void send({ action: "view" });
}

function drawLogin(out: HTMLElement): void {
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("친선 배틀은 로그인해야 할 수 있어요"));
  const acts = el("div", "trade-acts");
  acts.appendChild(actionButtonEl("로그인", true, false, () => openSubDialog({ kind: "user", tab: "account" })));
  card.appendChild(acts);
  out.appendChild(card);
}

// 링크 만들기·참가 두 카드와 규칙 — 시작·친구 기다림·오류
function drawStart(f: FriendlyScreen, out: HTMLElement): void {
  const row = el("div", "trade-row");
  const host = el("div", "trade-card");
  if (f.phase === "hosting" && f.link) {
    host.appendChild(tradeCardHead("공유 채널", tradeState("친구 기다리는 중", "wait")));
    const left = el("div", "trade-desc");
    const time = el("strong", "trade-left", f.expiresAt ? leftText(f.expiresAt - Date.now()) : "");
    time.dataset.expires = String(f.expiresAt ?? "");
    left.append(document.createTextNode("참가 전 남은 시간 "), time);
    const acts = el("div", "trade-acts");
    const link = el("input", "trade-input trade-link");
    link.readOnly = true;
    link.value = `…#${f.link.slice(f.link.lastIndexOf("#") + 1, f.link.lastIndexOf("#") + 7)}`; // 앞 6자만 — 전체는 title 과 복사로
    link.title = f.link;
    link.setAttribute("aria-label", "내 친선 배틀 링크");
    const copy = actionButtonEl(st.copied ? "복사됨" : "링크 복사", true, false, () => {
      api.copyText(f.link ?? "");
      st.copied = true;
      redraw();
      setTimeout(() => {
        st.copied = false;
        redraw();
      }, 1500);
    });
    acts.append(link, copy, actionButtonEl("취소", false, f.busy, () => void send({ action: "leave" })));
    host.append(left, acts);
  } else {
    host.appendChild(tradeCardHead("공유 채널 만들기"));
    const acts = el("div", "trade-acts");
    acts.appendChild(actionButtonEl("링크 만들기", true, f.busy, () => void send({ action: "create" })));
    host.appendChild(acts);
  }
  const join = el("div", "trade-card");
  join.appendChild(tradeCardHead("링크로 참가"));
  const acts = el("div", "trade-acts");
  const input = liveInputEl("friendly-link", st.input, "친선 배틀 링크 붙여넣기", (q) => {
    st.input = q;
  });
  input.type = "text";
  input.classList.add("trade-input");
  const go = actionButtonEl("참가", false, f.busy || f.phase === "hosting", () => {
    const link = st.input.trim();
    if (!link) return;
    void send({ action: "join", link }).then((s) => {
      if (s?.phase === "meet") {
        st.input = "";
        redraw();
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
  rules.appendChild(tradeCardHead("친선 배틀 규칙"));
  for (const line of RULES) rules.appendChild(el("div", "trade-desc", line));
  out.appendChild(rules);
}

// 배틀 파티 한 줄 — 이름과 오른쪽 위 준비 표시, 6칸. 준비한 줄은 옅은 바탕 (02 `Friendly Battle Side`)
function sideRow(name: string, party: (BattlePickSlotView | null)[] | null, ready: boolean): HTMLElement {
  const row = el("div", ready ? "preset-row bo-row fb-row on" : "preset-row bo-row fb-row");
  const head = el("div", "po-head");
  head.append(el("span", "po-name", name), el("span", ready ? "fb-ready on" : "fb-ready", ready ? "준비 완료" : "준비 전"));
  const cells = el("div", "po-cells");
  for (let i = 0; i < 6; i++) cells.appendChild(pickCell(party?.[i] ?? null));
  row.append(head, cells);
  return row;
}

function drawMeet(f: FriendlyScreen, out: HTMLElement): void {
  const list = el("div", "preset-list bo-list");
  // 두 줄 사이 `VS` — 옅은 선, 청록 알약, 옅은 선 (Figma 02 `VS Divider` 1887:109999, 2026-10-10 사용자 "진행해봐")
  const vs = el("div", "fb-vs");
  vs.append(el("i"), el("span", undefined, "VS"), el("i"));
  list.append(sideRow("나", f.mine, f.myReady), vs, sideRow(f.friendName ?? "친구", f.friend, f.friendReady));
  out.appendChild(list);
  // 바닥 줄 — 실패와 출전 불가는 배너 대신 왼쪽 한 줄 글자. 단추 자리는 그대로다
  const err = f.error ? failTextOf(f.error.code, "friendly").text : f.myBlocked ? "출전할 수 없는 포켓몬이 있어요" : "";
  const note = el("div", "fb-error", err);
  const leave = actionButtonEl("나가기", false, f.busy, () => void send({ action: "leave" }));
  const ready = actionButtonEl(f.myReady ? "준비 취소" : "준비", !f.myReady, f.busy || f.running || (!f.myReady && f.myBlocked), () => void send({ action: "ready", ready: !f.myReady }));
  ready.classList.add("fb-go");
  const acts = el("div", "actions");
  acts.append(note, leave, ready);
  out.appendChild(acts);
}

export function drawFriendly(): void {
  const f = st.screen;
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "친선 배틀"));
  if (f?.phase === "meet") titles.appendChild(el("div", "sub", "둘 다 준비하면 바로 시작해요"));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", dismissDialog); // ✕ 는 한 단계 물러나기 (docs/specs/ui-components.md C-13 "닫기 규칙")
  top.append(titles, x);
  const out = el("div", "scroll");
  dialogEl.append(top, out);
  if (!f) {
    out.appendChild(el("div", "empty-note", "친선 배틀 상태를 읽는 중이에요."));
    return;
  }
  if (!f.available) {
    out.appendChild(el("div", "empty-note", "친선 배틀을 쓸 수 없어요."));
    return;
  }
  if (f.phase === "meet") {
    drawMeet(f, out);
    return;
  }
  // 오류·닫힘 배너 — 같은 자리에 제목과 문구만 바뀐다
  const fail = f.error && f.error.code !== "FRIENDLY_LOGIN_REQUIRED" ? failTextOf(f.error.code, "friendly", "ko", f.error.detail) : null;
  if (fail) out.appendChild(alertEl("bad", fail.text, fail.detail ?? ""));
  else if (f.phase === "closed") {
    const [title, detail] = CLOSED[f.closedReason ?? ""] ?? ["친선 배틀이 닫혔어요", "새 링크로 다시 시작해 주세요"];
    out.appendChild(alertEl("bad", title, detail));
  }
  if (!f.signedIn) drawLogin(out);
  else drawStart(f, out);
}

// 참가 전 남은 시간 — 교환 모달의 같은 1초 시계가 .trade-left 글자를 바꾼다 (trade.ts)
