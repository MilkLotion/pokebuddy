// 설정창의 포켓몬 메뉴 — 파티 카드·박스 칸의 우클릭 메뉴 띄우기, 그 메뉴의 `팔기` 확인 창 (P10 20)
// 파티 카드·박스 칸을 우클릭하면 무대 우클릭과 같은 메뉴를 메인이 커서 자리에 띄운다 (src/view/menus.ts petMenu, 2026-10-02 사용자 결정).
// 좌클릭은 개체 상세를 연다. 그래서 이 메뉴에는 `상세 보기` 가 없다 (같은 날 사용자 결정 — 좌클릭 메뉴가 어색했다).
// 메뉴와 모습 말풍선은 메뉴 창이 그린다 (src/renderer/windows/menu.ts). 고른 모습·옮기기·팔기는 경로(routes.ts goTo)로 돌아온다.
// 메뉴를 띄울 길이 없으면(개발용 실행기) 아무것도 하지 않는다
import { pointText } from "../../shared/count-text.js";
import { josa } from "../../shared/josa.js";
import { el } from "../ui/dom.js";
import { api } from "./api.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead } from "./dialog.js";
import { petInView } from "./state.js";

export function askPetMenu(petId: string): void {
  void api.petMenu(petId).catch(() => undefined);
}

// 포켓몬 팔기 확인 — 되돌릴 수 없어 확인을 받는다. 판매가는 메뉴를 띄울 때 메인이 잰 값이다 (src/shop/sell-pet.ts, Figma 05 `Box / Sell Confirm`)
export function drawSellPet(petId: string, price: number): void {
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
