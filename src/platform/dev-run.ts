// 저장소에서 직접 띄웠는가 — exe 설치본(packaged)도, npm 설치본도 아니어야 참이다.
// app.isPackaged 만으로는 npm 설치본(`electron .` 으로 뜬다)을 가리지 못한다. npm 설치본(package.json files)에는 src/main 의 TS 원본이 없다.
// Electron 값을 넣어 한 번 셈하는 것은 메인의 일이다
import fs from "node:fs";
import path from "node:path";

export function isRepoRun(packaged: boolean, appPath: string, exists: (file: string) => boolean = fs.existsSync): boolean {
  return !packaged && exists(path.join(appPath, "src", "main", "app.ts"));
}
