// 설정창의 가이드북 모달 — 패치노트와 같은 2단. 왼쪽 `가이드`·`튜토리얼` 목록, 오른쪽 고른 항목 (P10o2)
// Figma `Guidebook Panel` `1459:56271`·05 `Settings / Guidebook` `1461:902`. 규칙은 docs/specs/game.md "튜토리얼과 가이드북"
import { buttonEl, el } from "../ui/dom.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, dismissDialog, openAnyDialog } from "./dialog.js";
import type { TabId } from "./dialog-types.js";
import { goTo, openDialogOrPet } from "./routes.js";
import { redrawBody, setTab } from "./shell.js";
import { ui } from "./state.js";
import { restartTutorialSteps } from "./tutorial.js";
import { notesHead } from "./update-notes.js";
import { NATURE_SHOWN } from "../../shared/features.js";

// 가이드 — 다섯 주제. 숫자는 적지 않는다. 밸런스 값이 바뀌어도 이 문구가 어긋나지 않게 한다
const GUIDE: { title: string; lines: string[] }[] = [
  {
    title: "돌봄",
    lines: [
      "만복도는 시간이 지나면 줄고, 밥을 주면 오른다. 배가 고프면 포인트가 덜 쌓인다.",
      "심심함은 일한 시간만큼 쌓이고, 놀아주면 풀린다. 심심하면 포인트가 덜 쌓인다.",
      "장난감을 쓰면 신남, 프리미엄먹이를 쓰면 든든함이 되어 친밀도와 포인트가 더 빨리 쌓인다. 밥 주기·놀아주기는 쿨타임이 지나야 다시 할 수 있다.",
      "프리미엄먹이는 배를 채우고 한동안 줄지 않게 한다. 장난감은 심심함을 풀고 한동안 쌓이지 않게 한다.",
      "잘 돌본 포켓몬은 더 자주 무언가를 주워 온다.",
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
      "파티와 다른 프리셋에 든 개체가 포인트를 모은다. 다른 프리셋은 더 느리게 모은다. 박스에 둔 개체는 멈춘다.",
      "꺼낸 개체만 바탕화면에 보인다. 숨겨도 포인트와 친밀도는 쌓인다.",
      "박스는 상점에서 사서 늘린다. 파티와 박스에 빈 칸이 없으면 알을 열 수 없다.",
    ],
  },
  {
    title: "진화",
    lines: [
      "조건을 채운 개체는 상세에서 직접 진화시킨다. 저절로 진화하지 않는다.",
      "조건은 종마다 다르다. 레벨, 친밀도, 도구, 시간대를 본다.",
      NATURE_SHOWN ? "진화해도 같은 개체다. 이로치와 성격은 그대로 남는다." : "진화해도 같은 개체다. 이로치는 그대로 남는다.",
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

// 튜토리얼 다시 보기 — 순서와 id 는 src/tutorial/queue.ts REPLAYABLE_TUTORIALS. 이름은 말풍선 머리 "튜토리얼 · {이름}" 과 같다
const REPLAY: { id: string; name: string; what: string; where: string }[] = [
  { id: "first-care", name: "첫 돌봄", what: "바탕화면의 포켓몬을 우클릭해 돌보는 법을 보여 줘요", where: "바탕화면의 포켓몬에서" },
  { id: "growth", name: "성장", what: "친밀도·만복도·레벨이 오르는 법을 보여 줘요", where: "파티 탭으로 가서" },
  { id: "points", name: "포인트", what: "파티 포켓몬이 포인트를 모으는 법을 보여 줘요", where: "관리 창의 포인트에서" },
  { id: "hatch", name: "부화", what: "돌보미집에서 준비를 마친 알을 여는 법을 보여 줘요", where: "박스 탭으로 가서" },
  { id: "party", name: "파티", what: "볼에 넣기와 박스에 보관하기를 보여 줘요", where: "파티 탭으로 가서" },
  { id: "preset", name: "파티 프리셋", what: "프리셋으로 파티를 바꾸고 교체하는 법을 보여 줘요", where: "파티 탭으로 가서" },
  { id: "box", name: "박스", what: "박스의 메뉴, 옮기기, 자리 바꾸기를 보여 줘요", where: "박스 탭으로 가서" },
  { id: "bag", name: "가방", what: "도구를 골라 파티 포켓몬에게 쓰는 법을 보여 줘요", where: "가방 탭으로 가서" },
  { id: "evolution", name: "진화", what: "조건을 채운 포켓몬을 진화시키는 법을 보여 줘요", where: "파티 탭으로 가서" },
  { id: "dex", name: "도감", what: "도감 칸에서 입수 방법을 보는 법을 보여 줘요", where: "도감 탭으로 가서" },
  { id: "achievement", name: "업적", what: "업적 보상을 받는 곳을 보여 줘요", where: "업적 아이콘에서" },
  { id: "trade", name: "교환", what: "링크로 친구와 포켓몬을 바꾸는 법을 보여 줘요", where: "교환 창을 열고" },
  { id: "user", name: "사용자", what: "로그인과 CLI 연결을 보여 줘요", where: "사용자 창을 열고" },
  { id: "area", name: "화면 설정", what: "포켓몬 표시, 고스트 모드, 놀이공간을 보여 줘요", where: "설정의 화면 탭으로 가서" },
  { id: "detail", name: "개체 상세", what: "상세의 볼, 돌봄, 진화, 크기를 보여 줘요", where: "첫 파티 포켓몬의 상세를 열고" },
];

const TUT = "tut:"; // pick 앞머리 — 주제 제목과 튜토리얼 id 를 가른다

// 탭에서 뜨는 튜토리얼 — 그 탭으로 간다. 첫 돌봄(바탕화면)·포인트·업적(헤더)은 가이드북만 닫으면 뜬다
const TAB_OF: Record<string, TabId> = { growth: "party", party: "party", preset: "party", evolution: "party", hatch: "box", box: "box", bag: "bag", dex: "dex" };

// 다시 보기를 눌렀다 — 처음부터 보이게 저장을 바꾸고, 가이드북을 닫은 뒤 그 튜토리얼이 뜨는 자리로 간다
async function replay(id: string): Promise<void> {
  if (!(await sendCommand("tutorial.replay", id))) return;
  restartTutorialSteps();
  if (id === "trade") return goTo({ to: "trade" });
  if (id === "user") return goTo({ to: "account" });
  if (id === "area") return openAnyDialog({ kind: "settings", tab: "display" });
  if (id === "detail") {
    const petId = ui.view?.party.slots.find((s) => s.pet)?.pet?.id;
    if (petId) openDialogOrPet({ kind: "pet", petId });
    else closeDialog();
    return;
  }
  closeDialog();
  ui.detailPet = null;
  const tab = TAB_OF[id];
  if (tab) setTab(tab);
  redrawBody();
}

function guideDetail(pick: string): HTMLElement {
  const box = el("div", "notes-detail");
  const tut = pick.startsWith(TUT) ? REPLAY.find((t) => t.id === pick.slice(TUT.length)) : undefined;
  const topic = tut ? undefined : GUIDE.find((g) => g.title === pick);
  const head = el("div", "notes-version");
  head.appendChild(el("h3", undefined, tut?.name ?? topic?.title ?? ""));
  box.appendChild(head);
  if (topic) for (const line of topic.lines) box.appendChild(el("p", "notes-line", `· ${line}`));
  if (tut) {
    box.append(el("p", "notes-line", `· ${tut.what}`), el("p", "notes-line", `· 다시 보기를 누르면 ${tut.where} 처음부터 보여 줘요`));
    const ready = ui.view?.replayTutorials.includes(tut.id) === true;
    const b = actionButtonEl("다시 보기", false, !ready, () => void replay(tut.id));
    b.classList.add("guide-replay");
    box.appendChild(b);
  }
  return box;
}

// ✕ 는 설정으로 돌아간다 — 설정에서 열었다
export function drawGuide(pick?: string): void {
  const current = pick ?? GUIDE[0]!.title;
  dialogEl.appendChild(notesHead("가이드북", "궁금한 것을 고르세요", dismissDialog)); // ✕ 는 Esc·가림막과 같다 — 설정으로 돌아간다
  const body = el("div", "notes-body");
  const list = el("div", "notes-list scroll");
  const item = (key: string, label: string): void => {
    const b = buttonEl(key === current ? "notes-item on" : "notes-item");
    b.appendChild(el("span", "notes-item-version", label));
    b.setAttribute("aria-pressed", String(key === current));
    b.addEventListener("click", () => {
      if (key !== current) openAnyDialog({ kind: "guide", pick: key });
    });
    list.appendChild(b);
  };
  list.appendChild(el("div", "guide-group", "가이드"));
  for (const g of GUIDE) item(g.title, g.title);
  list.appendChild(el("div", "guide-group", "튜토리얼"));
  for (const t of REPLAY) item(TUT + t.id, t.name);
  body.append(list, guideDetail(current));
  dialogEl.appendChild(body);
}
