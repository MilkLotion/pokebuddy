# 공개 문서 정리 — README 게임 소개, 설명서 분리, 이미지 자리 (2026-09-29, 맥)

## 설계

### 사용자 요청 (2026-09-29)

- "지금 readme가 좀 불친절하긴해. 갱신안한지 좀 오래됐을거라 이상한 내용들이 많아. 이 게임에 대한 내용들이 적혀야하는데 그런게 아니거든."
- "최대한 문서들 다 정리하고 이미지는 대충 적고 집pc로 할 때 그 이미지 찾아서 잘 넣을 수 있게 너가 다시 세팅해봐."
- worklog 는 그대로 둔다. 공개 README 에서만 뺀다. "내 작업이력을 git에 올릴필욘없잖아."

### 범위

- `README.md`: 게임 소개 중심으로 새로 쓴다. 설치는 GitHub Releases 다운로드와 첫 실행 경고 안내로 바꾼다.
- `docs/guide.md`: 설치 파일 사용자용 설명서로 새로 쓴다.
- 옛 `docs/guide.md` 의 개발·내부 내용은 원문 그대로 두 문서로 옮긴다.
  - 동반자 동작(따르는 창, CLI 훅 연동, buddy, 무대 창, 그림 메모) → `docs/specs/companion.md`
  - 저장소 실행, npm 판, 옛 이름 이전, CLI 명령·옵션·설정 파일, 문제 확인, 빌드·시험·배포·로고 → `docs/contributing/development.md`
- `docs/images/`: 캡처 목록과 넣는 방법. 문서에는 `<!-- 이미지 [ID]: … -->` 주석으로 자리만 둔다.
- 범위 밖: `docs/specs/*` 의 규칙 내용, 코드 주석의 `worklog/` 경로.

### 근거

- npm 레지스트리에 `pokebuddy` 가 없다. `npm view pokebuddy` 가 404 를 돌려줬다(2026-09-29). `package.json` 에 `"private": true` 가 있다.
- GitHub 저장소 이름은 `MilkLotion/pokebuddy` 다. 옛 주소 `terminal_pokemon` 은 301 로 넘어간다. 릴리스 v0.11.1 에 exe·dmg 가 있다(GitHub API, 2026-09-29).
- 설정창 탭은 6개다(`src/renderer/manage.ts` `TABS`, 교환 포함).

## 작업

| 파일 | 변경 |
|---|---|
| `README.md` | 새로 씀. 다운로드 표, 경고창 넘기기, 이렇게 놀아요, 설정창 탭, 선택 기능, 문서 표, 라이선스. 이미지 자리 4개 |
| `docs/guide.md` | 새로 씀. 설치·업데이트·제거, 처음 시작하기, 놀이공간, 돌봄, 포인트와 상점, 알, 성장과 진화, 파티와 박스, 도감과 업적, 교환, 계정과 우편함, 설정, AI 도구 연결, 문제 해결, 라이선스 |
| `docs/specs/companion.md` | 새 파일. 옛 설명서 267–310, 325–353, 355–410, 412–477, 479–516, 570–596 줄을 옮김. 첫 절 이름을 `기본 구조` 로 바꿈. `design.md` 링크 경로 수정 |
| `docs/contributing/development.md` | 새 파일. 옛 설명서 20–43, 109–177, 179–265, 518–568, 598–698 줄을 옮김. npm 절은 미게시 사실로 고침 |
| `docs/images/README.md` | 새 파일. 캡처 16건 목록, 넣는 절차, 시험용 HOME 준비 명령, 찍을 때 지킬 것 |
| `docs/images/install-windows-smartscreen.png` | 사용자가 대화에 올린 SmartScreen 캡처 |
| `docs/README.md` | 문서 표를 쓰는 사람·만드는 사람으로 나눔. 새 문서 3개 추가. `worklog/` 절 삭제(`contributing/workflow.md` 에 같은 내용이 있음) |
| `docs/terms.md` | 설정창 탭에 교환 추가. 설명서 행의 범위 갱신 |
| `docs/design.md`, `docs/specs/game.md`, `docs/specs/ui-components.md` | 설정창 탭에 교환 추가. "관리 창" 3곳을 "설정창"으로(Figma 노드 이름은 유지) |
| `AGENTS.md` | 문서 지도에 `companion.md`, `development.md`, `docs/images/` 추가 |
| `scripts/check-docs.cjs` | 문서 루트 허용 폴더에 `images` 추가 |
| `src/tools/dev-test.ts`, `src/main/portraits.ts`, `src/cli/game.ts` | 주석의 설명서 경로를 새 위치로 |

## 검수

- `node scripts/check-docs.cjs`: 실패 1건 `문서 루트 위치 오류: docs/worklog-mac`. 이 폴더를 옮기면 사라진다. 그 밖의 파일 링크 누락은 없다.
- `git diff --check` (변경 파일 한정): 문제 없음.
- 의미 검수: 새 README 와 설명서의 기능 서술을 `docs/specs/game.md`, `docs/design.md`, `docs/specs/balance.md`, 옛 설명서와 대조했다. 수치는 복사하지 않고 `balance.md` 로 연결했다. 옮긴 두 문서는 원문 그대로라 문장을 다시 검수하지 않았다.
- 빌드·앱 실행: 미실행(문서 작업, 주석 세 줄만 코드 변경).

## 피드백과 수정

- `docs/images/README.md` 의 링크 예가 검사기에 실제 링크로 잡혔다. 목록 안 들여쓴 코드 블록은 검사기가 코드로 빼지 않는다. 예를 목록 밖 코드 블록으로 옮겼다.
- 남은 일: 집 PC 에서 `docs/images/README.md` 목록의 캡처 15건을 넣는다. 설명서의 줍기 서술은 오늘 맥 작업(줍기, 미검수)에 기댄다. 줍기가 빠지면 설명서의 해당 줄도 뺀다.
