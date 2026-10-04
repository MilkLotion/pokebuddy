// 관리 창 — 스냅샷을 받아 그리고, 조작은 명령으로 보낸다. 게임 규칙은 하나도 여기 두지 않는다.
//
// 값은 메인이 이미 화면이 읽을 모양으로 바꿔서 준다 (src/tx/snapshot.ts, src/tx/lists.ts). 여기서는 배치와 글자만 만든다.
// 명령을 보내면 새 스냅샷을 다시 받아 그린다. 화면이 스스로 상태를 들고 있지 않는다.
// 도감과 CLI 연결은 스냅샷에 없다. 필요할 때만 따로 부르고 그다음부터는 들고 있는다.
// 모달은 하나만 뜬다. 어느 모달인지는 `dialog` 하나가 가진다 — 겹쳐 띄우지 않는다.
import { api } from "./api.js";
import { goTo, openDialogOrPet, openPet } from "./routes.js";
import { coachIdOf, drawTutorial, restartAreaTutorial } from "./tutorial.js";
import { BOX_ICON, boxSlot, drawBox, drawBoxOrder, setBoxTabHooks } from "./box-tab.js";
import { drawParty, setPartyTabHooks, stepPreset, stopPresetRename } from "./party-tab.js";
import { closeSwap, onPartyAction, partyLink, syncPartyDevice } from "./party-link.js";
import { drawGuide } from "./guide.js";
import { closeSettingSelect, drawSettings, drawUser, syncIdentify } from "./settings.js";
import { boxUi, hold } from "./box-state.js";
import { endHold, setBoxMoveHooks } from "./box-move.js";
import { currentAccount, setAccountHooks } from "./account.js";
import { drawTradeDialog, loadTrade, redrawTrade, setTradeHooks } from "./trade.js";
import { drawLetter, drawMail } from "./mail.js";
import { drawNotes, drawNotesNew, loadUpdate, openUnseenNotes } from "./update-notes.js";
import { drawAchievements } from "./achievements.js";
import { onPetAction, petLink, stepPet, syncPetDevice } from "./pet-link.js";
import { bagLink, clearBagResult, dropGoneBagPick, leaveBag, onBagAction, setBagLinkHooks, stepBag, syncBagDevice } from "./bag-link.js";
import { bagStepRows, drawBag } from "./bag-tab.js";
import { dropGoneShopPick, leaveShop, onShopAction, setShopLinkHooks, shopLink, stepShop, syncShopDevice } from "./shop-link.js";
import { closeShopRegion, drawPool, drawShop, isShopRegionOpen, shopStepRows } from "./shop-tab.js";
import { onDexClosed, setDexLinkHooks } from "./dex-link.js";
import { clearDexPick, closeDexRegion, drawDex, enterDex, forgetDexRows, isDexRegionOpen, leaveDex, setDexTabHooks, stepDex } from "./dex-tab.js";
import { drawEvolve } from "./evolve.js";
import { drawNature, drawNatureTarget } from "./nature.js";
import { drawForm, drawMega } from "./pet-forms.js";
import { restoreSearchFocus, typingSearch } from "./search.js";
import { alertEl, dialogCloseEl, lvNature } from "./widgets.js";
import { iconOf, loadArt, portraitOf } from "./art-cache.js";
import { clockTick, refreshView, setLiveHooks } from "./live.js";
import type { EggView, Snapshot } from "../../shared/model/snapshot.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { josa } from "../../shared/josa.js";
import { buttonEl, el, needEl } from "../ui/dom.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { pointText } from "../../shared/count-text.js";
import { lastReplyOf, sendCommand, setCommandHooks } from "./command.js";
import { bodyEl, redrawBody, registerAfterDraw, registerBodySync, registerTab, setShellHooks } from "./shell.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, dismissDialog, drawDialog, openAnyDialog, registerDialog, scrimEl, setDialogHooks } from "./dialog.js";
import type { Hatched, TabId } from "./dialog-types.js";
import { petInView, ui } from "./state.js";

