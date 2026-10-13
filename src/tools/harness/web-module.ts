// 렌더러 모듈 불러오기 — 렌더러 빌드(dist/web, 브라우저 ESM)의 순수 모듈을 node 자체 검사가 그대로 부른다 (worklog/records/perf-refactor 0-4)
// node 22.12 이상은 ESM 을 require 한다. dist/web 에는 package.json 의 type 이 없어 node 가 모듈 꼴을 알아내며 경고를 찍는다 — 그 경고만 숨긴다.
// DOM 을 불러올 때 건드리는 모듈은 부를 수 없다. 순수 모듈(ui/live-draw.ts, manage/device-link.ts 등)만 쓴다
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
const TYPELESS = "MODULE_TYPELESS_PACKAGE_JSON";
let quiet = false;

// 경고 받는 곳을 한 번 감싼다 — 모듈 꼴 경고만 버리고 나머지는 그대로 넘긴다
function quietTypeless(): void {
  if (quiet) return;
  quiet = true;
  const listeners = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w: Error & { code?: string }) => {
    if (w.code === TYPELESS) return;
    for (const l of listeners) l(w);
  });
}

// rel 은 dist/web 기준 경로다. 예: "renderer/ui/live-draw.js"
export function webModule<T>(rel: string): T {
  quietTypeless();
  return require(path.join(ROOT, "dist", "web", rel)) as T;
}
