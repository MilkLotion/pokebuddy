// 창 옵션 — 모든 창이 같은 보안 옵션을 쓰게 한 곳에서 만든다 (worklog/records/code-structure/design/10-main.md 3.1절)
//
// contextIsolation·sandbox 를 기본값에 기대지 않고 적는다. 렌더러는 preload 가 낸 다리만 쓴다.
// 폴더 나누기(windows/options.ts)와 투명 창 공통 옵션은 M2 에서 더한다
import type { WebPreferences } from "electron";

// preload 가 null 이면 문서를 읽지 않는 창이다 (OS 대화상자의 부모)
export function webPreferencesOf(preload: string | null, extra: Pick<WebPreferences, "backgroundThrottling" | "autoplayPolicy"> = {}): WebPreferences {
  return { ...(preload ? { preload } : {}), contextIsolation: true, sandbox: true, ...extra };
}
