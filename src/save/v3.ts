// [임시] 옛 자리 — src/tools 의 시험·도구 34개와 scripts/*.cjs 다섯이 dist/save/v3.js 로 empty·normalize 를 읽는다.
// 원본은 ./normalize.ts(저장 전체)와 ./normalize-pets.ts(개체·파티·박스)다. 읽는 쪽이 새 자리로 가면 이 파일을 지운다
export { emptySave as empty, normalizeSave as normalize, normalizeTx } from "./normalize.js";
export { addStraysToBox as putStrays, normalizePet } from "./normalize-pets.js";
