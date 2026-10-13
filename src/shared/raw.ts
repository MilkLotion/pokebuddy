// 손으로 고칠 수 있는 값(저장·명령 인자)을 읽는 순수 도우미 — 저장 정규화와 도메인이 같은 규칙을 쓴다
import type { ScreenRefV3 } from "./save-v3";

// 손으로 고친 값의 객체 판정 — 배열은 아니다. 여러 모듈이 같은 판정을 복사해 쓰던 것을 모은다 (worklog/records/perf-refactor 6-3)
// 훅(src/hooks)과 서버 검증(src/verify)은 다른 모듈을 가져오지 못해 따로 둔다
export const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// 화면 하나를 가리키는 값 — id 와 사각형이 모두 유한한 수이고 크기가 있어야 한다. 아니면 null (설정·개체·명령이 같은 규칙을 쓴다)
export function screenRefOf(raw: unknown): ScreenRefV3 | null {
  if (!isObj(raw)) return null;
  const { id, x, y, w, h } = raw;
  if (![id, x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const ref = { id: Math.round(id as number), x: Math.round(x as number), y: Math.round(y as number), w: Math.round(w as number), h: Math.round(h as number) };
  return ref.w > 0 && ref.h > 0 ? ref : null;
}
