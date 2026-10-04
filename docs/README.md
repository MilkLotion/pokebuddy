# 문서 안내

이 폴더는 pokebuddy 의 공개 문서다. 지금 앱이 어떻게 동작하는지와 그 규칙을 적는다.

## 쓰는 사람

| 문서 | 내용 |
|---|---|
| [guide.md](guide.md) | 설치, 게임 방법, 설정, 문제 해결 |

## 만드는 사람

| 문서 | 내용 |
|---|---|
| [design.md](design.md) | 제품 구조와 설계 원칙 |
| [terms.md](terms.md) | 화면 용어와 뜻 |
| [specs/game.md](specs/game.md) | 게임 규칙 — 파티·박스·도감·상점·가방·알·진화·튜토리얼·설정 |
| [specs/scenarios.md](specs/scenarios.md) | 사용자 흐름과 수용 조건 |
| [specs/balance.md](specs/balance.md) | 가격·적립·성장 같은 밸런스 수치 |
| [specs/moves.md](specs/moves.md) | 기술·특성 데이터와 탐험·배틀 전투 규칙 |
| [specs/modules.md](specs/modules.md) | 모듈 책임과 경계, 저장 구조, 명령 계약 |
| [specs/companion.md](specs/companion.md) | 동반자 동작 — 따르는 창, CLI 상태 연동, buddy, 무대 창, 그림 |
| [specs/ui-components.md](specs/ui-components.md) | 화면에서 반복되는 UI 컴포넌트 계약 |
| [contributing/development.md](contributing/development.md) | 저장소 실행, CLI 명령, 시험, 빌드와 릴리스 |
| [contributing/workflow.md](contributing/workflow.md) | 작업 절차 |
| [contributing/writing.md](contributing/writing.md) | 문서 작성 원칙과 검수 항목 |
| [contributing/figma.md](contributing/figma.md) | Figma 글자 작업과 Galmuri 재배치 |
| [images/README.md](images/README.md) | 문서 캡처 목록과 넣는 방법 |

## 근거 판단

- 실제 동작은 코드·설정·검사 결과로 확인한다.
- 규칙이 바뀌면 그 규칙을 적은 공개 문서만 고친다. 같은 수치를 여러 문서에 복사하지 않는다.
- 아직 정하지 않은 항목에는 `[스펙 미확정]` 을 붙인다.
- Figma 는 화면 모양의 근거다. 게임 규칙의 근거가 아니다.

## 완료 전 확인

1. [작성 검사표](contributing/writing.md#완료-전-의미-검수)를 적용한다.
2. `node scripts/check-docs.cjs` 를 실행한다.
3. `git diff --check` 를 실행한다.

자동 검사는 구조와 파일 참조를 확인한다. 문장의 의미는 판정하지 않는다.
