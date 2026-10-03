// Electron 실행 파일 경로 — pokebuddy 명령(cli/run.js)과 setup(cli/setup.js 의 준비 확인)이 같이 쓴다.
// electron 모듈을 불러오지 않는다(경로만 푼다) — Electron 44 는 실행 파일이 없으면 그 자리에서 100MB 를 받기 시작해
// 명령이 그만큼 멈추고, 오프라인이면 매번 스택을 찍는다. 받는 일은 설치(postinstall)와 pokebuddy setup 이 맡는다
// (예전 lib/electron.js. 도구 레인 T7b-2 에서 타입 검사를 받게 옮겼다)
import fs from "node:fs";
import path from "node:path";

// 반환: 실행 파일 절대 경로. 아직 안 받았으면 null
export function electronPath(): string | null {
  try {
    const dir = path.dirname(require.resolve("electron/package.json"));
    const rel = fs.readFileSync(path.join(dir, "path.txt"), "utf8").trim();
    const exe = path.join(dir, "dist", rel);
    return fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}
