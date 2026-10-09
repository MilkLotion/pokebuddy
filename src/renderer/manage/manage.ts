// 관리 창 — 스냅샷을 받아 그리고, 조작은 명령으로 보낸다. 게임 규칙은 하나도 여기 두지 않는다.
//
// 값은 메인이 이미 화면이 읽을 모양으로 바꿔서 준다 (src/tx/snapshot.ts, src/tx/lists.ts). 여기서는 배치와 글자만 만든다.
// 명령을 보내면 새 스냅샷을 다시 받아 그린다. 화면이 스스로 상태를 들고 있지 않는다.
// 도감과 CLI 연결은 스냅샷에 없다. 필요할 때만 따로 부르고 그다음부터는 들고 있는다.
// 모달은 하나만 뜬다. 어느 모달인지는 `dialog` 하나가 가진다 — 겹쳐 띄우지 않는다.
import { api } from "./api.js";
import { drawSellPet } from "./pet-menu.js";
import { drawSellDuplicates } from "./sell-dup.js";
import { drawDaycare, drawHatched, drawUnder } from "./daycare.js";
import { goTo, openDialogOrPet } from "./routes.js";
import { coachIdOf, drawTutorial, restartAreaTutorial } from "./tutorial.js";
import { boxSlot, drawBox } from "./box-tab.js";
import { drawBoxOrder } from "./box-order.js";
import { drawPresetOverview } from "./preset-overview.js";
import { drawBattleOpponent } from "./battle-opponent.js";
import { drawBattleRecord, loadBattleRecord } from "./battle-record.js";
import { closePartyMenu, drawParty, stepPreset, stopPresetRename } from "./party-tab.js";
import { drawGuide } from "./guide.js";
import { closeSettingSelect, drawSettings, drawUser, syncIdentify } from "./settings.js";
import { boxUi, hold } from "./box-state.js";
import { endHold, setBoxMoveHooks } from "./box-move.js";
import { currentAccount, setAccountHooks } from "./account.js";
import { drawTradeDialog, setTradeHooks } from "./trade.js";
import { loadTrade, redrawTrade } from "./trade-state.js";
import { drawLetter, drawMail } from "./mail.js";
import { drawNotes, drawNotesNew, loadUpdate, openUnseenNotes, peekUpdate } from "./update-notes.js";
import { drawAchievements } from "./achievements.js";
import { onPetAction, petLink, stepPet, syncPetDevice } from "./pet-link.js";
import { drawAdventure } from "./adventure-tab.js";
import { battleLink, leaveBattle, onBattleAction, stepBattle, syncBattleDevice } from "./battle-link.js";
import { drawBattlePick, startBattlePick } from "./battle-pick.js";
import { drawMovePick, startMovePick } from "./move-pick.js";
import { drawSwap, startSwap } from "./party-swap.js";
import { bagLink, clearBagResult, dropGoneBagPick, leaveBag, onBagAction, setBagLinkHooks, stepBag, syncBagDevice } from "./bag-link.js";
import { bagStepRows, drawBag } from "./bag-tab.js";
import { dropGoneShopPick, leaveShop, onShopAction, setShopLinkHooks, shopLink, stepShop, syncShopDevice } from "./shop-link.js";
import { closeShopRegion, drawPool, drawShop, isShopRegionOpen, shopStepRows } from "./shop-tab.js";
import { onDexClosed, setDexLinkHooks } from "./dex-link.js";
import { clearDexPick, closeDexRegion, drawDex, enterDex, forgetDexRows, isDexRegionOpen, leaveDex, setDexTabHooks, stepDex } from "./dex-tab.js";
import { drawEvolve } from "./evolve.js";
import { drawNature, drawNatureTarget } from "./nature.js";
import { drawEvolveConfirm, drawForm, drawMega } from "./pet-forms.js";
import { restoreSearchFocus, typingSearch } from "./search.js";
import { alertEl } from "./widgets.js";
import { loadArt } from "./art-cache.js";
import { clockTick, refreshView, setLiveHooks } from "./live.js";
import { needEl } from "../ui/dom.js";
import { sendCommand, setCommandHooks } from "./command.js";
import { bodyEl, redrawBody, registerAfterDraw, registerBodySync, registerTab, setShellHooks } from "./shell.js";
import { dialogEl, dismissDialog, drawDialog, openAnyDialog, registerDialog, scrimEl, setDialogHooks } from "./dialog.js";
import type { TabId } from "./dialog-types.js";
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

