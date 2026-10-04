// 설정창의 가이드북 모달 — 다섯 주제의 글과 그리기 (P10o2)
import { el } from "../ui/dom.js";
import { actionsRowEl, closeButton, dialogEl, dialogHead } from "./dialog.js";
import { NATURE_UI } from "./widgets.js";

// 가이드북 — 구성은 docs/specs/game.md "튜토리얼과 가이드북" 의 다섯 주제다.
// 숫자는 적지 않는다. 밸런스 값이 바뀌어도 이 문구가 어긋나지 않게 한다
const GUIDE: { title: string; lines: string[] }[] = [
  {
    title: "돌봄",
    lines: [
      "밥을 주면 만복도가 오른다. 쿨타임이 지나야 다시 줄 수 있다.",
      "놀아주면 친밀도가 오른다. 쿨타임이 지난 뒤 남은 시간 안에 이어서 놀아주면 중첩이 오른다.",
      "두 번 이어서 놀아주면 들뜸, 세 번이면 신남이 되고 친밀도 증가량이 늘어난다.",
      "프리미엄먹이를 먹으면 든든함이 되고 친밀도 증가량이 늘어난다.",
      "친밀도가 가득이면 기분과 버프가 포인트 적립을 올린다.",
      "PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.",
    ],
  },
  {
    title: "상점과 알",
    lines: [
      "포인트로 알, 포켓몬, 도구, 진화용 도구, 파티 칸을 산다.",
      "산 알은 돌보미집으로 간다. 5분이 지나면 열 수 있다.",
      "준비를 마친 알을 열면 개체가 나온다. 파티가 차 있으면 박스로 간다.",
    ],
  },
  {
    title: "파티와 박스",
    lines: [
      "파티 칸은 처음부터 다 열려 있지 않다. 상점과 업적으로 연다.",
      "파티에 있는 개체만 시간이 흐른다. 박스에 둔 개체는 멈춘다.",
      "꺼낸 개체만 바탕화면에 보인다. 숨겨도 포인트와 친밀도는 쌓인다.",
      "박스는 상점에서 사서 늘린다. 파티와 박스에 빈 칸이 없으면 알을 열 수 없다.",
    ],
  },
  {
    title: "진화",
    lines: [
      "조건을 채운 개체는 상세에서 직접 진화시킨다. 저절로 진화하지 않는다.",
      "조건은 종마다 다르다. 레벨, 친밀도, 도구, 시간대를 본다.",
      NATURE_UI ? "진화해도 같은 개체다. 이로치와 성격은 그대로 남는다." : "진화해도 같은 개체다. 이로치는 그대로 남는다.",
    ],
  },
  {
    title: "업적",
    lines: [
      "달성한 업적은 나중에 상태가 바뀌어도 사라지지 않는다.",
      "보상은 업적창에서 직접 받는다.",
      "받지 않은 보상이 있으면 탭 줄 오른쪽의 업적창 아이콘에 점이 뜬다.",
    ],
  },
];

export function drawGuide(): void {
  dialogEl.append(...dialogHead("가이드북", "", { label: "설정", to: { kind: "settings", tab: "general" } }));
  const scroll = el("div", "scroll");
  for (const topic of GUIDE) {
    const box = el("div", "topic");
    box.appendChild(el("h3", undefined, topic.title));
    for (const line of topic.lines) box.appendChild(el("p", undefined, line));
    scroll.appendChild(box);
  }
  dialogEl.appendChild(scroll);
  dialogEl.appendChild(actionsRowEl(closeButton()));
}
