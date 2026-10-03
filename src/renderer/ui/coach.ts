// 코치마크(튜토리얼 말풍선)의 공용 계산 — 설정창(manage)·파티 상세 기기 창(pet)·무대(stage)가 같이 쓴다
// - 구멍: 대상 둘레를 pad 만큼 넓히고 창 안으로 자른다
// - 막 네 장: 구멍 위·아래·왼쪽·오른쪽을 덮는 사각형 [x, y, w, h]
// - 흔들기: 막을 누르면 말풍선을 한 번 흔든다 (2026-09-28 튜토리얼 입력 규칙)
// 창마다 다른 값(pad·gap·말풍선 자리)은 부르는 쪽이 정한다

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