// 명령의 뒤처리 — 다시 읽기·도감 비우기는 여기에 있다 (command.ts)
setCommandHooks({
  reload: () => refreshView(),
  touchesDex: () => forgetDexRows(),
});

// 모달의 뒤처리 — 검색·돌보미집 겹침·화면 표시·튜토리얼·경고 배너는 여기에 있다 (dialog.ts)
setDialogHooks({
  isTyping: (root) => typingSearch(root),
  drawUnder: () => drawUnder(),
  alertEl: (text) => alertEl("bad", "", text),
  afterDraw: () => {
    restoreSearchFocus();
    syncIdentify();
    drawTutorial(); // 대화상자 안의 튜토리얼(설정 › 화면의 놀이공간)
  },
  afterEmpty: () => syncIdentify(),
  onScrimChanged: () => drawTutorial(),
  openAny: (next) => openDialogOrPet(next),
});

// 도감 — 칸을 누른 것은 도감 튜토리얼의 목표 행동이다. 기기 창이 닫히면 고른 칸을 비우고, 옆 도감이 바뀌면 파티 상세 기기 창을 맞춘다
setDexTabHooks({
  onPicked: () => {
    if (coachIdOf() === "dex") void sendCommand("tutorial.done", "dex");
  },
});
setDexLinkHooks({
  pickClosed: () => clearDexPick(),
  besideChanged: () => syncPetDevice(),
});

// 상점 기기 창의 이전·다음 — 상점 탭이 보이는 순서로 돈다
setShopLinkHooks({ stepRows: (shop) => shopStepRows(shop) });

// 가방 기기 창 — 이전·다음은 가방 탭의 순서, 파티 줄의 ◀ ▶ 는 파티 탭의 프리셋 넘김
setBagLinkHooks({ stepRows: (bag) => bagStepRows(bag), stepPreset: (delta) => stepPreset(delta) });

// 옮기기 — 커서를 따라오는 칸은 박스 칸과 같은 모습이다
setBoxMoveHooks({ ghostCell: (pet) => boxSlot(pet, () => undefined) });

// 파티 탭 — 카드는 개체 상세를, 오른쪽 누르기는 포켓몬 메뉴를 연다
setPartyTabHooks({ openPet: (id) => openPet(id), askPetMenu: (id) => askPetMenu(id) });

// 박스 탭 — 칸은 개체 상세를, 오른쪽 누르기는 포켓몬 메뉴를 연다. 넘김 줄의 돌보미집 단추는 돌보미집 모달 쪽에 있다
setBoxTabHooks({ openPet: (id) => openPet(id), askPetMenu: (id) => askPetMenu(id), daycareButton: (v) => daycareOpenButton(v) });

// 1초 시계 — 탭이 아는 끊기는 조작(끌기·박스 이름 입력)과 시간 값만 바뀐 뒤의 기기 창 맞추기 (live.ts)
setLiveHooks({
  isHolding: () => hold.drag != null || boxUi.renaming,
  afterLive: () => {
    syncPetDevice();
    syncShopDevice();
    syncBagDevice();
  },
});

setTradeHooks({
  account: () => currentAccount(),
});
// 계정의 뒤처리 — 교환 모달 다시 그리기는 trade.ts 에 있다 (account.ts)
setAccountHooks({
  redrawTrade: () => redrawTrade(),
});
// 탭을 옮길 때 탭과 무관한 정리 — 개체 상세·든 개체·프리셋 이름 고치기·가방 결과 줄 (shell.ts setTab)
setShellHooks({
  isTyping: (root) => typingSearch(root),
  beforeTabChange: () => {
    ui.detailPet = null; // 개체 상세는 파티·박스에서만 열린다 — 다음 그리기의 syncPetDevice 가 기기 창을 닫는다
    if (hold.box) endHold(); // 옮기기로 든 개체는 박스 탭을 나가면 내려놓는다
    stopPresetRename();
  },
  afterTabChange: () => {
    clearBagResult(); // 가방 결과 줄은 탭을 떠나면 지운다
  },
});



