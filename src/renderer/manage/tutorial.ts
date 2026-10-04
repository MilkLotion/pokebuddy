// 설정창의 튜토리얼 코치마크 — 단계 세기, 코치마크 층, 그리고 튜토리얼 중의 입력 막기 (P10 15). 문구·단계 표는 tutorial-steps.ts
// Figma `Tutorial / Shop` `399:8590` · `Hatch` `399:8901` · `Party` `399:9159`. 모두 한 단계다(2026-09-26 사용자 결정).
// 대상 둘레 8px 을 비우고 네 장의 배경막으로 덮는다. 대상은 그대로 누를 수 있다. 말풍선은 대상 바로 아래(넘치면 위).
// 무엇을 보여 줄지는 스냅샷 `tutorial` 이 정한다(src/tutorial/queue.ts). 그 탭에 있을 때만 그린다 — 화면을 강제로 바꾸지 않는다.
// 문구는 Figma 그대로다 (2026-09-26 사용자 결정 "figma대로 진행")
import type { Snapshot } from "../../shared/model/snapshot.js";
import { COACH_SIZE, drawCoachLayer, guardCoachFocus, type CoachLayer } from "../ui/coach.js";
import { api } from "./api.js";
import { hold } from "./box-state.js";
import { sendCommand } from "./command.js";
import { dialogEl, isDimmed, openAnyDialog } from "./dialog.js";
import { bodyEl, redrawBody, setTab, tabButtonOf } from "./shell.js";
import { ui } from "./state.js";
import { ACHIEVEMENT_GUIDE, areaSteps, firstBoxPet, GUIDES, TUTORIAL_TEXT } from "./tutorial-steps.js";

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

let areaStep = 0;
let areaStart: Snapshot | null = null; // 지금 단계에 들어온 때
// 설정 › 화면에 새로 들어왔다 — 화면 탭 튜토리얼은 1단계부터 (settings 대화상자의 enter)
export function restartAreaTutorial(): void {
  areaStep = 0;
  areaStart = null;
}
// 가이드북의 다시 보기 — 지난번에 멈춘 단계가 아니라 1단계부터 센다
export function restartTutorialSteps(): void {
  guideId = null;
  guideStep = 0;
  restartAreaTutorial();
}
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
  // OS 가 그리는 창 단추 자리도 함께 어둡게 한다 — 헤더를 덮은 막의 겹수만큼. 모달 가림막 한 겹,
  // 돌보미집 위의 부화 결과 한 겹 더(daycare.ts drawUnder), 창 전체를 덮는 튜토리얼 막 한 겹 더(모달 안의 사용자·교환·화면 튜토리얼이면 두 겹)
  const stacked = ui.dialog?.kind === "hatched" && ui.dialog.over === "daycare";
  api.dim(Math.min(2, (isDimmed() ? 1 : 0) + (stacked ? 1 : 0) + (coachEl ? 1 : 0)));
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
