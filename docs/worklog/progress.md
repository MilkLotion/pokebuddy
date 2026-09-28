# 진행 상태 (임시 — `worklog/progress.md` 에 반영한다)

**집 PC 에서 먼저 할 일:** Figma 반영. Mac 의 Figma MCP 계정에 파일 편집 권한이 없어 못 했다. 할 일 표는 `records/user-modal/record.md` 끝 절이다. 포켓몬 우클릭 메뉴 시안(`Context Menu` `338:738`)도 그 표에 있다.

2026-09-28 Mac 에서 한 작업만 적는다.

- Mac 앱(dmg) 배포: 완료. 커밋 `21d9107`. 남은 확인 — Intel Mac 실기 실행, 첫 실행 Gatekeeper 경고 실기.
- 다음 릴리스 때 GitHub Release 에 dmg 두 개를 함께 올린다. `.blockmap` 은 올리지 않아도 된다(자동 업데이트를 쓰지 않는다).
- 포켓몬 우클릭 메뉴를 그 포켓몬 기능만으로(`잠시 숨기기`·`종료` 제거, `설정창 열기` → `상세 보기`): 완료(미커밋). 실기 우클릭 확인 전.
- 헤더 로고·톱니바퀴·사용자 모달(계정·연결): 코드 완료(미커밋). 남은 것 — **Figma 반영(집 PC, 할 일 표: `worklog/records/user-modal/record.md` "Figma 반영 — 남은 일")**, 헤더 아이콘 열림 상태(명세와 코드 불일치), `e2e-account` 실행.
- mac 포켓몬 클릭이 설정창을 앞으로 올림: 무대 창 `type: "panel"` 적용(미커밋). 사용자 실기로 해결 확인. Dock 아이콘이 뜨던 현상도 사라졌다.
- 0.8.0 릴리스: 완료. https://github.com/MilkLotion/pokebuddy/releases/tag/v0.8.0 — exe·blockmap·latest.yml·dmg 2개. `releases/latest/download/latest.yml` 이 0.8.0 을 가리킴을 확인했다. Mac 에서 만든 exe 의 Windows 실기 설치·0.7.0 → 0.8.0 자동 업데이트는 확인 전.
- 0.9.0 릴리스 예정(사용자 2026-09-28 "지금 작업한것들다 0.9.0 릴리스로 올릴예정"): Mac 자체 업데이트, 여러 화면 놀이공간, 훅 정리(자동 등록 제거·Codex PreToolUse 제거·갱신·Windows 안내). 릴리스에 dmg·zip 각 2개와 `latest-mac.yml` 을 더한다.
- 다음 버전으로 미룸: 연결 점검 기능(가벼운 확인·`점검` 실행 시험·마지막 신호 표시, node 없으면 연결 막기). 2026-09-28 제안, 사용자가 0.9.0 범위를 지금 작업으로 정함.
- 다음 버전 후보: Windows 제거 프로그램(NSIS)이 CLI 훅 등록을 걷지 않는다 — 제거 뒤에도 저장 폴더가 남으면 훅이 계속 돈다(Codex 는 창도). 제거 때 `uninstall` 의 등록 해제를 부르거나, 앱 제거 전 `해제` 를 안내한다. 2026-09-28 발견.
- 0.9.0 패치노트 제안: "Codex 를 쓰면 설정 → 사용자 → 연결에서 `갱신` 을 눌러 주세요"(옛 Codex 훅의 도구 전 이벤트를 걷는다). 사용자 확인 전.
- 0.9.0 릴리스: 완료. https://github.com/MilkLotion/pokebuddy/releases/tag/v0.9.0 — exe·blockmap·latest.yml, dmg·zip 각 2개, latest-mac.yml. `releases/latest/download/latest.yml`·`latest-mac.yml` 이 0.9.0 을 가리키고 arm64 zip 이 200 으로 받아진다. 사용자 실기 필요: Mac 0.7.0 → 0.9.0 dmg 덮어 설치, 모니터 사이 드래그·모니터 빼기·`화면에서 고르기`, Windows 0.8.0 → 0.9.0 자동 업데이트와 Codex 정리·안내 배너.