// 친구 교환은 탭이 아니다 — 박스 머리 메뉴의 `교환` 이 모달로 연다 (2026-10-02 사용자 결정 "교환도 메뉴로")
// (2026-09-30 사용자 결정 "교환 버튼을 만들고, 모달로 기존의 교환 창 띄우게." worklog/records/features-0930/record.md 7)

// 상점 분류 — `전체` 는 두지 않는다. 처음 여는 탭은 첫 탭 `알` (2026-09-29 사용자 결정 "상점에 전체는 없애")



// 성격을 골라야 하는 도구 — 고르는 화면이 아직 없어 여기서 막는다





// ── 박스 ───────────────────────────────────────────────────────────────────────

let openingAll = false; // 모두 열기가 알을 차례로 여는 중 — 단추를 다시 누르지 못하게

// 넘김 줄의 돌보미집 단추 — 집 아이콘, `정렬` 왼쪽. 부화할 수 있는 알이 있으면 오른쪽 위 점
// (2026-10-02 사용자 결정 "돌보미집은 집아이콘 만들어서 정렬 왼쪽에 버튼으로 두자")
function daycareOpenButton(v: Snapshot): HTMLButtonElement {
  const b = buttonEl("icon-button daycare-open");
  b.innerHTML = BOX_ICON.house; // 고정 그림 — 사용자 값이 들어가지 않는다
  b.setAttribute("aria-label", "돌보미집");
  b.title = "돌보미집";
  b.dataset.tut = "hatch"; // 부화 튜토리얼이 밝히는 곳
  const dot = el("span", "dot");
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = !v.eggs.list.some((e) => e.ready);
  b.appendChild(dot);
  b.addEventListener("click", () => openAnyDialog({ kind: "daycare" }));
  return b;
}

// 돌보미집 칸 — 알 그림과 `열기`(준비됨) 또는 남은 시간. 준비된 칸은 톤 바탕 (Figma 05 `Box / Daycare Modal` `1093:23698`)
function daycareCell(egg: EggView, live: boolean): HTMLElement {
  const cell = el("div", egg.ready ? "egg ready" : "egg");
  cell.title = egg.name;
  cell.appendChild(iconOf(egg.icon, "shell"));
  if (egg.ready) {
    const openEgg = buttonEl("primary", "열기");
    openEgg.disabled = !live;
    openEgg.addEventListener("click", () => void openEggAndShow(egg.id, "daycare"));
    cell.appendChild(openEgg);
  } else {
    const note = el("div", "note", egg.noteText);
    note.dataset.liveEgg = egg.id; // 1초 시계가 이 글자만 고친다 (applyLive)
    cell.appendChild(note);
  }
  return cell;
}

// 돌보미집 모달 — 제목·부제(알 수, 준비 수)·✕, 3×2 칸. live 가 아니면 부화 결과 창 뒤에 깔린 모습이다(누를 수 없다)
function drawDaycare(root: HTMLElement = dialogEl, live = true): void {
  const v = ui.view;
  if (!v) {
    if (live) closeDialog();
    return;
  }
  const ready = v.eggs.list.filter((e) => e.ready).length;
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.append(el("h2", undefined, "돌보미집"), el("div", "sub", `알 ${v.eggs.used} / ${v.eggs.size}${ready ? ` · 부화 준비 ${ready}` : ""}`));
  top.appendChild(titles);
  // 모두 열기 — 준비된 알을 칸 순서대로 모두 열고 결과를 하나씩 보인다. 준비된 알이 없으면 흐리다. 자리는 늘 있다
  // (2026-10-02 사용자 결정, Figma 05 `Box / Daycare Modal`). 부화 결과 창 뒤에 깔린 모습(live 아님)에도 같은 자리에 그린다
  const all = buttonEl("act open-all", "모두 열기");
  all.disabled = !live || ready === 0 || openingAll;
  all.addEventListener("click", () => void openAllEggs());
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.disabled = !live;
  x.addEventListener("click", closeDialog);
  top.append(all, x);
  const grid = el("div", "daycare-grid");
  for (let i = 0; i < v.eggs.size; i++) {
    const egg = v.eggs.list[i];
    grid.appendChild(egg ? daycareCell(egg, live) : el("div", "egg empty"));
  }
  root.append(top, grid);
}

