// 코치마크(튜토리얼 말풍선)의 공용 계산 — 설정창(manage)·파티 상세 기기 창(pet)·무대(stage)가 같이 쓴다
// - 구멍: 대상 둘레를 pad 만큼 넓히고 창 안으로 자른다
// - 막 네 장: 구멍 위·아래·왼쪽·오른쪽을 덮는 사각형 [x, y, w, h]
// - 흔들기: 막을 누르면 말풍선을 한 번 흔든다 (2026-09-28 튜토리얼 입력 규칙)
// 창마다 다른 값(pad·gap·말풍선 자리)은 부르는 쪽이 정한다
import { buttonEl, el } from "./dom.js";
import { closeIconEl } from "./line-icons.js";

// 말풍선 폭과 창 가장자리 여백 — 세 곳이 같다
export const COACH_SIZE = { width: 280, margin: 8 } as const;

export interface Hole {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function holeOf(target: EdgeRect, pad: number, W: number, H: number): Hole {
  return { l: Math.max(0, target.left - pad), t: Math.max(0, target.top - pad), r: Math.min(W, target.right + pad), b: Math.min(H, target.bottom + pad) };
}

// 막 네 장 — 위, 아래, 왼쪽, 오른쪽 순서. 폭·높이는 음수일 수 있다(그리는 쪽이 0 으로 자른다)
export function dimRectsOf(hole: Hole, W: number, H: number): readonly (readonly [number, number, number, number])[] {
  return [
    [0, 0, W, hole.t],
    [0, hole.b, W, H - hole.b],
    [0, hole.t, hole.l, hole.b - hole.t],
    [hole.r, hole.t, W - hole.r, hole.b - hole.t],
  ];
}

// 말풍선을 한 번 흔든다 — 넘어가거나 스킵되지 않는다
export function nudgeEl(bubble: HTMLElement): void {
  bubble.classList.remove("nudge");
  void bubble.offsetWidth; // 애니메이션을 처음부터 다시
  bubble.classList.add("nudge");
}

// 말풍선 — head(단계 + ✕) / title / body? / 단추 줄? (C-23, Figma `Coach Bubble` `338:764`)
// - 단추는 말풍선이 만든다(Figma `Button` Primary Small, styles/coach.css `.coach-go`). 세 창이 같은 단추를 쓴다 (94 4-9)
// - goLabel 이 없으면 단추 줄이 없다(해 보는 단계). ✕ 는 스킵이다
export interface CoachBubbleSpec {
  step: string;
  title: string;
  body?: string;
  goLabel?: string;
  onGo?: () => void;
  onSkip: () => void;
}
export function coachBubbleEl(spec: CoachBubbleSpec): { bubble: HTMLElement; skip: HTMLButtonElement; go: HTMLButtonElement | null } {
  const bubble = el("div", "coach-bubble");
  const head = el("div", "head");
  const skip = buttonEl("x", undefined, spec.onSkip);
  skip.appendChild(closeIconEl()); // Figma `Icon / Close` `299:166` — 글자 ✕ 가 아니라 선 아이콘이다
  skip.setAttribute("aria-label", "튜토리얼 닫기");
  head.append(el("span", "step", spec.step), skip);
  bubble.append(head, el("div", "title", spec.title));
  if (spec.body) bubble.appendChild(el("div", "body", spec.body)); // 본문이 없으면 제목 아래 바로 단추
  let go: HTMLButtonElement | null = null;
  if (spec.goLabel) {
    go = buttonEl("coach-go", spec.goLabel, spec.onGo);
    const foot = el("div", "foot");
    foot.appendChild(go);
    bubble.appendChild(foot);
  }
  return { bubble, skip, go };
}

// 말풍선 세로 자리 — 세 창이 같은 규칙이다: 대상 아래 → 위 → (둘 다 모자라면) 창 아래쪽 안. 위 여백보다 위로는 가지 않는다 (94 4-8)
export function bubbleTopOf(hole: Hole, bubbleHeight: number, H: number, gap: number): number {
  const { margin } = COACH_SIZE;
  const below = hole.b + gap;
  const above = hole.t - gap - bubbleHeight;
  const top = below + bubbleHeight <= H - margin ? below : above >= margin ? above : H - margin - bubbleHeight;
  return Math.max(margin, top);
}

export interface CoachLayer {
  layer: HTMLElement;
  allows(node: Node): boolean; // 튜토리얼 중 초점을 둘 수 있는 곳 — 말풍선, 그리고 목표 행동이면 대상
  home: HTMLElement; // 초점을 되돌릴 곳 — 단추가 있으면 단추, 없으면 ✕
  stop(): void; // 대상 크기 감시를 끊는다
}

export interface CoachLayerOptions {
  target: HTMLElement;
  also?: HTMLElement | null; // 함께 밝힐 요소 — 구멍을 둘을 감싸는 사각형으로 넓힌다
  bounds: { W: number; H: number };
  pad: number;
  gap: number;
  align: "left" | "center"; // 말풍선 가로 — 대상 왼쪽(manage) · 대상 가운데(pet). 세로는 bubbleTopOf 하나
  interactive: boolean; // false 면 구멍도 막는다(coach-block) — 대상은 보이되 눌리지 않는다
  bubble: CoachBubbleSpec;
  onTargetResized?: () => void; // 대상이 그린 뒤에 크기·자리가 바뀌었다 — 다시 그린다
}

// DOM 요소를 대상으로 하는 코치마크 — 막 네 장, 구멍 막기, 말풍선 자리, 초점, 크기 감시. body 에 붙인다
export function drawCoachLayer(opts: CoachLayerOptions): CoachLayer {
  const { target, pad, gap } = opts;
  const { W, H } = opts.bounds;
  const layer = el("div", "coach");
  const t0 = target.getBoundingClientRect();
  const t1 = opts.also?.getBoundingClientRect();
  const r: EdgeRect = t1 ? { left: Math.min(t0.left, t1.left), top: Math.min(t0.top, t1.top), right: Math.max(t0.right, t1.right), bottom: Math.max(t0.bottom, t1.bottom) } : t0;
  const hole = holeOf(r, pad, W, H);
  const { bubble, skip, go } = coachBubbleEl(opts.bubble);
  // 막을 누르면 아무 일도 없고 말풍선을 한 번 흔든다
  const block = (cls: string, x: number, y: number, w: number, h: number): void => {
    const dim = el("div", cls);
    Object.assign(dim.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    dim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      nudgeEl(bubble);
    });
    layer.appendChild(dim);
  };
  for (const [x, y, w, h] of dimRectsOf(hole, W, H)) block("coach-dim", x, y, w, h);
  if (!opts.interactive) block("coach-block", hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);
  layer.appendChild(bubble);
  document.body.appendChild(layer);

