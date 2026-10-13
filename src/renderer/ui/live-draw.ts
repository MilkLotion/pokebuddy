// 화면 모델의 "모양" — 시간으로만 바뀌는 필드(LIVE_KEYS)와 시간 값의 경로(paths)를 뺀 글자. 모양이 같으면 다시 그리지 않고 표시만 고친다
import { LIVE_KEYS } from "../../shared/live-keys.js";

const BASE: ReadonlySet<string> = new Set(LIVE_KEYS);
const NONE: ReadonlySet<string> = new Set();

// 만복도는 100 에 닿았는지만 모양이다(밥 주기 · 배부름) — 그 밖의 값은 표시만 고친다. extraLive 는 그 창만 받는 시간 필드다
// paths — "day.progress" 꼴의 점 경로. 배열은 지나지 않는다. 그 자리만 사본으로 바꿔 지운다(원본은 그대로)
function withoutPaths(view: unknown, paths: readonly string[]): unknown {
  if (!paths.length || view === null || typeof view !== "object") return view;
  const root: Record<string, unknown> = { ...(view as Record<string, unknown>) };
  for (const p of paths) {
    const keys = p.split(".");
    let at = root;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const next = at[keys[i]!];
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        at = {};
        break;
      }
      at = at[keys[i]!] = { ...(next as Record<string, unknown>) };
    }
    delete at[keys[keys.length - 1]!];
  }
  return root;
}

export function structureOf(view: unknown, extraLive: ReadonlySet<string> = NONE, paths: readonly string[] = []): string {
  return JSON.stringify(withoutPaths(view, paths), (k: string, val: unknown) => (BASE.has(k) || extraLive.has(k) ? undefined : k === "fullness" && typeof val === "number" ? val >= 100 : val));
}
