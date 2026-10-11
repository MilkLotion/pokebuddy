// 앱 메인 표시 — src/main/app.ts 의 맨 처음 import 다. 다른 import 보다 먼저 돌아야 한다(순서를 바꾸지 않는다).
// src/platform/paths.ts 는 이 표시가 있는 Electron 메인에서만 옛 데이터 폴더(~/.claude/pokebuddy)를 옮긴다.
// Electron 으로 도는 시험 도구(src/tools/dev·smoke)는 이 파일을 부르지 않는다 — 진짜 홈을 읽은 채 불러와도 사용자의 폴더를 옮기지 않게.
// Electron 에서는 require.main 이 진입 파일이 아니다(실측 2026-10-12: filename "electron") — 그래서 표시를 따로 둔다
(globalThis as Record<symbol, unknown>)[Symbol.for("pokebuddy.appMain")] = true;

export {};
