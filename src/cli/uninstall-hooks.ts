// Windows 제거 프로그램이 부르는 훅 해제 — 설치된 exe 를 Node 모드(ELECTRON_RUN_AS_NODE=1)로 돌려 이 파일을 실행한다 (scripts/installer.nsh).
// CLI(Claude Code·Codex·Gemini) 설정에서 우리 훅 등록을 빼고 훅 파일을 지운다. 저장(~/.claude/pokebuddy)은 남긴다.
// 업데이트 때는 부르지 않는다(installer.nsh 의 isUpdated). 실패해도 제거는 이어진다 — 종료 코드만 남긴다
// (예전 cli/uninstall-hooks.js. 도구 레인 T7b-3 에서 TypeScript 로 옮겼다. 설치본은 resources\app\dist\cli\uninstall-hooks.js 를 부른다)
// setup 을 늦게 읽는다 — 읽다가 던져도(파일이 깨진 설치본 등) 이 catch 가 받아 종료 코드만 남기게
try {
  (require("./setup") as typeof import("./setup")).runUninstall({ editor: false }); // 에디터 CLI 는 찾지 않는다 — 제거 중에 외부 프로그램을 띄우지 않는다
} catch (e) {
  process.stderr.write(`pokebuddy uninstall-hooks: ${e instanceof Error && e.message ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