// 알 하나를 연다 — 결과를 돌려준다. 실패하면 null (실패 문구는 send 가 띄운다)
async function openEgg(eggId: string): Promise<Hatched | null> {
  if (!(await sendCommand("egg.open", eggId, {}, { keepOpen: true }))) return null;
  const r = lastReplyOf();
  if (!r) return null;
  const egg = r.egg as { id?: unknown } | undefined;
  if (egg && typeof egg.id === "string") return { eggId: egg.id };
  if (typeof r.petId === "string") return { petId: r.petId, ...(typeof r.slotIndex === "number" ? { slotIndex: r.slotIndex } : {}) };
  return null;
}

// 알 열기 — 끝나면 부화 결과 창을 연다. 돌보미집 모달에서 열면 그 모달 위에 겹친다 (2026-09-30 사용자 "열기를 누르면 모달열린채로 부화결과창")
async function openEggAndShow(eggId: string, over?: "daycare"): Promise<void> {
  const got = await openEgg(eggId);
  if (got) openAnyDialog({ kind: "hatched", ...got, ...(over ? { over } : {}) });
}

// 모두 열기 — 준비된 알을 칸 순서대로 하나씩 연다(알마다 egg.open 하나). 다 연 뒤 결과를 하나씩 보인다.
// 여는 중에 실패하면 거기서 멈추고 그때까지 연 결과만 보인다. 하나도 못 열면 실패 문구가 돌보미집 모달에 남는다
async function openAllEggs(): Promise<void> {
  if (openingAll || !ui.view) return;
  const ids = ui.view.eggs.list.filter((e) => e.ready).map((e) => e.id);
  if (!ids.length) return;
  openingAll = true;
  const queue: Hatched[] = [];
  try {
    for (const id of ids) {
      const got = await openEgg(id);
      if (!got) break;
      queue.push(got);
    }
  } finally {
    openingAll = false;
  }
  const first = queue[0];
  if (first) openAnyDialog({ kind: "hatched", ...first, over: "daycare", ...(queue.length > 1 ? { queue, at: 0 } : {}) });
  else drawDialog(); // 단추의 흐림을 되돌린다
}

// 부화 결과 — Figma 05 `Box / Daycare Modal · Hatch Result` `1096:22424`. 제목, 초상·이름·타입·레벨, `확인` 만 둔 작은 창.
// 들어간 자리 안내 줄은 뺐다 — 파티·박스 화면에서 본다 (2026-09-30 사용자 "info 는 삭제해서 부화결과창 ui를 작게")
// 랜덤알에서 단일 포켓몬 알이 나오면 같은 창으로 그 알을 알린다 (docs/specs/game.md 단일 포켓몬 알). 이때는 알이 어디 갔는지 안내가 필요해 두 줄을 남긴다
function drawHatched(petId?: string, eggId?: string, over?: "daycare", queue?: Hatched[], at = 0): void {
  const card = el("div", "nat-card");
  const info = el("div", "info-box");
  if (eggId) {
    const egg = ui.view?.eggs.list.find((e) => e.id === eggId);
    dialogEl.append(...dialogHead("알에서 새 알이 나왔어요", ""));
    card.append(iconOf(egg?.icon ?? "egg:random", "portrait"), el("div", "name", egg?.name ?? "알"));
    info.append(el("div", undefined, "돌보미집에 들어갔어요."), el("div", "note", "아직 얻지 않은 포켓몬이 나와요."));
  } else {
    const pet = petId ? petInView(petId) : undefined;
    if (!pet) {
      closeDialog();
      return;
    }
    dialogEl.append(...dialogHead("알이 부화했어요", ""));
    const tags = el("div", "tags");
    pet.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, pet.typeIds[i])));
    tags.appendChild(el("span", "note", lvNature(pet.level, pet.nature)));
    const name = el("div", "name", pet.name);
    if (pet.shiny) name.appendChild(shinyIcon(16));
    card.append(portraitOf(pet.look, pet.shiny, "portrait"), name, tags);
  }
  // 모두 열기의 결과는 `다음 (1 / N)` 으로 넘기고 마지막만 `확인 (N / N)` 이다. ✕·Esc·바깥 누르기는 남은 결과를 건너뛴다(dismiss)
  const next = queue?.[at + 1];
  const count = queue ? ` (${at + 1} / ${queue.length})` : "";
  const done = actionButtonEl(`${next ? "다음" : "확인"}${count}`, true, false, () => {
    if (next && queue) openAnyDialog({ kind: "hatched", ...next, ...(over ? { over } : {}), queue, at: at + 1 });
    else if (over) openAnyDialog({ kind: "daycare" });
    else closeDialog();
  });
  done.dataset.confirm = ""; // Space·Enter 가 누르는 단추 (아래 keydown)
  dialogEl.append(card);
  if (info.childElementCount) dialogEl.appendChild(info);
  dialogEl.appendChild(actionsRowEl(done));
}