  const { width, margin } = COACH_SIZE;
  const bh = bubble.offsetHeight;
  // 가운데 맞춤은 대상 하나의 가운데다(also 와 함께 쓰지 않는다)
  const anchor = opts.align === "center" ? t0.left + t0.width / 2 - width / 2 : r.left;
  const left = Math.min(Math.max(margin, anchor), W - width - margin);
  const top = bubbleTopOf(hole, bh, H, gap);
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;

  const home = go ?? skip;
  const allows = (n: Node): boolean => bubble.contains(n) || (opts.interactive && target.contains(n));
  const active = document.activeElement;
  if (!active || active === document.body || !allows(active)) home.focus({ preventScroll: true });

  // 대상이 그린 뒤에 크기가 바뀌면 다시 잰다 — 도감 칸은 어림 높이(content-visibility)로 먼저 잡혔다가 다음 프레임에 줄어든다
  let watch: ResizeObserver | null = null;
  const onResized = opts.onTargetResized;
  if (onResized) {
    const w = new ResizeObserver(() => {
      if (!layer.isConnected) return w.disconnect(); // 지난 코치마크다
      const now = target.getBoundingClientRect();
      if (Math.abs(now.top - t0.top) > 1 || Math.abs(now.height - t0.height) > 1 || Math.abs(now.width - t0.width) > 1) {
        w.disconnect();
        onResized();
      }
    });
    w.observe(target);
    watch = w;
  }
  return { layer, allows, home, stop: () => watch?.disconnect() };
}

// 튜토리얼 중에는 키보드 초점도 코치마크 안에 둔다 — Tab·Enter 로 막 밖의 단추를 누르지 않게
export function guardCoachFocus(current: () => CoachLayer | null): void {
  // Tab·Shift+Tab 은 받는 요소들 사이에서만 돈다 — 밖으로 나갔다 home 으로 끌려오면 앞으로 Tab 으로는 ✕ 에 닿지 못한다
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Tab") return;
      const coach = current();
      if (!coach) return;
      const list = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")].filter(
        (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && coach.allows(el),
      );
      if (!list.length) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? 0 : (at + (e.shiftKey ? list.length - 1 : 1)) % list.length;
      list[next]?.focus({ preventScroll: true });
    },
    true,
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const coach = current();
      if (!coach) return;
      if (e.target instanceof Node && !coach.allows(e.target)) coach.home.focus({ preventScroll: true });
    },
    true,
  );
}
