// 설정창 튜토리얼의 문구와 단계 표 — 무엇을 어디에 보여 줄지만 둔다. 그리기·입력 막기는 tutorial.ts (P10 18)
// 문구는 Figma 그대로다 (2026-09-26 사용자 결정 "figma대로 진행")
import type { Snapshot } from "../../shared/model/snapshot.js";
import { agentRows, loadAgents } from "./agents.js";
import { bagPickOf } from "./bag-link.js";
import { dialogEl, openAnyDialog } from "./dialog.js";
import type { TabId } from "./dialog-types.js";
import { bodyEl, tabButtonOf } from "./shell.js";
import { partyPets, ui } from "./state.js";

// guide* 는 그 탭이 아닌 곳에 있을 때 탭 버튼으로 이어 주는 말풍선이다 (Figma 시안 E `514:1670` · F `514:2182`)
interface TutorialText {
  name: string;
  tab: TabId;
  title: string;
  body: string;
  guideTitle: string;
  guideBody: string;
  guideButton: string;
}
export const TUTORIAL_TEXT: Record<string, TutorialText> = {
  shop: {
    name: "상점", tab: "shop", title: "시작 포인트로 랜덤알 하나를 살 수 있어요", body: "",
    guideTitle: "시작 포인트로 랜덤알 하나를 살 수 있어요", guideBody: "", guideButton: "상점으로 가기",
  },
  hatch: {
    name: "부화", tab: "box", title: "알은 5분 뒤에 준비돼요", body: "준비가 끝나면 열기를 눌러야 부화해요. 여러 개면 모두 열기를 눌러요.", // Figma `399:8901` 문구와 같다 (2026-10-02 모두 열기 안내를 더함)
    guideTitle: "알은 박스의 돌보미집에 들어갔어요", guideBody: "", guideButton: "박스로 가기",
  },
};
// 업적 튜토리얼 — 헤더의 업적 아이콘을 밝힌다 (Figma 시안 G `514:2444`). 어느 탭에서든 보인다
// 업적의 파티 칸 보상은 다른 프리셋을 적용한 중에도 첫 프리셋의 칸을 연다 (2026-10-02 문구 변경, Figma `514:2444`)
export const ACHIEVEMENT_GUIDE = { title: "보상을 받으면 첫 프리셋의 칸이 열려요", body: "", button: "업적 보기" };

