// 무대 튜토리얼 코치마크 — Figma `Tutorial / First Care` `397:8552`. 문구와 대상은 메인이 준다(stage:coach).
// 첫 돌봄: 포켓몬 둘레 8px 을 비우고 나머지를 어둡게 한다. 막은 보기만 한다 — 클릭은 그대로 아래로 통과하므로 포켓몬 우클릭이 된다.
//   포켓몬이 움직이므로 그릴 때마다 자리를 다시 잰다(placeAt). 말풍선은 포켓몬 위(넘치면 아래).
// 놀이공간: 무대(=놀이공간) 둘레 테두리와 "지금 · 화면 전체" 표시, 말풍선은 가운데.
// 말풍선 위에서만 클릭을 받는다(answerHover 의 "coach" 답). 버튼은 메인으로 간다 — 버튼은 완료, ✕ 는 스킵
// 설정창·파티 상세와 같이 쓰는 것은 구멍·막·흔들기(ui/coach.ts)뿐이다. 자리 잡기(메뉴 피하기)·입력 가드·area 형은 여기만 있다
import type { CoachView } from "../../shared/model/stage.js";
import { el } from "../ui/dom.js";
import { COACH_SIZE, dimRectsOf, holeOf, nudgeEl } from "../ui/coach.js";

export interface StageCoachDeps {
  box: HTMLElement; // #coach
  hitAt: (x: number, y: number) => string | null; // 무대 좌표의 포켓몬
  pressedId: () => string | null; // 누르고 있는 포켓몬
  onAct: (id: string, action: "done" | "skip") => void;
  onChanged: () => void; // 다음 그리기가 포켓몬 자리에 맞춰야 한다
}

const COACH = { pad: 8, gap: 12, ...COACH_SIZE };

