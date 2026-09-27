# 문서 안내

이 폴더는 pokebuddy 의 공개 문서다. 지금 앱이 어떻게 동작하는지와 그 규칙을 적는다.

## 문서

| 문서 | 내용 |
|---|---|
| [guide.md](guide.md) | 설치와 사용 방법, 동반자·CLI 연동·문제 확인 |
| [design.md](design.md) | 제품 구조와 설계 원칙 |
| [terms.md](terms.md) | 화면 용어와 뜻 |
| [specs/game.md](specs/game.md) | 게임 규칙 — 파티·박스·도감·상점·가방·알·진화·튜토리얼·설정 |
| [specs/scenarios.md](specs/scenarios.md) | 사용자 흐름과 수용 조건 |
| [specs/balance.md](specs/balance.md) | 가격·적립·성장 같은 밸런스 수치 |
| [specs/modules.md](specs/modules.md) | 모듈 책임과 경계, 저장 구조, 명령 계약 |
| [specs/ui-components.md](specs/ui-components.md) | 화면에서 반복되는 UI 컴포넌트 계약 |
| [contributing/workflow.md](contributing/workflow.md) | 작업 절차 |
| [contributing/writing.md](contributing/writing.md) | 문서 작성 원칙과 검수 항목 |
| [contributing/figma.md](contributing/figma.md) | Figma 글자 작업과 Galmuri 재배치 |

## 작업 기록은 저장소 밖에 둔다

설계·작업·검수 기록, 월별 이력, 진행 현황은 `worklog/` 에 둔다. 이 폴더는 `.gitignore` 로 저장소에서 뺀다(2026-09-27 결정). 공개 문서는 `worklog/` 를 링크하지 않는다. 문서 검사(`scripts/check-docs.cjs`)가 이것을 막는다.

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
