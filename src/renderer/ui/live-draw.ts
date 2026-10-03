// 화면 모델의 "모양" — 시간으로만 바뀌는 필드(LIVE_KEYS)를 뺀 글자. 모양이 같으면 다시 그리지 않고 표시만 고친다
import { LIVE_KEYS } from "../../shared/live-keys.js";

const BASE: ReadonlySet<string> = new Set(LIVE_KEYS);
const NONE: ReadonlySet<string> = new Set();

// 만복도는 100 에 닿았는지만 모양이다(밥 주기 · 배부름) — 그 밖의 값은 표시만 고친다. extraLive 는 그 창만 받는 시간 필드다
export function structureOf(view: unknown, extraLive: ReadonlySet<string> = NONE): string {
  return JSON.stringify(view, (k: string, val: unknown) => (BASE.has(k) || extraLive.has(k) ? undefined : k === "fullness" && typeof val === "number" ? val >= 100 : val));
}