export function createStageCoach(deps: StageCoachDeps): {
  drawCoach(next: CoachView | null): void;
  placeAt(petId: string, r: { x: number; y: number; w: number; h: number }): void;
  isOver(x: number, y: number): boolean;
  answerHover(x: number, y: number): { hoverId: string | null; answer: string | null };
} {
  const coachBox = deps.box;
  let coach: CoachView | null = null;
  let bubbleEl: HTMLElement | null = null;
  const dims: HTMLElement[] = [];

  function drawCoach(next: CoachView | null): void {
    coach = next;
    coachBox.replaceChildren();
    dims.length = 0;
    bubbleEl = null;
    coachBox.hidden = !next;
    if (!next) return;
    if (next.kind === "pet") {
      for (let i = 0; i < 4; i++) dims.push(coachBox.appendChild(el("div", "coach-dim")));
    } else {
      const frameEl = coachBox.appendChild(el("div", "coach-area"));
      frameEl.appendChild(el("span", "coach-area-label", next.areaLabel ?? ""));
    }
    const bubble = el("div", "coach-bubble");
    const head = el("div", "head");
    const x = el("button", "x", "✕");
    x.setAttribute("aria-label", "튜토리얼 닫기");
    x.addEventListener("click", () => act("skip"));
    head.append(el("span", "step", next.step), x);
    bubble.append(head, el("div", "title", next.title));
    if (next.body) bubble.appendChild(el("div", "body", next.body)); // 본문이 없으면 제목만
    // 버튼 문구가 없는 단계는 행동으로만 넘어간다 — 첫 돌봄은 우클릭·밥 주기 (Figma `579:16959`)
    if (next.button) {
      const foot = el("div", "foot");
      const go = el("button", "go", next.button);
      go.addEventListener("click", () => act("done"));
      foot.appendChild(go);
      bubble.appendChild(foot);
    }
    // 말풍선을 누른 것이 포켓몬 잡기·우클릭 메뉴로 번지지 않게
    for (const type of ["pointerdown", "pointerup", "contextmenu"]) bubble.addEventListener(type, (e) => e.stopPropagation());
    coachBox.appendChild(bubble);
    bubbleEl = bubble;
    if (next.kind === "area") placeArea();
    else deps.onChanged(); // 다음 그리기가 포켓몬 자리에 맞춘다
  }

  function act(action: "done" | "skip"): void {
    if (!coach) return;
    deps.onAct(coach.id, action);
  }

  // 첫 돌봄 — 포켓몬 사각형 r(무대 안 DIP)에 맞춰 막 네 장과 말풍선을 옮긴다. 대상 포켓몬일 때만
  function placeAt(petId: string, r: { x: number; y: number; w: number; h: number }): void {
    if (coach?.kind !== "pet" || coach.petId !== petId) return;
    if (!bubbleEl || dims.length !== 4) return;
    const W = innerWidth;
    const H = innerHeight;
    const hole = holeOf({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h }, COACH.pad, W, H);
    dimRectsOf(hole, W, H).forEach(([x, y, w, h], i) => {
      const d = dims[i];
      if (d) Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    });
    const bh = bubbleEl.offsetHeight;
    const bw = COACH.width;
    const clampX = (x: number): number => Math.min(Math.max(COACH.margin, x), W - bw - COACH.margin);
    const clampY = (y: number): number => Math.min(Math.max(COACH.margin, y), H - bh - COACH.margin);
    const above = hole.t - COACH.gap - bh;
    const below = hole.b + COACH.gap;
    const centerX = clampX(r.x + r.w / 2 - bw / 2);
    const baseTop = above >= COACH.margin ? above : clampY(below);
    let spot = { left: centerX, top: baseTop };
    // 열린 메뉴를 덮지 않는 자리 — 기본 자리 → 메뉴 왼쪽 → 메뉴 오른쪽 → 메뉴 위 → 메뉴 아래 순서로 처음 맞는 곳
    const a = coach?.avoid;
    if (a) {
      const hits = (s: { left: number; top: number }): boolean => s.left < a.x + a.w && s.left + bw > a.x && s.top < a.y + a.h && s.top + bh > a.y;
      const fits = (s: { left: number; top: number }): boolean => s.left >= 0 && s.left + bw <= W && s.top >= 0 && s.top + bh <= H;
      const candidates = [
        spot,
        { left: a.x - COACH.gap - bw, top: clampY(baseTop) },
        { left: a.x + a.w + COACH.gap, top: clampY(baseTop) },
        { left: clampX(a.x + a.w / 2 - bw / 2), top: a.y - COACH.gap - bh },
        { left: clampX(a.x + a.w / 2 - bw / 2), top: a.y + a.h + COACH.gap },
      ];
      spot = candidates.find((s) => fits(s) && !hits(s)) ?? spot;
    }
    bubbleEl.style.left = `${Math.round(spot.left)}px`;
    bubbleEl.style.top = `${Math.round(spot.top)}px`;
  }

  // 놀이공간 — 말풍선을 무대 가운데에
  function placeArea(): void {
    if (!bubbleEl) return;
    bubbleEl.style.left = `${Math.round((innerWidth - COACH.width) / 2)}px`;
    bubbleEl.style.top = `${Math.round((innerHeight - bubbleEl.offsetHeight) / 2)}px`;
  }
  addEventListener("resize", () => {
    if (coach?.kind === "area") placeArea();
  });

  // 첫 돌봄 말풍선이 떠 있는 동안의 입력 — 받는 것은 대상 포켓몬 우클릭과 말풍선 단추뿐이다.
  // 왼쪽 누름(잡기·클릭=놀아주기)과 다른 곳 우클릭은 막고 말풍선을 한 번 흔든다. 포인터 모듈(pointer.ts)보다 먼저 본다(캡처)
  const guardCoach = (e: MouseEvent): boolean => {
    if (coach?.kind !== "pet" || coach.passive) return false;
    if (isOver(e.clientX, e.clientY)) return false; // 말풍선 단추는 그대로
    const onTarget = deps.hitAt(e.clientX, e.clientY) === coach.petId;
    if (e.type === "contextmenu" && onTarget) return false; // 목표 행동 — 대상 우클릭
    if (e.type === "pointerdown" && (e as PointerEvent).button === 2 && onTarget) return false;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== "pointerup" && bubbleEl) nudgeEl(bubbleEl);
    return true;
  };
  for (const type of ["pointerdown", "pointerup", "contextmenu"] as const) addEventListener(type, guardCoach, true);

  // 커서가 말풍선 위인가 (무대 안 좌표)
  function isOver(x: number, y: number): boolean {
    if (!coach || !bubbleEl || coachBox.hidden) return false;
    const b = bubbleEl.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  }

  // 메인이 묻는 커서 자리의 답 — 누르고 있는 동안은 늘 그 마리. 말풍선 위면 "coach"(클릭을 받는다)
  // 첫 돌봄 말풍선이 떠 있으면 창이 모든 클릭을 받는다 — 막을 누르면 아래 창으로 가지 않고 말풍선이 흔들린다.
  // 대상 포켓몬 위에서만 그 마리로 답한다(우클릭을 받게) (2026-09-28 튜토리얼 입력 규칙)
  function answerHover(x: number, y: number): { hoverId: string | null; answer: string | null } {
    const pressed = deps.pressedId();
    const onBubble = !pressed && isOver(x, y);
    let hoverId = pressed ?? (onBubble ? null : deps.hitAt(x, y));
    const guarded = coach?.kind === "pet" && !coach.passive && !pressed;
    if (guarded && !onBubble && hoverId !== coach?.petId) hoverId = null;
    return { hoverId, answer: onBubble || (guarded && hoverId == null) ? "coach" : hoverId };
  }

  return { drawCoach, placeAt, isOver, answerHover };
}
