# CLI 훅 연결 정리

- 날짜: 2026-09-28 (Mac). 0.9.0 에 넣는다.

## 설계

- 사용자 보고(Windows, 다른 세션의 진단 스크린숏): "hooks.json 에 PokeBuddy 상태 기록 명령이 Codex의 8개 이벤트에 등록돼 있었어 … Codex가 명령을 새로 실행해서 PowerShell이 반복해서 떴던 거야." 요청: "설치버튼 눌러야 설치되고 호환잘되게 하고싶은데".
- 조사: `pokebuddy setup` 이 설정 폴더가 있는 CLI 전부에 확인 없이 등록했다(`cli/setup.js`). 창은 Windows Codex 데몬이 훅마다 콘솔을 띄우는 Codex 쪽 문제다([openai/codex#44768](https://github.com/openai/codex/issues/44768)). 우회는 `codex --no-daemon`. 우리 훅의 PowerShell 호출(`ancestorPids`)은 `windowsHide` 로 숨겨져 있다.
- 사용자 결정(선택지 응답): setup 의 자동 등록을 빼고 기존 등록은 둔다. Codex 는 도구 전 이벤트(PreToolUse)를 빼고 Windows 안내를 둔다.
- 사용자 질문 "기존에 이미 훅으로 저 오류나는사람들을 어떻게 해결해주냐니까? 만약에 연결을 안하면" → 제안: 앱 시작 때 자동 정리(목록에 없는 우리 이벤트만 걷기, 있는 훅 파일 새로 고침) + Windows Codex 연결 사용자에게 한 번 안내 배너. 사용자 "진행".
- 사용자 질문 "해제 누르면 설치된 훅이 삭제돼?" → 코드 확인 답: 그 CLI 의 우리 등록 전부를 지운다(백업, 남의 훅 유지). 훅 파일은 CLI 들이 같이 써서 남긴다.

## 작업

1. 훅 정리(서브 에이전트): `cli/setup.js`(setup 은 파일 준비·옛 이름 걷기만, codex 이벤트에서 PreToolUse 제거, `registerTarget` 이 목록에 없는 우리 등록을 걷음, `hookInstalled` 에 stale·source), `src/agents/registry.ts`(`outdated`), `manage.d.ts`·`game.ts`·`manage-window.ts`(`outdated`·`platform`), `manage.ts`·`manage.html`(연결 탭 `갱신 필요`·`갱신`·Windows 안내), `cli/status.js`, `scripts/dev-manage.cjs`(CODEX_HOME 도 임시로), `selftest-agents`(12건).
2. 자동 정리·한 번 알림(서브 에이전트): `src/main/hook-upkeep.ts`(writer 동반자가 `startUpdater()` 뒤 `setImmediate` 로 정리, 주기 루프에서 알림 `tick`), `src/agents/notice.ts`(판정·`notices.json` 기록), `cli/setup.js` `tidyInstalled`, `registry.ts` `tidy()`, `notifier.ts` `showOnce`, 배너 종류 `notice`(`banner.ts`·`banner.html`), `ManageRoute` `{ to: "agents" }`, i18n 문구 2개, `selftest-hook-upkeep`(6건)·`selftest-notify`(9). 정리는 매 시작·모든 OS 에서 돈다(걷을 것이 없으면 쓰지 않음).
3. 문서: README, `docs/guide.md`(설치·CLI 연동 절·이벤트 표), `docs/specs/scenarios.md`(연결 탭 상태).

## 검수

- `cli/setup.js` diff 를 직접 읽었다 — 목록에 없는 이벤트 걷기는 `isOurs` 로 우리 명령만 고른다. 남의 훅과 백업 규칙은 그대로다.
- `selftest-agents` 12건 통과. 전체 selftest 는 여러 화면 작업이 끝난 뒤 다시 돌린다.
- 사용자의 실제 설정 파일: `~/.claude/settings.json` 10:02 변경은 우리 백업 파일이 없어 이 작업과 무관(Claude Code 권한 저장으로 봄). 이 Mac 의 `~/.codex/hooks.json` 에는 9월 23일 등록한 옛 훅 8개(PreToolUse 포함)가 있다 — 개발 실행으로 앱을 띄우면 자동 정리가 이 파일을 고친다.

- 알림 배너: `scripts/dev-banner.cjs` 에 `notice` 견본을 더해 찍었다 — 296×98 안에 제목 한 줄, 본문 두 줄, `바로가기`. 부화 배너와 크기가 같다.
- 자동 정리 뒤 전체 `npm run selftest` 종료 코드 0(서브 에이전트). 실제 `~/.codex/hooks.json`·`~/.claude/settings.json` 무변경.

## 피드백

- 이 Mac 에서 0.9.0(또는 개발 실행)을 켜면 실제 `~/.codex/hooks.json` 의 옛 PreToolUse 가 백업을 남기고 걷힌다 — 의도한 동작.

- Windows 제거 프로그램이 훅 등록을 걷지 않는다 → 다음 버전 후보(progress).
- 연결 점검 기능(가벼운 확인·실행 시험·마지막 신호) → 다음 버전으로 미룸.
- Windows 안내 줄·배너는 Mac 에서 띄울 수 없어 코드·자체 시험으로만 본다.
