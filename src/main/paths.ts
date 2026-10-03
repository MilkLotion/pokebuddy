// [임시] 옛 자리 — src/main 의 파일들과 src/tools 가 이 경로로 읽는다. 원본은 src/platform/paths.ts. 메인 레인이 파일을 옮길 때 새 자리로 잇는다
// 창 문서·preload·로고는 src/main/windows/files.ts 로 옮겼다. 다시 내보내기를 읽는 파일이 없어지면 이 파일을 지운다
export { PATHS, PROJECT, type Paths } from "../platform/paths.js";
export { readConfig as loadConfig, type RuntimeInfo, type UserConfig } from "../platform/user-config.js";
