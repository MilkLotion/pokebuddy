// Electron 자리 채우기 — node 로 도는 자체 검사가 메인 모듈(src/main)을 불러올 때 쓴다. 설치본처럼 보이게 app.isPackaged 와 getAppPath 만 둔다
// 메인 모듈보다 먼저 import 한다. 창·IPC 를 쓰는 함수는 부르지 않는다 (worklog/records/perf-refactor 0-1)
const id = require.resolve("electron");
require.cache[id] = { id, filename: id, loaded: true, exports: { app: { isPackaged: true, getAppPath: () => process.cwd() } } } as unknown as NodeJS.Module;

export {};
