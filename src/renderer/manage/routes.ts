// 설정창의 열기와 바로가기 — 모달·개체 상세 열기, 교환 딥링크, 알림 배너·포켓몬 메뉴에서 온 경로 (P10 16)
// 다른 파일은 dialog.ts openAnyDialog 로 연다(설정창이 DialogHooks.openAny 로 openDialogOrPet 을 건다)
import type { ManageRoute } from "../../shared/model/route.js";
import { loadAccount } from "./account.js";
import { resetAchievementTab } from "./achievements.js";
import { loadAgents } from "./agents.js";
import { startHold } from "./box-move.js";
import { hold } from "./box-state.js";
import { sendCommand } from "./command.js";
import { closeDialog, dialogEl, openDialog, setScrim } from "./dialog.js";
import type { Dialog } from "./dialog-types.js";
import { openSwap } from "./party-link.js";
import { redrawBody, setTab } from "./shell.js";
import { findPartySlot, petInView, ui } from "./state.js";
import { loadTrade } from "./trade-state.js";
import { coachIdOf } from "./tutorial.js";

// 개체 상세는 관리 창 옆의 기기 창이다 — 모달을 닫고 그 개체가 있는 탭을 그린 뒤 기기 창에 띄운다
// (2026-09-28 사용자 "파티상세페이지도 도감상세처럼 옆에 뜨는거로 바꾸자", A안 기기형). 나머지는 모달이다 (dialog.ts openDialog)
export function openDialogOrPet(next: Dialog): void {
  if (next.kind === "pet") {
    if (coachIdOf() === "evolution") void sendCommand("tutorial.done", "evolution"); // 기기 창의 진화 단추를 보는 것이 목표 행동이다 — 카드를 눌러 온다
    ui.dialog = null;
    ui.notice = "";
    setScrim(false);
    setTab(findPartySlot(next.petId) != null ? "party" : "box");
    ui.detailPet = next.petId;
    redrawBody();
    return;
  }
  openDialog(next);
}

// 박스 탭을 열고 교환 모달을 띄운다 — 교환 링크(딥링크)로 왔을 때
function showTrade(): void {
  setTab("box");
  ui.detailPet = null; // 박스 탭에 있었어도 개체 상세는 닫고 교환 모달만 띄운다
  redrawBody();
  openDialogOrPet({ kind: "trade" });
  void loadTrade();
}

// 파티 카드·박스 칸의 좌클릭 — 개체 상세를 연다
export const openPet = (id: string): void => {
  if (ui.detailPet === id && !ui.dialog) {
    ui.detailPet = null; // 이미 떠 있는 개체를 다시 누르면 기기 창을 닫는다 — 도감 칸과 같다
    redrawBody();
    return;
  }
  openDialogOrPet({ kind: "pet", petId: id });
};

// 알림 배너의 `바로가기` — 부화는 돌보미집, 진화는 개체 상세, 업적은 업적 창의 그 줄 (docs/specs/game.md "알림 배너의 개별 표시")
export function goTo(route: ManageRoute): void {
  if (route.to === "daycare") {
    setTab("box");
    redrawBody();
    openDialogOrPet({ kind: "daycare" }); // 돌보미집은 모달이다 (2026-09-30)
  } else if (route.to === "pet") {
    if (petInView(route.petId)) openDialogOrPet({ kind: "pet", petId: route.petId }); // 이미 떠 있어도 닫지 않는다 — 무대 우클릭 메뉴의 상세 보기·진화 배너
  } else if (route.to === "form") {
    // 포켓몬 메뉴의 모습 말풍선에서 고른 모습 — 바꾸기 확인 창. 고를 수 없는 모습이면 drawForm 이 창을 닫는다
    if (petInView(route.petId)) openDialogOrPet({ kind: "form", petId: route.petId, to: route.species });
  } else if (route.to === "move") {
    startHold(route.petId); // 포켓몬 메뉴의 `옮기기` — 박스 탭에서 그 개체를 든다
  } else if (route.to === "swap") {
    // 포켓몬 메뉴의 `교체` — 교체 화면을 열고 그 개체를 든 채 시작한다 (2026-10-09 사용자 "파티,박스에 우클릭 메뉴에 교체 추가").
    // 파티 개체는 파티 기기 창에서, 박스 개체는 박스 탭에서 든다. 그다음은 머리 메뉴의 `교체` 로 연 화면과 같다
    if (!petInView(route.petId)) return;
    openSwap();
    if (findPartySlot(route.petId) != null) {
      hold.party = route.petId;
      redrawBody();
    } else startHold(route.petId);
  } else if (route.to === "sell") {
    if (petInView(route.petId)) openDialogOrPet({ kind: "sell-pet", petId: route.petId, price: route.price }); // 포켓몬 메뉴의 `팔기` — 확인 창
  } else if (route.to === "account") {
    ui.detailPet = null;
    openDialogOrPet({ kind: "user", tab: "account" });
    void loadAccount();
  } else if (route.to === "trade") {
    // 교환 링크(딥링크)로 왔다 — 박스 탭을 열고 교환 모달을 띄운다.
    // 교환 모달이 이미 떠 있으면 그대로 두고 상태만 다시 읽는다. 다른 대화상자가 떠 있으면 닫고 연다
    // (2026-09-30 사용자 결정 "ㅇㅇ 닫고 교환모달로.")
    if (ui.dialog?.kind === "trade") void loadTrade();
    else {
      if (ui.dialog) closeDialog();
      showTrade();
    }
  } else if (route.to === "agents") {
    // Codex 창 깜빡임 알림 — 사용자 모달의 연결 탭 (src/agents/notice.ts)
    ui.detailPet = null;
    openDialogOrPet({ kind: "user", tab: "agents" });
    void loadAgents();
  } else if (route.to === "bag" || route.to === "shop") {
    // 줍기 배너 — 도구·진화용 도구는 가방, 포인트는 상점 (docs/specs/game.md "줍기")
    closeDialog();
    setTab(route.to);
    ui.detailPet = null;
    redrawBody();
  } else {
    resetAchievementTab(); // 다른 분류를 고른 채면 그 업적 줄이 목록에 없다
    openDialogOrPet({ kind: "achievements" });
    dialogEl.querySelector(`.achievement[data-id="${CSS.escape(route.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }
}
