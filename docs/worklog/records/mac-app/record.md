# Mac 앱(dmg) 배포

- 날짜: 2026-09-28
- 컴퓨터: Mac(Apple Silicon, macOS 26). 이 컴퓨터에는 `worklog/` 가 없어 이 기록을 `docs/worklog/` 에 임시로 둔다.
- 커밋: `21d9107 feat: [배포] Mac 앱(dmg) 빌드 — npm run dist:mac, ad-hoc 서명, 자동 업데이트 없음`

## 설계

**목표.** Mac 사용자가 Node.js 없이 설치하는 앱을 만든다. Windows 설치 파일(exe)은 Mac 에서 실행할 수 없다.

- 사용자 요청(2026-09-28): "맥모드 추가하자. exe를 맥에선 못하네"
- 범위: 빌드 스크립트, npm 스크립트, 설치·배포 문서. 앱 런타임 코드는 바꾸지 않는다.
- SSOT: [scripts/build-exe.cjs](../../../../scripts/build-exe.cjs), [package.json](../../../../package.json), [docs/guide.md](../../../guide.md)

**결정.** 다음은 이 작업에서 정한 제안이다. 사용자는 결과 보고 뒤 커밋을 지시했다. 항목별 명시 승인은 없다.

| 항목 | 결정 | 근거 |
|---|---|---|
| 형식 | dmg 두 개 — `PokeBuddy-<버전>-arm64.dmg`, `PokeBuddy-<버전>-x64.dmg` | universal 앱은 크기가 두 배다. 아키텍처별 dmg 가 흔한 배포 방식이다 |
| 스크립트 | `scripts/build-exe.cjs --mac` 분기. 파일 모으기(`release/app/`)는 Windows 와 같다 | 새 스크립트를 만들지 않는다. `e2e-update.cjs`·문서가 파일 이름을 참조한다 |
| 서명 | ad-hoc(`identity: "-"`), `hardenedRuntime: false` | Apple 개발자 인증서가 없다. Apple Silicon 은 서명이 전혀 없는 앱을 열지 않는다 |
| 자동 업데이트 | 끈다. `publish: null` | electron-updater 의 mac 설치기(Squirrel.Mac)는 정식 서명이 있어야 새 번들을 받는다. `src/main/app.ts` 는 이미 `win32` 에서만 켠다 |
| 링크 | `mac.protocols` 로 `pokebuddy://` 를 Info.plist 에 등록 | mac 은 Info.plist 에 적힌 스킴만 앱에 넘긴다. Windows 는 실행 중 등록이라 mac 에만 둔다 |
| 앱 이름 | `PokeBuddy.app` (`productName`) | 저장 폴더는 `app.setPath("userData", …)` 로 고정이라 이름과 무관하다 |
| 헬퍼 | `dist:mac` 이 universal 헬퍼를 먼저 만든다. 빌드는 arm64·x86_64 가 모두 없으면 멈춘다 | Intel dmg 가 창 추적 없이 나가지 않게 한다 |

**위험.**

- 처음 열 때 Gatekeeper 경고가 뜬다. 사용자가 `그래도 열기` 를 눌러야 한다.
- Intel 판은 실기에서 띄워 보지 않았다.

**수용 조건.**

1. `npm run dist:mac` 이 dmg 두 개를 만든다.
2. 두 앱의 서명이 `codesign --verify --deep --strict` 를 통과한다.
3. 번들 안 헬퍼가 arm64·x86_64 를 모두 가진다.
4. Info.plist 에 `pokebuddy` 스킴이 있다.
5. `app-update.yml`·`latest-mac.yml` 이 생기지 않는다.
6. 앱이 켜져 첫 포켓몬 선택 창을 띄운다.

## 작업

- `scripts/build-exe.cjs`: `--mac` 분기(서브 에이전트 작성, 검수 후 `publish: null` 한 줄 수정). mac 이 아닌 곳의 `--mac` 과 `PB_UPDATE_TEST` 와의 조합은 오류로 멈춘다. 설정은 공통부와 플랫폼 조각으로 나눴다. Windows 조각의 값은 전과 같다.
- `package.json`: `"dist:mac": "npm run build && node scripts/build-helper.js && node scripts/build-exe.cjs --mac"`
- `docs/guide.md`: "Mac 앱" 설치 절, "Mac 앱 만들기" 배포 절, 요구사항·설치 머리 문장
- `README.md`: Mac 설치 한 줄
- `docs/specs/game.md`, `docs/specs/modules.md`: Mac 앱은 자동 업데이트를 하지 않는다