// 겹친 모달의 뒤 — 돌보미집 모달 모습과 한 겹 더 어두운 막 (Figma 05 `1096:22424`)
const underEl = el("div", "dialog daycare under");
const underScrimEl = el("div", "scrim-under");
underEl.hidden = true;
underScrimEl.hidden = true;
scrimEl.insertBefore(underScrimEl, dialogEl);
scrimEl.insertBefore(underEl, underScrimEl);
underScrimEl.addEventListener("click", dismissDialog);
function drawUnder(): void {
  const stacked = ui.dialog?.kind === "hatched" && ui.dialog.over === "daycare";
  underEl.hidden = !stacked;
  underScrimEl.hidden = !stacked;
  underEl.replaceChildren();
  if (stacked) drawDaycare(underEl, false);
}

// ── 포켓몬 메뉴 ────────────────────────────────────────────────────────────────
// 파티 카드·박스 칸을 우클릭하면 무대 우클릭과 같은 메뉴를 메인이 커서 자리에 띄운다 (src/view/menus.ts petMenu, 2026-10-02 사용자 결정).
// 좌클릭은 개체 상세를 연다. 그래서 이 메뉴에는 `상세 보기` 가 없다 (같은 날 사용자 결정 — 좌클릭 메뉴가 어색했다).
// 메뉴와 모습 말풍선은 메뉴 창이 그린다 (src/renderer/windows/menu.ts). 고른 모습·옮기기·팔기는 경로(routes.ts goTo)로 돌아온다.
// 메뉴를 띄울 길이 없으면(개발용 실행기) 아무것도 하지 않는다
function askPetMenu(petId: string): void {
  void api.petMenu(petId).catch(() => undefined);
}


// 포켓몬 팔기 확인 — 되돌릴 수 없어 확인을 받는다. 판매가는 메뉴를 띄울 때 메인이 잰 값이다 (src/shop/sell-pet.ts, Figma 05 `Box / Sell Confirm`)
function drawSellPet(petId: string, price: number): void {
  const pet = petInView(petId);
  if (!pet) {
    closeDialog();
    return;
  }
  dialogEl.append(...dialogHead(`${pet.name}${josa(pet.name, "을/를")} 팔까요?`, ""));
  const body = el("p", "acct-confirm-body", `${pointText(price)}를 받아요. 판 포켓몬은 되돌릴 수 없어요.`); // 확인 창 본문 — 계정 확인 창과 같은 글자
  const go = actionButtonEl("팔기", true, false, () => void sendCommand("pet.sell", pet.id));
  dialogEl.append(body, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), go));
}

