# 문서 구조와 작성 절차 정리

갱신: 2026-09-21
상태: 문서 구조 정리 완료

## 설계

목표: 현재 기준과 작업 이력을 분리한다. 한국어 문서에 적용할 작성 원칙을 검수 절차에 연결한다.
범위: 문서 이동, 참조 갱신, 작업 규칙, 문서 검사 도구.
제외: 게임 규칙 변경, Figma 수정, 앱 구현, 사용자 저장 변경.

| 위치 | 역할 |
|---|---|
| `docs/` | 입구와 현재 기준 문서 |
| `docs/specs/` | 현재 기능 계약 |
| `docs/work/<작업명>/` | 작업 기록과 해당 검수 자료 |
| `docs/history/` | 월별 완료 이력 |
| `docs/contributing/` | 작성 규칙과 작업 절차 |
| `docs/archive/` | 대체된 설계와 시안 |

새 작업은 `record.md` 하나에 설계·작업·검수·피드백·수정을 기록한다. 기존 작업은 해당 폴더의 기록을 갱신한다. 작은 후속 수정마다 파일을 추가하지 않는다.
기존 기록은 이동한다. 과거 검수 결과를 현재 결과로 다시 쓰지 않는다.

위험: 상대 링크, 코드 주석의 경로, HTML 참조가 끊길 수 있다. 근거 JSON은 이동 전후 해시를 비교한다.
사용자가 제공한 [Platty 동작 원리](https://github.com/paradigmshift-labs/platty/blob/main/guide/ko/how-platty-works.md)를 확인했다. 근거 추적과 정정 보존 방식을 적용한다. 폴더 구조는 이 프로젝트에 맞춘 결정이다.

수용 조건:

- `docs/` 바로 아래에는 README·설계·현황·명칭·사용 설명서만 둔다.
- 기존 파일의 이동 목적지를 모두 기록한다.
- 이동한 문서의 상대 링크와 저장소 참조를 갱신한다.
- 작성 규칙에 근거·용어·문장·완료 판정을 포함한다.
- 자동 검사와 사람의 의미 검수를 구분한다.
- 문서 검사와 `git diff --check`를 통과한다.

## 작업

문서 루트의 파일을 24개에서 5개로 줄였다. 파일 24개를 이동했다. 역할 지침 5개도 새 규칙 경로로 이동했다.
이동 직후 모든 파일의 SHA-256이 원본과 같았다. 이후 문서 참조와 역할 지침을 갱신했다.

| 이전 위치 | 현재 위치 |
|---|---|
| `docs/plan-s5.md` | `docs/specs/s5.md` |
| `docs/history.md` | `docs/history/2026-09.md` |
| `docs/review-s3.md` | `docs/work/s3/review.md` |
| `docs/plan-s4.md` | `docs/work/s4/plan.md` |
| `docs/review-s4.md` | `docs/work/s4/review.md` |
| `docs/plan-logo.md` | `docs/work/logo/plan.md` |
| `docs/review-logo.md` | `docs/work/logo/review.md` |
| `docs/plan-icon-concepts.md` | `docs/work/icon-concepts/plan.md` |
| `docs/review-icon-concepts.md` | `docs/work/icon-concepts/review.md` |
| `docs/feedback-icon-concepts.md` | `docs/work/icon-concepts/feedback.md` |
| `docs/plan-s5-design-system-v2.md` | `docs/work/s5-design-system-v2/plan.md` |
| `docs/review-s5-design-system-v2.md` | `docs/work/s5-design-system-v2/review.md` |
| `docs/feedback-s5-design-system-v2.md` | `docs/work/s5-design-system-v2/feedback.md` |
| `docs/figma-s5-v2-inventory.json` | `docs/work/s5-design-system-v2/evidence/inventory.json` |
| `docs/figma-s5-v2-screens-inventory.json` | `docs/work/s5-design-system-v2/evidence/screens-inventory.json` |
| `docs/plan-s5-record-cleanup.md` | `docs/work/s5-record-cleanup/plan.md` |
| `docs/review-s5-record-cleanup.md` | `docs/work/s5-record-cleanup/review.md` |
| `docs/plan-s5-terminology.md` | `docs/work/s5-terminology/plan.md` |
| `docs/review-s5-terminology.md` | `docs/work/s5-terminology/review.md` |
| `docs/roles/design.md` | `docs/contributing/roles/design.md` |
| `docs/roles/work.md` | `docs/contributing/roles/work.md` |
| `docs/roles/review.md` | `docs/contributing/roles/review.md` |
| `docs/roles/feedback.md` | `docs/contributing/roles/feedback.md` |
| `docs/roles/revision.md` | `docs/contributing/roles/revision.md` |

현재 현황에서 자산 수와 과거 검수 설명의 중복을 줄였다. 상세 근거는 해당 작업 기록으로 연결했다.
설명서의 이전 육성 수치 표를 제거했다. 현재 규칙의 코드와 설계로 연결했다.
작성 규칙에 문장·근거·상태 검수를 추가했다. 역할 지침과 AGENTS.md에 완료 전 검사를 연결했다.
문서 검사 도구를 추가했다. 구조·파일 링크·JSON 구문만 자동으로 검사한다.

## 검수

- 이동: 목적지 24개가 존재한다. 이전 경로 24개는 없다.
- 근거 보존: Figma JSON 2개의 해시가 이동 전과 같다.
- 문서 구조: 루트 파일은 README·설계·현황·명칭·설명서 5개다.
- 명령: `node scripts/check-docs.cjs`.
- 결과: 문서 44개, 파일 링크 324개, JSON 4개를 확인했다. 누락과 구문 오류는 없다.
- 명령: `git diff --check`.
- 결과: 통과.
- 앱 코드·저장·Figma 변경: 없음.
- 빌드·린트·앱 기능 검사: 미실행. 문서와 문서 검사 도구만 변경했다.

의미 검수 범위는 이번에 작성하거나 수정한 문장이다. README·작성 규칙·역할 지침·현황·설명서의 육성 절·이 기록을 확인했다.
문장마다 사실과 지시를 구분했다. 현재 구현과 제안의 근거를 분리했다. 과거 통과를 이번 검사 결과로 사용하지 않았다.
과거 문서 전체의 문체를 소급 수정하지 않았다. 공식 ASD-STE100 준수 검사를 수행했다고 기록하지 않는다.

## 피드백과 수정

| 발견 | 조치 | 상태 |
|---|---|---|
| 현재 문서와 작업 이력이 루트에 섞였다. | 기능 계약·작업 기록·월별 이력을 분리했다. | 해결 |
| 작은 후속 수정에도 새 기록 파일을 만들었다. | 기존 작업 기록 갱신을 기본으로 바꿨다. | 해결 |
| 작성 원칙이 완료 검사와 연결되지 않았다. | 역할 지침과 AGENTS.md에 의미 검수를 추가했다. | 해결 |
| 사용자 의도와 코드 존재를 같은 근거로 취급했다. | 출처와 확정 여부를 기록하도록 했다. | 해결 |
| 설명서에 오래된 육성 수치가 남았다. | 현재 코드 규칙으로 연결했다. | 해결 |
| 첫 검사에서 HTML 스크립트의 템플릿 문자열을 파일로 해석했다. | 정적 파일 검사에서 스크립트 본문을 제외했다. | 해결 |

사용자가 제공한 platty 문서를 확인했다. 관련 대상에 근거를 연결하는 방식을 작업 절차에 추가했다.
platty의 자동 분석이나 데이터베이스를 설치하지 않았다. 문서 구조는 이 저장소의 선택이다.
기존 Figma 문제와 미확정 상품은 해당 작업 기록에 남아 있다. 문서 구조 정리 완료와 구분한다.

## 2026-09-24 번호 체계 교통정리 — 설계

상태: 설계. 작업 미시작.
사용자 질문: "s1~s5, v1~v3이런거 다 구분되는게 뭐야. … 교통정리도 하고싶은데?"
사용자 결정: S 번호는 "S5 이런걸 없애고 싶었던건데". 구현 기록은 "구현 기록 새 폴더로 (권장)".

**관측** (2026-09-24, `grep` 결과)
- S0~S6 은 개발 단계 번호다. 기록·이력을 뺀 현재 문서 22개에 약 170번 나온다. 이력·보관 문서에 139번, 코드 주석에 25번 나온다.
- `docs/specs/s5.md` 로 가는 링크가 문서에 273개, 코드 주석에 43개 있다.
- "v2" 는 세 뜻으로 쓰인다. 저장 형식 v2, Figma 2판(`s5-design-system-v2`, "v2 검수"), Figma 2판 문제 번호(V2-01~V2-12)다.
- `progress.md` 머리말은 "현재 구현: S4, S5 기능 구현: 미시작"이다. 실제로는 새 게임 규칙과 저장 v3 가 구현돼 돈다.
- 구현 기록이 설계·Figma 기록과 함께 `s5-design-system-v2/plan.md` 한 파일(약 3,100줄)에 쌓인다.

**목표** — 현재 문서만 읽고 무엇이 지금 기준인지 알 수 있게 한다. 단계 번호 대신 기능 이름을 쓴다. 번호는 저장 형식 하나에만 남긴다.

**범위**
1. 현재 문서에서 S 번호를 기능 이름으로 바꾼다. 대상은 `progress.md`, `design.md`, `terms.md`, `guide.md`, `README.md`, `work/README.md`, `specs/*` 다. 예: S2 → 무대, S3 → 육성(옛 규칙), S4 → 옛 상점·진화, S5 → 새 게임 규칙·관리 창, S6 → 배포.
2. 기능 계약 파일 이름에서 번호를 뺀다. `specs/s5.md` → `specs/game.md`, `specs/s5-scenarios.md` → `specs/scenarios.md`. 링크는 모든 문서와 코드 주석에서 고친다. 이력·보관 문서의 링크도 경로만 고친다. 본문은 고치지 않는다.
3. 번호는 저장 형식에만 쓴다. `terms.md` 에 "번호 체계" 절을 두고 저장 v1~v3 를 정의한다. 문서의 "v2 검수"·"디자인 시스템 v2" 는 "Figma 2판"으로 정의한다. V2-xx 는 Figma 2판 문제 번호로 정의한다.
4. 상태 문구를 사실대로 고친다. `progress.md` 머리말과 상태 표는 단계가 아니라 기능 영역별로 적는다.
5. 구현 기록을 새 폴더 `docs/work/game-runtime/record.md` 로 나눈다. `plan.md` 의 오늘 구현 절 세 개(실제 앱을 저장 v3 으로, 저장 v3 전환과 관리 창의 검수·수정, 끊긴 기능 세 가지의 v3 설계)를 옮긴다. 옛 자리에는 옮긴 곳 링크 한 줄을 남긴다. 이 절을 가리키는 링크를 고친다.

**범위 밖**
- 이력(`docs/history/`)과 보관(`docs/archive/`) 본문, 지난 작업 기록 폴더(`work/s3`, `work/s4`, `work/s5-*`)의 이름과 본문. 당시 기록이므로 바꾸지 않는다. 링크 경로만 고친다.
- 코드 주석의 S 번호와 파일 이름의 `-v3` 꼬리표. 대부분 옛 v2 모듈에 붙어 있다. 작업 후보 2 "옛 v2 코드 정리"에서 모듈과 함께 정리한다.

**위험**
- 링크 수백 개를 바꾼다. 스크립트로 바꾸고 `node scripts/check-docs.cjs` 로 끊긴 링크를 찾는다.
- 기능 이름으로 바꾸다 뜻이 바뀔 수 있다. 문장마다 무엇을 가리키는지 확인하고 바꾼다.
- 다른 세션이 옛 경로(`specs/s5.md`)를 기억할 수 있다. `progress.md` 에 바뀐 경로를 한 줄 적는다.

**수용 검사**
1. 현재 문서(범위 1의 파일)에 `\bS[0-6]\b` 가 없다. 인용한 사용자 원문은 예외로 둔다.
2. `node scripts/check-docs.cjs` 통과. 끊긴 링크 0.
3. `git grep "specs/s5"` 결과가 0 이다.
4. `terms.md` 의 번호 체계 절이 저장 v1~v3, Figma 2판, V2-xx 를 정의한다.
5. `progress.md` 머리말이 현재 구현 상태와 맞다.
6. 코드는 주석만 바뀐다. `npm run build` 와 `npm run selftest` 가 통과한다.

**설계 조정** (2026-09-25) — 사용자 답: "이런식으로 교통정리 되어있었으면 상관없어. 작업하는데 S5 도 나왔다가 V3도 나왔다가 막 이러니까 헷갈려서 그런 교통정리가 필요했어." 승인: "진행".
S 번호를 없애지 않는다. 대응표로 정리한다. 범위를 아래 셋으로 줄인다. 위 범위 1·2(번호 치환, 파일 이름 변경)는 하지 않는다.
1. `terms.md` 에 번호 체계 절을 둔다. S0~S6 과 기능 이름, S5 와 저장 v3 의 관계, "v2" 의 세 뜻을 적는다.
2. `progress.md` 머리말·상태 표와 `design.md` 의 낡은 상태 문구를 고친다.
3. 구현 기록을 `docs/work/game-runtime/record.md` 로 나눈다.
수용 검사는 위 4·5와 `node scripts/check-docs.cjs` 통과, 옮긴 절로 가는 링크가 끊기지 않는 것이다. 코드는 바꾸지 않는다.

## 2026-09-25 번호 체계 교통정리 — 작업·검수·수정

**작업**
- `docs/terms.md` 에 [번호 체계](../../terms.md#번호-체계) 절을 더했다. 단계 S0~S6 과 기능 이름, 저장 v1~v3, S5 와 v3 의 관계, Figma 2판과 V2-xx 를 적었다. 머리말의 "현재 앱은 S4다"를 고쳤다.
- `docs/progress.md` 머리말, 현재 상태 표, 전체 설계 트리의 "현재 구현은 S4다"를 고쳤다. 상태 표에 S5 구현 행을 더했다. [작업 후보](../../progress.md#작업-후보) 표를 더했다.
- `docs/design.md` 머리말, 기술 표의 S5 행, 모듈 표 아래 문장의 "미시작"을 고쳤다.
- 구현 기록을 [S5 게임 런타임 구현 기록](../game-runtime/record.md)으로 나눴다. `s5-design-system-v2/plan.md` 끝의 세 절을 옮기고 옮긴 곳 링크를 남겼다. 새 기록은 이 저장소의 기록 형식(설계·작업·검수·피드백과 수정)에 맞춰 절을 나눴다. 링크가 가리키는 제목 세 개는 그대로 두었다. 들어오는 링크 9개를 새 경로로 고쳤다. `docs/work/README.md` 에 행을 더했다.

**검수**
- `node scripts/check-docs.cjs`: 문서 51개, 파일 링크 1080개 통과.
- 이 검사는 `#` 앵커를 보지 않는다. 바꾼 파일 네 개로 가는 링크 454개의 앵커를 GitHub 제목 규칙으로 따로 확인했다. 끊긴 링크 1개를 찾았다.
- `git diff --check` 통과. 코드는 바꾸지 않았으므로 빌드와 자체 검사는 실행하지 않았다.

**피드백과 수정**
- `progress.md` 의 `plan.md#부화·진화·교체의-트랜잭션-적용` 은 이번 변경 전부터 끊겨 있었다. GitHub 앵커는 `·` 를 뺀다. `#부화진화교체의-트랜잭션-적용` 으로 고쳤다.
- 옮기면서 첫 검증 문단의 "별명은 legacy 에서 되살아나며"를 뺐다가 되살렸다. 당시에는 사실인 기록이다. 뒤에 "별명 표시는 끊긴 기능 작업에서 계약대로 뺐다"를 붙였다.
- 변경 문장은 쓰기 점검표로 검토했다. 사용자 원문을 인용했다.

## 2026-09-27 문서·디렉토리 잔재 정리

사용자 지시 원문: "문서들, 디렉토리 내용들 좀 정리하고있어봐. 필요없는 문서나 명칭안맞는거등이 좀 많을거같아서. 이전작업 잔재들이 좀 많은거로알아"

**설계**
- 범위: 현재 상태와 어긋난 문장, 코드가 쓰지 않는 파일, 이미 바뀐 이름. 문서 조사와 디렉토리 조사를 따로 돌려 근거(참조 grep)를 모았다.
- 제외: 정식 용어 자체의 변경(사용자 결정이 필요하다), `s3`·`s4`·`s5-*` 폴더 이름(2026-09-25 결정 "S 번호를 없애지 않는다", 파일 이름은 바꾸지 않는다), 지난 작업 기록 안의 당시 문장, 다른 세션이 고치는 파일(`progress.md`·`history/2026-09.md`·`game-runtime/record.md` 는 terminal-pokemon-18 의 미커밋 변경이 있어 그 커밋 뒤로 미룸, `supabase/`).
- 다른 세션 확인: terminal-pokemon-67(교환) 은 `trade/record.md` 두 곳 수정과 `modules.md` 정리에 동의했다. 사용자 인용은 바꾸지 않는다는 조건이다. terminal-pokemon-18 은 위 세 파일을 커밋 전까지 두라고 했다.

**작업 — 지운 것**
- `data/shop.json`: 2026-09-25 옛 상점 코드를 걷은 뒤 읽는 코드가 없다(grep 0). 설치본(`files` 의 `data/`)에 실려 있었다. 링크 네 곳을 글자로 바꿨다.
- `src/tools/build-logo.ts`, `assets/logo/src/logo.txt`·`logo.small.txt`: `npm run logo:build` 는 `scripts/sync-official-logo.js`(SVG)를 돈다. 픽셀 지도 방식은 공식 SVG 로고로 바꾼 뒤(`f5f9dbb`) 쓰지 않는다. `guide.md` 로고 절을 SVG 방식으로 고쳤다.

**작업 — 고친 문장**
- `design.md`: 명령 목록을 `CommandName` 에 맞췄다. `pet.set size` 의 `not-yet`, 저장 버전 미정, 탭·그림의 "본문 없음·연결 전"을 지금 상태로 고쳤다. `유대의끈` → `연결의끈`(이름 변경 표시).
- `terms.md`: S6 상태를 "진행 중, v0.3.0·v0.3.1 공개"로.
- `specs/*.md` 머리말 다섯 곳과 `s5.md` 12절의 "구현 미시작"에 "(당시)"를 붙이고 현재 상태 줄을 더했다.
- `specs/modules.md`: 표에 없던 기존 폴더 다섯 개(`commands`·`cli`·`hooks`·`shared`·`tools`), 명령 `pet.form`·`starter.pick`·`box.*` 를 더했다. 구현하지 않은 `settings.open` 을 적었다. "남은 일"을 끝남으로 고쳤다. 교환 저장 구조는 교환 세션 몫으로 남겼다.
- `docs/README.md` 문서 트리와 `work/README.md` 목록에 09-22 뒤 작업 폴더를 더했다.
- `work/trade/record.md` 21·134행 설명의 `유대의끈` → `연결의끈`. 사용자 선택지 인용 "유대의끈 유지"는 그대로다.
- 코드 주석: 없는 문서 `s2-plan` 을 가리키던 번호 여섯 곳을 걷었다. "S2 유지 · S5 에 이식"을 "JS 로 남아 있다"로, `menus.ts` 우클릭 설명을 지금 세 묶음으로, `legacy.ts` 머리를 "v3 이전 파일 읽기"로, `registry.ts` 의 "S5 에서 옮긴다"를 `[리팩토링 대상]` 태그로 고쳤다.

**남긴 것 (근거)**
- `lib/`·`art/`·`cli/`·`config.js`·`helpers/`·`bin/`: CLI·설치본·`src/main` 이 require 한다.
- `shell/pokebuddy.zsh`: `guide.md` 의 git clone 설치 안내가 쓴다.
- `pokebuddy.config.example.json`: `guide.md` 가 형식 참고로 가리킨다.
- `assets/icon-concepts/`: 코드는 안 쓰지만 `work/icon-concepts` 기록의 근거다.
- `src/save/legacy.ts`: v1·v2 저장을 v3 으로 옮길 때 쓴다. `-v3` 꼬리표 이름 정리는 import 가 많아 하지 않았다.
- `archive/s5-legacy/`: 이미 보관된 자료다.

**이어서 한 것** (terminal-pokemon-18 커밋 `8f469b9` 뒤)
- `progress.md`: 머리말을 v0.3.1 기준으로. "다른 세션에서 재개"를 지금 절차(여러 세션 동시 작업, 미커밋 확인, Figma 먼저)로 바꿨다. 2026-09-22 결정 목록과 재개 요청 예시는 뺐다 — 결정은 `design.md`, 발언은 `s5-design-system-v2/plan.md` 에 있다. 다른 PC 인계 기준일, S6 상태, 크기 1~6 문장, 끝난 "재개 순서"를 고쳤다. "설정창"으로 맞췄다.
- `history/2026-09.md`: `history/README.md` 규칙("최신 항목을 위에")대로 다시 늘어놓았다. 항목 내용은 그대로다(줄 비교로 잃은 줄 0). "기록 형식" 절 안에 끼어 있던 09-18 항목을 09-18 묶음으로 옮겼다. 빠져 있던 v0.3.0·v0.3.1 공개 항목을 커밋 근거와 함께 더했다.

**명칭 결정** (2026-09-27 사용자 답)
- "1. 설정창으로.": 현재 기준 문서(`design`·`terms`·`guide`·`progress`·`specs` 4개)의 "관리 창" 67곳을 "설정창"으로 바꿨다. 링크 주소(다른 기록의 제목 앵커)는 그대로다. 같은 문서 안 앵커 `#게임--설정창과-cli` 하나를 고쳤다. 앱 메뉴 문구 "관리 창 열기"를 "설정창 열기"로 바꿨다(`src/main/app.ts` 두 곳, 주석 두 곳). 지난 작업 기록·이력은 당시 기록이라 그대로다. `terms.md` 설정창 항목에 옛 이름과 코드 식별자 `manage` 를 적었다.
- "2. 추가.": `terms.md` 에 "코치마크"를 더했다.
- "3. 너가보기엔 어때": 가이드북(앱 안 사용법)과 설명서(`docs/guide.md`, 설치·명령·개발)를 나누자고 제안했다. 사용자 답 "그렇게 해". `terms.md` 가이드북 정의에서 "설명서"를 빼고 "설명서" 항목을 더했다. 앱 화면과 파일은 바꾸지 않았다.

**검수**
- `node scripts/check-docs.cjs`: 통과(문서 57개).
- `npm run check`: 통과. 코드는 주석과 지운 도구 파일만 바뀌었다.
- `git diff --check`: 통과.
- 의미 검수: 바꾼 문장을 작성 점검표로 읽었다. 사용자 인용은 바꾸지 않았다.
