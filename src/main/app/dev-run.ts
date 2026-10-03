// 개발 실행 판정과 개발용 환경 변수 (worklog/records/code-structure/design/10-main.md 3.12절 app/dev-run.ts)
//
// 개발 실행 — 저장소에서 직접 띄웠을 때만 참. exe·npm 설치본은 거짓이다 (src/platform/dev-run.ts isRepoRun)
// 업데이트 실기 시험 빌드 — 설치본 옆에 update-test.json 이 있다 (scripts/build-exe.cjs PB_UPDATE_TEST)
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isRepoRun } from "../../platform/dev-run.js";
import { PROJECT } from "../../platform/paths.js";

let devRun: boolean | null = null;
export function isDevRun(): boolean {
  if (devRun == null) devRun = isRepoRun(app.isPackaged, app.getAppPath());
  return devRun;
}

// 개발 실행이 아니면 환경 변수를 넘기지 않는다 — 서버 주소를 바꿔 세션 토큰을 빼 가지 못하게
export const devEnv = (): NodeJS.ProcessEnv => (isDevRun() ? process.env : {});

// 개발 실행에서만 읽는 양의 정수 환경 변수. 설치본·빈 값·숫자가 아닌 값·0 은 undefined
export function devNumber(name: string): number | undefined {
  const v = isDevRun() ? process.env[name] : undefined;
  return v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined;
}

let updateTestBuild: boolean | null = null;
export function isUpdateTestBuild(): boolean {
  if (updateTestBuild == null) updateTestBuild = app.isPackaged && fs.existsSync(path.join(PROJECT, "update-test.json"));
  return updateTestBuild;
}