// 정렬·지방·설정 목록은 바깥을 누르면 닫는다
document.addEventListener("click", () => {
  if (closeSettingSelect()) drawDialog();
  if (!boxUi.sortOpen && !boxUi.menuOpen && !isDexRegionOpen() && !isShopRegionOpen()) return;
  boxUi.sortOpen = false;
  boxUi.menuOpen = false;
  closeDexRegion();
  closeShopRegion();
  redrawBody();
});

// ── 그리기 ─────────────────────────────────────────────────────────────────────

// 탭 아이콘 — Figma 03 `Primary Navigation` `208:542` 의 16px 그림 그대로(선 색은 CSS)
const TAB_ICON: Record<TabId, string> = {
  party: '<path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z" stroke-width="1.5"/><path d="M2.7 8h3.6m3.4 0h3.6" stroke-width="1.5" stroke-linecap="round"/><path d="M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" stroke-width="1.5"/>',
  box: '<path d="M3.5 2.5h9c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5V4c0-.83.67-1.5 1.5-1.5Z" stroke-width="1.5" stroke-linecap="round"/><path d="M2 6.5h12M6.5 9.5h3" stroke-width="1.5" stroke-linejoin="round"/>',
  dex: '<path d="M4 3.25h7.25c.97 0 1.75.78 1.75 1.75v6.25c0 .97-.78 1.75-1.75 1.75h-6.5C3.78 13 3 12.22 3 11.25V5c0-.97.78-1.75 1.75-1.75H4Z" stroke-width="1.35" stroke-linejoin="round"/><path d="M4.1 3.2 5 1.9m.6 3.7h3.9M5.6 8h4.8m-4.8 2.4h3.1" stroke-width="1.35" stroke-linecap="round"/><circle cx="4.9" cy="5.6" r=".55" fill="currentColor" stroke="none"/><circle cx="4.9" cy="8" r=".55" fill="currentColor" stroke="none"/><circle cx="4.9" cy="10.4" r=".55" fill="currentColor" stroke="none"/>',
  shop: '<path d="M3.2 6.4h9.6v6.2H3.2V6.4Z" stroke-width="1.25" stroke-linejoin="round"/><path d="M2.5 6.4 3.7 3.2h8.6l1.2 3.2h-11Z" stroke-width="1.25" stroke-linejoin="round"/><path d="M6.55 12.6V9.2h2.9v3.4" stroke-width="1.25" stroke-linejoin="round"/><circle cx="8" cy="4.8" r="1.1" stroke-width="1.05"/><path d="M6.9 4.8h.55m1.1 0h.55" stroke-width="1.05" stroke-linecap="round"/>',
  bag: '<path d="M12.5 5.5h-9C2.67 5.5 2 6.17 2 7v6c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V7c0-.83-.67-1.5-1.5-1.5Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5V4a2.75 2.75 0 0 1 5.5 0v1.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

// 탭 — 등록한 순서대로 탭 줄에 선다 (shell.ts). 나갈 때 그 탭의 기기 창을 닫는다
registerTab({ id: "party", label: "파티", icon: TAB_ICON.party, draw: (v) => drawParty(v) });
// 교체 화면은 박스 탭을 나가면 끝난다 — 다음 그리기의 syncPartyDevice 가 파티 기기 창을 닫는다
registerTab({ id: "box", label: "박스", icon: TAB_ICON.box, draw: (v) => drawBox(v), leave: () => closeSwap() });
registerTab({
  id: "dex",
  label: "도감",
  icon: TAB_ICON.dex,
  draw: (v) => drawDex(v),
  enter: () => enterDex(),
  leave: () => leaveDex(),
});
// 상점·가방 기기 창 — 다음 그리기의 syncShopDevice·syncBagDevice 가 닫는다
registerTab({
  id: "shop",
  label: "상점",
  icon: TAB_ICON.shop,
  draw: (v) => drawShop(v),
  leave: () => leaveShop(),
});
registerTab({
  id: "bag",
  label: "가방",
  icon: TAB_ICON.bag,
  draw: (v) => drawBag(v),
  leave: () => leaveBag(),
});

// 본문을 그리기 전 기기 창 맞추기 — 고른 것이 사라졌으면 닫는다. 순서: 파티 상세 → 상점 → 가방 → 파티
registerBodySync(() => {
  if (ui.detailPet && !petInView(ui.detailPet)) ui.detailPet = null; // 개체 상세 — 옆 기기 창. 개체가 사라졌으면 닫는다
  syncPetDevice();
});
registerBodySync(() => {
  dropGoneShopPick();
  syncShopDevice();
});
registerBodySync(() => {
  dropGoneBagPick(); // 다 쓰거나 팔았다
  syncBagDevice();
});
registerBodySync(() => syncPartyDevice());
// 본문을 그린 뒤 — 저장 실패 줄 → 검색 칸 초점 → 튜토리얼
registerAfterDraw(() => drawSaveFailing());
registerAfterDraw(() => restoreSearchFocus());
registerAfterDraw(() => drawTutorial());

// 이어진 저장 실패 안내 — 제목 줄 바로 아래. 한 번 저장하면 다음 새로 읽기에서 사라진다. 조작은 막지 않는다
// Figma 05 `Party / Save Failing` `716:17993` (Alert Tone=Error). 2026-09-27 사용자 "그렇게해"
function drawSaveFailing(): void {
  if (!ui.view?.saveFailing) return;
  const banner = alertEl("bad", "저장하지 못하고 있어요", "3번 이어서 저장하지 못했어요. 디스크 공간과 폴더 권한을 확인해 주세요.");
  banner.classList.add("save-failing");
  const first = bodyEl.firstElementChild;
  if (first?.classList.contains("head")) first.after(banner);
  else bodyEl.prepend(banner);
}

// ── 모달 · 공통 ────────────────────────────────────────────────────────────────

// ── 모달 · 여닫기 ──────────────────────────────────────────────────────────────
// 여닫기·가림막·스크롤 되돌리기는 dialog.ts. 여기서는 모달 종류마다 폭·헤더 표시·그리기를 등록한다
// 폭: 고르기는 격자가 들어가서 넓고, 목록은 길어서 안에서 스크롤한다
registerDialog({ kind: "evolve", shape: "dialog", draw: (d) => drawEvolve(d.petId, d.to) });
registerDialog({ kind: "nature", shape: "dialog", draw: (d) => drawNature(d.petId, d.pick, d.itemId) });
registerDialog({ kind: "nature-target", shape: "dialog", draw: (d) => drawNatureTarget(d.itemId) });
// 칩을 바꿔도 창 높이가 그대로다 — 줄 수가 달라도 대화상자가 움직이지 않는다
registerDialog({ kind: "achievements", shape: "dialog tall steady", headerButton: "open-achievements", draw: () => drawAchievements() });
registerDialog({
  kind: "settings",
  shape: "dialog settings",
  headerButton: "open-settings",
  draw: (d) => drawSettings(d.tab),
  // 설정 › 화면에 새로 들어오면 화면 탭 튜토리얼은 1단계부터
  enter: (d, prev) => {
    if (d.tab === "display" && !(prev?.kind === "settings" && prev.tab === "display")) restartAreaTutorial();
  },
});
registerDialog({ kind: "user", shape: "dialog settings", headerButton: "open-user", draw: (d) => drawUser(d.tab) });
registerDialog({ kind: "guide", shape: "dialog tall", draw: () => drawGuide() });
registerDialog({ kind: "hatched", shape: "dialog hatched", draw: (d) => drawHatched(d.petId, d.eggId, d.over, d.queue, d.at) });
registerDialog({ kind: "daycare", shape: "dialog daycare", draw: () => drawDaycare() });
registerDialog({ kind: "box-order", shape: "dialog daycare box-order", draw: () => drawBoxOrder() });
registerDialog({ kind: "pool", shape: "dialog daycare egg-pool", draw: (d) => drawPool(d.productId, d.page) });
registerDialog({ kind: "form", shape: "dialog", draw: (d) => drawForm(d.petId, d.to) });
registerDialog({ kind: "mega", shape: "dialog", draw: (d) => drawMega(d.petId, d.to) });
registerDialog({ kind: "sell-pet", shape: "dialog", draw: (d) => drawSellPet(d.petId, d.price) });
registerDialog({ kind: "notes", shape: "dialog settings notes", draw: (d) => drawNotes(d.pick) });
registerDialog({ kind: "notes-new", shape: "dialog settings notes-new", draw: (d) => drawNotesNew(d.version) });
registerDialog({ kind: "mail", shape: "dialog settings mail", headerButton: "open-mail", draw: () => drawMail() });
registerDialog({ kind: "letter", shape: "dialog settings mail", draw: (d) => drawLetter(d.id) });
registerDialog({ kind: "trade", shape: "dialog trade", draw: () => drawTradeDialog() });

// ── 헤더 단추 · 가림막 · Esc ─────────────────────────────────────────────────────

needEl("open-achievements", HTMLButtonElement, "manage").addEventListener("click", () => openAnyDialog({ kind: "achievements" }));
needEl("open-settings", HTMLButtonElement, "manage").addEventListener("click", () => openAnyDialog({ kind: "settings", tab: "general" }));
needEl("open-user", HTMLButtonElement, "manage").addEventListener("click", () => openAnyDialog({ kind: "user", tab: "account" }));

scrimEl.addEventListener("click", (e) => {
  if (e.target === scrimEl) dismissDialog();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.dialog) dismissDialog();
  // 부화 결과 창 — Space·Enter 는 `확인` 을 누른 것과 같다 (2026-10-02 사용자 결정). 누르고 있는 동안의 반복은 받지 않는다.
  // 단추에 포커스가 있을 때 브라우저가 한 번 더 누르지 않게 기본 동작을 막는다
  if (ui.dialog?.kind === "hatched" && (e.key === "Enter" || e.key === " ") && !e.isComposing) {
    e.preventDefault();
    if (!e.repeat) dialogEl.querySelector<HTMLButtonElement>("button[data-confirm]:not(:disabled)")?.click();
  }
});

