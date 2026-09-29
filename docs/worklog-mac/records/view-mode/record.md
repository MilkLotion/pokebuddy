# 도감·상점 보는 방식 고르기 (2026-09-29, 맥)

## 설계

### 사용자 요청과 결정

- 요청(2026-09-29): "도감이랑 상점 그거 사용자가 보는방식 정하게 하자. segement tab처럼 되어있고 그거로 보는방식바꾸는거 알지?"
- 결정 1: 도감 탭과 상점 포켓몬 탭에 보는 방식을 바꾸는 세그먼트 토글을 둔다. 방식은 `격자`와 `목록` 두 가지다.
- 결정 2: 목록은 한 줄에 한 종이다. 번호, 작은 초상, 이름, 타입(상점은 가격)을 보인다. 한 쪽에 창에 들어가는 줄 수만 보이고 ◀ ▶로 넘긴다. 스크롤은 없다. Claude가 권장안으로 제시했고 사용자가 골랐다.
- 결정 3: 고른 방식은 도감과 상점을 따로 기억한다. 앱을 다시 켜도 유지한다. Claude가 권장안으로 제시했고 사용자가 골랐다.
- 격자는 지금처럼 한 쪽 15칸(5×3)이다.

### 제안 (Claude, 사용자 확인 전)

- 토글 모양: 검색 줄 오른쪽 끝의 아이콘 두 개짜리 세그먼트(격자 아이콘 · 목록 아이콘). 선택된 쪽은 톤 배경이다. 컬러 테두리 강조는 쓰지 않는다(사용자 디자인 선호).
- 저장 위치: 게임 저장(`save.json`)이 아니라 앱 설정(화면 표시 선호)에 둔다. 클라우드 저장과 무관하다.
- 방식을 바꾸면 지금 보던 첫 항목이 들어 있는 쪽으로 간다.
- 기본값은 `격자`다.

### 범위

- `src/renderer/manage.ts`, `src/renderer/manage.html`, 설정 저장 경로(`src/state/settings.ts` 등 기존 관례), `src/shared/manage.d.ts`, `docs/specs/ui-components.md`, `docs/specs/game.md`(도감·상점 화면), `docs/guide.md`.
- 제외: Figma 수정, 박스 탭(이미 원작 박스 격자), 다른 상점 분류(알·도구·진화·파티 칸은 줄 목록 그대로).

### 위험

- 1초 갱신 부분 갱신(`applyLive`)과 포커스 복원이 목록 모양에서도 동작해야 한다.
- 도감 기기 창의 이전·다음이 쪽을 넘기는 동작이 두 방식에서 같아야 한다.
- 목록 한 쪽 줄 수가 창 높이(682)와 최소 높이에서 스크롤 없이 들어가야 한다.

### 수용 조건

- 도감과 상점 포켓몬 탭에서 토글로 격자와 목록을 바꿀 수 있다.
- 두 방식 모두 스크롤 없이 쪽 넘김으로 본다. 지방·검색이 바뀌면 1쪽이다.
- 도감에서 목록, 상점에서 격자를 고른 뒤 앱을 다시 켜도 각자 유지된다.
- 목록 줄을 누르면 격자 칸을 누른 것과 같다(도감은 기기 창, 상점은 구매 창).
- 미해금 종은 목록에서도 `???`로 보인다.

## 작업

- `src/renderer/manage.ts`
  - `viewToggle`: 검색 줄 오른쪽 끝 아이콘 두 개. 고른 쪽은 `aria-pressed` + 톤 배경.
  - `dexRow`: 번호·작은 초상·이름·타입. 미해금은 `???`, 초상 실루엣, 타입 숨김. 누르면 `pickDex`.
  - `shopLine`: 번호·작은 초상·이름·가격. `blocked`가 있으면 앞에 한 줄. 누르면 구매 창.
  - 한 쪽 크기: 목록 `LIST_PAGE` 8줄, 격자 15칸(`pageSize(mode)`).
  - 방식을 바꾸면 지금 쪽의 첫 항목이 든 쪽으로 간다(`pageAfterSwitch`). 지방·검색·칩이 바뀌면 1쪽.
  - `stepDex`는 지금 방식의 쪽 크기로 쪽을 넘긴다. 도감 튜토리얼 대상에 목록 줄 포함.
- `src/renderer/manage.html`: `.view-toggle`, `.dex-list`, `.list-row`(32px).
- `src/shared/manage.d.ts`, `src/tx/lists.ts`: `DexEntry`에 `types`·`typeIds` 선택 필드. 미해금은 빈 배열.
- 기억: 관리 창 localStorage `pokebuddy.view.dex`·`pokebuddy.view.shop`. 이유(서브 에이전트 판단): `save.settings`는 게임 저장이라 클라우드로 동기화되고, `config.js`는 읽기 전용이며, 화면 표시 선호를 쓰는 곳이 따로 없다. Electron `userData`(`PATHS.electronData`)에 남아 재시작 후에도 유지된다. 실패하면 기본값 격자.
- 문서: `docs/specs/ui-components.md` C-11(제안 분리 표시), `docs/specs/game.md`(화면 표, 5절, 상점 포켓몬 절), `docs/guide.md` 한 줄.
- `src/tools/smoke-manage.ts` 검사 (9).

