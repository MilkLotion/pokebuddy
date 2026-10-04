// 설정창의 튜토리얼 코치마크 — 문구 표, 단계 세기, 코치마크 층, 그리고 튜토리얼 중의 입력 막기 (P10 15)
// Figma `Tutorial / Shop` `399:8590` · `Hatch` `399:8901` · `Party` `399:9159`. 모두 한 단계다(2026-09-26 사용자 결정).
// 대상 둘레 8px 을 비우고 네 장의 배경막으로 덮는다. 대상은 그대로 누를 수 있다. 말풍선은 대상 바로 아래(넘치면 위).
// 무엇을 보여 줄지는 스냅샷 `tutorial` 이 정한다(src/tutorial/queue.ts). 그 탭에 있을 때만 그린다 — 화면을 강제로 바꾸지 않는다.
// 문구는 Figma 그대로다 (2026-09-26 사용자 결정 "figma대로 진행")
import type { Snapshot } from "../../shared/model/snapshot.js";
import { COACH_SIZE, drawCoachLayer, guardCoachFocus, type CoachLayer } from "../ui/coach.js";
import { agentRows, loadAgents } from "./agents.js";
import { api } from "./api.js";
import { bagPickOf } from "./bag-link.js";
import { hold } from "./box-state.js";
import { sendCommand } from "./command.js";
import { dialogEl, isDimmed, openAnyDialog } from "./dialog.js";
import type { TabId } from "./dialog-types.js";
import { bodyEl, redrawBody, setTab, tabButtonOf } from "./shell.js";
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
const TUTORIAL_TEXT: Record<string, TutorialText> = {
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
const ACHIEVEMENT_GUIDE = { title: "보상을 받으면 첫 프리셋의 칸이 열려요", body: "", button: "업적 보기" };

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
const firstBoxPet = (): HTMLElement | null => bodyEl.querySelector<HTMLElement>(".box-grid > .cell:not(.blank)");
// 사용자 모달의 첫 블록(계정 · CLI 목록) — 스크롤 영역 전체를 밝히면 말풍선이 탭을 가린다
const dialogScroll = (): HTMLElement | null => dialogEl.querySelector<HTMLElement>(".scroll > *:first-child") ?? dialogEl.querySelector<HTMLElement>(".scroll");
// 지금 진화할 수 있는 파티 개체의 카드
const evolveCard = (): HTMLElement | null => {
  const pet = partyPets().find((p) => p.evolutions.some((e) => e.ready));
  return pet ? bodyEl.querySelector<HTMLElement>(`.slot[data-pet="${CSS.escape(pet.id)}"]`) : null;
};
const GUIDES: Record<string, Guide> = {
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
  // 파티 프리셋 — 머리 줄의 넘김 → 첫 줄의 카드 → 교체 단추. 설명만 하고 대상은 막는다. 파티 기기 창은 다른 창이라 가리키지 않는다
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
      { title: "교체로 포켓몬을 넣고 빼요", body: "박스의 포켓몬을 눌러 들고, 옆 창의 칸을 눌러 놓아요.", target: () => bodyEl.querySelector<HTMLElement>(".head .swap-open") },
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
      { title: "CLI 를 연결하면 더 빨리 자라요", body: "에이전트가 일하는 동안 친밀도와 포인트가 두 배로 쌓여요.", target: dialogScroll, also: () => dialogEl.querySelector<HTMLElement>(".scroll .agents-note") },
    ],
  },
};
let coachId: string | null = null; // 지금 떠 있는 코치마크의 튜토리얼
// 지금 떠 있는 코치마크의 튜토리얼 — 도감 칸 고르기·진화 기기 창 열기가 목표 행동인지 본다
export function coachIdOf(): string | null {
  return coachId;
}
let guideId: string | null = null; // 단계를 세는 튜토리얼 — 바뀌면 1단계부터
let guideStep = 0;

// 새 기능 튜토리얼 한 단계를 그린다. 대상이 없으면 그리지 않는다(다음 그리기에서 다시 본다)
function drawGuideStep(id: string): void {
  const guide = GUIDES[id];
  if (!guide) return;
  if (guideId !== id) {
    guideId = id;
    guideStep = 0;
  }
  const index = Math.min(guide.steps.length - 1, guide.step ? guide.step() : guideStep);
  const step = guide.steps[index];
  const target = step?.target() ?? null;
  if (!step || !target) return;
  const last = index === guide.steps.length - 1;
  const counter = guide.steps.length > 1 ? ` ${index + 1} / ${guide.steps.length}` : "";
  const words = step.words?.() ?? step;
  coachEl = coachLayer(id, target, {
    step: `튜토리얼 · ${guide.name}${counter}`,
    title: words.title,
    body: words.body,
    button: step.tryIt ? "" : last ? "확인" : "다음",
    onGo: () => {
      if (last) return void sendCommand("tutorial.done", id);
      if (guide.onNext) guide.onNext();
      else {
        guideStep = index + 1;
        drawTutorial();
      }
    },
    interactive: step.tryIt === true || step.interactive === true,
    also: step.also?.() ?? null,
  });
  coachId = id;
}

