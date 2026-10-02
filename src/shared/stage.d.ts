// [임시] 옛 경로 — src/tools 가 이 경로로 가져다 쓴다. 도구 레인이 src/tools 의 import 를 새 자리로 고친 뒤 이 파일을 지운다.
// 새 코드는 여기서 가져오지 않는다. 자리는 ./model/stage.ts 와 ./ipc/stage.ts 다
export type * from "./model/stage.js";
export type * from "./ipc/stage.js";