## 검수

- 서브 에이전트: build, check, selftest-manage·screens·snapshot·dex·unlocks 통과, smoke-manage 통과(목록 8줄, `2 / 129`, 넘침 0, `???`, 줄 클릭 → dexOpen·구매 창, 도감·상점 따로 기억과 다시 읽기 뒤 유지), `git diff --check` 통과, check-docs는 worklog-mac 한 줄.
- Claude 직접(임시 HOME): `npm run check`, `npm run build` 통과. smoke-manage exit 0. selftest-manage·screens·snapshot·dex 통과. `git diff --check` 통과. 스크린샷 도감 목록·상점 목록을 봤다.
- 확인하지 않음: 최소 창 높이 560에서의 넘침(격자도 682 기준), 앱 실기.

## 피드백과 수정

- 관찰(Claude): 682 창에서 목록 8줄 아래에 빈 공간이 약 80px 남는다.
- 사용자 피드백(2026-09-29): "리스트는 기존처럼". Claude가 모양인지 스크롤인지 물었고 사용자는 "스크롤을 기존처럼"을 골랐다.
- 결정 4: 목록 보기는 쪽 넘김 없이 세로 스크롤로 전부 보인다. 결정 2의 "쪽 넘김, 스크롤 없음"을 대체한다. 격자는 15칸 쪽 넘김을 유지한다.
- 수정: `LIST_PAGE` 제거. 목록은 걸러진 종 전부, 넘김 줄 없음, 초상 lazy. `.list-row`에 `content-visibility: auto`. `switchView`: 격자 → 목록은 격자 쪽 첫 항목 줄로 스크롤, 목록 → 격자는 맨 위 줄이 든 쪽. `stepDex`: 목록은 그 줄이 보이게 스크롤(nearest). 문서 C-11·game.md·guide.md 갱신(전환 방식은 제안).
- 검수: 서브 에이전트 smoke-manage (9)(1025줄, 넘김 줄 없음, 맨 위 `#0016`, 전체 다시 그리기 뒤 scrollTop 1234 유지, 상점 목록 스크롤, 따로 기억). Claude 직접: check, build, smoke-manage exit 0, selftest-manage·screens·snapshot, `git diff --check` 통과. 스크린샷(도감 목록 16번부터)을 봤다.

- 사용자 피드백(2026-09-29): "이해를 못한건가?? 리스트형태는 작업하기 이전의 그 스크롤되는거로 하라고"
- 정정(Claude): "기존처럼"을 스크롤 방식만으로 해석하고, 모양은 새로 만든 한 줄 목록을 그대로 두었다. 사용자의 뜻은 작업 전 화면 자체였다. 두 번 잘못 전달했다.
- 작업 전 모습(관찰, 커밋 `9662a46`): 상점 포켓몬은 `shopRow` 상품 줄 카드(`.rows` 두 열) 세로 스크롤, 도감은 `.dex-grid` 칸 격자 세로 스크롤(쪽 넘김 없음).
- 결정 5: 목록 보기 = 작업 전 화면 그대로(상점·도감 둘 다). 결정 2의 한 줄 목록 모양을 대체한다. Claude가 미리보기로 물었고 사용자가 골랐다.
- 수정: 스크롤 방식에서 도감은 `9662a46`의 `.dex-grid` + `dexCell`(같은 코드), 상점은 `shopRow` 상품 줄 카드(`.rows` 두 열)를 전부 그리고 세로 스크롤한다. `dexRow`·`shopLine`·`.dex-list`·`.list-row`·`DexEntry.types` 추가는 걷어냈다(`src/tx/lists.ts`·`src/shared/manage.d.ts` diff 없음). 유지: 지방·검색(Enter), 1초 부분 갱신, 포커스 복원, 세대 번호, 조사, 초상 lazy, 전환 시 자리 잇기(다음 프레임에 한 번 더 맞춤), 스크롤 위치 유지, 기기 창 이전·다음 스크롤.
- 토글 `aria-label`·`title`: `쪽으로 보기` / `스크롤로 보기`(서브 에이전트 판단, 사용자 확인 전). 기억 키와 저장 위치는 그대로다.
- 문서: C-11(결정 원문 인용, 제안 줄 분리), game.md, guide.md.
- 검수: 서브 에이전트 smoke-manage (9)(도감 1025칸, 넘김 줄 없음, 맨 위 `#0016`, scrollTop 1234 유지, 상점 카드 100개 넘게·격자 칸 0개, 따로 기억), selftest-manage·screens·snapshot·unlocks 통과. Claude 직접: check, build, smoke-manage exit 0, selftest-manage·screens·snapshot, `git diff --check` 통과. 스크린샷(상점 두 열 카드, 도감 칸 격자 스크롤)을 봤다.

### 실기 확인 항목

1. 토글 모양과 위치(제안).
2. 목록 줄 글자 크기와 줄 간격. 스크롤이 매끄럽고 초상이 채워진다. 스크롤해 둔 채 기다려도 위치가 튀지 않는다.
3. 도감을 목록, 상점을 격자로 두고 앱을 다시 켜도 그대로다.
4. 도감 기기 창 ◀ ▶로 목록 줄이 따라 스크롤된다. 격자와 목록을 오갈 때 보던 자리가 이어진다.
