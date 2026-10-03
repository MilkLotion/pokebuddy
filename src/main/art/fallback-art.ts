// 대체 그림의 공통 조립 — PMD 그림이 없는 종을 무대에 세우는 두 그림(걷기 overworld-art.ts · 초상 portrait-art.ts)이 함께 쓴다
// (worklog/records/code-structure/design/10-main.md 3.11절 art/fallback-art.ts)
//
// 둘 다 PMD 모양(8행 × 2열)의 시트로 Idle·Walk 두 동작만 만든다. 잠자기·반응 동작은 없다 — 없는 동작은 움직임 모듈이 알아서 빼고 고른다
//   Idle  방향의 첫 칸 → 같은 칸을 1도트 위 — 숨 쉬듯 들썩인다
//   행    PMD 방향 행(0 정면 2 오른쪽 4 뒤 6 왼쪽)
import type { SpriteSheet } from "../../shared/model/stage";
import type { PmdArt } from "./stage-art";

export const FALLBACK_RULES = {
  bob: 1, // 들썩이는 높이 (도트)
  idleMs: [600, 400], // 제자리 → 위
  rows: 8,
} as const;

// 시트 한 장의 동작 — 칸 크기·프레임 길이·그림
export function fallbackAnimOf(frame: { w: number; h: number }, ms: readonly number[], dataUrl: string): SpriteSheet {
  return { fw: frame.w, fh: frame.h, rows: FALLBACK_RULES.rows, frames: ms.map((d, x) => ({ x, ms: d })), dataUrl };
}

// 무대가 쓰는 그림 묶음 — 칸이 곧 몸이다. 상태는 src/main/art/pmd.ts STATE_ANIMS 와 같은 이름. 걷기만 오른쪽 행이고 나머지는 정면에서 숨 쉰다
export function fallbackArtOf(o: { kind: "overworld" | "portrait"; frame: { w: number; h: number }; anims: Record<"Idle" | "Walk", SpriteSheet>; dex: string }): PmdArt {
  return {
    kind: o.kind,
    cell: o.frame,
    body: o.frame,
    work: {},
    workOnly: [],
    zoom: 2,
    anims: o.anims,
    clips: {
      idle: { anim: "Idle", mode: "loop", row: 0 },
      running: { anim: "Walk", mode: "loop", row: 2 },
      waiting: { anim: "Idle", mode: "loop", row: 0 },
      waving: { anim: "Idle", mode: "loop", row: 0 },
      failed: { anim: "Idle", mode: "loop", row: 0 },
      review: { anim: "Idle", mode: "loop", row: 0 },
    },
    credits: [],
    dex: o.dex,
    from: o.kind,
  };
}