// 새 기능 튜토리얼 — 문구는 Figma 05 Screens 섹션 `13 튜토리얼 · 관리 창` `930:18248` 그대로다
// (2026-09-29 사용자 "새 기능 튜토리얼 8종 … 개발진행", worklog/records/tutorial-overhaul/record.md "새 기능 튜토리얼 8종 — 코드 설계").
// 파티 1/2 · 진화는 파티 카드를 밝힌다 — 상세는 옆 기기 창이다(Figma `932:17544` · `932:18610`)
interface GuideStep {
  title: string;
  body: string;
  target: () => HTMLElement | null;
  also?: () => HTMLElement | null; // 함께 밝힐 요소 — 구멍을 둘을 감싸는 사각형으로 넓힌다
  tryIt?: boolean; // 대상을 눌러야 넘어간다 — 다음 단추를 두지 않는다
  interactive?: boolean; // 대상도 눌린다(목표 행동)
  words?: () => { title: string; body: string } | null; // 화면 상태에 따라 바꿀 문구 — null 이면 title·body 그대로
}
interface Guide {
  name: string; // 말풍선 머리의 "튜토리얼 · {name}"
  tab: TabId | null; // 이 탭에서 보인다. null 이면 어느 탭이든
  go: string; // 다른 탭에 있을 때 탭 단추로 이어 주는 말풍선의 단추
  steps: GuideStep[];
  step?: () => number; // 화면 상태로 단계를 정한다(가방 — 사용 판이 열렸는가, 사용자 — 연결 탭인가)
  onNext?: () => void; // 다음 단추가 할 일 — 없으면 단계만 넘긴다
}
const firstPetCard = (): HTMLElement | null => bodyEl.querySelector<HTMLElement>(".grid .slot[data-pet]");
// 지금 박스의 첫 개체 칸 — 박스 튜토리얼은 개체가 있을 때만 뜬다
export const firstBoxPet = (): HTMLElement | null => bodyEl.querySelector<HTMLElement>(".box-grid > .cell:not(.blank)");
// 사용자 모달의 첫 블록(계정 · CLI 목록) — 스크롤 영역 전체를 밝히면 말풍선이 탭을 가린다
const dialogScroll = (): HTMLElement | null => dialogEl.querySelector<HTMLElement>(".scroll > *:first-child") ?? dialogEl.querySelector<HTMLElement>(".scroll");
// 지금 진화할 수 있는 파티 개체의 카드
const evolveCard = (): HTMLElement | null => {
  const pet = partyPets().find((p) => p.evolutions.some((e) => e.ready));
  return pet ? bodyEl.querySelector<HTMLElement>(`.slot[data-pet="${CSS.escape(pet.id)}"]`) : null;
};
export const GUIDES: Record<string, Guide> = {
  growth: {
    name: "성장", tab: "party", go: "파티로 가기",
    steps: [
      { title: "친밀도는 함께한 시간만큼 올라요", body: "밥 주기·놀아주기로 더 올라요. 높을수록 포인트가 빨리 쌓여요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".meters > .meter:first-child") ?? null },
      { title: "배고프면 친밀도가 덜 올라요", body: "만복도는 시간이 지나면 줄어요. 밥을 주면 채워져요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".meters > .meter:last-child") ?? null },
      { title: "레벨은 사탕으로 올려요", body: "경험치는 친밀도와 따로 쌓여요. 가방의 경험사탕을 써요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".top") ?? null },
    ],
  },
  points: {
    name: "포인트", tab: null, go: "",
    steps: [{ title: "파티 포켓몬이 포인트를 모아요", body: "상점에서 알과 도구를 살 때 써요.", target: () => document.querySelector<HTMLElement>(".point-chip") }],
  },
  party: {
    name: "파티", tab: "party", go: "파티로 가기",
    steps: [
      { title: "볼에 넣으면 바탕화면에서 쉬어요", body: "카드를 우클릭해 볼에 넣기를 눌러요. 볼 안에서도 성장은 이어져요.", target: firstPetCard }, // 볼에 넣기는 우클릭 메뉴에 있다 (2026-10-02)
      { title: "박스에 보관하면 성장이 멈춰요", body: "파티 칸이 모자라면 박스에 맡겨요.", target: () => tabButtonOf("box") },
    ],
  },
  // 파티 프리셋 — 머리 줄의 넘김 → 첫 줄의 카드 → 머리 메뉴 단추(교체가 든 메뉴). 설명만 하고 대상은 막는다. 파티 기기 창은 다른 창이라 가리키지 않는다
  // (2026-10-02 사용자 확인, Figma 05 `1260:23402` · `1260:23424` · `1260:23446`)
  preset: {
    name: "프리셋", tab: "party", go: "파티로 가기",
    steps: [
      { title: "프리셋으로 파티를 바꿔요", body: "◀ ▶ 를 누르면 그 프리셋이 바로 바탕화면에 나와요.", target: () => bodyEl.querySelector<HTMLElement>(".head .preset-pager") },
      {
        title: "지금 프리셋의 포켓몬만 자라요",
        body: "다른 프리셋의 포켓몬은 쉬어요. 파티 칸은 프리셋마다 따로 열어요.",
        // 첫 줄의 두 칸 — 둘째 칸이 빈 칸·잠긴 칸이어도 함께 밝힌다
        target: () => bodyEl.querySelectorAll<HTMLElement>(".grid .slot")[0] ?? null,
        also: () => bodyEl.querySelectorAll<HTMLElement>(".grid .slot")[1] ?? null,
      },
      // 교체는 머리 햄버거 메뉴 안에 있다 — 메뉴 단추를 밝힌다
      { title: "교체로 포켓몬을 넣고 빼요", body: "박스의 포켓몬을 눌러 들고, 옆 창의 칸을 눌러 놓아요.", target: () => bodyEl.querySelector<HTMLElement>(".head .party-menu-toggle") },
    ],
  },
  bag: {
    name: "가방", tab: "bag", go: "가방으로 가기",
    // 도구를 눌러 가방 기기 창이 뜨면 2단계, 닫으면 1단계로 돌아간다 (2026-10-01 가방 기기 창)
    step: () => (bagPickOf() ? 1 : 0),
    steps: [
      { title: "쓸 도구를 골라요", body: "경험사탕은 레벨을, 먹이와 장난감은 친밀도를 올려요.", target: () => bodyEl.querySelector<HTMLElement>(".bag-grid"), tryIt: true },
      {
        title: "옆 창에서 파티 포켓몬을 고르고 사용을 눌러요",
        body: "여러 개를 한 번에 쓸 수 있어요. 진화용 도구는 파티 상세의 진화 줄에서 써요.",
        target: () => bodyEl.querySelector<HTMLElement>('.bag-card[aria-pressed="true"]'),
        interactive: true,
      },
    ],
  },
  evolution: {
    name: "진화", tab: "party", go: "파티로 가기",
    steps: [{ title: "조건을 채우면 진화할 수 있어요", body: "진화는 직접 눌러야 해요.", target: evolveCard, interactive: true }],
  },
  // 박스 — 박스 탭을 처음 열 때(대기열 밖). 우클릭 메뉴 → 옮기기 → 끌기. 설명만 하고 대상은 막는다
  // (2026-10-02 사용자 확인, Figma 05 `1251:21977` · `1251:22000` · `1251:22023`)
  box: {
    name: "박스", tab: "box", go: "",
    steps: [
      { title: "우클릭하면 메뉴가 열려요", body: "옮기기와 팔기는 메뉴에 있어요. 그냥 누르면 상세를 봐요.", target: firstBoxPet },
      {
        title: "옮기기로 다른 박스에 보내요",
        body: "든 채로 ◀ ▶ 를 눌러 박스를 넘기고, 칸을 눌러 놓아요.",
        // ◀ 부터 ▶ 까지 — 이름 칸을 사이에 둔 두 단추를 함께 밝힌다
        target: () => bodyEl.querySelector<HTMLElement>(".box-pager > button"),
        also: () => bodyEl.querySelector<HTMLElement>(".box-pager > .box-name-cell + button"),
      },
      { title: "끌면 박스 안에서 자리를 바꿔요", body: "포켓몬 칸에 놓으면 서로 바뀌어요.", target: () => bodyEl.querySelector<HTMLElement>(".box-grid") },
    ],
  },
  dex: {
    name: "도감", tab: "dex", go: "",
    steps: [{ title: "칸을 누르면 입수 방법이 보여요", body: "아직 해금하지 않은 포켓몬은 실루엣으로 보여요.", target: () => bodyEl.querySelector<HTMLElement>(".dex-grid .dex-cell"), interactive: true }],
  },
  // 교환 모달을 처음 열 때 — 모달 안의 링크 만들기·링크로 참가 줄을 밝힌다 (Figma 05 `Tutorial / Trade` `1036:24561`)
  trade: {
    name: "교환", tab: null, go: "",
    steps: [{ title: "링크로 친구와 한 마리씩 바꿔요", body: "링크를 만들어 보내거나, 받은 링크로 참가해요.", target: () => dialogEl.querySelector<HTMLElement>('[data-tut="trade"]') }],
  },
  user: {
    name: "사용자", tab: null, go: "",
    step: () => (ui.dialog?.kind === "user" && ui.dialog.tab === "agents" ? 1 : 0),
    onNext: () => {
      if (!agentRows) void loadAgents();
      openAnyDialog({ kind: "user", tab: "agents" });
    },
    steps: [
      { title: "로그인하면 다른 컴퓨터에서도 이어서 해요", body: "지금 진행도 익명 저장으로 서버에 올라가요.", target: dialogScroll },
      // CLI 목록 전체 — 첫 줄부터 아래 안내 줄까지
      { title: "CLI 를 연결하면 업적이 열려요", body: "에이전트와 함께 일한 시간이 쌓이면 함께 일하기 업적 보상을 받아요.", target: dialogScroll, also: () => dialogEl.querySelector<HTMLElement>(".scroll .agents-note") },
    ],
  },
};

// 설정 › 화면 튜토리얼 — 줄마다 무엇인지 알리고 직접 해 보게 한다. 해 보는 단계는 다음 단추가 없고, 그 동작을 하면 넘어간다
// (2026-09-28 사용자 "화면 튜토리얼도 각각이 뭐가있고, 사용자가 직접해보는거까지 튜토리얼해").
// 바탕화면 표시 줄(포켓몬 표시·고스트 모드)이 없는 창이면 그 단계는 건너뛴다. 마지막 단계는 고른 놀이공간 방식을 설명한다
interface AreaStep {
  tut: string;
  also?: (v: Snapshot) => string | null; // 함께 밝힐 줄
  title: string;
  body: (v: Snapshot) => string;
  // 해 보는 단계 — 이 조건이 되면 넘어간다. start 는 단계에 들어온 때의 스냅샷
  until?: (v: Snapshot, start: Snapshot) => boolean;
  needsDisplay?: boolean;
}
const AREA_BODY: Record<string, string> = {
  all: "모든 화면이면 화면마다 놀아요. 끌어서 다른 화면으로 옮길 수 있어요.",
  screen: "한 화면이면 목록이나 화면에서 고르기로 놀 화면을 정해요.",
  region: "영역 지정이면 영역 그리기로 놀 곳을 직접 그려요.",
};
const AREA_STEPS: readonly AreaStep[] = [
  { tut: "set-hidden", title: "포켓몬 표시", body: () => "끄면 바탕화면의 포켓몬이 모두 숨어요. 스위치를 눌러 꺼 보세요.", until: (v) => v.display?.hidden === true, needsDisplay: true },
  { tut: "set-hidden", title: "다시 켜 보세요", body: () => "켜면 포켓몬이 다시 나와요.", until: (v) => v.display?.hidden === false, needsDisplay: true },
  { tut: "set-ghost", title: "고스트 모드", body: () => "켜면 포켓몬 위를 눌러도 뒤 창이 눌려요. 켜 보세요.", until: (v) => v.display?.clickThrough === true, needsDisplay: true },
  { tut: "set-ghost", title: "다시 꺼 보세요", body: () => "끄면 포켓몬을 다시 만질 수 있어요.", until: (v) => v.display?.clickThrough === false, needsDisplay: true },
  { tut: "area", title: "포켓몬이 놀 곳을 골라요", body: () => "모든 화면, 한 화면, 영역 지정이 있어요. 다른 칸을 눌러 보세요.", until: (v, start) => v.settings.playArea !== start.settings.playArea },
  {
    tut: "area",
    also: (v) => (v.settings.playArea === "screen" ? "area-screen" : v.settings.playArea === "region" ? "area-region" : null),
    title: "놀이공간을 바꿨어요",
    body: (v) => AREA_BODY[v.settings.playArea] ?? "",
  },
];

// 쓸 수 있는 단계 — 바탕화면 표시 줄이 없으면 그 단계를 뺀다
export const areaSteps = (v: Snapshot): AreaStep[] => AREA_STEPS.filter((st) => !st.needsDisplay || v.display != null);