// 정렬·지방·설정 목록은 바깥을 누르면 닫는다
document.addEventListener("click", () => {
  if (closeSettingSelect()) drawDialog();
  const partyMenu = closePartyMenu();
  if (!partyMenu && !boxUi.sortOpen && !boxUi.menuOpen && !isDexRegionOpen() && !isShopRegionOpen()) return;
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
  adventure: '<path d="M10.5 3.5 5.5 2l-4 1.5V14l4-1.5M5.5 2v10.5m0 0 5 1.5 4-1.5V2l-4 1.5m0 0V14" stroke-width="1.5" stroke-linejoin="round"/>', // 지도 — Figma 01 `Icon / Adventure` `1659:3`
};

// 탭 — 등록한 순서대로 탭 줄에 선다 (shell.ts). 나갈 때 그 탭의 기기 창을 닫는다
registerTab({ id: "party", label: "파티", icon: TAB_ICON.party, draw: (v) => drawParty(v) });
registerTab({ id: "box", label: "박스", icon: TAB_ICON.box, draw: (v) => drawBox(v) });
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
// 모험 — 배틀 파티. 배틀 파티 상세 기기 창은 다음 그리기의 syncBattleDevice 가 닫는다 (docs/specs/adventure.md "모험 탭")
registerTab({
  id: "adventure",
  label: "모험",
  icon: TAB_ICON.adventure,
  draw: (v) => drawAdventure(v),
  leave: () => leaveBattle(),
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
registerBodySync(() => syncBattleDevice());
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
registerDialog({ kind: "evolve-confirm", shape: "dialog", draw: (d) => drawEvolveConfirm(d.petId, d.to) });
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
    if (prev?.kind !== "settings") void peekUpdate(); // 설정창을 열 때 새 버전도 확인한다(마지막 확인 뒤 10분 지났을 때만)
    if (d.tab === "display" && !(prev?.kind === "settings" && prev.tab === "display")) restartAreaTutorial();
  },
});
registerDialog({ kind: "user", shape: "dialog settings", headerButton: "open-user", draw: (d) => drawUser(d.tab) });
registerDialog({ kind: "guide", shape: "dialog settings notes", draw: (d) => drawGuide(d.pick) });
registerDialog({ kind: "hatched", shape: "dialog hatched", draw: (d) => drawHatched(d.petId, d.eggId, d.over, d.queue, d.at, d.allCaught) });
registerDialog({ kind: "daycare", shape: "dialog daycare", draw: () => drawDaycare() });
registerDialog({ kind: "box-order", shape: "dialog daycare box-order", draw: () => drawBoxOrder() });
registerDialog({ kind: "preset-overview", shape: "dialog daycare preset-overview", draw: (d) => drawPresetOverview(d.battle === true) });
registerDialog({ kind: "battle-opponent", shape: "dialog daycare preset-overview battle-opponent", draw: () => drawBattleOpponent() });
registerDialog({ kind: "battle-record", shape: "dialog daycare preset-overview battle-record", draw: (d) => drawBattleRecord(d.back), enter: () => void loadBattleRecord() });
registerDialog({ kind: "swap", shape: "dialog swap party-swap", draw: () => drawSwap(), enter: (d, prev) => (prev?.kind === "swap" ? undefined : startSwap(d.focus)) });
registerDialog({ kind: "battle-pick", shape: "dialog swap battle-pick", draw: () => drawBattlePick(), enter: (d, prev) => (prev?.kind === "battle-pick" ? undefined : startBattlePick(d.slot)) });
registerDialog({ kind: "move-pick", shape: "dialog move-pick", draw: () => drawMovePick(), enter: (d, prev) => (prev?.kind === "move-pick" ? undefined : startMovePick(d.petId, d.slot)) });
registerDialog({ kind: "pool", shape: "dialog daycare egg-pool", draw: (d) => drawPool(d.productId, d.page) });
registerDialog({ kind: "form", shape: "dialog", draw: (d) => drawForm(d.petId, d.to) });
registerDialog({ kind: "mega", shape: "dialog", draw: (d) => drawMega(d.petId, d.to, d.battle === true) });
registerDialog({ kind: "sell-pet", shape: "dialog", draw: (d) => drawSellPet(d.petId, d.price) });
registerDialog({ kind: "sell-dup", shape: "dialog sell-dup", draw: (d) => drawSellDuplicates(d.off ?? []) });
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
api.onBattleStep((delta) => stepBattle(delta));
api.onBattleAct((action) => onBattleAction(action));
api.onBattleClosed((gen) => battleLink.onClosed(gen));
api.onShopStep((delta) => stepShop(delta));
api.onShopAct((action) => onShopAction(action));
api.onShopClosed((gen) => shopLink.onClosed(gen));
api.onBagStep((delta) => stepBag(delta));
api.onBagAct((action) => onBagAction(action));
api.onBagClosed((gen) => bagLink.onClosed(gen));
api.onRoute((route) => void firstDraw.then(() => refreshView()).then(() => goTo(route)));
// 시간이 흐르면 만복도·쿨타임·알 준비가 바뀐다. 앱 전역 1초 시계(`manage:clock`)마다 다시 읽는다 (clockTick)
api.onClock?.(() => void clockTick());