## 검수

| 명령·확인 | 결과 |
|---|---|
| `npm install` (이 Mac 의 `node_modules` 에 electron-builder 가 없었다. 락파일 그대로) | 통과. 생긴 `package-lock.json` 의 `peer` 표시 차이는 되돌렸다 |
| `npm run dist:mac` | 통과. arm64 121MB, x64 128MB |
| `codesign --verify --deep --strict` (두 앱) | 통과. `Signature=adhoc` |
| `lipo -archs` 앱 실행 파일 / 헬퍼 | arm64 · x86_64 각각 / 두 앱 모두 `x86_64 arm64` |
| Info.plist `CFBundleURLTypes` | `pokebuddy` 등록 |
| `Contents/Resources/*.yml`, `release/latest-mac.yml` | 두 번째 빌드부터 없음 |
| 실행 시험 — arm64 앱 사본에 `update-test.json`(임시 홈)을 넣고 실행 | 선택 창(640×812)이 떴다. 그림 2,093장을 8.3초에 받았다. 실제 저장·로그인 항목·링크 등록은 건드리지 않았다 |
| `node scripts/check-docs.cjs`, `git diff --check` | 통과 |

문서 문장 검수: 변경한 guide·README·specs 문장에 작성 원칙(한 문장 한 사실, 조건 먼저)을 적용했다.

## 피드백과 수정

1. 첫 빌드에서 `app-update.yml`(`provider: gitlab`)과 `latest-mac.yml` 이 생겼다. `publish` 키를 빼면 electron-builder 가 git 원격으로 공급처를 짐작한다. mac 조각에 `publish: null` 을 넣었다. 다시 빌드해 두 파일이 없음을 확인했다.
2. 첫 실행 시험이 `starter-cancelled` 로 끝났다. 선택 창이 선택 없이 닫혔다. 두 번째 실행에서 창 위치가 계속 바뀌었다. 사용자가 화면에서 창을 만진 것으로 추정한다. 확인되지 않았다.

**남은 문제.**

- Intel Mac 실기 실행 [스펙 미확정]
- Gatekeeper 경고 문구는 macOS 버전마다 다르다. 가이드의 두 경우(`그래도 열기`, "손상됨" 시 `xattr`)는 실기로 보지 않았다.
- CLI 상태 연동의 훅은 `node` 로 돈다. Node.js 없는 Mac 에서는 연동이 안 된다. Windows 실행 파일과 같다.

## 후속 — 포켓몬 클릭이 설정창을 앞으로 올림 (2026-09-28)

- 사용자 관찰: "맥에서는 화면에 있는 포켓몬 클릭을 해도 설정창이 열리네?"
- 조사: 메인·무대 코드에 포켓몬 클릭으로 설정창을 여는 경로는 없다. 클릭은 놀아주기(`src/main/commands.ts` `click`)다. 설정창은 닫으면 창을 없앤다(`closed`).
- 원인(사용자 실기로 해결 확인, 합성 실험은 결론 없음): mac 은 `focusable: false` 창을 눌러도 앱을 활성화한다. 앱이 활성화되면 뒤에 열린 채 있던 설정창이 앞으로 올라온다. 같은 이유로 터미널 포커스도 빠진다.
- 조치: `src/main/stage-window.ts` — mac 에서만 무대 창을 `type: "panel"` 로 만든다. Electron 문서: panel 은 `NSWindowStyleMaskNonactivatingPanel` 을 붙이고 모든 Space 에 보인다.
- 검수: `npm run build`, `selftest-stage` 통과. 합성 클릭 실험(`CGEvent`)은 이 터미널에 손쉬운 사용 권한이 없어 클릭이 전달되지 않았다. 결론을 내지 못했다.
- 사용자 실기(2026-09-28): "해결된거같은데? 원래는 맥 밑에 독? 거기에 떴었는데, 그것도 사라진게 마음에 들어." — 설정창이 올라오지 않는다. 포켓몬 클릭 때 Dock 에 앱 아이콘이 뜨던 현상도 사라졌다(앱 활성화가 멈춘 결과로 본다). 사용자가 이 변화를 좋다고 했다.
- 남은 확인: 드래그, 우클릭 메뉴, 터미널 포커스 유지, 전체 화면 앱 위 표시는 따로 보고받지 않았다.