interface CoachSpec {
  step: string;
  title: string;
  body: string;
  button: string;
  onGo: () => void;
  // 구멍 안의 대상이 그 단계의 목표 행동인가(상점 카드·업적 아이콘·탭 버튼). 아니면 대상도 막고 다음·확인·✕ 만 받는다
  // (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
  interactive?: boolean;
  also?: HTMLElement | null; // 함께 밝힐 요소 — 구멍을 둘을 감싸는 사각형으로 넓힌다(놀이공간 줄 + 화면 줄)
}
const COACH = { pad: 8, gap: 12, ...COACH_SIZE };

let coachEl: HTMLElement | null = null;
// coachEl 의 초점 규칙과 대상 크기 감시 — 초점은 말풍선, 그리고 목표 행동이면 대상. 막 밖으로 Tab 이 나가면 말풍선 단추로 되돌린다
let coachNow: CoachLayer | null = null;

// 개체 상세 튜토리얼은 파티 상세 기기 창이 그린다(src/renderer/device/pet.ts) — 끝내거나 닫으면 여기로 알려 와 기록한다

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
let areaStep = 0;
let areaStart: Snapshot | null = null; // 지금 단계에 들어온 때
// 설정 › 화면에 새로 들어왔다 — 화면 탭 튜토리얼은 1단계부터 (settings 대화상자의 enter)
export function restartAreaTutorial(): void {
  areaStep = 0;
  areaStart = null;
}
// 쓸 수 있는 단계 — 바탕화면 표시 줄이 없으면 그 단계를 뺀다
const areaSteps = (v: Snapshot): AreaStep[] => AREA_STEPS.filter((st) => !st.needsDisplay || v.display != null);

export function drawTutorial(): void {
  coachEl?.remove();
  coachEl = null;
  coachNow?.stop();
  coachNow = null;
  const id = ui.view?.tutorial ?? null;
  coachId = null;
  const screenTut = (tid: string): boolean => ui.view?.screenTutorials?.includes(tid) === true;
  if (ui.view && ui.dialog?.kind === "user" && !dialogEl.querySelector(".acct-overlay") && screenTut("user")) {
    drawGuideStep("user"); // 사용자 모달을 처음 열 때 — 계정 → 연결
  } else if (ui.view && ui.dialog?.kind === "trade" && screenTut("trade")) {
    drawGuideStep("trade"); // 교환 모달을 처음 열 때
  } else if (ui.view && !ui.dialog && ui.tab === "dex" && screenTut("dex")) {
    drawGuideStep("dex"); // 도감 탭을 처음 열 때
  } else if (ui.view && !ui.dialog && !ui.detailPet && !hold.box && !hold.swap && ui.tab === "box" && screenTut("box") && id !== "hatch" && firstBoxPet()) {
    // 박스 탭을 처음 열 때 — 지금 박스에 개체가 있을 때만. 부화 튜토리얼 차례면 그것이 먼저다(같은 탭의 돌보미집 단추를 밝힌다).
    // 교체 화면(hold.swap)에서는 띄우지 않는다 — 칸 좌클릭이 상세가 아니라 들기라 1단계 문구와 다르다
    drawGuideStep("box");
  } else if (ui.view && ui.dialog?.kind === "settings" && ui.dialog.tab === "display" && ui.view.areaTutorial) {
    // 설정 › 화면 — 줄마다 설명하고 직접 해 보게 한다. 바탕화면의 놀이공간 튜토리얼을 옮겨 왔다
    // (2026-09-28 사용자 "이 영역설명은 설정에서 설명하게 해야할거같아", Figma 99 `Tutorial / Playground · 설정`)
    const steps = areaSteps(ui.view);
    // 해 보는 단계의 동작을 했으면 다음 단계로 — 설정이 바뀌면 스냅샷이 새로 와서 여기로 다시 온다
    for (;;) {
      const cur = steps[areaStep];
      if (!areaStart) areaStart = ui.view;
      if (!cur?.until || !cur.until(ui.view, areaStart) || areaStep >= steps.length - 1) break;
      areaStep += 1;
      areaStart = ui.view;
    }
    const step = steps[areaStep];
    const target = step ? dialogEl.querySelector<HTMLElement>(`[data-tut="${step.tut}"]`) : null;
    if (step && target) {
      const alsoKey = step.also?.(ui.view) ?? null;
      const tryIt = step.until != null;
      coachEl = coachLayer("area", target, {
        step: `튜토리얼 · 화면 ${areaStep + 1} / ${steps.length}`,
        title: step.title,
        body: step.body(ui.view),
        button: tryIt ? "" : "확인", // 해 보는 단계는 그 동작으로만 넘어간다
        onGo: () => void sendCommand("tutorial.done", "area"),
        interactive: tryIt,
        also: alsoKey ? dialogEl.querySelector<HTMLElement>(`[data-tut="${alsoKey}"]`) : null,
      });
    }
  } else if (id && ui.view && !ui.dialog && !ui.detailPet) {
    const text = TUTORIAL_TEXT[id];
    const guide = GUIDES[id];
    if (guide && (guide.tab == null || guide.tab === ui.tab)) {
      drawGuideStep(id);
    } else if (guide && guide.tab) {
      // 다른 탭에 있다 — 그 탭 버튼으로 이어 준다. 누를 때만 옮긴다(상점·부화 튜토리얼과 같다)
      const to = guide.tab;
      const target = tabButtonOf(to);
      const first = guide.steps[0];
      if (target && first) {
        coachEl = coachLayer(id, target, {
          step: `튜토리얼 · ${guide.name}`,
          title: first.title,
          body: "",
          button: guide.go,
          onGo: () => {
            setTab(to);
            redrawBody();
          },
          interactive: true,
        });
      }
    } else if (id === "achievement") {
      const done = ui.view.achievements.list.find((a) => a.state === "achieved");
      const target = document.getElementById("open-achievements");
      if (done && target) {
        coachEl = coachLayer(id, target, { step: "튜토리얼 · 업적", ...ACHIEVEMENT_GUIDE, onGo: () => openAnyDialog({ kind: "achievements" }), interactive: true });
      }
    } else if (text && ui.tab === text.tab) {
      const target = bodyEl.querySelector<HTMLElement>(`[data-tut="${id}"]`);
      // 한 단계뿐이면 "1 / 1" 을 붙이지 않고 단추는 "확인" — 바탕화면 튜토리얼과 같다
      // 상점은 랜덤알 카드를 눌러 사는 것이 목표 행동이다. 부화는 안내만 한다
      if (target) coachEl = coachLayer(id, target, { step: `튜토리얼 · ${text.name}`, title: text.title, body: text.body, button: "확인", onGo: () => void sendCommand("tutorial.done", id), interactive: id === "shop" });
    } else if (text) {
      // 다른 탭에 있다 — 그 탭 버튼으로 이어 준다. 누를 때만 옮긴다
      const target = tabButtonOf(text.tab) ?? undefined;
      if (target) {
        coachEl = coachLayer(id, target, {
          step: `튜토리얼 · ${text.name}`,
          title: text.guideTitle,
          body: text.guideBody,
          button: text.guideButton,
          onGo: () => {
            setTab(text.tab);
            redrawBody();
          },
          interactive: true,
        });
      }
    }
  }
  // OS 가 그리는 창 단추 자리도 함께 어둡게 한다 — 모달 가림막과 같은 통로
  api.dim(isDimmed() || coachEl != null);
}

