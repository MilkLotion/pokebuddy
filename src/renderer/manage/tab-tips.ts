// 탭 팁 — 탭 머리 제목 옆 ? 단추와 그 아래 팁 말풍선 (2026-10-10 사용자 "타이틀 옆에 작게 팁 아이콘만들고 그걸 누르면 보이게")
// Figma 01 `Icon / Help` `1677:2402`, 02 `Tip Bubble` `1933:99808`, 05 `Party / Base · 팁 말풍선` `1933:102416`·`Adventure / Battle Party · 팁 말풍선` `1933:102714`
//   - 모양은 배틀 파티 상세 기기 창의 ? 단추·말풍선과 같다(styles/bubble.css)
//   - 숫자는 적지 않는다. 밸런스 값이 바뀌어도 어긋나지 않게 한다. 수치가 든 자세한 팁은 웹 가이드(docs/guide.md "팁")
//   - 닫기: ? 를 다시 누르기, 바깥 누르기(manage.ts), Esc, 탭 바꾸기
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import type { TabId } from "./dialog-types.js";
import { redrawBody } from "./shell.js";

// 탭마다 제목과 세 줄 — 근거 수치는 docs/specs/balance.md, 배틀은 worklog/records/battle-balance 의 한 가지만 바꾼 실험
const TIPS: Record<TabId, { title: string; lines: string[] }> = {
  party: {
    title: "파티 팁",
    lines: [
      "파티에 든 포켓몬마다 따로 포인트를 모아요. 칸과 프리셋을 늘려요",
      "쓰지 않는 프리셋의 포켓몬도 모아요. 친밀도가 높을수록 더 모아요",
      "친밀도가 높을수록, 잘 돌볼수록 빨리 모아요",
    ],
  },
  box: {
    title: "박스 팁",
    lines: [
      "박스의 포켓몬은 포인트를 모으지 않아요",
      "파티나 다른 프리셋에 넣어 두면 모아요",
      "남는 포켓몬은 우클릭해서 팔 수 있어요",
    ],
  },
  dex: {
    title: "도감 팁",
    lines: [
      "칸을 누르면 얻는 방법과 진화 조건이 보여요",
      "업적 보상으로만 얻는 포켓몬도 있어요",
      "다른 지방의 모습은 따로 한 칸이에요",
    ],
  },
  shop: {
    title: "상점 팁",
    lines: [
      "파티 칸과 프리셋을 먼저 늘리면 포인트가 빨리 쌓여요",
      "가진 프리셋의 칸을 모두 열어야 다음 프리셋을 살 수 있어요",
      "알에서 나오는 포켓몬과 확률은 사기 전에 확인해요",
    ],
  },
  bag: {
    title: "가방 팁",
    lines: [
      // 도구 역할 — 먹이는 포인트, 장난감은 친밀도 (2026-10-11 사용자 "장난감은 버프가 포인트보단 친밀도 오르는거에 집중", 팁은 "그런데에 잘 적어놔봐")
      "프리미엄먹이는 포인트를, 장난감은 친밀도를 빨리 올려요",
      "새로 온 포켓몬엔 장난감, 다 키운 포켓몬엔 먹이를 줘요",
      "효과가 끝난 뒤 다시 써요. 남은 시간에 더해지지 않아요",
    ],
  },
  adventure: {
    title: "배틀 팁",
    // 첫 줄은 배틀 능력치 기준 — 배틀 상세 기기 창의 ? 에만 있어 보기 어려웠다(2026-10-11 사용자 "배틀 자동보정 정보가 상세기기에만 있어서 보기어려움" → "b+c 같이"). 이 줄만 숫자를 적는다(src/battle/rules.ts BATTLE_RULES 와 맞춘다)
    lines: ["모두 50레벨·6V·노력치·도구 없이 싸워요", "6칸을 채우고 단단한 포켓몬은 오른쪽 열에 둬요", "기술을 직접 고르고 메가진화를 켜요"],
  },
};

let open: TabId | null = null;

// 바깥 누르기·탭 바꾸기 — 열려 있었으면 닫고 true
export function closeTabTip(): boolean {
  if (!open) return false;
  open = null;
  return true;
}

// 탭 머리에 ? 단추를 제목 바로 뒤에 붙이고, 열렸으면 말풍선을 머리 아래 왼쪽에 단다
export function addTabTip(head: HTMLElement, tab: TabId): void {
  const tip = TIPS[tab];
  const help = buttonEl("help tab-help", "?");
  help.setAttribute("aria-label", `${tip.title} 보기`);
  help.setAttribute("aria-expanded", String(open === tab));
  help.addEventListener("click", (e) => {
    e.stopPropagation(); // 바깥 누르기 닫기와 겹치지 않게
    open = open === tab ? null : tab;
    redrawBody();
  });
  const title = head.querySelector("h1");
  if (title) title.after(help);
  else head.prepend(help);
  if (open !== tab) return;
  head.classList.add("has-tip");
  const bubble = el("div", "bubble tab-tip");
  bubble.setAttribute("role", "note");
  bubble.addEventListener("click", (e) => e.stopPropagation()); // 말풍선 안을 눌러도 닫지 않는다
  bubble.appendChild(el("strong", undefined, tip.title));
  for (const line of tip.lines) bubble.appendChild(el("div", "tip-line", `· ${line}`)); // 줄마다 점 — 배틀 상세의 능력치 기준 말풍선과 같은 꼴 (2026-10-11 사용자 "팁에 각 줄에 점이 있으면 좋겠음")
  const more = buttonEl("tip-more", "웹 가이드에서 더 보기");
  more.addEventListener("click", () => api.openGuide(tab));
  bubble.appendChild(more);
  head.appendChild(bubble);
}