// 첫 화면을 그린 뒤에 옮긴다 — 창을 새로 열면서 온 목적지는 스냅샷보다 먼저 올 수 있다
const firstDraw = loadArt().then(refreshView);
// 버전·패치노트 — 첫 화면 뒤에 읽는다. 업데이트한 뒤 처음이면 노트를 한 번 띄운다
void firstDraw.then(loadUpdate).then(openUnseenNotes);
// 교환 상태 — 박스 머리 햄버거 단추의 진행 중 점에 쓴다. 뒤의 변경은 onTrade 로 온다
void firstDraw.then(loadTrade);
api.onDexStep((delta) => stepDex(delta));
api.onDexClosed((gen) => onDexClosed(gen));
api.onPetStep((delta) => stepPet(delta));
api.onPetAct((action) => onPetAction(action));
api.onPetClosed((gen) => petLink.onClosed(gen));
api.onShopStep((delta) => stepShop(delta));
api.onShopAct((action) => onShopAction(action));
api.onShopClosed((gen) => shopLink.onClosed(gen));
api.onBagStep((delta) => stepBag(delta));
api.onBagAct((action) => onBagAction(action));
api.onBagClosed((gen) => bagLink.onClosed(gen));
api.onPartyAct((action) => onPartyAction(action));
api.onPartyStep((delta) => stepPreset(delta));
api.onPartyClosed((gen) => partyLink.onClosed(gen));
api.onRoute((route) => void firstDraw.then(() => refreshView()).then(() => goTo(route)));
// 시간이 흐르면 만복도·쿨타임·알 준비가 바뀐다. 앱 전역 1초 시계(`manage:clock`)마다 다시 읽는다 (clockTick)
api.onClock?.(() => void clockTick());