function coachLayer(id: string, target: HTMLElement, spec: CoachSpec): HTMLElement {
  coachNow?.stop(); // 지난 코치마크의 관찰은 버린다 — 하나만 둔다
  // 말풍선은 대상 왼쪽. 아래 → 위 → (대상이 커서 둘 다 모자라면) 창 아래쪽 안. 안내만 하는 단계는 구멍도 막는다(예: 개체 상세의 박스에 보관)
  coachNow = drawCoachLayer({
    target,
    also: spec.also,
    bounds: { W: window.innerWidth, H: window.innerHeight },
    pad: COACH.pad,
    gap: COACH.gap,
    align: "left",
    interactive: spec.interactive === true,
    bubble: {
      step: spec.step,
      title: spec.title,
      body: spec.body,
      goLabel: spec.button || undefined, // 해 보는 단계는 단추 없이 그 동작으로 넘어간다
      onGo: spec.onGo,
      onSkip: () => void sendCommand("tutorial.skip", id), // 닫기는 스킵이다
    },
    onTargetResized: () => drawTutorial(),
  });
  return coachNow.layer;
}

// 튜토리얼 중에는 키보드 초점도 말풍선(과 목표 대상) 안에 둔다 — Tab·Enter 로 막 밖의 단추를 누르지 않게
guardCoachFocus(() => (coachEl ? coachNow : null));

// 튜토리얼 중에는 Esc 를 받지 않는다 — 받는 입력은 다음·확인·✕ 와 목표 행동뿐이다. 파티 상세 기기 창과 같다
// (94 1-2, docs/specs/game.md "튜토리얼 입력 규칙"). 잡는 단계에서 막아 모달 닫기·든 개체 내려놓기·입력칸 취소로 번지지 않게 한다
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && coachEl) e.stopImmediatePropagation();
  },
  true,
);

// 본문·대화상자가 스크롤되거나 창 크기가 바뀌면 자리를 다시 잰다
bodyEl.addEventListener("scroll", () => {
  if (coachEl) drawTutorial();
});
dialogEl.addEventListener(
  "scroll",
  () => {
    if (coachEl) drawTutorial();
  },
  true,
);
window.addEventListener("resize", () => {
  if (coachEl) drawTutorial();
});
